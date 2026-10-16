/** MESA/21 — Pure blackjack rules. Credits are fictional integer units. */
export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type Card = { rank: Rank; suit: Suit };
export type Phase = 'betting' | 'playing' | 'finished';
export type Result = 'win' | 'lose' | 'push' | 'blackjack';
export type Hand = { cards: Card[]; wager: number; status: 'playing' | 'stood' | 'busted' | 'settled'; result?: Result; payout: number; split: boolean };
export type Game = {
  phase: Phase;
  balance: number;
  hands: Hand[];
  activeHand: number;
  dealer: Card[];
  shoe: Card[];
  shoeIndex: number;
  decks: number;
  round: number;
  lastChange: number;
  totalWager: number;
  message: string;
};
export type Action = { type: 'bet'; amount: number } | { type: 'hit' } | { type: 'stand' } | { type: 'double' } | { type: 'split' } | { type: 'next' };
export type RandomUint32 = () => number;

const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const INITIAL_CREDITS = 2000;
export const DAILY_BONUS = 500;
export const DECK_COUNT = 6;
export const SHUFFLE_PENETRATION = 0.75;

export function cardPoints(card: Card): number {
  if (card.rank === 'A') return 11;
  if (['K','Q','J'].includes(card.rank)) return 10;
  return Number(card.rank);
}
export function evaluateHand(cards: readonly Card[]): { total: number; soft: boolean; blackjack: boolean; busted: boolean } {
  let total = cards.reduce((sum, card) => sum + cardPoints(card), 0);
  let aces = cards.filter(c => c.rank === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0, blackjack: cards.length === 2 && total === 21, busted: total > 21 };
}
export function buildShoe(decks = DECK_COUNT): Card[] {
  if (!Number.isInteger(decks) || decks < 1 || decks > 8) throw new Error('Quantidade inválida de baralhos.');
  const cards: Card[] = [];
  for (let d=0; d<decks; d++) for(const suit of SUITS) for(const rank of RANKS) cards.push({suit,rank});
  return cards;
}
export const cryptoRandom: RandomUint32 = () => {
  const data = new Uint32Array(1);
  globalThis.crypto.getRandomValues(data);
  return data[0];
};
/** Fisher–Yates with rejection sampling: avoids modulo bias. */
export function shuffle(cards: readonly Card[], nextUint32: RandomUint32 = cryptoRandom): Card[] {
  const out = [...cards];
  for (let i=out.length-1; i>0; i--) {
    const range = i+1;
    const limit = Math.floor(4294967296/range)*range;
    let value: number;
    do {
      value = nextUint32();
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('Gerador inválido.');
    } while (value >= limit);
    const j=value%range;
    [out[i],out[j]]=[out[j],out[i]];
  }
  return out;
}
export function newGame(balance = INITIAL_CREDITS, nextUint32: RandomUint32 = cryptoRandom): Game {
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('Saldo inválido.');
  return { phase: 'betting', balance, hands: [], activeHand: 0, dealer: [], shoe: shuffle(buildShoe(),nextUint32), shoeIndex:0,
    decks:DECK_COUNT, round:0,lastChange:0,totalWager:0, message:'Escolha sua aposta para começar.' };
}
const clone = (game: Game): Game => ({...game, dealer:[...game.dealer],hands:game.hands.map(h=>({...h,cards:[...h.cards]})),shoe:[...game.shoe]});
function draw(g: Game): Card {
  const card=g.shoe[g.shoeIndex];
  if (!card) throw new Error('O sapato acabou antes do fim da rodada.');
  g.shoeIndex++;
  return card;
}
function settle(g: Game): void {
  const hasLiveHand=g.hands.some(h=>h.status!=='busted' && !(evaluateHand(h.cards).blackjack && !h.split));
  if (hasLiveHand) {
    while (true) {
      const dealer=evaluateHand(g.dealer);
      // S17: dealer stands on every 17, including soft 17.
      if (dealer.total >= 17) break;
      g.dealer.push(draw(g));
    }
  }
  const dealer=evaluateHand(g.dealer);
  let returned=0;
  for(const hand of g.hands) {
    const player=evaluateHand(hand.cards);
    let result: Result;
    if (player.busted) result='lose';
    else if (player.blackjack && !hand.split && !dealer.blackjack) result='blackjack';
    else if (dealer.blackjack && !player.blackjack) result='lose';
    else if (dealer.busted || player.total>dealer.total) result='win';
    else if (player.total===dealer.total) result='push';
    else result='lose';
    // Stakes have already been debited; returned amount includes refunded stake.
    const payout=result==='blackjack' ? hand.wager*2.5 : result==='win' ? hand.wager*2 : result==='push' ? hand.wager : 0;
    if (!Number.isSafeInteger(payout)) throw new Error('A aposta não permite pagamento exato em créditos.');
    hand.result=result; hand.payout=payout; hand.status='settled'; returned+=payout;
  }
  g.balance+=returned;
  g.lastChange=returned-g.totalWager;
  g.phase='finished';
  const first=g.hands[0]?.result;
  g.message=first==='blackjack'?'Blackjack!':g.lastChange>0?'Boa! Você ganhou.':g.lastChange<0?'Não foi dessa vez.':'Deu empate.';
}
function advance(g: Game): void {
  const next=g.hands.findIndex((h,i)=>i>g.activeHand && h.status==='playing');
  if (next!==-1) { g.activeHand=next;g.message='Sua vez de jogar.';return; }
  settle(g);
}
export function canDouble(g: Game): boolean {
  const h=g.hands[g.activeHand];
  return g.phase==='playing' && !!h && h.status==='playing' && h.cards.length===2 && g.balance>=h.wager;
}
export function canSplit(g: Game): boolean {
  const h=g.hands[g.activeHand];
  return g.phase==='playing' && g.hands.length===1 && !!h && h.status==='playing' && h.cards.length===2 &&
    cardPoints(h.cards[0])===cardPoints(h.cards[1]) && g.balance>=h.wager;
}
/** State transition. Never mutates caller-owned state. Rejects invalid transitions. */
export function applyAction(game: Game, action: Action, nextUint32: RandomUint32 = cryptoRandom): Game {
  const g=clone(game);
  if (action.type==='next') {
    if (g.phase!=='finished') throw new Error('A rodada ainda não terminou.');
    g.phase='betting';g.hands=[];g.dealer=[];g.activeHand=0;g.totalWager=0;g.lastChange=0;g.message='Escolha sua próxima aposta.';
    return g;
  }
  if (action.type==='bet') {
    if (g.phase!=='betting') throw new Error('A rodada já começou.');
    if (!Number.isSafeInteger(action.amount) || action.amount < 10 || action.amount % 2) throw new Error('Escolha uma aposta válida (mínimo R$ 10).');
    if (action.amount>g.balance) throw new Error('Saldo insuficiente.');
    if (g.shoeIndex >= Math.floor(g.shoe.length*SHUFFLE_PENETRATION) || g.shoe.length-g.shoeIndex<25) {
      g.shoe=shuffle(buildShoe(g.decks),nextUint32);g.shoeIndex=0;
    }
    g.balance-=action.amount;g.totalWager=action.amount;g.round++;
    const h:Hand={cards:[],wager:action.amount,status:'playing',payout:0,split:false};
    h.cards.push(draw(g));g.dealer.push(draw(g));h.cards.push(draw(g));g.dealer.push(draw(g));
    g.hands=[h];g.activeHand=0;g.phase='playing';g.message='Sua vez de jogar.';
    if (evaluateHand(h.cards).blackjack || evaluateHand(g.dealer).blackjack) settle(g);
    return g;
  }
  if (g.phase!=='playing') throw new Error('Não é possível jogar fora do seu turno.');
  const h=g.hands[g.activeHand];
  if (!h || h.status!=='playing') throw new Error('Essa mão não está ativa.');
  if(action.type==='hit') {
    h.cards.push(draw(g));
    const score=evaluateHand(h.cards);
    if(score.busted) {h.status='busted';advance(g);}
    else if(score.total===21){h.status='stood';advance(g);}
    else g.message='Carta recebida. Qual será sua jogada?';
  } else if(action.type==='stand') {
    h.status='stood';advance(g);
  } else if(action.type==='double') {
    if(!canDouble(g)) throw new Error('Dobrar não está disponível.');
    g.balance-=h.wager;g.totalWager+=h.wager;h.wager*=2;
    h.cards.push(draw(g));h.status=evaluateHand(h.cards).busted?'busted':'stood';advance(g);
  } else if(action.type==='split') {
    if(!canSplit(g)) throw new Error('Dividir não está disponível.');
    const second=h.cards.pop()!;
    const wager=h.wager;
    g.balance-=wager;g.totalWager+=wager;h.split=true;
    const hand2:Hand={cards:[second],wager,status:'playing',payout:0,split:true};
    h.cards.push(draw(g));hand2.cards.push(draw(g));g.hands.push(hand2);
    // Single-card draw only after splitting aces (a common table rule).
    if (h.cards[0].rank==='A') {
      h.status='stood';hand2.status='stood';settle(g);
    } else if (evaluateHand(h.cards).total===21) {
      h.status='stood';advance(g);
    }
  }
  return g;
}
