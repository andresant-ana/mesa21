import type { DurableObjectState, Env } from "./types.ts";

type Account = {
  id: string;
  username: string;
  key: string;
  passwordSalt: string;
  passwordHash: string;
  recoveryHash: string;
  createdAt: number;
};
type AuthSession = { accountId: string; expiresAt: number; createdAt: number };
type LoginThrottle = { failures: number; until: number };
type AuthDatabase = {
  accounts: Record<string, Account>;
  sessions: Record<string, AuthSession>;
  throttles: Record<string, LoginThrottle>;
};

const AUTH_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const THROTTLE_MS = 15 * 60 * 1000;
const PBKDF2_ITERATIONS = 210_000;
const MAX_ACCOUNTS = 1_000;
const MAX_FAILURES = 5;
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;
const encoder = new TextEncoder();

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function blankDatabase(): AuthDatabase {
  return { accounts: Object.create(null), sessions: Object.create(null), throttles: Object.create(null) };
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes);
}
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
async function digest(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
async function passwordHash(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt: fromBase64url(salt),
    iterations: PBKDF2_ITERATIONS
  }, key, 256);
  return base64url(new Uint8Array(bits));
}
function equalDigest(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
function publicAccount(account: Account) {
  return { id: account.id, username: account.username, createdAt: account.createdAt };
}
async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}
function validUsername(value: unknown): value is string {
  return typeof value === "string" && USERNAME_PATTERN.test(value) &&
    !["admin", "moderator", "support", "mesa21", "system"].includes(value.toLowerCase());
}
function saveSession(database: AuthDatabase, account: Account, tokenHash: string, now: number): void {
  const active = Object.entries(database.sessions)
    .filter(([, entry]) => entry.accountId === account.id)
    .sort(([, a], [, b]) => a.createdAt - b.createdAt);
  for (const [oldToken] of active.slice(0, Math.max(0, active.length - 4))) delete database.sessions[oldToken];
  database.sessions[tokenHash] = { accountId: account.id, createdAt: now, expiresAt: now + AUTH_SESSION_MS };
}
function throttle(database: AuthDatabase, key: string, now: number): boolean {
  return (database.throttles[key]?.failures ?? 0) >= MAX_FAILURES &&
    (database.throttles[key]?.until ?? 0) > now;
}
function recordFailure(database: AuthDatabase, key: string, now: number): void {
  const previous = database.throttles[key];
  const failures = previous && previous.until > now ? previous.failures + 1 : 1;
  database.throttles[key] = { failures, until: now + THROTTLE_MS };
}
function clean(database: AuthDatabase, now: number): void {
  for (const [token, session] of Object.entries(database.sessions)) {
    if (session.expiresAt <= now) delete database.sessions[token];
  }
  for (const [key, entry] of Object.entries(database.throttles)) {
    if (entry.until <= now) delete database.throttles[key];
  }
}

export class AccountDirectory {
  private readonly storage: DurableObjectState["storage"];
  private queue: Promise<void> = Promise.resolve();

  constructor(state: DurableObjectState, _env: Env) {
    this.storage = state.storage;
  }

  fetch(request: Request): Promise<Response> {
    const current = this.queue.then(() => this.handle(request)).catch(() =>
      response({ error: "INTERNAL_ERROR" }, 500));
    this.queue = current.then(() => undefined, () => undefined);
    return current;
  }

  private async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const now = Date.now();
    const database = (await this.storage.get<AuthDatabase>("auth:v1")) ?? blankDatabase();
    clean(database, now);
    const rawToken = request.headers.get("x-mesa21-auth-token") ?? "";
    // The Worker, not the browser, is the only allowed source of this internal header.
    const tokenHash = TOKEN_PATTERN.test(rawToken) ? await digest(rawToken) : null;
    const authSession = tokenHash ? database.sessions[tokenHash] : undefined;
    const currentAccount = authSession
      ? Object.values(database.accounts).find((account) => account.id === authSession.accountId)
      : undefined;

    if (path === "/auth/me" && request.method === "GET") {
      return currentAccount ? response({ user: publicAccount(currentAccount) }) :
        response({ error: "UNAUTHORIZED" }, 401);
    }
    if (request.method !== "POST") return response({ error: "NOT_FOUND" }, 404);
    const body = await parseBody(request);
    if (!body) return response({ error: "INVALID_REQUEST" }, 400);

    if (path === "/auth/logout") {
      if (tokenHash) delete database.sessions[tokenHash];
      await this.storage.put("auth:v1", database);
      return response({ ok: true, clearAuth: true });
    }

    if (path === "/auth/register") {
      if (!validUsername(body.username) || !validPassword(body.password)) {
        return response({ error: "INVALID_CREDENTIALS_FORMAT" }, 400);
      }
      const username = body.username;
      const key = username.toLowerCase();
      if (database.accounts[key]) return response({ error: "USERNAME_TAKEN" }, 409);
      if (Object.keys(database.accounts).length >= MAX_ACCOUNTS) {
        return response({ error: "SIGNUP_LIMIT_REACHED" }, 503);
      }
      const salt = randomSecret();
      const recoveryCode = randomSecret();
      const account: Account = {
        id: crypto.randomUUID(), username, key, passwordSalt: salt,
        passwordHash: await passwordHash(body.password, salt),
        recoveryHash: await digest(recoveryCode), createdAt: now
      };
      database.accounts[key] = account;
      const authToken = randomSecret();
      saveSession(database, account, await digest(authToken), now);
      await this.storage.put("auth:v1", database);
      return response({ user: publicAccount(account), recoveryCode, authToken }, 201);
    }

    if (path === "/auth/login" || path === "/auth/recover") {
      if (typeof body.username !== "string" || !USERNAME_PATTERN.test(body.username)) {
        return response({ error: "INVALID_CREDENTIALS" }, 401);
      }
      const key = body.username.toLowerCase();
      if (throttle(database, key, now)) return response({ error: "TOO_MANY_ATTEMPTS" }, 429);
      const account = database.accounts[key];
      let valid = false;
      if (path === "/auth/login") {
        if (typeof body.password === "string" && account) {
          valid = equalDigest(await passwordHash(body.password, account.passwordSalt), account.passwordHash);
        }
      } else {
        if (typeof body.recoveryCode === "string" && validPassword(body.newPassword) && account) {
          valid = equalDigest(await digest(body.recoveryCode), account.recoveryHash);
        }
      }
      if (!valid || !account) {
        recordFailure(database, key, now);
        await this.storage.put("auth:v1", database);
        return response({ error: "INVALID_CREDENTIALS" }, 401);
      }
      delete database.throttles[key];
      if (path === "/auth/recover") {
        account.passwordSalt = randomSecret();
        account.passwordHash = await passwordHash(body.newPassword as string, account.passwordSalt);
        const recoveryCode = randomSecret();
        account.recoveryHash = await digest(recoveryCode);
        for (const [hash, entry] of Object.entries(database.sessions)) {
          if (entry.accountId === account.id) delete database.sessions[hash];
        }
        const authToken = randomSecret();
        saveSession(database, account, await digest(authToken), now);
        await this.storage.put("auth:v1", database);
        return response({ user: publicAccount(account), recoveryCode, authToken });
      }
      const authToken = randomSecret();
      saveSession(database, account, await digest(authToken), now);
      await this.storage.put("auth:v1", database);
      return response({ user: publicAccount(account), authToken });
    }
    return response({ error: "NOT_FOUND" }, 404);
  }
}
