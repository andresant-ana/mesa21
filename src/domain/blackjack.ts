export const STARTING_CASUAL_CREDITS = 2_000;
export const MIN_BET = 10;
export const MAX_BET = 100;
export const SHOE_DECKS = 6;
export const RESHUFFLE_REMAINING_CARDS = (SHOE_DECKS * 52) / 4; // 75% penetration

export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export type Card = { rank: Rank; suit: Suit };
export type GamePhase = "player" | "finished";
export type RoundResult = "blackjack" | "win" | "loss" | "push" | "bust";
export type Action = "hit" | "stand" | "double" | "split";

export type SecondaryHand = {
  cards: Card[];
  bet: number;
  result: RoundResult | null;
  done: boolean;
};

export type GameState = {
  balance: number;
  bet: number;
  shoe: Card[];
  playerCards: Card[];
  dealerCards: Card[];
  phase: GamePhase;
  result: RoundResult | null;
  splitHand: SecondaryHand | null;
  activeHand: 0 | 1;
  primaryDone: boolean;
};

export type PublicHand = {
  cards: Card[];
  bet: number;
  total: number;
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
  canSplit: boolean;
  activeHand: 0 | 1;
  secondaryHand: PublicHand | null;
};

export type RuleErrorCode =
  | "INVALID_BET"
  | "INSUFFICIENT_CREDITS"
  | "ROUND_NOT_ACTIVE"
  | "DOUBLE_UNAVAILABLE"
  | "SPLIT_UNAVAILABLE";

export class RuleError extends Error {
  readonly code: RuleErrorCode;
  constructor(code: RuleErrorCode) {
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
    result: null,
    splitHand: null,
    activeHand: 0,
    primaryDone: false
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

  if (action === "split") {
    if (!canSplit(game)) throw new RuleError("SPLIT_UNAVAILABLE");
    const first = game.playerCards[0]!;
    const second = game.playerCards[1]!;
    game.balance -= game.bet;
    game.playerCards = [first, draw(game)];
    game.splitHand = { cards: [second, draw(game)], bet: game.bet, result: null, done: false };
    game.activeHand = 0;

    // Split aces get one additional card each and stand automatically.
    if (first.rank === "A") {
      game.splitHand.done = true;
      advanceAfterHand(game);
    } else if (scoreHand(game.playerCards).total === 21) {
      advanceAfterHand(game);
    }
    return game;
  }

  const isSecond = game.splitHand !== null && game.activeHand === 1;
  const cards = isSecond ? game.splitHand!.cards : game.playerCards;
  const wager = isSecond ? game.splitHand!.bet : game.bet;

  if (action === "hit") {
    cards.push(draw(game));
    const total = scoreHand(cards).total;
    if (total > 21) advanceAfterHand(game, "bust");
    else if (total === 21) advanceAfterHand(game);
    return game;
  }

  if (action === "stand") {
    advanceAfterHand(game);
    return game;
  }

  if (action === "double") {
    if (cards.length !== 2) throw new RuleError("DOUBLE_UNAVAILABLE");
    if (game.balance < wager) throw new RuleError("INSUFFICIENT_CREDITS");
    game.balance -= wager;
    if (isSecond) game.splitHand!.bet *= 2;
    else game.bet *= 2;
    cards.push(draw(game));
    // A double-down bust loses immediately, including after a split.
    advanceAfterHand(game, scoreHand(cards).total > 21 ? "bust" : null);
    return game;
  }

  throw new RuleError("ROUND_NOT_ACTIVE");
}

export function toPublicGame(game: GameState): PublicGame {
  const active = game.phase === "player";
  const dealerCards: Array<Card | null> = active
    ? [game.dealerCards[0] ?? null, null]
    : [...game.dealerCards];
  const currentCards = game.splitHand && game.activeHand === 1
    ? game.splitHand.cards
    : game.playerCards;
  const currentBet = game.splitHand && game.activeHand === 1
    ? game.splitHand.bet
    : game.bet;
  return {
    casualCredits: game.balance,
    bet: game.bet,
    phase: game.phase,
    result: game.result,
    playerCards: [...game.playerCards],
    dealerCards,
    playerTotal: scoreHand(game.playerCards).total,
    dealerTotal: active ? null : scoreHand(game.dealerCards).total,
    canDouble: active && currentCards.length === 2 && game.balance >= currentBet,
    canSplit: active && canSplit(game),
    activeHand: game.activeHand,
    secondaryHand: game.splitHand ? {
      cards: [...game.splitHand.cards],
      bet: game.splitHand.bet,
      total: scoreHand(game.splitHand.cards).total,
      result: game.splitHand.result
    } : null
  };
}

function splitValue(rank: Rank): number {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J") return 10;
  return Number(rank);
}

function canSplit(game: GameState): boolean {
  return game.phase === "player" &&
    game.splitHand === null &&
    game.playerCards.length === 2 &&
    game.balance >= game.bet &&
    splitValue(game.playerCards[0]!.rank) === splitValue(game.playerCards[1]!.rank);
}

function advanceAfterHand(game: GameState, resultOverride: RoundResult | null = null): void {
  if (!game.splitHand) {
    if (resultOverride === "bust") finish(game, "bust");
    else dealerPlays(game);
    return;
  }

  if (game.activeHand === 0) {
    game.primaryDone = true;
    if (resultOverride) game.result = resultOverride;
    const second = game.splitHand;
    if (second.done || scoreHand(second.cards).total === 21) {
      second.done = true;
      dealerPlays(game);
    } else {
      game.activeHand = 1;
    }
    return;
  }

  game.splitHand.done = true;
  if (resultOverride) game.splitHand.result = resultOverride;
  dealerPlays(game);
}

function dealerPlays(game: GameState): void {
  if (game.splitHand) {
    if (!game.primaryDone || !game.splitHand.done) throw new Error("HANDS_STILL_ACTIVE");
    if (!(game.result === "bust" && game.splitHand.result === "bust")) {
      while (scoreHand(game.dealerCards).total < 17) game.dealerCards.push(draw(game));
    }
    if (!game.result) game.result = settleHand(game, game.playerCards, game.bet);
    if (!game.splitHand.result) {
      game.splitHand.result = settleHand(game, game.splitHand.cards, game.splitHand.bet);
    }
    game.phase = "finished";
    return;
  }

  while (scoreHand(game.dealerCards).total < 17) game.dealerCards.push(draw(game));
  const player = scoreHand(game.playerCards).total;
  const dealer = scoreHand(game.dealerCards).total;
  if (dealer > 21 || player > dealer) finish(game, "win");
  else if (player < dealer) finish(game, "loss");
  else finish(game, "push");
}

function settleHand(game: GameState, cards: Card[], bet: number): RoundResult {
  const player = scoreHand(cards).total;
  const dealer = scoreHand(game.dealerCards).total;
  if (player > 21) return "bust";
  if (dealer > 21 || player > dealer) {
    game.balance += bet * 2;
    return "win";
  }
  if (player === dealer) {
    game.balance += bet;
    return "push";
  }
  return "loss";
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
