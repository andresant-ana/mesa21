import "./styles.css";
import "./rooms.css";
import "./navigation.ts";
import { cancelCardMotion, dealFromDeck, flipRevealedCard } from "./dealAnimation.ts";

type Suit = "clubs" | "diamonds" | "hearts" | "spades";
type Card = { rank: string; suit: Suit };
type SecondaryHand = { cards: Card[]; bet: number; total: number; result: "blackjack" | "win" | "loss" | "push" | "bust" | null };
type PublicGame = {
  balance: number;
  casualCredits: number;
  bet: number;
  phase: "player" | "finished";
  result: "blackjack" | "win" | "loss" | "push" | "bust" | null;
  playerCards: Card[];
  dealerCards: Array<Card | null>;
  playerTotal: number;
  dealerTotal: number | null;
  canDouble: boolean;
  canSplit: boolean;
  activeHand: 0 | 1;
  secondaryHand: SecondaryHand | null;
};
type Session = { casualCredits: number; rankedPoints: number | null; game: PublicGame | null };
const isRanked = document.body.dataset.mode === "ranked";
const sessionPath = isRanked ? "/api/ranked/session" : "/api/session";
const startPath = isRanked ? "/api/ranked/start" : "/api/game/start";
const actionPath = isRanked ? "/api/ranked/action" : "/api/game/action";

const balanceElement = required<HTMLElement>("credit-balance");
const dealerCardsElement = required<HTMLElement>("dealer-cards");
const playerCardsElement = required<HTMLElement>("player-cards");
const dealerTotalElement = required<HTMLElement>("dealer-total");
const playerTotalElement = required<HTMLElement>("player-total");
const messageElement = required<HTMLElement>("round-message");
const errorElement = required<HTMLElement>("error-message");
const betElement = required<HTMLInputElement>("bet");
const betControls = required<HTMLElement>("bet-controls");
const hitButton = required<HTMLButtonElement>("hit");
const standButton = required<HTMLButtonElement>("stand");
const doubleButton = required<HTMLButtonElement>("double");
const splitButton = required<HTMLButtonElement>("split");
const newRoundButton = required<HTMLButtonElement>("new-round");
const refillButton = required<HTMLButtonElement>("refill");
let currentCredits = 0;
let activeGame: PublicGame | null = null;
let busy = false;
let firstSnapshot = true;
let renderedGame: PublicGame | null = null;
let animateNextDeal = false;

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error("Elemento ausente: " + id);
  return element as T;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir a ação.");
  return data;
}

async function loadSession(): Promise<void> {
  try {
    const session = await api<Session>(sessionPath);
    renderSession(session);
  } catch (error) {
    showError(error instanceof Error && error.message === "UNAUTHORIZED"
      ? "Entre na sua conta para acessar a mesa classificatória."
      : "Não foi possível conectar à mesa. Atualize a página para tentar de novo.");
  }
}

function renderSession(session: Session): void {
  currentCredits = session.casualCredits;
  balanceElement.textContent = formatCredits(currentCredits);
  activeGame = session.game;
  errorElement.hidden = true;
  renderGame(session.game);
}

function renderGame(game: PublicGame | null): void {
  cancelCardMotion();
  const table = document.querySelector<HTMLElement>(".solo-table");
  const freshlyDealt = animateNextDeal && !firstSnapshot;
  animateNextDeal = false;
  const arriving: HTMLElement[] = [];
  table?.classList.remove("result-win", "result-loss", "result-push");
  if (game?.phase === "finished") {
    table?.classList.add(game.result === "win" || game.result === "blackjack" ? "result-win" : game.result === "push" ? "result-push" : "result-loss");
  }
  const tableBet = document.getElementById("table-bet");
  const seatWager = document.getElementById("seat-wager");
  document.querySelectorAll<HTMLButtonElement>(".chip-button").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.dataset.bet === betElement.value));
  });
  if (tableBet) tableBet.textContent = game ? String(game.bet) + " fichas" : betElement.value + " fichas";
  if (seatWager) seatWager.textContent = game ? "Aposta: " + game.bet + " fichas" : "Aposta sugerida: " + betElement.value;
  const canRefill = !isRanked && currentCredits < 10 && (!game || game.phase === "finished");
  refillButton.hidden = !canRefill;
  refillButton.disabled = busy || !canRefill;
  const bettingPhase = !game || game.phase === "finished";
  betControls.hidden = !bettingPhase;
  newRoundButton.hidden = !bettingPhase || currentCredits < 10;
  if (!game) {
    dealerCardsElement.replaceChildren(hint("Dê início à rodada quando estiver pronto."));
    playerCardsElement.replaceChildren(emptyCard(), emptyCard());
    dealerTotalElement.textContent = "";
    playerTotalElement.hidden = false;
    playerTotalElement.textContent = "";
    messageElement.textContent = isRanked ? "Escolha sua aposta. Os resultados vão para o ranking." : "Uma mesa simples, só para você.";
    setActions(false, false);
    betElement.disabled = busy;
    newRoundButton.disabled = busy || currentCredits < 10;
    firstSnapshot = false;
    renderedGame = null;
    return;
  }

  const previousDealerCount = renderedGame?.dealerCards.length ?? 0;
  const dealerCards = game.dealerCards.map((card) => card ? playingCard(card) : cardBack());
  if (!firstSnapshot && !freshlyDealt) {
    arriving.push(...dealerCards.slice(previousDealerCount));
    if (renderedGame?.dealerCards[1] === null && game.dealerCards[1]) {
      flipRevealedCard(dealerCards[1]!);
    }
  }
  dealerCardsElement.replaceChildren(...dealerCards);
  if (game.secondaryHand) {
    const priorPrimary = renderedGame?.playerCards.length ?? 0;
    const priorSecondary = renderedGame?.secondaryHand?.cards.length ?? 0;
    playerCardsElement.replaceChildren(
      splitHandView(1, game.playerCards, game.playerTotal, game.bet, game.result, game.activeHand === 0 && game.phase === "player"),
      splitHandView(2, game.secondaryHand.cards, game.secondaryHand.total, game.secondaryHand.bet, game.secondaryHand.result, game.activeHand === 1 && game.phase === "player")
    );
    const renderedHands = playerCardsElement.querySelectorAll(".split-hand");
    [[game.playerCards.length, priorPrimary], [game.secondaryHand.cards.length, priorSecondary]].forEach(([size, prior], index) => {
      if (!firstSnapshot && !freshlyDealt && size > prior) {
        arriving.push(...Array.from(renderedHands[index]?.querySelectorAll<HTMLElement>(".playing-card") ?? []).slice(prior));
      }
    });
    playerTotalElement.hidden = true;
  } else {
    const previousPlayerCount = renderedGame?.playerCards.length ?? 0;
    const playerCards = game.playerCards.map(playingCard);
    if (!firstSnapshot && !freshlyDealt) arriving.push(...playerCards.slice(previousPlayerCount));
    playerCardsElement.replaceChildren(...playerCards);
    playerTotalElement.hidden = false;
  }
  if (freshlyDealt) {
    // Opening sequence alternates player/dealer from the actual deck.
    const players = Array.from(playerCardsElement.querySelectorAll<HTMLElement>(".playing-card"));
    for (let i = 0; i < Math.max(players.length, dealerCards.length); i += 1) {
      if (players[i]) arriving.push(players[i]!);
      if (dealerCards[i]) arriving.push(dealerCards[i]!);
    }
  }
  if (table) dealFromDeck(table, arriving);
  firstSnapshot = false;
  renderedGame = game;
  dealerTotalElement.textContent = game.dealerTotal === null ? "" : String(game.dealerTotal);
  playerTotalElement.textContent = String(game.playerTotal);
  betElement.disabled = busy || game.phase === "player";
  newRoundButton.disabled = busy || game.phase === "player" || currentCredits < 10;

  if (game.phase === "player") {
    messageElement.textContent = game.secondaryHand
      ? "Sua vez: mão " + (game.activeHand + 1) + " de 2."
      : "Sua vez. Peça uma carta, pare ou dobre a aposta.";
    setActions(true, game.canDouble, game.canSplit);
  } else {
    setActions(false, false);
    messageElement.textContent = game.secondaryHand
      ? "Mão 1: " + shortResult(game.result) + " · Mão 2: " + shortResult(game.secondaryHand.result) + "."
      : resultMessage(game.result);
  }
}

function setActions(enabled: boolean, canDouble: boolean, canSplit = false): void {
  hitButton.hidden = !enabled;
  standButton.hidden = !enabled;
  doubleButton.hidden = !enabled || !canDouble;
  splitButton.hidden = !enabled || !canSplit;
  hitButton.disabled = busy || !enabled;
  standButton.disabled = busy || !enabled;
  doubleButton.disabled = busy || !canDouble;
  splitButton.disabled = busy || !canSplit;
}

function splitHandView(
  number: number,
  cards: Card[],
  total: number,
  wager: number,
  result: PublicGame["result"],
  active: boolean
): HTMLElement {
  const group = document.createElement("div");
  group.className = "split-hand" + (active ? " is-active" : "");
  const label = document.createElement("div");
  label.className = "split-hand-label";
  label.textContent = "Mão " + number + " · " + total + " pontos · " + wager + " créditos";
  const row = document.createElement("div");
  row.className = "split-hand-cards";
  row.append(...cards.map(playingCard));
  group.append(label, row);
  if (result) {
    const badge = document.createElement("span");
    badge.className = "split-hand-result";
    badge.textContent = shortResult(result);
    group.append(badge);
  }
  return group;
}

function shortResult(result: PublicGame["result"]): string {
  switch (result) {
    case "blackjack": return "Blackjack";
    case "win": return "Vitória";
    case "loss": return "Derrota";
    case "bust": return "Estourou";
    case "push": return "Empate";
    default: return "Em andamento";
  }
}

function playingCard(card: Card): HTMLElement {
  const element = document.createElement("div");
  element.className = "playing-card" + (card.suit === "hearts" || card.suit === "diamonds" ? " red-suit" : "");
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", card.rank + " de " + suitName(card.suit));
  const top = document.createElement("span");
  top.className = "card-corner";
  top.textContent = card.rank + suitSymbol(card.suit);
  const center = document.createElement("span");
  center.className = "card-center";
  center.textContent = suitSymbol(card.suit);
  const bottom = document.createElement("span");
  bottom.className = "card-corner card-corner-bottom";
  bottom.textContent = card.rank + suitSymbol(card.suit);
  element.append(top, center, bottom);
  return element;
}

function cardBack(): HTMLElement {
  const element = document.createElement("div");
  element.className = "playing-card card-back";
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", "Carta fechada");
  const motif = document.createElement("span");
  motif.setAttribute("aria-hidden", "true");
  motif.textContent = "✦";
  element.append(motif);
  return element;
}

function emptyCard(): HTMLElement {
  const element = document.createElement("div");
  element.className = "empty-card";
  element.setAttribute("aria-hidden", "true");
  element.textContent = "＋";
  return element;
}

function hint(text: string): HTMLElement {
  const element = document.createElement("p");
  element.className = "table-hint";
  element.textContent = text;
  return element;
}

function suitSymbol(suit: Suit): string { return { clubs: "\u2663", diamonds: "\u2666", hearts: "\u2665", spades: "\u2660" }[suit]; }

function suitName(suit: Suit): string {
  return { clubs: "paus", diamonds: "ouros", hearts: "copas", spades: "espadas" }[suit];
}

function formatCredits(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}
function resultMessage(result: PublicGame["result"]): string {
  switch (result) {
    case "blackjack": return "Blackjack! Sua mão natural paga 3:2.";
    case "win": return "Boa mão. Você venceu esta rodada.";
    case "loss": return "A dealer levou esta. Tente outra rodada.";
    case "push": return "Empate. A aposta voltou para seus créditos.";
    case "bust": return "Passou de 21. A rodada ficou com a dealer.";
    default: return "Rodada encerrada.";
  }
}
function showError(message: string): void {
  errorElement.textContent = message;
  errorElement.hidden = false;
}
async function perform(path: string, body: unknown): Promise<void> {
  if (busy) return;
  busy = true;
  setActions(false, false);
  newRoundButton.disabled = true;
  refillButton.disabled = true;
  betElement.disabled = true;
  errorElement.hidden = true;
  try {
    const next = await api<Session>(path, body);
    currentCredits = next.casualCredits;
    balanceElement.textContent = formatCredits(currentCredits);
    activeGame = next.game;
    animateNextDeal = path === startPath;
  } catch (error) {
    showError(error instanceof Error ? friendlyError(error.message) : "A ação não foi concluída.");
  } finally {
    busy = false;
    renderGame(activeGame);
  }
}
function friendlyError(code: string): string {
  if (code === "INSUFFICIENT_CREDITS") return "Você não tem créditos suficientes para essa aposta.";
  if (code === "UNAUTHORIZED") return "Entre na sua conta para jogar partidas classificatórias.";
  if (code === "ROUND_ACTIVE") return "Termine a rodada atual antes de começar outra.";
  if (code === "REFILL_NOT_AVAILABLE") return "Os créditos de cortesia estarão disponíveis quando você ficar sem fichas casuais.";
  if (code === "RATE_LIMITED") return "Muitas ações em pouco tempo. Aguarde um minuto e tente novamente.";
  if (code === "RATE_LIMIT_UNAVAILABLE") return "As proteções da mesa estão indisponíveis. Tente mais tarde.";
  if (code === "ORIGIN_NOT_ALLOWED") return "A origem da solicitação não foi aceita.";
  return "A ação não foi concluída. Tente novamente.";
}

hitButton.addEventListener("click", () => void perform(actionPath, { action: "hit" }));
standButton.addEventListener("click", () => void perform(actionPath, { action: "stand" }));
doubleButton.addEventListener("click", () => void perform(actionPath, { action: "double" }));
splitButton.addEventListener("click", () => void perform(actionPath, { action: "split" }));
newRoundButton.addEventListener("click", () => void perform(startPath, { bet: Number(betElement.value) }));
document.querySelectorAll<HTMLButtonElement>(".chip-button").forEach((chip) => {
  chip.addEventListener("click", () => {
    if (betElement.disabled) return;
    betElement.value = chip.dataset.bet ?? betElement.value;
    renderGame(activeGame);
  });
});
refillButton.addEventListener("click", () => { if (!isRanked) void perform("/api/game/refill", {}); });
window.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const key = event.key.toLowerCase();
  if (key === "h" && !hitButton.disabled) hitButton.click();
  if (key === "s" && !standButton.disabled) standButton.click();
  if (key === "d" && !doubleButton.disabled) doubleButton.click();
  if (key === "v" && !splitButton.disabled) splitButton.click();
});
void loadSession();
