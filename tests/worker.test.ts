import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/worker/index.ts";
import { GameSession } from "../src/worker/GameSession.ts";
import { createGame } from "../src/domain/blackjack.ts";

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
  assert.equal(body.casualCredits, 1_000);
  assert.equal(body.rankedPoints, null);
  assert.equal(body.game, null);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
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
  assert.ok(body.casualCredits <= 1_015);
  assert.ok(body.casualCredits >= 990);
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
