export const STARTING_CASUAL_CREDITS = 1_000;
export const MIN_BET = 10;
export const MAX_BET = 100;
export const SHOE_DECKS = 6;

export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export type Card = { rank: Rank; suit: Suit };
export type GamePhase = "player" | "finished";
export type RoundResult = "blackjack" | "win" | "loss" | "push" | "bust";
export type Action = "hit" | "stand" | "double";

export type GameState = {
  balance: number;
  bet: number;
  shoe: Card[];
  playerCards: Card[];
  dealerCards: Card[];
  phase: GamePhase;
  result: RoundResult | null;
};

export type PublicGame = {
  casualCredits: number;
  bet: number;
  phase: GamePhase;
  result: RoundResult | null;
  playerCards: Card[];
  dealerCards: Array<Card | null>;
  playerTotal: number;
  dealerTotal: number | null;
  canDouble: boolean;
};

export class RuleError extends Error {
  readonly code: "INVALID_BET" | "INSUFFICIENT_CREDITS" | "ROUND_NOT_ACTIVE" | "DOUBLE_UNAVAILABLE";
  constructor(code: "INVALID_BET" | "INSUFFICIENT_CREDITS" | "ROUND_NOT_ACTIVE" | "DOUBLE_UNAVAILABLE") {
    super(code);
    this.name = "RuleError";
    this.code = code;
  }
}

export function scoreHand(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === "A") {
      aces += 1;
      total += 1;
    } else if (card.rank === "K" || card.rank === "Q" || card.rank === "J") {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  const soft = aces > 0 && total + 10 <= 21;
  if (soft) total += 10;
  return { total, soft };
}

export function isNatural(cards: readonly Card[]): boolean {
  return cards.length === 2 && scoreHand(cards).total === 21;
}

export function createShuffledShoe(randomBytes: (array: Uint32Array) => Uint32Array = secureRandom): Card[] {
  const shoe: Card[] = [];
  for (let deck = 0; deck < SHOE_DECKS; deck += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) shoe.push({ rank, suit });
    }
  }
  for (let index = shoe.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1, randomBytes);
    [shoe[index], shoe[target]] = [shoe[target]!, shoe[index]!];
  }
  return shoe;
}

function secureRandom(array: Uint32Array): Uint32Array {
  return globalThis.crypto.getRandomValues(array);
}

function randomIndex(maxExclusive: number, randomBytes: (array: Uint32Array) => Uint32Array): number {
  const range = 0x1_0000_0000;
  const ceiling = Math.floor(range / maxExclusive) * maxExclusive;
  const word = new Uint32Array(1);
  let value: number;
  do {
    randomBytes(word);
    value = word[0]!;
  } while (value >= ceiling);
  return value % maxExclusive;
}

export function createGame(balance: number, bet: number, shoe: Card[]): GameState {
  if (!Number.isSafeInteger(bet) || bet < MIN_BET || bet > MAX_BET || bet % 10 !== 0) {
    throw new RuleError("INVALID_BET");
  }
  if (!Number.isSafeInteger(balance) || balance < bet) throw new RuleError("INSUFFICIENT_CREDITS");
  if (shoe.length < 4) throw new Error("SHOE_EXHAUSTED");

  const game: GameState = {
    balance: balance - bet,
    bet,
    shoe: [...shoe],
    playerCards: [],
    dealerCards: [],
    phase: "player",
    result: null
  };
  game.playerCards.push(draw(game));
  game.dealerCards.push(draw(game));
  game.playerCards.push(draw(game));
  game.dealerCards.push(draw(game));

  if (isNatural(game.playerCards) || isNatural(game.dealerCards)) {
    if (isNatural(game.playerCards) && isNatural(game.dealerCards)) finish(game, "push");
    else if (isNatural(game.playerCards)) finish(game, "blackjack");
    else finish(game, "loss");
  }
  return game;
}

export function applyAction(current: GameState, action: Action): GameState {
  if (current.phase !== "player") throw new RuleError("ROUND_NOT_ACTIVE");
  const game = structuredClone(current);

  if (action === "hit") {
    game.playerCards.push(draw(game));
    const total = scoreHand(game.playerCards).total;
    if (total > 21) finish(game, "bust");
    else if (total === 21) dealerPlays(game);
    return game;
  }

  if (action === "stand") {
    dealerPlays(game);
    return game;
  }

  if (action === "double") {
    if (game.playerCards.length !== 2) throw new RuleError("DOUBLE_UNAVAILABLE");
    if (game.balance < game.bet) throw new RuleError("INSUFFICIENT_CREDITS");
    game.balance -= game.bet;
    game.bet *= 2;
    game.playerCards.push(draw(game));
    dealerPlays(game);
    return game;
  }

  throw new RuleError("ROUND_NOT_ACTIVE");
}

export function toPublicGame(game: GameState): PublicGame {
  const active = game.phase === "player";
  const dealerCards: Array<Card | null> = active
    ? [game.dealerCards[0] ?? null, null]
    : [...game.dealerCards];
  return {
    casualCredits: game.balance,
    bet: game.bet,
    phase: game.phase,
    result: game.result,
    playerCards: [...game.playerCards],
    dealerCards,
    playerTotal: scoreHand(game.playerCards).total,
    dealerTotal: active ? null : scoreHand(game.dealerCards).total,
    canDouble: active && game.playerCards.length === 2 && game.balance >= game.bet
  };
}

function dealerPlays(game: GameState): void {
  while (scoreHand(game.dealerCards).total < 17) game.dealerCards.push(draw(game));
  const player = scoreHand(game.playerCards).total;
  const dealer = scoreHand(game.dealerCards).total;
  if (dealer > 21 || player > dealer) finish(game, "win");
  else if (player < dealer) finish(game, "loss");
  else finish(game, "push");
}

function finish(game: GameState, result: RoundResult): void {
  game.phase = "finished";
  game.result = result;
  if (result === "blackjack") game.balance += game.bet + (game.bet * 3) / 2;
  else if (result === "win") game.balance += game.bet * 2;
  else if (result === "push") game.balance += game.bet;
}

function draw(game: GameState): Card {
  const card = game.shoe.shift();
  if (!card) throw new Error("SHOE_EXHAUSTED");
  return card;
}
