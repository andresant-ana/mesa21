import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const port = 8797;
const base = `http://127.0.0.1:${port}`;
const run = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--local", "--port", String(port)], {
  stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "true" }
});
let logTail = "";
for (const stream of [run.stdout, run.stderr]) {
  stream.on("data", (chunk) => {
    logTail = (logTail + String(chunk)).slice(-10_000);
  });
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (run.exitCode !== null) throw new Error("Wrangler saiu antes de inicializar:\n" + logTail);
    try {
      const response = await fetch(base + "/api/session", { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch { /* local worker still booting */ }
    await delay(500);
  }
  throw new Error("Worker não iniciou a tempo:\n" + logTail);
}

async function request(path, cookie, body) {
  const response = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: cookie,
      ...(body === undefined ? {} : { Origin: base, "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000)
  });
  const payload = await response.json();
  return { status: response.status, payload, headers: response.headers };
}

async function cookieForGuest() {
  const response = await fetch(base + "/api/session", { signal: AbortSignal.timeout(8_000) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.match(cookie, /^mesa21_session=[\w-]{40,64}$/);
  return cookie;
}

async function upgrade(code, cookie) {
  return await new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("WebSocket handshake timeout")); }, 8_000);
    socket.on("connect", () => {
      socket.write([
        `GET /api/rooms/${code}/stream HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        `Origin: ${base}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
        "Sec-WebSocket-Version: 13",
        `Cookie: ${cookie}`,
        "", ""
      ].join("\r\n"));
    });
    socket.on("data", (buffer) => {
      const firstLine = buffer.toString("latin1").split("\r\n", 1)[0];
      clearTimeout(timer);
      socket.destroy();
      resolve(firstLine);
    });
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

try {
  await waitForWorker();
  // Persistent account lifecycle against a REAL local Durable Object.
  const username = "test_" + randomBytes(5).toString("hex");
  const password = "Long private demo password 2026!";
  const changedPassword = "Another safe demo password 2026!";
  const registered = await request("/auth/register", "", { username, password });
  assert.equal(registered.status, 201, JSON.stringify(registered.payload));
  assert.equal(registered.payload.authToken, undefined);
  assert.ok(registered.payload.recoveryCode);
  const authCookie = (registered.headers.get("set-cookie") ?? "").match(/mesa21_auth=[A-Za-z0-9_-]+/)?.[0];
  assert.ok(authCookie);
  const loggedIn = await request("/auth/me", authCookie);
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.payload.user.username, username);
  const recovery = await request("/auth/recover", authCookie, {
    username, recoveryCode: registered.payload.recoveryCode, newPassword: changedPassword
  });
  assert.equal(recovery.status, 200);
  const rotatedCookie = (recovery.headers.get("set-cookie") ?? "").match(/mesa21_auth=[A-Za-z0-9_-]+/)?.[0];
  assert.ok(rotatedCookie);
  assert.equal((await request("/auth/me", authCookie)).status, 401);
  assert.equal((await request("/auth/me", rotatedCookie)).status, 200);
  assert.equal((await request("/auth/logout", rotatedCookie, {})).status, 200);
  assert.equal((await request("/auth/me", rotatedCookie)).status, 401);

  const host = await cookieForGuest();
  const guest = await cookieForGuest();
  assert.notEqual(host, guest);
  const made = await request("/rooms", host, {
    name: "Mesa Smoke", displayName: "andre", visibility: "public", mode: "casual"
  });
  assert.equal(made.status, 201, JSON.stringify(made.payload));
  const room = made.payload.room;
  assert.match(room.code, /^[A-F0-9]{12}$/);
  assert.equal(room.role, "player");
  const directory = await request("/rooms", guest);
  assert.ok(directory.payload.rooms.some((entry) => entry.code === room.code));

  const joined = await request(`/rooms/${room.code}/join`, guest, { displayName: "luigi" });
  assert.equal(joined.status, 200, JSON.stringify(joined.payload));
  assert.equal(joined.payload.room.players, 2);
  const socketStatus = await upgrade(room.code, host);
  assert.match(socketStatus, /^HTTP\/1\.1 101\b/, socketStatus);
  const stranger = await cookieForGuest();
  assert.match(await upgrade(room.code, stranger), /^HTTP\/1\.1 403\b/);

  const started = await request(`/rooms/${room.code}/start`, host, {});
  assert.equal(started.status, 200);
  assert.equal(started.payload.room.round.phase, "betting");
  assert.equal((await request(`/rooms/${room.code}/bet`, host, { bet: 100 })).status, 200);
  const dealt = await request(`/rooms/${room.code}/bet`, guest, { bet: 50 });
  assert.equal(dealt.status, 200, JSON.stringify(dealt.payload));
  assert.equal(dealt.payload.room.round.seats.length, 2);

  for (let move = 0; move < 12; move++) {
    const state = (await request(`/rooms/${room.code}`, host)).payload.room;
    if (state.round.phase === "finished") break;
    assert.equal(state.round.phase, "playing");
    assert.equal(state.round.dealerCards[1], null);
    const turn = state.round.turnSeatId;
    const own = (await request(`/rooms/${room.code}`, host)).payload.room.mySeatId === turn;
    const played = await request(`/rooms/${room.code}/action`, own ? host : guest, { action: "stand" });
    assert.equal(played.status, 200, JSON.stringify(played.payload));
  }
  const finished = (await request(`/rooms/${room.code}`, host)).payload.room;
  assert.equal(finished.round.phase, "finished");
  assert.ok(finished.round.dealerCards[1]);
  assert.equal((await request(`/rooms/${room.code}/action`, host, { action: "stand" })).status, 409);

  assert.equal((await request(`/rooms/${room.code}/leave`, host, {})).status, 200);
  assert.equal((await request(`/rooms/${room.code}/leave`, guest, {})).status, 200);

  const privateRoom = await request("/rooms", host, {
    name: "Mesa Privada", displayName: "andre", visibility: "private", mode: "casual"
  });
  assert.equal(privateRoom.status, 201);
  const publicListing = (await request("/rooms", guest)).payload.rooms;
  assert.ok(!publicListing.some((entry) => entry.code === privateRoom.payload.room.code));
  console.log("MESA/21 runtime smoke: accounts/recovery, HTTP, DO, WebSocket upgrade, multiplayer, privacy PASS");
} catch (error) {
  console.error(error);
  console.error("Wrangler tail:\n" + logTail);
  process.exitCode = 1;
} finally {
  run.kill("SIGTERM");
}
