
import assert from "node:assert/strict";
import test from "node:test";
import { RoomLobby } from "../src/worker/RoomLobby.ts";
import worker from "../src/worker/index.ts";
import { verifyRevealedShoe, verifyShoeDrawTrace, verifyShoeRoundReplay } from "../src/domain/shoeAudit.ts";
import type { RevealedShoe } from "../src/domain/shoeAudit.ts";

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

test("visitante não membro não recebe nomes, cartas ou provas de uma sala pública", async () => {
  const { request } = setup();
  const host = session("h"), guest = session("g"), visitor = session("o");
  const created = await request(host, "/rooms", create());
  const { room } = await created.json() as { room: { code: string } };
  await request(guest, "/rooms/" + room.code + "/join", { displayName: "amiga" });
  await request(host, "/rooms/" + room.code + "/start", {});
  const outsider = await request(visitor, "/rooms/" + room.code);
  assert.equal(outsider.status, 200);
  const { room: view } = await outsider.json() as { room: {
    role: string; members: unknown[]; spectatorsList: unknown[]; round: unknown;
  } };
  assert.equal(view.role, "visitor");
  assert.deepEqual(view.members, []);
  assert.deepEqual(view.spectatorsList, []);
  assert.equal(view.round, null);
  assert.equal((await request(visitor, "/rooms/" + room.code + "/audit")).status, 403);
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


test("duas sessões apostam contra a mesma dealer, com turno obrigatório e cartas ocultas", async () => {
  const { request, storage } = setup();
  const host = session("a"), friend = session("b");
  const first = await request(host, "/rooms", create());
  const { room } = await first.json() as { room: { code: string } };
  await request(friend, "/rooms/" + room.code + "/join", { displayName: "luigi21" });
  assert.equal((await request(host, "/rooms/" + room.code + "/start", {})).status, 200);
  const saved = storage.get("rooms") as { rooms: Array<{ round: { shoe: Array<{ rank: string; suit: string }> } }> };
  saved.rooms[0]!.round.shoe = [
    { rank: "10", suit: "clubs" }, { rank: "9", suit: "clubs" },
    { rank: "6", suit: "clubs" }, { rank: "8", suit: "clubs" },
    { rank: "7", suit: "clubs" }, { rank: "10", suit: "clubs" },
    { rank: "6", suit: "clubs" }, { rank: "2", suit: "clubs" },
    ...Array.from({ length: 50 }, () => ({ rank: "2", suit: "clubs" }))
  ];
  assert.equal((await request(host, "/rooms/" + room.code + "/bet", { bet: 100 })).status, 200);
  const begin = await request(friend, "/rooms/" + room.code + "/bet", { bet: 100 });
  const publicState = (await begin.json() as { room: { round: { phase: string; dealerCards: unknown[] } } }).room;
  assert.equal(publicState.round.phase, "playing");
  assert.equal(publicState.round.dealerCards[1], null);
  assert.equal((await request(friend, "/rooms/" + room.code + "/action", { action: "stand" })).status, 409);
  assert.equal((await request(host, "/rooms/" + room.code + "/action", { action: "stand" })).status, 200);
  assert.equal((await request(friend, "/rooms/" + room.code + "/action", { action: "hit" })).status, 200);
  const hostSnap = await request(host, "/rooms/" + room.code);
  const after = (await hostSnap.json() as { room: {
    round: { phase: string; dealerCards: unknown[] };
    myCredits: number;
  } }).room;
  assert.equal(after.round.phase, "finished");
  assert.equal(after.round.dealerCards.length, 3);
  assert.equal(after.myCredits, 2_000);
  assert.equal((await request(host, "/rooms/" + room.code + "/action", { action: "stand" })).status, 409);
  assert.equal((await request(host, "/rooms/" + room.code + "/leave", {})).status, 200);
});

test("não deixa sair nem reiniciar rodada que ainda está recebendo apostas", async () => {
  const { request } = setup();
  const { room } = await (await request(session("a"), "/rooms", create())).json() as { room: { code: string } };
  await request(session("a"), "/rooms/" + room.code + "/start", {});
  assert.equal((await request(session("a"), "/rooms/" + room.code + "/leave", {})).status, 409);
  assert.equal((await request(session("a"), "/rooms/" + room.code + "/start", {})).status, 409);
  assert.equal((await request(session("a"), "/rooms/" + room.code + "/deal", {})).status, 409);
});


test("alarme cancela rodada sem apostas para não prender a sala", async () => {
  const { request, storage, lobby } = setup();
  const host = session("a");
  const created = await request(host, "/rooms", create());
  const { room } = await created.json() as { room: { code: string } };
  await request(host, "/rooms/" + room.code + "/start", {});
  const state = storage.get("rooms") as { rooms: Array<{ round: { deadlineAt: number } | null }> };
  assert.ok(state.rooms[0]!.round);
  state.rooms[0]!.round!.deadlineAt = Date.now() - 1;
  await lobby.alarm();
  assert.equal(state.rooms[0]!.round, null);
  assert.equal((await request(host, "/rooms/" + room.code + "/start", {})).status, 200);
});

test("alarme faz o jogador ausente parar e passa ao próximo sem duplicar créditos", async () => {
  const { request, storage, lobby } = setup();
  const host = session("a"), guest = session("b");
  const { room } = await (await request(host, "/rooms", create())).json() as { room: { code: string } };
  await request(guest, "/rooms/" + room.code + "/join", { displayName: "luigi" });
  await request(host, "/rooms/" + room.code + "/start", {});
  const state = storage.get("rooms") as { rooms: Array<{ round: {
    shoe: Array<{ rank: string; suit: string }>;
    deadlineAt: number | null;
    phase: string;
    turn: number;
  } }> };
  state.rooms[0]!.round.shoe = [
    { rank: "10", suit: "clubs" }, { rank: "9", suit: "clubs" },
    { rank: "6", suit: "clubs" }, { rank: "8", suit: "clubs" },
    { rank: "7", suit: "clubs" }, { rank: "10", suit: "clubs" },
    { rank: "2", suit: "clubs" }, ...Array.from({ length: 50 }, () => ({ rank: "2", suit: "clubs" }))
  ];
  await request(host, "/rooms/" + room.code + "/bet", { bet: 100 });
  await request(guest, "/rooms/" + room.code + "/bet", { bet: 100 });
  assert.equal(state.rooms[0]!.round.phase, "playing");
  state.rooms[0]!.round.deadlineAt = Date.now() - 1;
  await lobby.alarm();
  assert.equal(state.rooms[0]!.round.turn, 1);
  assert.equal(state.rooms[0]!.round.phase, "playing");
  state.rooms[0]!.round.deadlineAt = Date.now() - 1;
  await lobby.alarm();
  assert.equal(state.rooms[0]!.round.phase, "finished");
  assert.equal(state.rooms[0]!.round.deadlineAt, null);
  const snapshot = await request(host, "/rooms/" + room.code);
  const { room: view } = await snapshot.json() as { room: { myCredits: number } };
  assert.equal(view.myCredits, 2_000); // 18 versus dealer final 18, push.
});


test("não permite mais que duas conexões ativas por participante na mesma sala", async () => {
  const state = new Map<string, unknown>();
  const sockets: Array<{ deserializeAttachment(): unknown; close(code: number, reason: string): void }> = [];
  const lobby = new RoomLobby({
    storage: {
      async get<T>(key: string) { return state.get(key) as T | undefined; },
      async put<T>(key: string, value: T) { state.set(key, value); }
    },
    acceptWebSocket(_socket) {},
    getWebSockets: () => sockets as unknown as WebSocket[]
  }, {} as never);
  const host = session("a");
  const createResponse = await lobby.fetch(new Request("https://internal/rooms", {
    method: "POST", headers: { "x-mesa21-session": host },
    body: JSON.stringify(create())
  }));
  assert.equal(createResponse.status, 201);
  const { room } = await createResponse.json() as { room: { code: string } };
  const url = "https://internal/rooms/" + room.code + "/stream";
  for (let index = 0; index < 2; index++) {
    sockets.push({
      deserializeAttachment: () => ({ code: room.code, session: host }),
      close() {}
    });
  }
  const blocked = await lobby.fetch(new Request(url, {
    headers: { "x-mesa21-session": host, upgrade: "websocket" }
  }));
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json() as { error: string }).error, "SOCKET_CAPACITY");
});

test("saída revoga sockets associados à sessão e impede novos eventos privados", async () => {
  const storage = new Map<string, unknown>();
  const closed: string[] = [];
  const sockets: Array<{
    deserializeAttachment(): unknown;
    send(message: string): void;
    close(code: number, reason: string): void;
  }> = [];
  const lobby = new RoomLobby({
    storage: {
      async get<T>(key: string) { return storage.get(key) as T | undefined; },
      async put<T>(key: string, value: T) { storage.set(key, value); }
    },
    getWebSockets: () => sockets as unknown as WebSocket[]
  }, {} as never);
  const invoke = (token: string, path: string, body?: unknown) => lobby.fetch(new Request(
    "https://internal" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-mesa21-session": token },
      body: body === undefined ? undefined : JSON.stringify(body)
    }
  ));
  const host = session("a"), guest = session("b");
  const created = await invoke(host, "/rooms", create("Mesa privada", "private"));
  const { room } = await created.json() as { room: { code: string } };
  await invoke(guest, "/rooms/" + room.code + "/join", { displayName: "luigi" });
  const received: string[] = [];
  sockets.push({
    deserializeAttachment: () => ({ code: room.code, session: guest }),
    send: (msg) => { received.push(msg); },
    close: (_code, reason) => { closed.push(reason); }
  });
  assert.equal((await invoke(guest, "/rooms/" + room.code + "/leave", {})).status, 200);
  assert.ok(closed.some((reason) => reason.includes("saiu")));
  const previous = received.length;
  assert.equal((await invoke(host, "/rooms/" + room.code + "/start", {})).status, 200);
  assert.equal(received.length, previous, "former member must not receive private round updates");
  assert.ok(closed.some((reason) => reason.includes("encerrada")));
});


test("compromisso é publicado antes das apostas, prova só aparece após aposentar baralho", async () => {
  const { request, storage } = setup();
  const host = session("a");
  const created = await request(host, "/rooms", create());
  const { room } = await created.json() as { room: { code: string } };
  const started = await request(host, "/rooms/" + room.code + "/start", {});
  assert.equal(started.status, 200);
  const snapshot = (await started.json() as { room: {
    shoeAudit: { commitment: string; revealedCount: number };
  } }).room;
  assert.match(snapshot.shoeAudit.commitment, /^[0-9a-f]{64}$/);
  assert.equal(snapshot.shoeAudit.revealedCount, 0);
  const active = await request(host, "/rooms/" + room.code + "/audit");
  const activeBody = await active.json() as { current: { commitment: string }; revealed: unknown[] };
  assert.equal(activeBody.current.commitment, snapshot.shoeAudit.commitment);
  assert.deepEqual(activeBody.revealed, []);
  assert.ok(!JSON.stringify(activeBody).includes("nonce"));
  assert.ok(!JSON.stringify(activeBody).includes("cards"));

  // Consume the real shoe across completed rounds; no synthetic deck mutation.
  let second: Response | null = null;
  for (let index = 0; index < 100; index++) {
    const bet = await request(host, "/rooms/" + room.code + "/bet", { bet: 10 });
    assert.equal(bet.status, 200);
    const current = (await bet.json() as { room: { round: { phase: string } } }).room.round;
    if (current.phase === "playing") {
      assert.equal((await request(host, "/rooms/" + room.code + "/action", { action: "stand" })).status, 200);
    }
    const next = await request(host, "/rooms/" + room.code + "/start", {});
    assert.equal(next.status, 200);
    const copy = next.clone();
    const data = await copy.json() as { room: { shoeAudit: { revealedCount: number } } };
    if (data.room.shoeAudit.revealedCount > 0) {
      second = next;
      break;
    }
  }
  assert.ok(second, "after 75% penetration the original shoe must be retired");
  const newSnapshot = (await second.json() as { room: {
    shoeAudit: { commitment: string; revealedCount: number };
  } }).room;
  assert.notEqual(newSnapshot.shoeAudit.commitment, snapshot.shoeAudit.commitment);
  assert.equal(newSnapshot.shoeAudit.revealedCount, 1);
  const proofResponse = await request(host, "/rooms/" + room.code + "/audit");
  const proofBody = await proofResponse.json() as {
    current: { commitment: string; nonce?: string; cards?: unknown };
    revealed: RevealedShoe[];
  };
  assert.equal(proofBody.current.commitment, newSnapshot.shoeAudit.commitment);
  assert.equal(proofBody.current.nonce, undefined);
  assert.equal(proofBody.current.cards, undefined);
  assert.equal(proofBody.revealed[0]!.commitment, snapshot.shoeAudit.commitment);
  assert.ok(proofBody.revealed[0]!.consumed >= 234);
  assert.equal(await verifyRevealedShoe(proofBody.revealed[0]!), true);
  assert.equal(verifyShoeDrawTrace(proofBody.revealed[0]!), true);
  assert.equal(verifyShoeRoundReplay(proofBody.revealed[0]!), true);
});


test("betting timeout retires existing shoe without losing prior completed-round audit", async () => {
  const { request, storage, lobby } = setup();
  const host = session("a");
  const created = await request(host, "/rooms", create());
  const { room } = await created.json() as { room: { code: string } };
  const url = "/rooms/" + room.code;
  assert.equal((await request(host, url + "/start", {})).status, 200);
  assert.equal((await request(host, url + "/bet", { bet: 10 })).status, 200);
  let round = (storage.get("rooms") as { rooms: Array<{ round: {
    phase: string; turn: number; seats: Array<{ id: string }>; deadlineAt: number | null
  } }> }).rooms[0]!.round;
  if (round.phase === "playing") {
    assert.equal((await request(host, url + "/action", { action: "stand" })).status, 200);
  }
  assert.equal(round.phase, "finished");
  assert.equal((await request(host, url + "/start", {})).status, 200);
  const state = storage.get("rooms") as { rooms: Array<{
    round: { deadlineAt: number } | null;
    audit: { active: { draws: unknown[] }; revealed: unknown[] };
  }> };
  const archived = state.rooms[0]!.audit.active.draws.length;
  assert.ok(archived >= 4);
  state.rooms[0]!.round!.deadlineAt = Date.now() - 1;
  await lobby.alarm();
  assert.equal(state.rooms[0]!.round, null);
  const restarted = await request(host, url + "/start", {});
  assert.equal(restarted.status, 200);
  const revealed = await request(host, url + "/audit");
  const data = await revealed.json() as { revealed: Array<import("../src/domain/shoeAudit.ts").RevealedShoe> };
  assert.equal(data.revealed.length, 1);
  assert.equal(data.revealed[0]!.consumed, archived);
  assert.equal(await verifyRevealedShoe(data.revealed[0]!), true);
  assert.equal(verifyShoeDrawTrace(data.revealed[0]!), true);
  assert.equal(verifyShoeRoundReplay(data.revealed[0]!), true);
});
