import {applyAction,canDouble,canSplit,DAILY_BONUS,evaluateHand,INITIAL_CREDITS,newGame,type Card,type Game,type Action} from './blackjack.js';

type View = 'salas' | 'mesa' | 'ranking' | 'como-jogar' | 'perfil' | 'historico';
type Stats = { played:number; wins:number; losses:number; ties:number; blackjacks:number; net:number; claimedDate:string | null; history:{time:string; wager:number; delta:number; result:string; player:string; dealer:string}[] };
type Saved = {v:1;game:Game;stats:Stats};
const STORE = 'mesa21-local-demo-v1';
const DEFAULT_STATS=():Stats=>({played:0,wins:0,losses:0,ties:0,blackjacks:0,net:0,claimedDate:null,history:[]});
const state:{view:View;game:Game;stats:Stats;wager:number;modal:string|null;toast:string|null;error:string|null;filter:string}= {
  view: 'salas',game:newGame(),stats:DEFAULT_STATS(),wager:50,modal:null,toast:null,error:null,filter:'todas'
};
function restore():void {
  try {
    const data=JSON.parse(localStorage.getItem(STORE)||'null') as Saved|null;
    if(data?.v!==1||!data.game||!data.stats)return;
    const g=data.game;
    if(!['betting','playing','finished'].includes(g.phase)||!Array.isArray(g.shoe)||!Array.isArray(g.hands) || !Array.isArray(g.dealer) || !Number.isSafeInteger(g.balance) || g.balance<0 || g.shoe.length<52) return;
    state.game=g;state.stats=data.stats;
  }catch { /* browser storage unavailable or corrupt: clean guest session */ }
}
restore();
function persist():void {try {localStorage.setItem(STORE,JSON.stringify({v:1,game:state.game,stats:state.stats} satisfies Saved));}catch{/* private mode */}}
function today():string {const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
function money(value:number):string{return 'R$ '+value.toLocaleString('pt-BR',{maximumFractionDigits:2,minimumFractionDigits:value%1?2:0});}
function escaped(str:string):string{return String(str).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));}
const root=document.getElementById('app')!;
function icon(name:string):string {
 const paths:Record<string,string>={
  play:'<path d="m8 5 11 7-11 7z"/>',plus:'<path d="M12 5v14M5 12h14"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  cards:'<rect width="14" height="18" x="6" y="3" rx="2"/><path d="m3 7-1 12a2 2 0 0 0 2 2h10M11 9h4m-2-2v4"/>',
  coin:'<circle cx="12" cy="12" r="9"/><path d="M15 8H11a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9m3-10v12"/>',
  gift:'<rect width="18" height="12" x="3" y="9" rx="2"/><path d="M12 9v12m-9-8h18M12 9H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z"/>',
  trophy:'<path d="M8 21h8M12 17v4M7 4h10v7a5 5 0 0 1-10 0V4ZM7 7H4v3a4 4 0 0 0 4 4M17 7h3v3a4 4 0 0 1-4 4"/>',
  back:'<path d="m15 18-6-6 6-6"/>',x:'<path d="M18 6 6 18M6 6l12 12"/>',
  check:'<path d="m5 12 4 4L19 6"/>',chart:'<path d="M3 3v18h18M7 14l5-5 4 3 4-6"/>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  smile:'<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  refresh:'<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>',
 };
 return `<svg class="icon" aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.cards}</svg>`;
}
function dealer():string {return `<svg class="clarice" role="img" aria-label="Clarice, a dealer" viewBox="0 0 116 116" xmlns="http://www.w3.org/2000/svg"><circle cx="58" cy="58" r="55" fill="#e3f2e9"/><path d="M15 111q2-32 33-37l10 9 10-9q30 4 33 37" fill="#f5f6f1"/><path d="M37 79 58 99 79 79l-11-5-10 9-10-9Z" fill="#18463c"/><path d="M56 87h4l3 21h-10z" fill="#ff7760"/><rect x="51" y="66" width="14" height="15" rx="4" fill="#edb994"/><ellipse cx="58" cy="46" rx="27" ry="31" fill="#f1c6a6"/><path d="M30 42q0-30 28-30t28 30q-6-17-22-17-20 8-34 17Z" fill="#353e41"/><circle cx="48" cy="49" r="2.5" fill="#273c38"/><circle cx="69" cy="49" r="2.5" fill="#273c38"/><path d="M50 61q8 8 16 0" stroke="#a35f54" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M39 46q9-5 18 0M61 46q9-5 18 0" fill="none" stroke="#333b41" stroke-width="2.3" stroke-linecap="round"/><circle cx="48" cy="49" r="9" stroke="#3b4b4d" stroke-width="2.2" fill="none"/><circle cx="69" cy="49" r="9" stroke="#3b4b4d" stroke-width="2.2" fill="none"/><path d="M57 49h3" stroke="#3b4b4d" stroke-width="2"/><path d="M32 33q-1-30 28-27 28 0 24 31-12-13-17-17-15 14-35 13Z" fill="#333d40"/></svg>`;}
function cardHtml(card:Card, small=false):string {const red=card.suit==='♥'||card.suit==='♦';return `<div class="playing-card ${small?'compact':''} ${red?'red':''}" aria-label="${escaped(card.rank)} de ${card.suit==='♠'?'espadas':card.suit==='♥'?'copas':card.suit==='♦'?'ouros':'paus'}"><div class="corner">${card.rank}<span>${card.suit}</span></div><div class="suit-center">${card.suit}</div><div class="corner reverse">${card.rank}<span>${card.suit}</span></div></div>`;}
const backCard=()=>'<div class="playing-card back-card" aria-label="Carta oculta"><div class="back-mark">M<span>/21</span></div></div>';
function header():string {
 const current=state.view;const selected=(x:View)=>current===x?'selected':'';
 return `<header class="site-header"><div class="header-inner"><a href="#salas" class="brand" aria-label="MESA/21 - início">MESA<span>/21</span></a><nav class="main-nav" aria-label="Navegação principal"><a class="${selected('salas')}" href="#salas">Salas</a><a class="${selected('ranking')}" href="#ranking">Ranking</a><a class="${selected('como-jogar')}" href="#como-jogar">Como jogar</a></nav><div class="user-area"><span class="balance-pill" title="Fichas fictícias de demonstração">${icon('coin')} ${money(state.game.balance)}</span><button class="avatar-button" data-action="profile" aria-label="Abrir perfil"><span class="avatar">V</span><span class="user-label">Visitante</span></button></div></div></header>`;
}
function footer():string{return `<footer class="footer"><span>MESA/21 · Um cantinho pra jogar cartas.</span><span>Fichas fictícias, sem valor monetário.</span></footer>`;}
function lobby():string {
 const claimed=state.stats.claimedDate===today();
 return `<main class="page page-lobby"><section class="welcome"><div class="welcome-text"><span class="eyebrow"><span class="status-light"></span> MESA/21 · SEU JOGO DE CARTAS</span><h1>Bora jogar<span class="coral">?</span></h1><p>Uma mesa, um baralho e uma boa companhia. Sem complicação.</p><div class="welcome-actions"><button class="button primary large" data-action="solo">${icon('play')} Jogar sozinho</button><button class="button secondary large" data-action="create">${icon('plus')} Criar mesa</button></div></div><div class="welcome-art" aria-hidden="true"><div class="art-card art-one">A<small>♠</small></div><div class="art-card art-two">2<small>♥</small></div><span class="art-bubble">21!</span></div></section>
 <div class="lobby-grid"><section class="rooms-area"><div class="section-heading"><div><h2>Mesas abertas</h2><p>Encontre a sua turma ou comece uma mesa.</p></div><button class="text-button" data-action="create">${icon('plus')} Nova mesa</button></div>
 <div class="filters"><button data-action="filter" data-value="todas" class="filter ${state.filter==='todas'?'active':''}">Todas</button><button data-action="filter" data-value="casuais" class="filter ${state.filter==='casuais'?'active':''}">Casuais</button><button data-action="filter" data-value="classificatorias" class="filter ${state.filter==='classificatorias'?'active':''}">Classificatórias</button></div>
 <div class="empty-rooms"><div class="empty-icon">${icon('users')}</div><h3>As mesas vão abrir em breve.</h3><p>O multiplayer está sendo construído. Enquanto isso, a mesa solo já está pronta para você testar!</p><button class="button soft" data-action="solo">${icon('cards')} Experimentar blackjack ${icon('arrow')}</button></div>
 <div class="transparent-note">${icon('lock')} Esta é uma prévia funcional. Não mostramos salas ou jogadores inventados como se estivessem online.</div></section>
 <aside class="lobby-aside"><article class="bonus-box"><div class="bonus-head"><span class="bonus-icon">${icon('gift')}</span><span class="small-tag">SÓ FICHAS FICTÍCIAS</span></div><h3>Um presente pra hoje.</h3><p>Mais ${money(DAILY_BONUS)} pra jogar na sua mesa de treino.</p><button class="button ${claimed?'disabled':'coral-button'}" data-action="claim" ${claimed?'disabled':''}>${claimed?icon('check')+' Resgatado hoje':icon('gift')+' Resgatar '+money(DAILY_BONUS)}</button></article>
 <article class="ranking-teaser"><span class="teaser-icon">${icon('trophy')}</span><h3>Ranking entre amigos</h3><p>Em breve, seus resultados das mesas classificatórias vão aparecer por aqui.</p><button class="text-button" data-action="ranking">Conhecer ranking ${icon('arrow')}</button></article></aside></div></main>`;
}
function seat(index:number):string {return `<div class="seat empty-seat seat-${index}"><span class="seat-avatar">${icon('plus')}</span><span>Lugar livre</span></div>`;}
function handBlock():string {
 const game=state.game;
 if(game.phase==='betting')return '<div class="hand-placeholder"><span>♠</span><span>♥</span><span>♣</span><p>As cartas estão esperando você.</p></div>';
 return game.hands.map((hand,i)=>{const score=evaluateHand(hand.cards);
 return `<div class="player-hand ${game.phase==='playing'&&game.activeHand===i?'hand-active':''}"><div class="card-row">${hand.cards.map(c=>cardHtml(c)).join('')}</div><div class="hand-score">${game.hands.length>1?'Mão '+(i+1)+' · ':''}${score.total} pontos${hand.result?` · <strong>${labelResult(hand.result)}</strong>`:''}</div><div class="hand-wager">Aposta ${money(hand.wager)}</div></div>`;}).join('');
}
function labelResult(r:string):string {return ({win:'Vitória',lose:'Derrota',push:'Empate',blackjack:'Blackjack!'} as Record<string,string>)[r]||r;}
function gameControls():string {
 const g=state.game;
 if(g.phase==='betting'){
 const amounts=[10,20,50,100,200];
 return `<div class="bet-controls"><div class="control-info"><span class="tiny-label">Sua aposta</span><strong>${money(state.wager)}</strong><span class="bet-help">Saldo disponível: ${money(g.balance)}</span></div><div class="bet-options" role="group" aria-label="Escolher valor da aposta">${amounts.map(v=>`<button class="bet-chip ${state.wager===v?'active':''}" data-action="wager" data-value="${v}" ${v>g.balance?'disabled':''}>${v}</button>`).join('')}</div><button class="button primary big-button" data-action="bet" ${state.wager>g.balance?'disabled':''}>Confirmar aposta ${icon('arrow')}</button></div>${g.balance<10?'<p class="no-money">Suas fichas acabaram. Na demonstração, você pode pedir uma recarga gratuita. <button class="text-button" data-action="refill">Recarregar fichas</button></p>':''}`;
 }
 if(g.phase==='finished')return `<div class="result-controls"><div class="result-message"><span class="tiny-label">Rodada ${g.round} concluída</span><h3>${escaped(g.message)}</h3><strong class="${g.lastChange>=0?'profit':'loss'}">${g.lastChange>0?'+':''}${money(g.lastChange)}</strong></div><button class="button primary big-button" data-action="next">Próxima rodada ${icon('arrow')}</button></div>`;
 return `<div class="turn-controls"><div class="turn-copy"><span class="tiny-label">SUA VEZ</span><h3>${evaluateHand(g.hands[g.activeHand].cards).total} pontos</h3><span>${money(g.balance)} disponíveis</span></div><div class="turn-actions"><button class="button primary big-button" data-action="hit">${icon('plus')} Pedir <kbd>H</kbd></button><button class="button dark big-button" data-action="stand">${icon('check')} Parar <kbd>S</kbd></button><button class="button soft" data-action="double" ${canDouble(g)?'':'disabled'}>Dobrar</button><button class="button soft" data-action="split" ${canSplit(g)?'':'disabled'}>Dividir</button></div></div>`;
}
function table():string {
 const g=state.game,dc=g.phase==='betting'?[]:g.dealer;
 const reveal=g.phase==='finished';const dealerScore=reveal?evaluateHand(dc).total:(dc.length?evaluateHand([dc[0]]).total:0);
 const remaining=Math.round((1-g.shoeIndex/g.shoe.length)*100);
 return `<main class="game-page"><div class="game-toolbar"><div class="room-heading"><button class="round-icon" data-action="lobby" aria-label="Voltar às salas">${icon('back')}</button><div><strong>Mesa de treino</strong><span class="mode-tag">Solo · Casual</span></div></div><div class="room-tools"><span class="shoe-pill">6 baralhos · ${remaining}% disponíveis</span><button class="text-button" data-action="rules">${icon('book')} Regras</button><button class="text-button" data-action="lobby">Sair</button></div></div>
 <section class="felt" aria-label="Mesa de blackjack"><div class="felt-overlay"></div><div class="dealer-spot">${dealer()}<span class="dealer-name">Clarice <span>· dealer</span></span>${dc.length?`<div class="dealer-cards">${cardHtml(dc[0],true)}${reveal?dc.slice(1).map(c=>cardHtml(c,true)).join(''):backCard()}</div><div class="dealer-count">${reveal?dealerScore+' pontos':dealerScore+' + ?'}</div>`:'<p class="dealer-greeting">Preparada pra jogar?</p>'}</div>
 <div class="curve-line"></div>${seat(1)}${seat(2)}${seat(3)}${seat(4)}<div class="your-spot"><div class="your-cards">${handBlock()}</div><div class="your-identity"><div class="your-avatar">V</div><div><strong>Você</strong><span>Modo treino</span></div>${g.phase==='playing'?'<span class="your-turn">Sua vez</span>':''}</div></div><div class="table-brand">MESA <span>/21</span></div></section>
 <section class="controls-panel" aria-live="polite">${gameControls()}</section><div class="game-note">${icon('smile')} Treino solo: fichas guardadas apenas neste navegador. Nada de apostas reais.</div></main>`;
}
function ranking():string {return `<main class="page secondary-page"><div class="subpage-head"><span class="eyebrow">COMPETIÇÃO SAUDÁVEL</span><h1>Ranking<span class="coral">.</span></h1><p>Quem tá mandando bem nas mesas?</p></div><div class="future-feature"><span class="big-feature-icon">${icon('trophy')}</span><h2>Estamos preparando a classificação.</h2><p>O ranking mostrará lucro líquido fictício, sem contar bônus ou recargas. Para que ele seja justo, só vamos ativá-lo quando contas e partidas forem validadas pelo servidor.</p><div class="mini-stat-row"><div><strong>Semanal</strong><span>Novos desafios</span></div><div><strong>Mensal</strong><span>Temporadas</span></div><div><strong>Histórico</strong><span>Sua trajetória</span></div></div><button class="button primary" data-action="solo">Ir para a mesa ${icon('arrow')}</button></div></main>`;}
function rules():string {return `<main class="page secondary-page"><div class="subpage-head"><span class="eyebrow">UM GUIA SEM ENROLAÇÃO</span><h1>Como jogar<span class="coral">?</span></h1><p>Aprenda o básico em poucos minutos e venha pra mesa.</p></div><section class="rules-grid"><article class="rule-card"><span class="rule-number">01</span><h2>Chegue perto de 21.</h2><p>Seu objetivo é somar mais pontos que a Clarice sem passar de 21.</p><div class="mini-cards">${cardHtml({rank:'A',suit:'♠'},true)}${cardHtml({rank:'K',suit:'♥'},true)}</div></article><article class="rule-card"><span class="rule-number">02</span><h2>Entenda as cartas.</h2><p>De 2 a 10, cada carta vale seu número. J, Q e K valem 10. O Ás vale 1 ou 11.</p></article><article class="rule-card"><span class="rule-number">03</span><h2>Escolha sua jogada.</h2><p><b>Pedir</b> traz outra carta; <b>Parar</b> mantém sua mão; <b>Dobrar</b> aumenta a aposta e traz uma carta; <b>Dividir</b> separa um par.</p></article><article class="rule-card"><span class="rule-number">04</span><h2>E a Clarice?</h2><p>Ela pede cartas até alcançar pelo menos 17, inclusive quando o Ás conta como 11. Blackjack natural paga 3:2 e empate devolve a aposta.</p></article></section><div class="rules-disclaimer">As regras do blackjack favorecem matematicamente a casa. O embaralhamento do treino utiliza aleatoriedade criptográfica do navegador; o modo classificatório terá embaralhamento controlado e verificável no servidor.</div><button class="button primary" data-action="solo">Quero jogar ${icon('arrow')}</button></main>`;}
function profile():string {const s=state.stats;const rate=s.played?Math.round(s.wins/s.played*100):0;
 return `<main class="page secondary-page"><div class="profile-banner"><div class="profile-avatar">V</div><div><span class="eyebrow">PERFIL LOCAL · DEMONSTRAÇÃO</span><h1>Visitante</h1><p>Os números abaixo pertencem somente a este navegador.</p></div></div><div class="stat-grid"><div class="stat-card"><span>Fichas</span><strong>${money(state.game.balance)}</strong></div><div class="stat-card"><span>Rodadas</span><strong>${s.played}</strong></div><div class="stat-card"><span>Vitórias</span><strong>${s.wins}</strong></div><div class="stat-card"><span>Aproveitamento</span><strong>${rate}%</strong></div><div class="stat-card"><span>Blackjacks</span><strong>${s.blackjacks}</strong></div><div class="stat-card"><span>Resultado líquido</span><strong class="${s.net>=0?'profit':'loss'}">${s.net>0?'+':''}${money(s.net)}</strong></div></div><div class="callout"><h2>Conta permanente em preparação</h2><p>Quando as contas estiverem prontas, será possível salvar progresso entre dispositivos e participar do ranking. Este perfil de demonstração não é sincronizado.</p></div><button class="button secondary" data-action="historico">Ver histórico ${icon('arrow')}</button></main>`;
}
function history():string {const entries=state.stats.history;
 return `<main class="page secondary-page"><div class="subpage-head"><span class="eyebrow">SEUS ÚLTIMOS JOGOS</span><h1>Histórico<span class="coral">.</span></h1><p>Rodadas de treino armazenadas neste dispositivo.</p></div><div class="history-list">${entries.length?entries.map(e=>`<div class="history-item"><div><strong>${escaped(e.result)}</strong><span>${escaped(e.time)} · ${escaped(e.player)} contra ${escaped(e.dealer)}</span></div><div><small>Aposta ${money(e.wager)}</small><strong class="${e.delta>=0?'profit':'loss'}">${e.delta>0?'+':''}${money(e.delta)}</strong></div></div>`).join(''):'<div class="empty-rooms"><h3>Nenhuma rodada ainda.</h3><p>Quando jogar sua primeira mão, ela vai aparecer aqui.</p></div>'}</div><button class="button primary" data-action="solo">Jogar agora ${icon('arrow')}</button></main>`;
}
function modalHtml():string {
 if(!state.modal)return '';
 if(state.modal==='create')return `<div class="modal-backdrop" data-action="dismiss"><div class="modal" role="dialog" aria-modal="true" aria-label="Criar mesa"><button class="close-modal" data-action="dismiss" aria-label="Fechar">${icon('x')}</button><span class="eyebrow">SUA PRÓXIMA MESA</span><h2>Chama a turma.</h2><p>A criação de salas multiplayer ainda está em desenvolvimento. Você já pode testar a experiência solo e todas as regras do blackjack.</p><div class="modal-feature">${icon('users')} Em breve: salas públicas, privadas e convites por link.</div><button class="button primary wide" data-action="solo">Jogar sozinho ${icon('arrow')}</button></div></div>`;
 if(state.modal==='rules')return `<div class="modal-backdrop" data-action="dismiss"><div class="modal" role="dialog" aria-modal="true" aria-label="Regras da mesa"><button class="close-modal" data-action="dismiss" aria-label="Fechar">${icon('x')}</button><span class="eyebrow">REGRAS DO TREINO</span><h2>Direto ao ponto.</h2><p>São seis baralhos, reembaralhados após 75% de uso. Clarice para em qualquer 17. Blackjack natural paga 3:2.</p><p>Dobrar permite apenas mais uma carta. Dividir cria duas mãos (uma divisão por rodada); ases divididos recebem uma carta por mão. Você joga contra a dealer.</p><button class="button primary wide" data-action="dismiss">Entendi ${icon('check')}</button></div></div>`;
 return '';
}
function render():void {
 const view=state.view;
 const body=view==='salas'?lobby():view==='mesa'?table():view==='ranking'?ranking():view==='como-jogar'?rules():view==='perfil'?profile():history();
 root.innerHTML=`${header()}${body}${footer()}${modalHtml()}${state.toast?`<div class="toast" role="status">${icon('check')} ${escaped(state.toast)}</div>`:''}${state.error?`<div class="toast error" role="alert">${escaped(state.error)}</div>`:''}`;
 document.title=`${view==='mesa'?'Mesa de treino':view==='salas'?'Bora jogar?':view==='ranking'?'Ranking':view==='como-jogar'?'Como jogar':view==='perfil'?'Perfil':'Histórico'} · MESA/21`;
}
function go(view:View):void {state.view=view;state.modal=null;state.toast=null;state.error=null;window.history.replaceState(null,'','#'+view);render();window.scrollTo({top:0,behavior:'instant'});}
function updateStats(g:Game):void {
 const s=state.stats;s.played++;
 if(g.lastChange>0)s.wins++;else if(g.lastChange<0)s.losses++;else s.ties++;
 s.net+=g.lastChange;
 for(const hand of g.hands)if(hand.result==='blackjack')s.blackjacks++;
 const player=g.hands.map(h=>h.cards.map(c=>c.rank+c.suit).join(' ')).join(' / ');
 s.history.unshift({time:new Date().toLocaleString('pt-BR'),wager:g.totalWager,delta:g.lastChange,result:g.message,player,dealer:g.dealer.map(c=>c.rank+c.suit).join(' ')});
 s.history=s.history.slice(0,50);
}
function play(action:Action):void {
 const previouslyFinished=state.game.phase==='finished';
 const next=applyAction(state.game,action);
 state.game=next;
 if(next.phase==='finished'&&!previouslyFinished)updateStats(next);
 persist();render();
}
function dispatch(action:string,value?:string):void {
 state.error=null;state.toast=null;
 try {switch(action){
  case 'solo':go('mesa');return;
  case 'lobby':go('salas');return;
  case 'profile':go('perfil');return;
  case 'ranking':go('ranking');return;
  case 'historico':go('historico');return;
  case 'rules':state.modal='rules';break;
  case 'create':state.modal='create';break;
  case 'dismiss':state.modal=null;break;
  case 'filter':state.filter=value||'todas';break;
  case 'wager':state.wager=Number(value);break;
  case 'claim':if(state.stats.claimedDate===today())throw new Error('O bônus de hoje já foi resgatado.');state.stats.claimedDate=today();state.game.balance+=DAILY_BONUS;state.toast=`${money(DAILY_BONUS)} adicionados ao treino!`;persist();break;
  case 'refill':if(state.game.balance>=10||state.game.phase!=='betting')throw new Error('A recarga está disponível apenas com saldo insuficiente.');state.game.balance+=INITIAL_CREDITS;state.toast='Fichas fictícias recarregadas!';persist();break;
  case 'bet':play({type:'bet',amount:state.wager});return;
  case 'hit':play({type:'hit'});return;
  case 'stand':play({type:'stand'});return;
  case 'double':play({type:'double'});return;
  case 'split':play({type:'split'});return;
  case 'next':play({type:'next'});return;
  default:return;
 }}catch(err){state.error=err instanceof Error?err.message:'Não foi possível concluir a ação.';}
 render();
}
root.addEventListener('click',event=>{
 const target=(event.target as Element).closest<HTMLElement>('[data-action]');
 if(!target||target.hasAttribute('disabled'))return;
 if(target.classList.contains('modal-backdrop') && (event.target as Element).closest('.modal'))return;
 dispatch(target.dataset.action||'',target.dataset.value);
});
window.addEventListener('hashchange',()=>{
 const view=location.hash.substring(1) as View;
 if(['salas','mesa','ranking','como-jogar','perfil','historico'].includes(view))go(view);
});
window.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&state.modal){dispatch('dismiss');return;}
 if(state.view!=='mesa'||state.modal||state.game.phase!=='playing')return;
 const tag=(event.target as HTMLElement)?.tagName?.toLowerCase();
 if(tag==='input'||tag==='textarea')return;
 if(event.key.toLowerCase()==='h'){event.preventDefault();dispatch('hit');}
 if(event.key.toLowerCase()==='s'){event.preventDefault();dispatch('stand');}
});
const initial=location.hash.slice(1) as View;
if(['salas','mesa','ranking','como-jogar','perfil','historico'].includes(initial))state.view=initial;
render();
