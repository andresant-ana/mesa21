import type { Card } from "./blackjack.ts";
import { openBetting, placeTableBet, dealTable, playTableAction, publicTable } from "./socialGame.ts";
import type { TableDraw, TableRound, TableEvent, TableWallet } from "./socialGame.ts";
import { createShuffledShoe, SHOE_DECKS, RANKS, SUITS } from "./blackjack.ts";

export const AUDIT_PROTOCOL = "mesa21-shoe-commit-v1";

export type AuditedRound = {
  shoeStart: number;
  openingCredits: TableWallet[];
  events: TableEvent[];
  finalView: ReturnType<typeof publicTable>;
  closingCredits: TableWallet[];
};

export type ActiveShoeCommitment = {
  commitment: string;
  nonce: string;
  originalCards: Card[];
  draws?: TableDraw[];
  rounds?: AuditedRound[];
  committedAt: number;
};
export type RevealedShoe = {
  protocol: typeof AUDIT_PROTOCOL;
  commitment: string;
  nonce: string;
  cards: Card[];
  consumed: number;
  draws?: TableDraw[];
  rounds?: AuditedRound[];
  committedAt: number;
  revealedAt: number;
};
export type ShoeAuditState = {
  active: ActiveShoeCommitment;
  revealed: RevealedShoe[];
};

/** Stable, versioned serialization. Never expose active nonce or shoe order. */
function commitPayload(nonce: string, cards: readonly Card[]): string {
  return AUDIT_PROTOCOL + "\n" + nonce + "\n" +
    cards.map((card) => card.rank + "/" + card.suit).join(",");
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sha256(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

export async function newAuditedShoe(
  now = Date.now(),
  shuffled: Card[] = createShuffledShoe()
): Promise<{ shoe: Card[]; active: ActiveShoeCommitment }> {
  if (shuffled.length !== SHOE_DECKS * 52) throw new Error("INVALID_SHOE_SIZE");
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
  const cards = structuredClone(shuffled);
  const commitment = await sha256(commitPayload(nonce, cards));
  return {
    shoe: [...shuffled],
    active: { commitment, nonce, originalCards: cards, draws: [], rounds: [], committedAt: now }
  };
}

/**
 * Reveal only after the shoe is permanently retired. The 312-card order must
 * never be exposed while any card from this shoe might still be dealt.
 */
export function retireShoe(state: ShoeAuditState, remaining: number, now = Date.now()): RevealedShoe {
  if (!Number.isSafeInteger(remaining) || remaining < 0 || remaining > state.active.originalCards.length) {
    throw new Error("INVALID_SHOE_REMAINING");
  }
  const proof: RevealedShoe = {
    protocol: AUDIT_PROTOCOL,
    commitment: state.active.commitment,
    nonce: state.active.nonce,
    cards: structuredClone(state.active.originalCards),
    consumed: state.active.originalCards.length - remaining,
    draws: structuredClone(state.active.draws ?? []),
    rounds: structuredClone(state.active.rounds ?? []),
    committedAt: state.active.committedAt,
    revealedAt: now
  };
  state.revealed.push(proof);
  if (state.revealed.length > 3) state.revealed.splice(0, state.revealed.length - 3);
  return proof;
}

/** Anyone can independently verify a revealed proof using this public function. */
export async function verifyRevealedShoe(proof: RevealedShoe): Promise<boolean> {
  if (proof.protocol !== AUDIT_PROTOCOL || !/^[0-9a-f]{64}$/.test(proof.nonce) ||
    !/^[0-9a-f]{64}$/.test(proof.commitment) || proof.cards.length !== SHOE_DECKS * 52 ||
    !Number.isSafeInteger(proof.consumed) || proof.consumed < 0 || proof.consumed > proof.cards.length ||
    proof.revealedAt < proof.committedAt) return false;
  const expected = new Map<string, number>();
  for (const suit of SUITS) for (const rank of RANKS) expected.set(rank + "/" + suit, SHOE_DECKS);
  for (const card of proof.cards) {
    const key = card.rank + "/" + card.suit;
    const count = expected.get(key);
    if (!count) return false;
    expected.set(key, count - 1);
  }
  return (await sha256(commitPayload(proof.nonce, proof.cards))) === proof.commitment;
}

/** Public metadata can be sent before betting; never include nonce or cards. */
export function publicShoeCommitment(audit: ShoeAuditState | null | undefined) {
  return audit ? {
    protocol: AUDIT_PROTOCOL,
    commitment: audit.active.commitment,
    committedAt: audit.active.committedAt,
    revealedCount: audit.revealed.length
  } : null;
}

/**
 * Preserve the authoritative engine's draw trace after a round has completely
 * finished, before the next round can reuse or retire its shoe.
 */
export function retainFinishedDraws(
  audit: ShoeAuditState,
  draws: readonly TableDraw[],
): void {
  const saved = audit.active.draws ?? (audit.active.draws = []);
  for (const draw of draws) {
    if (!Number.isSafeInteger(draw.offset) || draw.offset !== saved.length ||
        !audit.active.originalCards[draw.offset] ||
        audit.active.originalCards[draw.offset]!.rank !== draw.card.rank ||
        audit.active.originalCards[draw.offset]!.suit !== draw.card.suit) {
      throw new Error("DRAW_TRACE_DIVERGENCE");
    }
    saved.push(structuredClone(draw));
  }
}

/**
 * Optional stronger check: every consumed card must be accounted for in its
 * original order. This does NOT yet prove that a specific public game snapshot
 * was faithfully rendered or that the dealer's strategy was followed.
 */
export function verifyShoeDrawTrace(proof: RevealedShoe): boolean {
  if (!Array.isArray(proof.draws) || !Number.isSafeInteger(proof.consumed) ||
    proof.draws.length !== proof.consumed || proof.consumed < 0 ||
    proof.consumed > proof.cards.length) return false;
  return proof.draws.every((draw, index) => {
    const committedCard = proof.cards[index];
    return draw.offset === index &&
      typeof draw.recipient === "string" && (draw.recipient === "dealer" || /^[A-F0-9]{12}$/.test(draw.recipient)) &&
      (draw.hand === 0 || draw.hand === 1) &&
      !!committedCard && !!draw.card &&
      draw.card.rank === committedCard.rank && draw.card.suit === committedCard.suit;
  });
}


/**
 * Archive the finished round's immutable input events and terminal result.
 * All data remains private until the complete shoe is retired.
 */
export function retainFinishedRound(audit: ShoeAuditState, round: TableRound): void {
  if (round.phase !== "finished" || !round.closingCredits) throw new Error("ROUND_NOT_FINISHED");
  const start = audit.active.draws?.length ?? 0;
  if (round.initialShoeLength !== audit.active.originalCards.length - start) {
    throw new Error("REPLAY_SHOE_OFFSET");
  }
  retainFinishedDraws(audit, round.draws);
  (audit.active.rounds ??= []).push({
    shoeStart: round.initialShoeLength,
    openingCredits: structuredClone(round.openingCredits),
    events: structuredClone(round.events),
    finalView: structuredClone(publicTable(round)),
    closingCredits: structuredClone(round.closingCredits)
  });
}

/**
 * Independently repeat each archived betting/action event against the
 * committed deck. This checks turn legality, blackjack rules, payouts, dealer
 * behavior, terminal hands and the per-player credit deltas.
 *
 * Does not prove server/player seed fairness or bind browser-observed snapshots.
 */
export function verifyShoeRoundReplay(proof: RevealedShoe): boolean {
  if (!Array.isArray(proof.rounds) || !Array.isArray(proof.draws) ||
    !Number.isSafeInteger(proof.consumed) || proof.consumed < 0 ||
    proof.consumed > proof.cards.length || proof.rounds.length > 100) return false;
  try {
    let shoe = structuredClone(proof.cards);
    let eventCount = 0;
    const collected: TableDraw[] = [];
    for (const receipt of proof.rounds) {
      if (!Array.isArray(receipt.events) || !Array.isArray(receipt.openingCredits) ||
        !Array.isArray(receipt.closingCredits) || receipt.events.length > 200 ||
        receipt.openingCredits.length < 1 || receipt.openingCredits.length > 5 ||
        receipt.shoeStart !== shoe.length) return false;
      eventCount += receipt.events.length;
      if (eventCount > 10000) return false;
      const wallets = structuredClone(receipt.openingCredits);
      const round = openBetting(wallets, shoe);
      for (const event of receipt.events) {
        if (event.type === "bet") {
          const wallet = wallets.find((member) => member.id === event.seatId);
          if (!wallet) return false;
          placeTableBet(round, wallet, event.wager);
        } else if (event.type === "deal") {
          dealTable(round, wallets);
        } else if (event.type === "action") {
          playTableAction(round, wallets, event.seatId, event.action);
        } else {
          return false;
        }
      }
      if (round.phase !== "finished" || JSON.stringify(round.events) !== JSON.stringify(receipt.events) ||
        JSON.stringify(publicTable(round)) !== JSON.stringify(receipt.finalView) ||
        JSON.stringify(round.closingCredits) !== JSON.stringify(receipt.closingCredits)) return false;
      collected.push(...round.draws);
      shoe = round.shoe;
    }
    return shoe.length === proof.cards.length - proof.consumed &&
      JSON.stringify(collected) === JSON.stringify(proof.draws) &&
      verifyShoeDrawTrace(proof);
  } catch {
    return false;
  }
}
