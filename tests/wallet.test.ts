import assert from "node:assert/strict";
import test from "node:test";
import { claimDaily, changeWallet, localDateKey, newWallet, periodStart, rankedStats, recordRound } from "../src/domain/wallet.ts";
import { AccountDirectory } from "../src/worker/AccountDirectory.ts";

test("bônus diário usa dia civil de São Paulo e nunca é lucro fictício de partidas", () => {
  const beforeMidnight = Date.parse("2026-10-17T02:59:59Z");
  const afterMidnight = Date.parse("2026-10-17T03:00:00Z");
  assert.equal(localDateKey(beforeMidnight), "2026-10-16");
  assert.equal(localDateKey(afterMidnight), "2026-10-17");
  const wallet = newWallet(beforeMidnight);
  assert.equal(wallet.balance, 2_000);
  claimDaily(wallet, beforeMidnight);
  assert.equal(wallet.balance, 2_500);
  assert.throws(() => claimDaily(wallet, beforeMidnight), /BONUS_ALREADY_CLAIMED/);
  claimDaily(wallet, afterMidnight);
  assert.equal(wallet.balance, 3_000);
  assert.equal(rankedStats(wallet, "historical", afterMidnight).netProfit, 0);
  assert.equal(wallet.ledger.filter((entry) => entry.kind === "daily").length, 2);
});

test("ledger impede lançamento duplicado, saldo negativo e overflow", () => {
  const wallet = newWallet(Date.now());
  changeWallet(wallet, "round", -100, Date.now(), "round:one", "round1");
  assert.equal(wallet.balance, 1_900);
  assert.throws(() => changeWallet(wallet, "round", -100, Date.now(), "round:one", "round1"), /DUPLICATE_EVENT/);
  assert.throws(() => changeWallet(wallet, "round", -5000, Date.now(), "debt"), /INVALID_AMOUNT/);
  assert.equal(wallet.balance, 1_900);
});

test("ranking usa apenas resultados reais e preserva janelas semanais e mensais", () => {
  const now = Date.parse("2026-10-16T18:00:00Z");
  const wallet = newWallet(now);
  recordRound(wallet, { id: "a", at: now, dateKey: "2026-10-10", netProfit: 80, result: "win", wager: 100 });
  recordRound(wallet, { id: "b", at: now, dateKey: "2026-10-16", netProfit: -30, result: "loss", wager: 30 });
  assert.equal(periodStart("weekly", now), "2026-10-12");
  assert.equal(periodStart("monthly", now), "2026-10-01");
  assert.equal(rankedStats(wallet, "weekly", now).netProfit, -30);
  assert.equal(rankedStats(wallet, "monthly", now).netProfit, 50);
  assert.equal(rankedStats(wallet, "historical", now).netProfit, 50);
  assert.throws(() => recordRound(wallet, { id: "a", at: now, dateKey: "2026-10-16",
    netProfit: 999, result: "win", wager: 100 }), /DUPLICATE_EVENT/);
});

function setup() {
  const data = new Map<string, unknown>();
  const directory = new AccountDirectory({ storage: {
    async get<T>(key: string) { return data.get(key) as T | undefined; },
    async put<T>(key: string, value: T) { data.set(key, structuredClone(value)); }
  } }, {} as never);
  const call = async (path: string, body?: unknown, token?: string) => {
    const response = await directory.fetch(new Request("https://internal" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: token ? { "x-mesa21-auth-token": token } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body)
    }));
    return { status: response.status, data: await response.json() as Record<string, any> };
  };
  return { call, data };
}

test("conta reivindica bônus uma vez, persiste saldo e exige autenticação", async () => {
  const { call } = setup();
  const registered = await call("/auth/register", { username: "andre", password: "Senha forte de teste 2026!" });
  assert.equal(registered.status, 201);
  const token = registered.data.authToken as string;
  assert.equal((await call("/wallet")).status, 401);
  const initial = await call("/wallet", undefined, token);
  assert.equal(initial.data.balance, 2_000);
  const claim = await call("/wallet/claim", {}, token);
  assert.equal(claim.status, 200);
  assert.equal(claim.data.balance, 2_500);
  assert.equal((await call("/wallet/claim", {}, token)).status, 409);
  const after = await call("/wallet", undefined, token);
  assert.equal(after.data.balance, 2_500);
  assert.equal(after.data.lifetimeProfit, 0);
});

test("partida classificatória é server-side, contabiliza lucro só ao concluir e não permite replay", async () => {
  const { call } = setup();
  const registered = await call("/auth/register", { username: "luigi21", password: "Senha forte de teste 2026!" });
  const token = registered.data.authToken as string;
  const started = await call("/ranked/start", { bet: 10, balance: 999_999, result: "blackjack" }, token);
  assert.equal(started.status, 200);
  assert.equal(started.data.game.shoe, undefined);
  assert.equal(started.data.game.balance, undefined);
  let session = await call("/ranked/session", undefined, token);
  if (session.data.game.phase === "player") {
    assert.equal((await call("/ranked/start", { bet: 10 }, token)).status, 409);
    const end = await call("/ranked/action", { action: "stand", reward: 99999 }, token);
    assert.equal(end.status, 200);
    session = end;
  }
  assert.equal(session.data.game.phase, "finished");
  const wallet = await call("/wallet", undefined, token);
  assert.equal(wallet.data.rounds.length, 1);
  assert.equal(wallet.data.handsPlayed, 1);
  assert.equal(wallet.data.lifetimeProfit, wallet.data.balance - 2_000);
  assert.equal(wallet.data.rounds[0].netProfit, wallet.data.lifetimeProfit);
  assert.equal((await call("/ranked/action", { action: "stand" }, token)).status, 409);
  const ranking = await call("/ranking?period=historical");
  assert.equal(ranking.data.ranking[0].username, "luigi21");
  assert.equal(ranking.data.ranking[0].netProfit, wallet.data.lifetimeProfit);
});

test("créditos diários não interferem no ranking após jogo encerrado", async () => {
  const { call } = setup();
  const registered = await call("/auth/register", { username: "stef", password: "Senha forte de teste 2026!" });
  const token = registered.data.authToken as string;
  await call("/wallet/claim", {}, token);
  const state = await call("/wallet", undefined, token);
  assert.equal(state.data.balance, 2_500);
  assert.equal(state.data.lifetimeProfit, 0);
  assert.deepEqual((await call("/ranking")).data.ranking, []);
});
