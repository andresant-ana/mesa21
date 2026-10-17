import type { RoundResult } from "./blackjack.ts";

export const INITIAL_CREDITS = 2_000;
export const DAILY_CREDITS = 500;
export type WalletEntry = {
  id: string; at: number; kind: "initial" | "daily" | "round";
  amount: number; balanceAfter: number; roundId?: string;
};
export type RankedRound = {
  id: string; at: number; dateKey: string; netProfit: number; result: RoundResult;
  wager: number;
};
export type Wallet = {
  balance: number;
  lastDailyKey: string | null;
  ledger: WalletEntry[];
  rounds: RankedRound[];
  lifetimeProfit: number;
  handsPlayed: number;
  blackjacks: number;
};
export type RankPeriod = "weekly" | "monthly" | "historical";

export class WalletError extends Error {
  readonly code: "BONUS_ALREADY_CLAIMED" | "ROUND_ACTIVE" | "INVALID_AMOUNT" | "DUPLICATE_EVENT";
  constructor(code: WalletError["code"]) {
    super(code);
    this.code = code;
    this.name = "WalletError";
  }
}

export function localDateKey(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(timestamp);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return part("year") + "-" + part("month") + "-" + part("day");
}

export function newWallet(now: number): Wallet {
  return {
    balance: INITIAL_CREDITS, lastDailyKey: null,
    ledger: [{ id: crypto.randomUUID(), at: now, kind: "initial", amount: INITIAL_CREDITS, balanceAfter: INITIAL_CREDITS }],
    rounds: [], lifetimeProfit: 0, handsPlayed: 0, blackjacks: 0
  };
}

export function changeWallet(wallet: Wallet, kind: WalletEntry["kind"], amount: number, now: number, id: string, roundId?: string): void {
  if (!Number.isSafeInteger(amount) || amount === 0 || !Number.isSafeInteger(wallet.balance + amount) ||
      wallet.balance + amount < 0) throw new WalletError("INVALID_AMOUNT");
  if (wallet.ledger.some((entry) => entry.id === id)) throw new WalletError("DUPLICATE_EVENT");
  wallet.balance += amount;
  wallet.ledger.push({ id, at: now, kind, amount, balanceAfter: wallet.balance, ...(roundId ? { roundId } : {}) });
}

export function claimDaily(wallet: Wallet, now: number): void {
  const today = localDateKey(now);
  if (wallet.lastDailyKey === today) throw new WalletError("BONUS_ALREADY_CLAIMED");
  changeWallet(wallet, "daily", DAILY_CREDITS, now, "daily:" + today);
  wallet.lastDailyKey = today;
}

export function recordRound(wallet: Wallet, round: RankedRound): void {
  if (wallet.rounds.some((item) => item.id === round.id)) throw new WalletError("DUPLICATE_EVENT");
  if (!Number.isSafeInteger(round.netProfit)) throw new WalletError("INVALID_AMOUNT");
  wallet.rounds.push(round);
  wallet.lifetimeProfit += round.netProfit;
  wallet.handsPlayed += 1;
  if (round.result === "blackjack") wallet.blackjacks += 1;
}

export function periodStart(period: RankPeriod, now: number): string | null {
  const today = localDateKey(now);
  if (period === "historical") return null;
  if (period === "monthly") return today.slice(0, 7) + "-01";
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return date.toISOString().slice(0, 10);
}

export function rankedStats(wallet: Wallet, period: RankPeriod, now: number) {
  const start = periodStart(period, now);
  const games = wallet.rounds.filter((round) => !start || round.dateKey >= start);
  return {
    netProfit: games.reduce((sum, game) => sum + game.netProfit, 0),
    handsPlayed: games.length,
    blackjacks: games.filter((game) => game.result === "blackjack").length
  };
}
