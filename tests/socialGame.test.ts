import assert from "node:assert/strict";
import test from "node:test";
import { dealTable, openBetting, placeTableBet, playTableAction, publicTable } from "../src/domain/socialGame.ts";
import type { Card } from "../src/domain/blackjack.ts";

const card = (rank: Card["rank"], suit: Card["suit"] = "clubs"): Card => ({ rank, suit });
const cards = (...first: Card[]) => [...first, ...Array.from({ length: 50 }, () => card("2"))];
const wallets = () => [{ id: "a", credits: 2_000 }, { id: "b", credits: 2_000 }];

test("dealer compartilhado resolve duas mãos sem creditar dois pagamentos da mesma aposta", () => {
  const users = wallets();
  const game = openBetting(users, cards(card("10"), card("9"), card("6"), card("8"), card("7"), card("10"), card("6"), card("2")));
  placeTableBet(game, users[0]!, 100);
  placeTableBet(game, users[1]!, 100);
  dealTable(game, users);
  assert.equal(game.phase, "playing");
  assert.equal(publicTable(game).dealerCards[1], null);
  assert.equal(publicTable(game).turnSeatId, "a");
  playTableAction(game, users, "a", "stand");
  assert.equal(publicTable(game).turnSeatId, "b");
  playTableAction(game, users, "b", "hit");
  assert.equal(game.phase, "finished");
  assert.equal(game.seats[0]?.hands[0]?.result, "push");
  assert.equal(game.seats[1]?.hands[0]?.result, "bust");
  assert.equal(users[0]!.credits, 2_000);
  assert.equal(users[1]!.credits, 1_900);
  assert.throws(() => playTableAction(game, users, "a", "stand"), /WRONG_PHASE/);
});

test("nega ações fora do turno sem alterar cartas ou créditos", () => {
  const users = wallets();
  const game = openBetting(users, cards(card("10"), card("9"), card("6"), card("8"), card("7"), card("10")));
  placeTableBet(game, users[0]!, 50);
  placeTableBet(game, users[1]!, 50);
  dealTable(game, users);
  const oldCount = game.shoe.length;
  const oldCredit = users[1]!.credits;
  assert.throws(() => playTableAction(game, users, "b", "hit"), /NOT_YOUR_TURN/);
  assert.equal(game.shoe.length, oldCount);
  assert.equal(users[1]!.credits, oldCredit);
});

test("dealer natural liquida imediatamente, inclusive empate de blackjack", () => {
  const users = wallets();
  const game = openBetting(users, cards(card("A"), card("8"), card("K"), card("K"), card("9"), card("A")));
  placeTableBet(game, users[0]!, 100);
  placeTableBet(game, users[1]!, 50);
  dealTable(game, users);
  assert.equal(game.phase, "finished");
  assert.equal(game.seats[0]?.hands[0]?.result, "push");
  assert.equal(game.seats[1]?.hands[0]?.result, "loss");
  assert.equal(users[0]!.credits, 2_000);
  assert.equal(users[1]!.credits, 1_950);
});

test("natural ganha 3:2 quando dealer não tem blackjack", () => {
  const users = wallets();
  const game = openBetting(users, cards(card("A"), card("9"), card("6"), card("K"), card("8"), card("10"), card("3")));
  placeTableBet(game, users[0]!, 100);
  placeTableBet(game, users[1]!, 50);
  dealTable(game, users);
  assert.equal(game.seats[0]!.hands[0]!.result, "blackjack");
  playTableAction(game, users, "b", "stand");
  assert.equal(game.phase, "finished");
  assert.equal(users[0]!.credits, 2_150);
});

test("split mantém duas apostas e 21 pós-split nunca é blackjack natural", () => {
  const users = [{ id: "a", credits: 2_000 }];
  const game = openBetting(users, cards(card("A"), card("6"), card("A"), card("10"), card("K"), card("9"), card("2")));
  placeTableBet(game, users[0]!, 100);
  dealTable(game, users);
  playTableAction(game, users, "a", "split");
  assert.equal(game.phase, "finished");
  assert.equal(game.seats[0]?.hands.length, 2);
  assert.deepEqual(game.seats[0]!.hands.map((h) => h.result), ["win", "win"]);
  assert.equal(users[0]!.credits, 2_200);
});

test("dobrar após dividir distribui uma única carta e encerra mão", () => {
  const users = [{ id: "a", credits: 2_000 }];
  const game = openBetting(users, cards(card("9"), card("6"), card("9"), card("10"), card("2"), card("3"), card("K"), card("2")));
  placeTableBet(game, users[0]!, 100);
  dealTable(game, users);
  playTableAction(game, users, "a", "split");
  playTableAction(game, users, "a", "double");
  assert.equal(game.seats[0]!.hands[0]!.wager, 200);
  assert.equal(game.seats[0]!.activeHand, 1);
  playTableAction(game, users, "a", "stand");
  assert.equal(game.phase, "finished");
  assert.equal(users[0]!.credits, 2_100);
});

test("rejeita aposta duplicada e mantém crédito no servidor", () => {
  const users = wallets();
  const game = openBetting(users, cards());
  placeTableBet(game, users[0]!, 100);
  assert.throws(() => placeTableBet(game, users[0]!, 100), /ALREADY_BET/);
  assert.throws(() => placeTableBet(game, users[1]!, 15), /INVALID_BET/);
  assert.equal(users[0]!.credits, 1_900);
  assert.equal(users[1]!.credits, 2_000);
});
