import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAction,buildShoe,cardPoints,canDouble,canSplit,evaluateHand,newGame,shuffle,DECK_COUNT,SHUFFLE_PENETRATION} from '../dist/src/blackjack.js';
const c=(rank,suit='♠')=>({rank,suit});
// The deterministic test shoe is injected only into the pure engine; the UI uses crypto randomness.
function arranged(...draws) {const g=newGame();g.shoe=[...draws,...buildShoe()];g.shoeIndex=0;return g;}
const zero=()=>0;
test('creates six full decks',()=>{
  const shoe=buildShoe();assert.equal(shoe.length,312);assert.equal(shoe.filter(c=>c.rank==='A').length,24);assert.equal(DECK_COUNT,6);
});
test('scores soft and hard aces correctly',()=>{
  assert.deepEqual(evaluateHand([c('A'),c('6')]),{total:17,soft:true,blackjack:false,busted:false});
  assert.deepEqual(evaluateHand([c('A'),c('A'),c('9')]),{total:21,soft:true,blackjack:false,busted:false});
  assert.equal(evaluateHand([c('A'),c('K')]).blackjack,true);
  assert.equal(evaluateHand([c('10'),c('K'),c('2')]).busted,true);
});
test('card values account for ten-valued ranks',()=>assert.equal(cardPoints(c('Q')),10));
test('shuffling preserves cards without relying on Math.random',()=>{
  const cards=buildShoe();const s=shuffle(cards,zero);
  assert.equal(s.length,cards.length);
  assert.deepEqual(s.map(c=>c.rank+c.suit).sort(),cards.map(c=>c.rank+c.suit).sort());
});
test('rejects invalid bets without modifying initial state',()=>{
  const g=arranged(c('7'),c('9'),c('8'),c('5'));
  for(const amount of [0,-1,3,11,3000,NaN]) assert.throws(()=>applyAction(g,{type:'bet',amount}));
  assert.equal(g.balance,2000);assert.equal(g.phase,'betting');
});
test('natural blackjack pays 3:2 without requiring dealer draws',()=>{
  const g=arranged(c('A'),c('9'),c('K'),c('8'));
  const next=applyAction(g,{type:'bet',amount:100});
  assert.equal(next.phase,'finished');assert.equal(next.lastChange,150);assert.equal(next.balance,2150);
  assert.equal(next.hands[0].result,'blackjack');assert.equal(next.shoeIndex,4);
});
test('natural against natural is a push',()=>{
  const next=applyAction(arranged(c('A'),c('A'),c('K'),c('Q')),{type:'bet',amount:50});
  assert.equal(next.balance,2000);assert.equal(next.hands[0].result,'push');
});
test('dealer blackjack defeats non-natural hand',()=>{
  const next=applyAction(arranged(c('9'),c('A'),c('7'),c('K')),{type:'bet',amount:50});
  assert.equal(next.lastChange,-50);assert.equal(next.hands[0].result,'lose');
});
test('dealer stands on soft 17, player 18 wins',()=>{
  let g=applyAction(arranged(c('10'),c('A'),c('8'),c('6'),c('K')),{type:'bet',amount:100});
  g=applyAction(g,{type:'stand'});
  assert.equal(g.shoeIndex,4);assert.equal(g.dealer.length,2);
  assert.equal(g.hands[0].result,'win');assert.equal(g.balance,2100);
});
test('dealer hits soft 16 and stands after 17+',()=>{
  let g=applyAction(arranged(c('10'),c('A'),c('8'),c('5'),c('10'),c('2')),{type:'bet',amount:100});
  g=applyAction(g,{type:'stand'});
  assert.equal(g.dealer.length,4);assert.equal(evaluateHand(g.dealer).total,18); // A+5+10+2 = hard 18
});
test('double down takes one card, doubles wager and settles',()=>{
  let g=applyAction(arranged(c('5'),c('9'),c('6'),c('7'),c('10'),c('2')),{type:'bet',amount:100});
  assert.equal(canDouble(g),true);
  g=applyAction(g,{type:'double'});
  assert.equal(g.hands[0].cards.length,3);assert.equal(g.hands[0].wager,200);
  assert.equal(g.phase,'finished');assert.equal(g.lastChange,200);
});
test('cannot double after hitting',()=>{
  let g=applyAction(arranged(c('2'),c('9'),c('3'),c('7'),c('4'),c('2')),{type:'bet',amount:100});
  g=applyAction(g,{type:'hit'});assert.equal(canDouble(g),false);
  assert.throws(()=>applyAction(g,{type:'double'}));
});
test('split debits second wager and never pays split 21 as natural',()=>{
  let g=applyAction(arranged(c('10'),c('6'),c('J'),c('9'),c('A'),c('10'),c('2')),{type:'bet',amount:100});
  assert.equal(canSplit(g),true);
  g=applyAction(g,{type:'split'});
  assert.equal(g.hands.length,2);assert.equal(g.totalWager,200);
  assert.equal(g.hands[0].cards.length,2);
  if(g.phase==='playing') g=applyAction(g,{type:'stand'});
  if(g.phase==='playing') g=applyAction(g,{type:'stand'});
  assert.notEqual(g.hands[0].result,'blackjack');
});
test('split aces each take a single card and stand',()=>{
  let g=applyAction(arranged(c('A'),c('6'),c('A'),c('9'),c('10'),c('9'),c('2')),{type:'bet',amount:100});
  g=applyAction(g,{type:'split'});assert.equal(g.phase,'finished');
  assert.equal(g.hands[0].cards.length,2);assert.equal(g.hands[1].cards.length,2);
});
test('no early next round and valid next clears hands',()=>{
  let g=arranged(c('10'),c('8'),c('9'),c('8'),c('2'));
  assert.throws(()=>applyAction(g,{type:'next'}));
  g=applyAction(g,{type:'bet',amount:100});g=applyAction(g,{type:'stand'});
  const next=applyAction(g,{type:'next'});
  assert.equal(next.phase,'betting');assert.equal(next.hands.length,0);assert.equal(next.round,1);
});
test('rounds reshuffle when 75 percent of shoe has been consumed',()=>{
  let g=arranged(c('10'),c('7'),c('7'),c('9'),c('2'));
  g.shoeIndex=Math.floor(g.shoe.length*SHUFFLE_PENETRATION);
  const next=applyAction(g,{type:'bet',amount:10},zero);
  assert.equal(next.shoeIndex,4);
});
