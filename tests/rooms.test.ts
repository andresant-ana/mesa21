
import assert from "node:assert/strict";
import test from "node:test";
import { RoomLobby } from "../src/worker/RoomLobby.ts";
import worker from "../src/worker/index.ts";

const session = (char: string) => char.repeat(43);
const create = (name = "Mesa dos Crias", visibility = "public") =>
  ({ name, visibility, displayName: "andre", mode: "casual" });

function setup() {
  const storage = new Map<string, unknown>();
  const state = { storage: {
    async get<T>(key: string) { return storage.get(key) as T | undefined; },
    async put<T>(key: string, value: T) { storage.set(key, value); }
  }};
  const lobby = new RoomLobby(state, {} as never);
  async function request(token: string, path: string, body?: unknown) {
    return lobby.fetch(new Request("https://internal" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-mesa21-session": token },
      body: body === undefined ? undefined : JSON.stringify(body)
    }));
  }
  return { storage, request, lobby };
}

test("cria sala pública e devolve resumo seguro sem identificar sessão", async () => {
  const { request } = setup();
  const created = await request(session("a"), "/rooms", create());
  assert.equal(created.status, 201);
  const { room } = await created.json() as { room: { code: string; players: number; members: unknown[]; role: string } };
  assert.match(room.code, /^[A-F0-9]{12}$/);
  assert.equal(room.players, 1);
  assert.equal(room.role, "player");
  assert.equal(JSON.stringify(room).includes(session("a")), false);
  const listing = await request(session("b"), "/rooms");
  const { rooms } = await listing.json() as { rooms: Array<{ code: string }> };
  assert.deepEqual(rooms.map((r) => r.code), [room.code]);
});

test("sala privada acessível apenas com código e ausente do lobby", async () => {
  const { request } = setup();
  const created = await request(session("a"), "/rooms", create("Mesa só nossa", "private"));
  const { room } = await created.json() as { room: { code: string } };
  assert.deepEqual((await (await request(session("b"), "/rooms")).json() as { rooms: unknown[] }).rooms, []);
  const detail = await request(session("b"), "/rooms/" + room.code);
  assert.equal((await detail.json() as { room: { role: string } }).room.role, "visitor");
  const joined = await request(session("b"), "/rooms/" + room.code + "/join", { displayName: "luigi21" });
  assert.equal((await joined.json() as { room: { players: number } }).room.players, 2);
});

test("cinco jogadores e espectadores sem extrapolar lotação", async () => {
  const { request } = setup();
  const first = await request(session("a"), "/rooms", create());
  const { room } = await first.json() as { room: { code: string } };
  for (let index = 0; index < 4; index++) {
    const added = await request(session(String(index + 1)), "/rooms/" + room.code + "/join", { displayName: "amigo" + index });
    assert.equal((await added.json() as { room: { role: string } }).room.role, "player");
  }
  const spectator = await request(session("z"), "/rooms/" + room.code + "/join", { displayName: "espectador" });
  const view = (await spectator.json() as { room: { role: string; players: number; spectators: number } }).room;
  assert.equal(view.role, "spectator");
  assert.equal(view.players, 5);
  assert.equal(view.spectators, 1);
});

test("host é transferido ao sair, e sala é fechada quando último jogador sai", async () => {
  const { request } = setup();
  const created = await request(session("a"), "/rooms", create());
  const { room } = await created.json() as { room: { code: string } };
  await request(session("b"), "/rooms/" + room.code + "/join", { displayName: "luigi21" });
  assert.equal((await request(session("a"), "/rooms/" + room.code + "/leave", {})).status, 200);
  const snap = await request(session("b"), "/rooms/" + room.code);
  assert.equal((await snap.json() as { room: { isHost: boolean } }).room.isHost, true);
  assert.equal((await request(session("b"), "/rooms/" + room.code + "/leave", {})).status, 200);
  assert.equal((await request(session("a"), "/rooms/" + room.code)).status, 404);
});

test("rejeita apelido duplicado, modo classificatório e segunda sala pelo mesmo visitante", async () => {
  const { request } = setup();
  const initial = await request(session("a"), "/rooms", create());
  const { room } = await initial.json() as { room: { code: string } };
  assert.equal((await request(session("a"), "/rooms", create())).status, 409);
  assert.equal((await request(session("b"), "/rooms", { ...create(), mode: "ranked" })).status, 409);
  assert.equal((await request(session("b"), "/rooms/" + room.code + "/join", { displayName: "AnDrE" })).status, 409);
  assert.equal((await request(session("b"), "/rooms/" + room.code + "/join", { displayName: "<script>" })).status, 400);
});

test("identidade da sala depende de cabeçalho validado pelo Worker", async () => {
  const { lobby } = setup();
  const response = await lobby.fetch(new Request("https://internal/rooms", {
    headers: { "x-mesa21-session": "falso" }
  }));
  assert.equal(response.status, 401);
});

test("Worker valida origem e rejeita criação de sala sem proteção CSRF", async () => {
  const lobby = setup().lobby;
  const env = {
    ENVIRONMENT: "development", ALLOWED_ORIGINS: "",
    ASSETS: { fetch: async () => new Response("asset") },
    GAME_SESSIONS: { idFromName: () => ({ toString: () => "solo" }), get: () => ({ fetch: async () => new Response("unused") }) },
    ROOM_LOBBY: { idFromName: () => ({ toString: () => "global-v1" }), get: () => ({ fetch: (request: Request) => lobby.fetch(request) }) }
  };
  const rejected = await worker.fetch(new Request("https://mesa21.test/api/rooms", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(create())
  }), env as never);
  assert.equal(rejected.status, 403);
  const allowed = await worker.fetch(new Request("https://mesa21.test/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://mesa21.test",
      "x-mesa21-session": session("x") },
    body: JSON.stringify(create())
  }), env as never);
  assert.equal(allowed.status, 201);
  const cookie = allowed.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  const created = await allowed.json() as { room: { code: string; role: string } };
  assert.equal(created.room.role, "player");
  // Forged identity forwarding header cannot be used as the browser session.
  const outsider = await worker.fetch(new Request("https://mesa21.test/api/rooms/" + created.room.code, {
    headers: { "x-mesa21-session": session("x") }
  }), env as never);
  assert.equal((await outsider.json() as { room: { role: string } }).room.role, "visitor");
});
