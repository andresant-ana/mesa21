import assert from "node:assert/strict";
import test from "node:test";
import { createShuffledShoe } from "../src/domain/blackjack.ts";
import { newAuditedShoe, retireShoe, publicShoeCommitment, verifyRevealedShoe, verifyShoeDrawTrace, retainFinishedDraws } from "../src/domain/shoeAudit.ts";
import { openBetting, placeTableBet, dealTable, playTableAction } from "../src/domain/socialGame.ts";

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
  modified.cards[0] = { rank: modified.cards[0]!.rank === "A" ? "2" : "A", suit: modified.cards[0]!.suit };
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

test("every dealt card is accountable against the sealed order after retirement", async () => {
  const { shoe, active } = await newAuditedShoe(100);
  const audit = { active, revealed: [] as ReturnType<typeof retireShoe>[] };
  const wallet = { id: "ABCDEF012345", credits: 2_000 };
  const first = openBetting([wallet], shoe);
  placeTableBet(first, wallet, 10);
  dealTable(first, [wallet]);
  if (first.phase === "playing") playTableAction(first, [wallet], wallet.id, "stand");
  assert.equal(first.phase, "finished");
  assert.ok(first.draws.length >= 4);
  assert.deepEqual(first.draws.map((item) => item.offset),
    first.draws.map((_, index) => index));
  retainFinishedDraws(audit, first.draws);

  const second = openBetting([wallet], first.shoe);
  placeTableBet(second, wallet, 10);
  dealTable(second, [wallet]);
  if (second.phase === "playing") playTableAction(second, [wallet], wallet.id, "stand");
  assert.equal(second.phase, "finished");
  retainFinishedDraws(audit, second.draws);
  const proof = retireShoe(audit, second.shoe.length, 200);
  assert.equal(proof.consumed, first.draws.length + second.draws.length);
  assert.equal(await verifyRevealedShoe(proof), true);
  assert.equal(verifyShoeDrawTrace(proof), true);

  const changedOffset = structuredClone(proof);
  changedOffset.draws![1]!.offset++;
  assert.equal(verifyShoeDrawTrace(changedOffset), false);
  const changedCard = structuredClone(proof);
  changedCard.draws![0]!.card.rank = changedCard.draws![0]!.card.rank === "A" ? "K" : "A";
  assert.equal(verifyShoeDrawTrace(changedCard), false);
  const changedDestination = structuredClone(proof);
  changedDestination.draws![0]!.recipient = "anonymous";
  assert.equal(verifyShoeDrawTrace(changedDestination), false);
  const missingEvent = structuredClone(proof);
  missingEvent.draws!.pop();
  assert.equal(verifyShoeDrawTrace(missingEvent), false);
  assert.equal(verifyShoeDrawTrace({ ...proof, consumed: proof.consumed + 1 }), false);
});

test("rejects duplicate archival and cannot leak active draw transcript", async () => {
  const { active, shoe } = await newAuditedShoe(100);
  const audit = { active, revealed: [] as ReturnType<typeof retireShoe>[] };
  const wallet = { id: "ABCDEF012345", credits: 2000 };
  const round = openBetting([wallet], shoe);
  placeTableBet(round, wallet, 10);
  dealTable(round, [wallet]);
  if (round.phase === "playing") playTableAction(round, [wallet], wallet.id, "stand");
  retainFinishedDraws(audit, round.draws);
  assert.throws(() => retainFinishedDraws(audit, round.draws), /DRAW_TRACE_DIVERGENCE/);
  const publicRecord = JSON.stringify(publicShoeCommitment(audit));
  assert.ok(!publicRecord.includes("draws"));
  assert.ok(!publicRecord.includes(round.draws[0]!.card.rank));
});
