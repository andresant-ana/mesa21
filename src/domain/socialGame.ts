import {
  type Card, type Action, type RoundResult,
  MIN_BET, MAX_BET, scoreHand, isNatural
} from "./blackjack.ts";

export type TablePhase = "betting" | "playing" | "finished";
export const BETTING_TIMEOUT_MS = 120_000;
export const TURN_TIMEOUT_MS = 45_000;
export type TableWallet = { id: string; credits: number };
export type TableHand = { cards: Card[]; wager: number; done: boolean; result: RoundResult | null };
export type TableSeat = { id: string; wager: number; hands: TableHand[]; activeHand: number };
export type TableRound = {
  phase: TablePhase;
  shoe: Card[];
  dealerCards: Card[];
  seats: TableSeat[];
  turn: number;
  deadlineAt: number | null;
};

export class TableError extends Error {
  readonly code:
    "INVALID_BET" | "INSUFFICIENT_CREDITS" | "WRONG_PHASE" | "ALREADY_BET" |
    "NOT_SEATED" | "NO_BETS" | "NOT_YOUR_TURN" | "DOUBLE_UNAVAILABLE" |
    "SPLIT_UNAVAILABLE" | "SHOE_EXHAUSTED";
  constructor(code: TableError["code"]) {
    super(code);
    this.code = code;
    this.name = "TableError";
  }
}

export function openBetting(members: readonly TableWallet[], shoe: Card[]): TableRound {
  if (!members.length || members.length > 5) throw new TableError("NOT_SEATED");
  if (shoe.length < 30) throw new TableError("SHOE_EXHAUSTED");
  return {
    phase: "betting", shoe: [...shoe], dealerCards: [],
    seats: members.map(({ id }) => ({ id, wager: 0, hands: [], activeHand: 0 })),
    turn: -1,
    deadlineAt: Date.now() + BETTING_TIMEOUT_MS
  };
}

export function placeTableBet(round: TableRound, member: TableWallet, wager: number): void {
  if (round.phase !== "betting") throw new TableError("WRONG_PHASE");
  const seat = round.seats.find((s) => s.id === member.id);
  if (!seat) throw new TableError("NOT_SEATED");
  if (seat.wager) throw new TableError("ALREADY_BET");
  if (!Number.isSafeInteger(wager) || wager < MIN_BET || wager > MAX_BET || wager % 10 !== 0) {
    throw new TableError("INVALID_BET");
  }
  if (member.credits < wager) throw new TableError("INSUFFICIENT_CREDITS");
  member.credits -= wager;
  seat.wager = wager;
}

export function dealTable(round: TableRound, wallets: TableWallet[]): void {
  if (round.phase !== "betting") throw new TableError("WRONG_PHASE");
  const seats = round.seats.filter((s) => s.wager > 0);
  if (!seats.length) throw new TableError("NO_BETS");
  if (round.shoe.length < (seats.length * 2) + 2) throw new TableError("SHOE_EXHAUSTED");
  round.seats = seats;
  for (const seat of seats) seat.hands = [{ cards: [draw(round)], wager: seat.wager, done: false, result: null }];
  round.dealerCards = [draw(round)];
  for (const seat of seats) seat.hands[0]!.cards.push(draw(round));
  round.dealerCards.push(draw(round));
  round.phase = "playing";
  round.turn = 0;
  round.deadlineAt = Date.now() + TURN_TIMEOUT_MS;

  const dealerNatural = isNatural(round.dealerCards);
  for (const seat of seats) {
    const hand = seat.hands[0]!;
    if (isNatural(hand.cards)) {
      hand.done = true;
      hand.result = dealerNatural ? "push" : "blackjack";
    } else if (dealerNatural) {
      hand.done = true;
      hand.result = "loss";
    }
  }
  if (dealerNatural || seats.every((seat) => seat.hands[0]!.done)) {
    settleTable(round, wallets);
    return;
  }
  advanceTableTurn(round, wallets);
}

export function playTableAction(round: TableRound, wallets: TableWallet[], seatId: string, action: Action): void {
  if (round.phase !== "playing") throw new TableError("WRONG_PHASE");
  const seat = round.seats[round.turn];
  if (!seat || seat.id !== seatId) throw new TableError("NOT_YOUR_TURN");
  const wallet = wallets.find((item) => item.id === seatId);
  if (!wallet) throw new TableError("NOT_SEATED");
  const hand = seat.hands[seat.activeHand];
  if (!hand || hand.done) throw new TableError("WRONG_PHASE");

  if (action === "split") {
    if (seat.hands.length !== 1 || hand.cards.length !== 2 ||
        value(hand.cards[0]!) !== value(hand.cards[1]!) || wallet.credits < hand.wager) {
      throw new TableError("SPLIT_UNAVAILABLE");
    }
    if (round.shoe.length < 2) throw new TableError("SHOE_EXHAUSTED");
    wallet.credits -= hand.wager;
    const second = hand.cards.pop()!;
    const aceSplit = hand.cards[0]!.rank === "A";
    hand.cards.push(draw(round));
    seat.hands.push({ cards: [second, draw(round)], wager: hand.wager, done: aceSplit, result: null });
    if (aceSplit) {
      hand.done = true;
      advanceTableTurn(round, wallets);
    } else if (scoreHand(hand.cards).total === 21) {
      hand.done = true;
      advanceTableTurn(round, wallets);
    }
    return;
  }

  if (action === "hit") {
    if (!round.shoe.length) throw new TableError("SHOE_EXHAUSTED");
    hand.cards.push(draw(round));
    const total = scoreHand(hand.cards).total;
    if (total >= 21) {
      hand.done = true;
      if (total > 21) hand.result = "bust";
      advanceTableTurn(round, wallets);
    }
    return;
  }

  if (action === "stand") {
    hand.done = true;
    advanceTableTurn(round, wallets);
    return;
  }

  if (action === "double") {
    if (hand.cards.length !== 2 || wallet.credits < hand.wager) {
      throw new TableError("DOUBLE_UNAVAILABLE");
    }
    if (!round.shoe.length) throw new TableError("SHOE_EXHAUSTED");
    wallet.credits -= hand.wager;
    hand.wager *= 2;
    hand.cards.push(draw(round));
    hand.done = true;
    if (scoreHand(hand.cards).total > 21) hand.result = "bust";
    advanceTableTurn(round, wallets);
    return;
  }

  throw new TableError("WRONG_PHASE");
}

function advanceTableTurn(round: TableRound, wallets: TableWallet[]): void {
  for (let i = 0; i < round.seats.length; i++) {
    const seat = round.seats[round.turn];
    if (seat) {
      const nextHand = seat.hands.findIndex((h) => !h.done);
      if (nextHand >= 0) {
        seat.activeHand = nextHand;
        round.deadlineAt = Date.now() + TURN_TIMEOUT_MS;
        return;
      }
    }
    round.turn += 1;
  }
  settleTable(round, wallets);
}

function settleTable(round: TableRound, wallets: TableWallet[]): void {
  // Only resolve the shared dealer after all player hands are complete.
  const unresolved = round.seats.some((seat) => seat.hands.some((h) => !h.done));
  if (unresolved) throw new TableError("WRONG_PHASE");
  const needDealer = round.seats.some((seat) =>
    seat.hands.some((hand) => !hand.result && scoreHand(hand.cards).total <= 21));
  if (needDealer) while (scoreHand(round.dealerCards).total < 17) round.dealerCards.push(draw(round));
  const dealerTotal = scoreHand(round.dealerCards).total;
  for (const seat of round.seats) {
    const wallet = wallets.find((member) => member.id === seat.id);
    if (!wallet) throw new TableError("NOT_SEATED");
    for (const hand of seat.hands) {
      if (!hand.result) {
        const total = scoreHand(hand.cards).total;
        hand.result = total > 21 ? "bust" : dealerTotal > 21 || total > dealerTotal
          ? "win" : total === dealerTotal ? "push" : "loss";
      }
      if (hand.result === "blackjack") wallet.credits += hand.wager * 2.5;
      else if (hand.result === "win") wallet.credits += hand.wager * 2;
      else if (hand.result === "push") wallet.credits += hand.wager;
    }
  }
  round.phase = "finished";
  round.turn = -1;
  round.deadlineAt = null;
}

function value(card: Card): number {
  return card.rank === "A" ? 11 :
    card.rank === "10" || card.rank === "J" || card.rank === "Q" || card.rank === "K" ? 10 : Number(card.rank);
}

function draw(round: TableRound): Card {
  const card = round.shoe.shift();
  if (!card) throw new TableError("SHOE_EXHAUSTED");
  return card;
}

export function publicTable(round: TableRound) {
  return {
    phase: round.phase,
    deadlineAt: round.deadlineAt,
    dealerCards: round.phase === "finished"
      ? round.dealerCards : round.phase === "playing" ? [round.dealerCards[0], null] : [],
    dealerTotal: round.phase === "finished" ? scoreHand(round.dealerCards).total : null,
    turnSeatId: round.phase === "playing" ? round.seats[round.turn]?.id ?? null : null,
    seats: round.seats.map((seat) => ({
      id: seat.id,
      wager: seat.wager,
      activeHand: seat.activeHand,
      hands: seat.hands.map((hand) => ({
        cards: [...hand.cards], total: scoreHand(hand.cards).total,
        wager: hand.wager, done: hand.done, result: hand.result
      }))
    }))
  };
}
