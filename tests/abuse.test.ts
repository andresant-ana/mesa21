import assert from "node:assert/strict";
import test from "node:test";
import { checkAbuseLimit } from "../src/worker/abuse.ts";
import worker from "../src/worker/index.ts";

type Limiter = { limit(input: { key: string }): Promise<{ success: boolean }> };
type Counter = { key: string; count: number };
const limit = (max: number, counts: Counter[] = []): Limiter => ({
  async limit({ key }) {
    let entry = counts.find((item) => item.key === key);
    if (!entry) { entry = { key, count: 0 }; counts.push(entry); }
    entry.count += 1;
    return { success: entry.count <= max };
  }
});
const fakeReq = (path: string, ip = "203.0.113.8", method = "GET") =>
  new Request("https://mesa21.test" + path, { method, headers: { "cf-connecting-ip": ip } });
const enabled = () => ({
  ENVIRONMENT: "production",
  ABUSE_API: limit(100),
  ABUSE_AUTH: limit(100),
  ABUSE_SIGNUP: limit(100),
  ABUSE_ROOMS: limit(100),
  ABUSE_SOCKETS: limit(100)
});

test("production blocks missing rate-limit bindings or missing edge identity, development runs without them", async () => {
  assert.equal(await checkAbuseLimit(fakeReq("/api/session"), { ENVIRONMENT: "development" }, "/api/session", null), null);
  const absent = await checkAbuseLimit(fakeReq("/api/session"), { ENVIRONMENT: "production" }, "/api/session", null);
  assert.equal(absent?.status, 503);
  assert.equal((await absent?.json() as { error: string }).error, "RATE_LIMIT_UNAVAILABLE");

  const noIp = await checkAbuseLimit(new Request("https://mesa21.test/api/session"),
    enabled(), "/api/session", null);
  assert.equal(noIp?.status, 503);
  assert.equal((await noIp?.json() as { error: string }).error, "CLIENT_IDENTITY_UNAVAILABLE");
});

test("production rate limits signup by edge IP before expensive password hashing", async () => {
  const env = { ...enabled(), ABUSE_SIGNUP: limit(2) };
  assert.equal(await checkAbuseLimit(fakeReq("/api/auth/register", "203.0.113.8", "POST"),
    env, "/api/auth/register", null), null);
  assert.equal(await checkAbuseLimit(fakeReq("/api/auth/register", "203.0.113.8", "POST"),
    env, "/api/auth/register", null), null);
  const denied = await checkAbuseLimit(fakeReq("/api/auth/register", "203.0.113.8", "POST"),
    env, "/api/auth/register", null);
  assert.equal(denied?.status, 429);
  assert.equal(denied?.headers.get("retry-after"), "60");
  assert.equal((await denied?.json() as { error: string }).error, "RATE_LIMITED");
  assert.equal(await checkAbuseLimit(fakeReq("/api/auth/register", "203.0.113.9", "POST"),
    env, "/api/auth/register", null), null);
});

test("shared authentication limit covers both login and recovery attempts", async () => {
  const env = { ...enabled(), ABUSE_AUTH: limit(1) };
  assert.equal(await checkAbuseLimit(fakeReq("/api/auth/login", "2001:db8::123", "POST"),
    env, "/api/auth/login", null), null);
  const denied = await checkAbuseLimit(fakeReq("/api/auth/recover", "2001:db8::123", "POST"),
    env, "/api/auth/recover", null);
  assert.equal(denied?.status, 429);
});

test("room requests and WebSocket upgrades have dedicated quotas", async () => {
  const env = { ...enabled(), ABUSE_SOCKETS: limit(1) };
  const req = fakeReq("/api/rooms/ABCDEF012345/stream");
  assert.equal(await checkAbuseLimit(req, env, "/api/rooms/ABCDEF012345/stream", null), null);
  const denied = await checkAbuseLimit(req, env, "/api/rooms/ABCDEF012345/stream", null);
  assert.equal(denied?.status, 429);
  assert.equal(await checkAbuseLimit(fakeReq("/api/rooms/ABCDEF012345/join", "203.0.113.8", "POST"),
    env, "/api/rooms/ABCDEF012345/join", null), null);
});

test("configured limiter errors fail closed, not silently bypassed", async () => {
  const env = { ...enabled(), ABUSE_API: { async limit() { throw new Error("backend unavailable"); } } };
  const response = await checkAbuseLimit(fakeReq("/api/auth/login", "203.0.113.8", "POST"),
    env, "/api/auth/login", null);
  assert.equal(response?.status, 503);
  assert.equal((await response?.json() as { error: string }).error, "RATE_LIMIT_UNAVAILABLE");
});

test("Worker replies 429 without forwarding a blocked request to accounts", async () => {
  let objectCalls = 0;
  const forbiddenObject = { idFromName: () => ({ toString: () => "test" }), get: () => ({
    fetch: async () => { objectCalls += 1; return new Response("{}"); }
  }) };
  const config = {
    ...enabled(),
    ABUSE_SIGNUP: limit(0),
    ALLOWED_ORIGINS: "",
    ASSETS: { fetch: async () => new Response("static") },
    ACCOUNT_DIRECTORY: forbiddenObject,
    ROOM_LOBBY: forbiddenObject,
    GAME_SESSIONS: forbiddenObject
  };
  const response = await worker.fetch(new Request("https://mesa21.test/api/auth/register", {
    method: "POST", headers: {
      "content-type": "application/json", "origin": "https://mesa21.test",
      "cf-connecting-ip": "203.0.113.14"
    }, body: JSON.stringify({ username: "attacker", password: "long-secret-secret" })
  }), config as never);
  assert.equal(response.status, 429);
  assert.equal(objectCalls, 0);
});
