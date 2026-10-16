import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/worker/index.ts";
import { GameSession } from "../src/worker/GameSession.ts";
import { applyAction, createGame, RESHUFFLE_REMAINING_CARDS } from "../src/domain/blackjack.ts";

function environment() {
  const objects = new Map<string, GameSession>();
  const env = {
    ENVIRONMENT: "development",
    ALLOWED_ORIGINS: "http://localhost:5173",
    ASSETS: { fetch: async () => new Response("asset") },
    GAME_SESSIONS: {
      idFromName(name: string) { return { toString: () => name }; },
      get(id: { toString(): string }) {
        const key = id.toString();
        if (!objects.has(key)) {
          const storageMap = new Map<string, unknown>();
          const state = {
            storage: {
              async get<T>(name: string) { return storageMap.get(name) as T | undefined; },
              async put<T>(name: string, value: T) { storageMap.set(name, value); }
            }
          };
          objects.set(key, new GameSession(state, env as never));
        }
        const instance = objects.get(key)!;
        return { fetch: (request: Request) => instance.fetch(request) };
      }
    }
  };
  return env;
}

test("cria sessão de visitante com cookie HttpOnly e créditos casuais", async () => {
  const env = environment();
  const response = await worker.fetch(new Request("https://mesa21.test/api/session"), env as never);
  const body = await response.json() as { casualCredits: number; rankedPoints: null; game: null };
  assert.equal(response.status, 200);
  assert.equal(body.casualCredits, 2_000);
  assert.equal(body.rankedPoints, null);
  assert.equal(body.game, null);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.ok(cookie.includes("Path=/"));
});

test("rejeita mutação sem origem e antes de chamar estado da partida", async () => {
  const env = environment();
  const response = await worker.fetch(new Request("https://mesa21.test/api/game/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bet: 10 })
  }), env as never);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "ORIGIN_NOT_ALLOWED" });
});

test("a API ignora saldo, cartas e resultado enviados pelo navegador", async () => {
  const env = environment();
  const first = await worker.fetch(new Request("https://mesa21.test/api/session"), env as never);
  const cookie = first.headers.get("set-cookie")!.split(";")[0]!;
  const response = await worker.fetch(new Request("https://mesa21.test/api/game/start", {
    method: "POST",
    headers: { "content-type": "application/json", "origin": "https://mesa21.test", cookie },
    body: JSON.stringify({ bet: 10, balance: 999999, cards: [{ rank: "A", suit: "spades" }], result: "win" })
  }), env as never);
  const body = await response.json() as { casualCredits: number; game: Record<string, unknown> };
  assert.equal(response.status, 200);
  assert.ok(body.casualCredits <= 2_015);
  assert.ok(body.casualCredits >= 1_990);
  assert.equal("shoe" in body.game, false);
  assert.equal("balance" in body.game, false);
  assert.equal("cards" in body.game, false);
});

test("requisições concorrentes não liquidam a mesma rodada duas vezes", async () => {
  const stored = new Map<string, unknown>();
  const state = { storage: { async get<T>(key: string) { return stored.get(key) as T | undefined; }, async put<T>(key: string, value: T) { stored.set(key, value); } } };
  const game = createGame(1_000, 10, [
    { rank: "10", suit: "clubs" }, { rank: "6", suit: "clubs" },
    { rank: "10", suit: "hearts" }, { rank: "9", suit: "spades" },
    { rank: "2", suit: "diamonds" }
  ]);
  stored.set("session", { casualCredits: game.balance, game });
  const session = new GameSession(state, {} as never);
  const action = () => session.fetch(new Request("https://internal/game/action", { method: "POST", body: JSON.stringify({ action: "stand" }) }));
  const results = await Promise.all([action(), action()]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 400]);
  const saved = stored.get("session") as { casualCredits: number };
  assert.equal(saved.casualCredits, 1_010);
});

test("origem diferente e tipo de conteúdo inválido não alteram a sessão", async () => {
  const env = environment();
  const first = await worker.fetch(new Request("https://mesa21.test/api/session"), env as never);
  const cookie = first.headers.get("set-cookie")!.split(";")[0]!;
  const response = await worker.fetch(new Request("https://mesa21.test/api/game/start", {
    method: "POST",
    headers: { "content-type": "text/plain", "origin": "https://attacker.test", cookie },
    body: "bet=100"
  }), env as never);
  assert.equal(response.status, 415);
});


test("mantém a ordem do sapato entre rodadas enquanto a penetração está abaixo de 75%", async () => {
  const store = new Map<string, unknown>();
  const state = { storage: {
    async get<T>(key: string) { return store.get(key) as T | undefined; },
    async put<T>(key: string, value: T) { store.set(key, value); }
  }};
  const sequence = [
    { rank: "10", suit: "clubs" }, { rank: "6", suit: "clubs" },
    { rank: "9", suit: "hearts" }, { rank: "10", suit: "spades" },
    ...Array.from({ length: 90 }, () => ({ rank: "2", suit: "clubs" }))
  ] as const;
  const previous = applyAction(createGame(2_000, 10, [...sequence]), "stand");
  const remaining = [...previous.shoe];
  assert.ok(remaining.length > RESHUFFLE_REMAINING_CARDS);
  store.set("session", { casualCredits: 2_000, game: previous });
  const session = new GameSession(state, {} as never);
  const response = await session.fetch(new Request("https://internal/game/start", {
    method: "POST", body: JSON.stringify({ bet: 10 })
  }));
  assert.equal(response.status, 200);
  const saved = store.get("session") as { game: ReturnType<typeof createGame> };
  assert.deepEqual(saved.game.playerCards, [remaining[0], remaining[2]]);
  assert.deepEqual(saved.game.dealerCards, [remaining[1], remaining[3]]);
  assert.equal(saved.game.shoe.length, remaining.length - 4);
});

test("reembaralha seis baralhos quando atinge 75% de penetração", async () => {
  const store = new Map<string, unknown>();
  const state = { storage: {
    async get<T>(key: string) { return store.get(key) as T | undefined; },
    async put<T>(key: string, value: T) { store.set(key, value); }
  }};
  const previous = applyAction(createGame(2_000, 10, [
    { rank: "10", suit: "clubs" }, { rank: "6", suit: "clubs" },
    { rank: "9", suit: "hearts" }, { rank: "10", suit: "spades" },
    { rank: "5", suit: "diamonds" }
  ]), "stand");
  previous.shoe = Array.from({ length: RESHUFFLE_REMAINING_CARDS }, () => ({ rank: "2", suit: "clubs" }));
  store.set("session", { casualCredits: 2_000, game: previous });
  const session = new GameSession(state, {} as never);
  const response = await session.fetch(new Request("https://internal/game/start", {
    method: "POST", body: JSON.stringify({ bet: 10 })
  }));
  assert.equal(response.status, 200);
  const saved = store.get("session") as { game: ReturnType<typeof createGame> };
  assert.equal(saved.game.shoe.length, 6 * 52 - 4);
});


test("permite recarga gratuita apenas com saldo casual insuficiente e sem rodada ativa", async () => {
  const store = new Map<string, unknown>();
  const state = { storage: {
    async get<T>(key: string) { return store.get(key) as T | undefined; },
    async put<T>(key: string, value: T) { store.set(key, value); }
  }};
  store.set("session", { casualCredits: 0, game: null });
  const session = new GameSession(state, {} as never);
  const refill = () => session.fetch(new Request("https://internal/game/refill", {
    method: "POST", body: "{}"
  }));
  const first = await refill();
  assert.equal(first.status, 200);
  const result = await first.json() as { casualCredits: number; rankedPoints: null };
  assert.equal(result.casualCredits, 2_000);
  assert.equal(result.rankedPoints, null);
  assert.equal((await refill()).status, 409);

  const active = createGame(2_000, 10, [
    { rank: "10", suit: "clubs" }, { rank: "6", suit: "clubs" },
    { rank: "9", suit: "hearts" }, { rank: "10", suit: "spades" },
    { rank: "5", suit: "diamonds" }
  ]);
  store.set("session", { casualCredits: 0, game: active });
  assert.equal((await refill()).status, 409);
  assert.equal((store.get("session") as { casualCredits: number }).casualCredits, 0);
});

test("rejeita JSON null sem gerar erro interno ou modificar saldo", async () => {
  const env = environment();
  const first = await worker.fetch(new Request("https://mesa21.test/api/session"), env as never);
  const cookie = first.headers.get("set-cookie")!.split(";")[0]!;
  const response = await worker.fetch(new Request("https://mesa21.test/api/game/start", {
    method: "POST",
    headers: { "content-type": "application/json", "origin": "https://mesa21.test", cookie },
    body: "null"
  }), env as never);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "INVALID_REQUEST" });
  const after = await worker.fetch(new Request("https://mesa21.test/api/session", {
    headers: { cookie }
  }), env as never);
  assert.equal((await after.json() as { casualCredits: number }).casualCredits, 2_000);
});
