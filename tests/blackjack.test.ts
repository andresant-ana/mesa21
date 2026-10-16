import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAction,
  createGame,
  createShuffledShoe,
  isNatural,
  scoreHand,
  toPublicGame
} from "../src/domain/blackjack.ts";
import type { Card } from "../src/domain/blackjack.ts";

const c = (rank: Card["rank"], suit: Card["suit"] = "clubs"): Card => ({ rank, suit });
const shoe = (...cards: Card[]) => [...cards, ...Array.from({ length: 20 }, () => c("2"))];

test("conta ases como 11 quando não estouram e como 1 quando necessário", () => {
  assert.deepEqual(scoreHand([c("A"), c("6")]), { total: 17, soft: true });
  assert.deepEqual(scoreHand([c("A"), c("6"), c("9")]), { total: 16, soft: false });
  assert.deepEqual(scoreHand([c("A"), c("A"), c("9")]), { total: 21, soft: true });
});

test("reconhece blackjack natural apenas em duas cartas", () => {
  assert.equal(isNatural([c("A"), c("K")]), true);
  assert.equal(isNatural([c("7"), c("7"), c("7")]), false);
});

test("cria sapato de seis baralhos e mantém as 312 cartas", () => {
  const shoeDeck = createShuffledShoe((array) => { array[0] = 0; return array; });
  assert.equal(shoeDeck.length, 312);
});

test("rejeita apostas fora do intervalo, fora do passo ou sem créditos", () => {
  assert.throws(() => createGame(100, 0, shoe(c("2"), c("3"), c("4"), c("5"))), /INVALID_BET/);
  assert.throws(() => createGame(100, 15, shoe(c("2"), c("3"), c("4"), c("5"))), /INVALID_BET/);
  assert.throws(() => createGame(100, 110, shoe(c("2"), c("3"), c("4"), c("5"))), /INVALID_BET/);
  assert.throws(() => createGame(5, 10, shoe(c("2"), c("3"), c("4"), c("5"))), /INSUFFICIENT_CREDITS/);
});

test("blackjack paga 3:2 e o saldo permanece inteiro", () => {
  const game = createGame(1_000, 100, shoe(c("A"), c("9"), c("K"), c("7")));
  assert.equal(game.result, "blackjack");
  assert.equal(game.balance, 1_150);
  assert.equal(Number.isInteger(game.balance), true);
});

test("blackjack de ambas as mãos devolve a aposta", () => {
  const game = createGame(1_000, 100, shoe(c("A"), c("A"), c("K"), c("K")));
  assert.equal(game.result, "push");
  assert.equal(game.balance, 1_000);
});

test("dealer para no soft 17", () => {
  const game = createGame(1_000, 50, shoe(c("10"), c("A"), c("8"), c("6")));
  const next = applyAction(game, "stand");
  assert.equal(next.result, "win");
  assert.equal(next.dealerCards.length, 2);
  assert.equal(next.balance, 1_050);
});

test("vitória normal credita a aposta e perda não a devolve", () => {
  const win = createGame(1_000, 100, shoe(c("10"), c("6"), c("10"), c("K"), c("2")));
  const won = applyAction(win, "stand");
  assert.equal(won.result, "win");
  assert.equal(won.balance, 1_100);

  const loss = createGame(1_000, 100, shoe(c("10"), c("10"), c("8"), c("9")));
  const lost = applyAction(loss, "stand");
  assert.equal(lost.result, "loss");
  assert.equal(lost.balance, 900);
});

test("pedir carta acima de 21 encerra como bust sem pagamento", () => {
  const game = createGame(1_000, 100, shoe(c("10"), c("7"), c("9"), c("9"), c("K")));
  const busted = applyAction(game, "hit");
  assert.equal(busted.result, "bust");
  assert.equal(busted.balance, 900);
});

test("dobrar é permitido no início e compra exatamente uma carta", () => {
  const game = createGame(1_000, 100, shoe(c("5"), c("6"), c("6"), c("10"), c("10"), c("2")));
  const doubled = applyAction(game, "double");
  assert.equal(doubled.result, "win");
  assert.equal(doubled.bet, 200);
  assert.equal(doubled.playerCards.length, 3);
  assert.equal(doubled.balance, 1_200);

  const stillPlaying = createGame(1_000, 50, shoe(c("5"), c("6"), c("6"), c("10"), c("2")));
  const hit = applyAction(stillPlaying, "hit");
  assert.equal(hit.phase, "player");
  assert.throws(() => applyAction(hit, "double"), /DOUBLE_UNAVAILABLE/);
});

test("a API pública não revela a carta fechada nem o sapato", () => {
  const game = createGame(1_000, 50, shoe(c("10"), c("6"), c("8"), c("K"), c("4")));
  const view = toPublicGame(game);
  assert.deepEqual(view.dealerCards, [c("6"), null]);
  assert.equal("shoe" in view, false);
  assert.equal(view.dealerTotal, null);
});

test("recusa novas ações depois que a rodada termina", () => {
  const game = createGame(1_000, 50, shoe(c("10"), c("6"), c("8"), c("K"), c("4")));
  const ended = applyAction(game, "stand");
  assert.equal(ended.phase, "finished");
  assert.throws(() => applyAction(ended, "hit"), /ROUND_NOT_ACTIVE/);
});



test("dobrar e estourar 21 liquida derrota imediatamente, sem ação da dealer", () => {
  const game = createGame(2_000, 100, shoe(c("10"), c("6"), c("9"), c("10"), c("K"), c("5")));
  const doubled = applyAction(game, "double");
  assert.equal(doubled.phase, "finished");
  assert.equal(doubled.result, "bust");
  assert.equal(doubled.balance, 1_800);
  assert.equal(doubled.bet, 200);
  assert.equal(doubled.playerCards.length, 3);
  assert.equal(doubled.dealerCards.length, 2);
  assert.equal(toPublicGame(doubled).dealerTotal, 16);
});
