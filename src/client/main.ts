import "./styles.css";

type Suit = "clubs" | "diamonds" | "hearts" | "spades";
type Card = { rank: string; suit: Suit };
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
};
type Session = { casualCredits: number; rankedPoints: null; game: PublicGame | null };

const balanceElement = required<HTMLElement>("credit-balance");
const dealerCardsElement = required<HTMLElement>("dealer-cards");
const playerCardsElement = required<HTMLElement>("player-cards");
const dealerTotalElement = required<HTMLElement>("dealer-total");
const playerTotalElement = required<HTMLElement>("player-total");
const messageElement = required<HTMLElement>("round-message");
const errorElement = required<HTMLElement>("error-message");
const betElement = required<HTMLSelectElement>("bet");
const hitButton = required<HTMLButtonElement>("hit");
const standButton = required<HTMLButtonElement>("stand");
const doubleButton = required<HTMLButtonElement>("double");
const newRoundButton = required<HTMLButtonElement>("new-round");
let activeGame: PublicGame | null = null;
let busy = false;

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
    const session = await api<Session>("/api/session");
    renderSession(session);
  } catch {
    showError("Não foi possível conectar à mesa. Atualize a página para tentar de novo.");
  }
}

function renderSession(session: Session): void {
  balanceElement.textContent = formatCredits(session.casualCredits);
  activeGame = session.game;
  errorElement.hidden = true;
  renderGame(session.game);
}

function renderGame(game: PublicGame | null): void {
  if (!game) {
    dealerCardsElement.replaceChildren(hint("Dê início à rodada quando estiver pronto."));
    playerCardsElement.replaceChildren(emptyCard(), emptyCard());
    dealerTotalElement.textContent = "";
    playerTotalElement.textContent = "";
    messageElement.textContent = "Uma mesa simples, só para você.";
    setActions(false, false);
    betElement.disabled = busy;
    newRoundButton.disabled = busy;
    return;
  }

  dealerCardsElement.replaceChildren(...game.dealerCards.map((card) => card ? playingCard(card) : cardBack()));
  playerCardsElement.replaceChildren(...game.playerCards.map(playingCard));
  dealerTotalElement.textContent = game.dealerTotal === null ? "" : String(game.dealerTotal);
  playerTotalElement.textContent = String(game.playerTotal);
  betElement.disabled = busy || game.phase === "player";
  newRoundButton.disabled = busy || game.phase === "player";

  if (game.phase === "player") {
    messageElement.textContent = "Sua vez. Peça uma carta, pare ou dobre a aposta.";
    setActions(true, game.canDouble);
  } else {
    setActions(false, false);
    messageElement.textContent = resultMessage(game.result);
  }
}

function setActions(enabled: boolean, canDouble: boolean): void {
  hitButton.disabled = busy || !enabled;
  standButton.disabled = busy || !enabled;
  doubleButton.disabled = busy || !canDouble;
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

function suitSymbol(suit: Suit): string {
  return { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" }[suit];
}
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
  betElement.disabled = true;
  errorElement.hidden = true;
  try {
    renderSession(await api<Session>(path, body));
  } catch (error) {
    showError(error instanceof Error ? friendlyError(error.message) : "A ação não foi concluída.");
  } finally {
    busy = false;
    if (activeGame) renderGame(activeGame);
    else renderGame(null);
  }
}
function friendlyError(code: string): string {
  if (code === "INSUFFICIENT_CREDITS") return "Você não tem créditos casuais suficientes para essa aposta.";
  if (code === "ROUND_ACTIVE") return "Termine a rodada atual antes de começar outra.";
  if (code === "ORIGIN_NOT_ALLOWED") return "A origem da solicitação não foi aceita.";
  return "A ação não foi concluída. Tente novamente.";
}

hitButton.addEventListener("click", () => void perform("/api/game/action", { action: "hit" }));
standButton.addEventListener("click", () => void perform("/api/game/action", { action: "stand" }));
doubleButton.addEventListener("click", () => void perform("/api/game/action", { action: "double" }));
newRoundButton.addEventListener("click", () => void perform("/api/game/start", { bet: Number(betElement.value) }));
window.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const key = event.key.toLowerCase();
  if (key === "h" && !hitButton.disabled) hitButton.click();
  if (key === "s" && !standButton.disabled) standButton.click();
});
void loadSession();
