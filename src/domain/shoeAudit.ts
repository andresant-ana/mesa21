import type { Card } from "./blackjack.ts";
import { createShuffledShoe, SHOE_DECKS, RANKS, SUITS } from "./blackjack.ts";

export const AUDIT_PROTOCOL = "mesa21-shoe-commit-v1";

export type ActiveShoeCommitment = {
  commitment: string;
  nonce: string;
  originalCards: Card[];
  committedAt: number;
};
export type RevealedShoe = {
  protocol: typeof AUDIT_PROTOCOL;
  commitment: string;
  nonce: string;
  cards: Card[];
  consumed: number;
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
    active: { commitment, nonce, originalCards: cards, committedAt: now }
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
