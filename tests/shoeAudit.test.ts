import assert from "node:assert/strict";
import test from "node:test";
import { createShuffledShoe } from "../src/domain/blackjack.ts";
import { newAuditedShoe, retireShoe, publicShoeCommitment, verifyRevealedShoe } from "../src/domain/shoeAudit.ts";

test("compromisso SHA-256 publica somente metadados, nunca baralho ou nonce ativo", async () => {
  const shoe = createShuffledShoe();
  const { active, shoe: playable } = await newAuditedShoe(12345, shoe);
  assert.equal(shoe.length, 312);
  assert.equal(playable.length, 312);
  assert.match(active.commitment, /^[0-9a-f]{64}$/);
  assert.match(active.nonce, /^[0-9a-f]{64}$/);
  const payload = JSON.stringify(publicShoeCommitment({ active, revealed: [] }));
  assert.ok(payload.includes(active.commitment));
  assert.ok(!payload.includes(active.nonce));
  assert.ok(!payload.includes("originalCards"));
  assert.ok(!payload.includes("cards"));
});

test("prova de baralho aposentado verifica compromisso, 312 cartas e limites de consumo", async () => {
  const { active } = await newAuditedShoe(12345);
  const audit = { active, revealed: [] as ReturnType<typeof retireShoe>[] };
  const proof = retireShoe(audit, 78, 67890);
  assert.equal(proof.consumed, 234);
  assert.equal(proof.cards.length, 312);
  assert.equal(await verifyRevealedShoe(proof), true);
  assert.equal(audit.revealed.length, 1);
});

test("adulteração de ordem, nonce, número de cartas ou contagem invalida prova", async () => {
  const { active } = await newAuditedShoe(100);
  const audit = { active, revealed: [] as ReturnType<typeof retireShoe>[] };
  const proof = retireShoe(audit, 75, 200);
  const modified = structuredClone(proof);
  [modified.cards[0], modified.cards[1]] = [modified.cards[1]!, modified.cards[0]!];
  // Force an actual permutation change, not a swap between identical ranks/suits.
  modified.cards[0] = { rank: "A", suit: "clubs" };
  assert.equal(await verifyRevealedShoe(modified), false);
  assert.equal(await verifyRevealedShoe({ ...proof, nonce: "0".repeat(64) }), false);
  assert.equal(await verifyRevealedShoe({ ...proof, consumed: 313 }), false);
  assert.equal(await verifyRevealedShoe({ ...proof, cards: proof.cards.slice(1) }), false);
  assert.equal(await verifyRevealedShoe({ ...proof, revealedAt: 50 }), false);
});

test("histórico mantém três últimas provas sem alterar compromisso ativo", async () => {
  const { active } = await newAuditedShoe(100);
  const audit = { active, revealed: [] as ReturnType<typeof retireShoe>[] };
  for (let index = 0; index < 5; index++) retireShoe(audit, 78, 200 + index);
  assert.equal(audit.revealed.length, 3);
  assert.equal(audit.active.commitment, active.commitment);
  assert.ok(audit.revealed.every((proof) => proof.commitment === active.commitment));
});
