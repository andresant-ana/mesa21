import assert from "node:assert/strict";
import test from "node:test";
import { AccountDirectory } from "../src/worker/AccountDirectory.ts";
import worker from "../src/worker/index.ts";

const goodPassword = "8chars!!";
const nextPassword = "Different stronger password 2026!";

function fixture() {
  const map = new Map<string, unknown>();
  const store = {
    async get<T>(key: string) { return map.get(key) as T | undefined; },
    async put<T>(key: string, value: T) { map.set(key, structuredClone(value)); }
  };
  const directory = new AccountDirectory({ storage: store }, {} as never);
  async function endpoint(path: string, body?: unknown, token?: string) {
    const response = await directory.fetch(new Request("https://internal" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: token ? { "x-mesa21-auth-token": token } : {},
      body: body === undefined ? undefined : JSON.stringify(body)
    }));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  return { map, endpoint, directory };
}

test("cadastro e login persistem com hash/salt, sem senha ou recuperação em claro no armazenamento", async () => {
  const { endpoint, map } = fixture();
  const registered = await endpoint("/auth/register", { username: "andre", password: goodPassword });
  assert.equal(registered.status, 201);
  const token = registered.body.authToken as string;
  const recovery = registered.body.recoveryCode as string;
  assert.match(token, /^[A-Za-z0-9_-]{40,64}$/);
  assert.match(recovery, /^[A-Za-z0-9_-]{40,64}$/);
  assert.equal((registered.body.user as { username: string }).username, "andre");
  const serialized = JSON.stringify(map.get("auth:v1"));
  assert.ok(!serialized.includes(goodPassword));
  assert.ok(!serialized.includes(token));
  assert.ok(!serialized.includes(recovery));
  const me = await endpoint("/auth/me", undefined, token);
  assert.equal(me.status, 200);
  assert.equal((me.body.user as { username: string }).username, "andre");
  const signedIn = await endpoint("/auth/login", { username: "ANDRE", password: goodPassword });
  assert.equal(signedIn.status, 200);
  assert.notEqual(signedIn.body.authToken, token);
  assert.equal((await endpoint("/auth/register", { username: "AnDrE", password: goodPassword })).status, 409);
});

test("recovery code é de uso único, troca senha, revoga sessões antigas e entrega novo código", async () => {
  const { endpoint } = fixture();
  const registered = await endpoint("/auth/register", { username: "luigi21", password: goodPassword });
  const before = registered.body.authToken as string;
  const recovered = await endpoint("/auth/recover", {
    username: "luigi21",
    recoveryCode: registered.body.recoveryCode,
    newPassword: nextPassword
  });
  assert.equal(recovered.status, 200);
  assert.notEqual(recovered.body.recoveryCode, registered.body.recoveryCode);
  assert.equal((await endpoint("/auth/me", undefined, before)).status, 401);
  assert.equal((await endpoint("/auth/login", { username: "luigi21", password: goodPassword })).status, 401);
  assert.equal((await endpoint("/auth/login", { username: "luigi21", password: nextPassword })).status, 200);
  assert.equal((await endpoint("/auth/recover", {
    username: "luigi21", recoveryCode: registered.body.recoveryCode, newPassword: goodPassword
  })).status, 401);
});

test("logout revoga token, não derruba outra sessão e mantém perfil", async () => {
  const { endpoint } = fixture();
  const initial = await endpoint("/auth/register", { username: "stef", password: goodPassword });
  const token1 = initial.body.authToken as string;
  const login = await endpoint("/auth/login", { username: "stef", password: goodPassword });
  const token2 = login.body.authToken as string;
  assert.equal((await endpoint("/auth/logout", {}, token1)).status, 200);
  assert.equal((await endpoint("/auth/me", undefined, token1)).status, 401);
  assert.equal((await endpoint("/auth/me", undefined, token2)).status, 200);
});

test("rejeita senhas fracas e usernames inválidos, e bloqueia após cinco erros", async () => {
  const { endpoint } = fixture();
  assert.equal((await endpoint("/auth/register", { username: "ab", password: goodPassword })).status, 400);
  assert.equal((await endpoint("/auth/register", { username: "shortpw", password: "7chars!" })).status, 400);
  const eight = await endpoint("/auth/register", { username: "eightchr", password: goodPassword });
  assert.equal(eight.status, 201);
  assert.equal((await endpoint("/auth/login", { username: "eightchr", password: goodPassword })).status, 200);
  assert.equal((await endpoint("/auth/me", undefined, eight.body.authToken as string)).status, 200);
  const long = await endpoint("/auth/register", { username: "longpassword", password: nextPassword });
  assert.equal(long.status, 201, "passwords of 12 or more characters remain valid");
  assert.equal((await endpoint("/auth/login", { username: "longpassword", password: nextPassword })).status, 200);
  assert.equal((await endpoint("/auth/register", { username: "test", password: "123" })).status, 400);
  assert.equal((await endpoint("/auth/register", { username: "admin", password: goodPassword })).status, 400);
  await endpoint("/auth/register", { username: "matheus", password: goodPassword });
  for (let i = 0; i < 5; i++) {
    assert.equal((await endpoint("/auth/login", { username: "matheus", password: "wrong password!" })).status, 401);
  }
  assert.equal((await endpoint("/auth/login", { username: "matheus", password: goodPassword })).status, 429);
  assert.equal((await endpoint("/auth/recover", {
    username: "matheus", recoveryCode: "not-a-code", newPassword: nextPassword
  })).status, 429);
});

test("Worker mantém token da conta apenas em cookie HttpOnly Secure, nunca no JSON", async () => {
  const { directory } = fixture();
  const env = {
    ENVIRONMENT: "development", ALLOWED_ORIGINS: "",
    ASSETS: { fetch: async () => new Response("asset") },
    GAME_SESSIONS: { idFromName: () => ({ toString: () => "solo" }), get: () => ({ fetch: async () => new Response("unused") }) },
    ROOM_LOBBY: { idFromName: () => ({ toString: () => "rooms" }), get: () => ({ fetch: async () => new Response("unused") }) },
    ACCOUNT_DIRECTORY: { idFromName: () => ({ toString: () => "accounts-v1" }), get: () => ({ fetch: (request: Request) => directory.fetch(request) }) }
  };
  const register = await worker.fetch(new Request("https://mesa21.test/api/auth/register", {
    method: "POST", headers: { origin: "https://mesa21.test", "content-type": "application/json",
      "x-mesa21-auth-token": "forged" },
    body: JSON.stringify({ username: "rafa", password: goodPassword })
  }), env as never);
  assert.equal(register.status, 201);
  const response = await register.json() as Record<string, unknown>;
  assert.equal(response.authToken, undefined);
  assert.equal(typeof response.recoveryCode, "string");
  const authCookie = (register.headers.get("set-cookie") ?? "").match(/mesa21_auth=[\w-]+/);
  assert.ok(authCookie);
  assert.match(register.headers.get("set-cookie") ?? "", /HttpOnly/);
  assert.match(register.headers.get("set-cookie") ?? "", /Secure/);
  const me = await worker.fetch(new Request("https://mesa21.test/api/auth/me", {
    headers: { Cookie: authCookie[0] }
  }), env as never);
  assert.equal(me.status, 200);
  assert.equal((await me.json() as { user: { username: string } }).user.username, "rafa");
  const untrusted = await worker.fetch(new Request("https://mesa21.test/api/auth/me", {
    headers: { "x-mesa21-auth-token": authCookie[0].split("=")[1] }
  }), env as never);
  assert.equal(untrusted.status, 401);
  const denied = await worker.fetch(new Request("https://mesa21.test/api/auth/logout", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}"
  }), env as never);
  assert.equal(denied.status, 403);
});
