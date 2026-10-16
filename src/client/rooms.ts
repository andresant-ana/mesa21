import "./styles.css";
import "./rooms.css";

type Entry = {
  code: string; name: string; visibility: "public" | "private"; mode: "casual";
  players: number; capacity: number; spectators: number; hostName: string; createdAt: number;
};
type SocialCard = { rank: string; suit: "clubs" | "diamonds" | "hearts" | "spades" };
type SocialHand = { cards: SocialCard[]; total: number; wager: number; done: boolean; result: string | null };
type SocialRound = { phase: "betting" | "playing" | "finished"; dealerCards: Array<SocialCard | null>; dealerTotal: number | null; turnSeatId: string | null; seats: Array<{ id: string; wager: number; activeHand: number; hands: SocialHand[] }> };
type Detail = Entry & {
  role: "visitor" | "player" | "spectator"; isHost: boolean; gameAvailable: boolean;
  members: Array<{ id: string; name: string; isHost: boolean }>;
  mySeatId: string | null;
  myCredits: number | null;
  round: SocialRound | null;
  spectatorsList: Array<{ id: string; name: string }>;
};

const element = <T extends HTMLElement>(id: string): T => {
  const result = document.getElementById(id);
  if (!result) throw new Error("Elemento ausente: " + id);
  return result as T;
};

const directory = element<HTMLElement>("room-directory");
const detailPanel = element<HTMLElement>("room-details");
const list = element<HTMLElement>("room-list");
const errorPanel = element<HTMLElement>("rooms-error");
const createForm = element<HTMLFormElement>("create-room");
const codeForm = element<HTMLFormElement>("join-code");
const nick = element<HTMLInputElement>("display-name");
const roomName = element<HTMLInputElement>("room-name");
const visibility = element<HTMLSelectElement>("visibility");
const roomCode = element<HTMLInputElement>("room-code");
const members = element<HTMLElement>("room-members");
const joinArea = element<HTMLElement>("join-area");
const inviteArea = element<HTMLElement>("invite-area");
const joinName = element<HTMLInputElement>("join-name");
const joinButton = element<HTMLButtonElement>("join-room");
const leaveButton = element<HTMLButtonElement>("leave-room");
const inviteLink = element<HTMLInputElement>("invite-link");
const connectionState = element<HTMLElement>("connection-state");
let opened: Detail | null = null;
let socket: WebSocket | null = null;
let busy = false;
let polling: number | null = null;
const CODE_PATTERN = /^[A-F0-9]{12}$/;

function showError(message: string): void {
  errorPanel.hidden = false;
  errorPanel.textContent = message;
}

function clearError(): void {
  errorPanel.hidden = true;
  errorPanel.textContent = "";
}

async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch("/api" + path, {
    method: data === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(messageFor(payload.error ?? "UNKNOWN"));
  return payload;
}

function messageFor(code: string): string {
  return ({
    ROOM_NOT_FOUND: "Não encontramos essa mesa. Confira seu convite.",
    ROOM_FULL: "A sala já atingiu o limite de jogadores e espectadores.",
    ALREADY_IN_ROOM: "Saia da sua sala atual antes de entrar em outra.",
    INVALID_NAME: "Escolha um apelido entre 2 e 20 caracteres.",
    NAME_TAKEN: "Esse apelido já está em uso na sala.",
    INVALID_ROOM: "Confira o nome da mesa, seu apelido e a privacidade.",
    RANKED_UNAVAILABLE: "As salas classificatórias ainda não estão disponíveis.",
    ROOM_LIMIT_REACHED: "Muitas mesas abertas agora. Tente novamente em alguns minutos.",
    UNAUTHORIZED: "Sua sessão expirou. Atualize a página.",
    NOT_IN_ROOM: "Entre na sala para acompanhar as atualizações."
  } as Record<string, string>)[code] ?? "Não foi possível concluir a ação. Tente novamente.";
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, content: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  item.className = className;
  item.textContent = content;
  return item;
}

async function renderDirectory(): Promise<void> {
  const { rooms } = await api<{ rooms: Entry[] }>("/rooms");
  list.replaceChildren();
  if (!rooms.length) {
    list.append(node("p", "room-empty", "Ainda não há mesas públicas. Que tal abrir a primeira?"));
    return;
  }
  for (const room of rooms) {
    const row = node("div", "room-list-item", "");
    const copy = node("div", "room-list-copy", "");
    copy.append(node("strong", "", room.name));
    copy.append(node("span", "", room.players + "/" + room.capacity + " jogadores · Anfitrião: " + room.hostName));
    const button = node("button", "button button-soft", "Entrar →");
    button.type = "button";
    button.addEventListener("click", () => openRoom(room.code));
    row.append(copy, button);
    list.append(row);
  }
}

function closeSocket(): void {
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  if (polling !== null) {
    window.clearInterval(polling);
    polling = null;
  }
}

function connect(code: string): void {
  closeSocket();
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  try {
    const ws = new WebSocket(scheme + "//" + location.host + "/api/rooms/" + code + "/stream");
    socket = ws;
    connectionState.textContent = "Conectando...";
    ws.onopen = () => { connectionState.textContent = "Amigos conectados em tempo real."; };
    ws.onmessage = (event) => {
      try {
        const message: unknown = JSON.parse(String(event.data));
        if (message && typeof message === "object" && "type" in message && message.type === "room" &&
            "room" in message && message.room && typeof message.room === "object") {
          renderRoom(message.room as Detail);
        }
      } catch { /* Ignore malformed notifications; snapshots remain authoritative. */ }
    };
    ws.onerror = () => { connectionState.textContent = "Reconectando via atualização periódica."; };
    ws.onclose = () => {
      if (opened?.code !== code) return;
      connectionState.textContent = "Atualizando os participantes periodicamente.";
      if (polling === null) {
        polling = window.setInterval(() => {
          if (document.visibilityState !== "visible" || opened?.code !== code) return;
          void api<{ room: Detail }>("/rooms/" + code)
            .then(({ room }) => renderRoom(room)).catch(() => undefined);
        }, 12_000);
      }
    };
  } catch {
    connectionState.textContent = "Atualize para verificar os participantes.";
  }
}

function renderRoom(room: Detail): void {
  opened = room;
  directory.hidden = true;
  detailPanel.hidden = false;
  element<HTMLElement>("opened-room-name").textContent = room.name;
  element<HTMLElement>("opened-room-meta").textContent =
    room.visibility === "private" ? "Sala privada · até 5 jogadores" : "Sala pública · até 5 jogadores";
  members.replaceChildren();
  for (const member of room.members) {
    const seat = node("div", "room-seat", "");
    const avatar = node("span", "seat-avatar", member.name.slice(0, 1).toUpperCase());
    const name = node("span", "seat-name", member.name + (member.isHost ? " · anfitrião" : ""));
    seat.append(avatar, name);
    members.append(seat);
  }
  for (let i = room.members.length; i < room.capacity; i += 1) {
    members.append(node("div", "room-seat is-empty", "＋  Tem lugar pra mais gente!"));
  }
  element<HTMLElement>("room-spectators").textContent = room.spectators
    ? room.spectators + " pessoa(s) assistindo" : "";
  const joined = room.role !== "visitor";
  leaveButton.hidden = !joined;
  inviteArea.hidden = !joined;
  joinArea.hidden = joined;
  inviteLink.value = location.origin + "/salas.html?sala=" + room.code;
  renderGameplay(room);
  joinName.value ||= nick.value;
  if (joined && (!socket || socket.readyState === WebSocket.CLOSED)) connect(room.code);
}


function socialCard(card: SocialCard | null): HTMLElement {
  const nodeCard = document.createElement("div");
  nodeCard.className = "playing-card" + (!card ? " card-back" : ["hearts", "diamonds"].includes(card.suit) ? " red-suit" : "");
  if (!card) {
    nodeCard.textContent = "✦";
    nodeCard.setAttribute("aria-label", "Carta fechada");
    return nodeCard;
  }
  const symbol = ({ clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" } as Record<SocialCard["suit"], string>)[card.suit];
  nodeCard.setAttribute("aria-label", card.rank + " " + symbol);
  nodeCard.append(node("span", "card-corner", card.rank + symbol), node("span", "card-center", symbol),
    node("span", "card-corner card-corner-bottom", card.rank + symbol));
  return nodeCard;
}

function renderGameplay(room: Detail): void {
  const area = element<HTMLElement>("game-area");
  area.hidden = room.role === "visitor";
  if (area.hidden) return;
  const round = room.round;
  const isPlayer = room.role === "player";
  const seat = round?.seats.find((s) => s.id === room.mySeatId);
  const dealer = element<HTMLElement>("social-dealer-cards");
  const hands = element<HTMLElement>("social-player-hands");
  dealer.replaceChildren();
  hands.replaceChildren();
  element<HTMLElement>("game-credits").textContent = room.myCredits === null ? "Assistindo" : room.myCredits + " créditos da sala";
  if (round) {
    dealer.append(...round.dealerCards.map(socialCard));
    for (const participant of round.seats) {
      const name = room.members.find((m) => m.id === participant.id)?.name ?? "Jogador";
      const section = node("section", "social-player" + (round.turnSeatId === participant.id ? " is-turn" : ""), "");
      const caption = node("strong", "", name + (participant.id === room.mySeatId ? " (você)" : ""));
      section.append(caption);
      for (const [index, hand] of participant.hands.entries()) {
        const title = node("span", "social-hand-label",
          (participant.hands.length > 1 ? "Mão " + (index + 1) + " · " : "") +
          hand.total + " pontos · " + hand.wager + " fichas" + (hand.result ? " · " + hand.result : ""));
        const cardRow = node("div", "room-game-cards", "");
        cardRow.append(...hand.cards.map(socialCard));
        section.append(title, cardRow);
      }
      hands.append(section);
    }
  }

  const isBetting = round?.phase === "betting";
  const isPlaying = round?.phase === "playing";
  const isFinished = round?.phase === "finished";
  const hasBet = (seat?.wager ?? 0) > 0;
  const myTurn = isPlaying && round?.turnSeatId === room.mySeatId && isPlayer;
  const myHand = seat?.hands[seat.activeHand];
  element<HTMLButtonElement>("game-start").hidden = !(room.isHost && (!round || isFinished));
  element<HTMLElement>("game-betting").hidden = !(isBetting && isPlayer && !hasBet);
  element<HTMLButtonElement>("game-deal").hidden = !(isBetting && room.isHost && (round?.seats.some((s) => s.wager > 0) ?? false));
  element<HTMLElement>("game-actions").hidden = !myTurn;
  element<HTMLButtonElement>("social-double").hidden = !myTurn || !myHand || myHand.cards.length !== 2 || (room.myCredits ?? 0) < myHand.wager;
  const splitValue = (rank: string) => ["10", "J", "Q", "K"].includes(rank) ? 10 : rank === "A" ? 11 : Number(rank);
  element<HTMLButtonElement>("social-split").hidden = !myTurn || !myHand || seat?.hands.length !== 1 ||
    myHand.cards.length !== 2 || splitValue(myHand.cards[0]!.rank) !== splitValue(myHand.cards[1]!.rank) ||
    (room.myCredits ?? 0) < myHand.wager;
  element<HTMLButtonElement>("social-refill").hidden = !isPlayer || (room.myCredits ?? 0) >= 10 || (isBetting || isPlaying);
  element<HTMLElement>("game-status").textContent = !round ? "Aguardando anfitrião começar a primeira rodada." :
    isBetting ? hasBet ? "Aposta registrada. Aguardando os outros jogadores." : "Escolha sua aposta para começar." :
    isPlaying ? myTurn ? "Sua vez! O que você vai fazer?" :
    "Vez de " + (room.members.find((m) => m.id === round.turnSeatId)?.name ?? "outro jogador") + "." :
    "Rodada encerrada! O anfitrião pode começar outra.";
}

async function roomAction(path: string, body: unknown = {}): Promise<void> {
  if (!opened) return;
  const code = opened.code;
  await withBusy(async () => {
    const { room } = await api<{ room: Detail }>("/rooms/" + code + "/" + path, body);
    renderRoom(room);
  });
}

async function openRoom(code: string, updateHistory = true): Promise<void> {
  const sanitized = code.toUpperCase().trim();
  if (!CODE_PATTERN.test(sanitized)) {
    showError("Use um código válido de 12 caracteres.");
    return;
  }
  clearError();
  closeSocket();
  try {
    const { room } = await api<{ room: Detail }>("/rooms/" + sanitized);
    if (updateHistory) history.pushState({}, "", "/salas.html?sala=" + sanitized);
    renderRoom(room);
  } catch (error) {
    showError(String(error instanceof Error ? error.message : error));
  }
}

async function withBusy(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  clearError();
  try { await action(); }
  catch (error) { showError(error instanceof Error ? error.message : "Não foi possível concluir a ação."); }
  finally { busy = false; }
}

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void withBusy(async () => {
    const { room } = await api<{ room: Detail }>("/rooms", {
      displayName: nick.value,
      name: roomName.value,
      visibility: visibility.value,
      mode: "casual"
    });
    history.pushState({}, "", "/salas.html?sala=" + room.code);
    renderRoom(room);
  });
});

codeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void openRoom(roomCode.value);
});

joinButton.addEventListener("click", () => void withBusy(async () => {
  if (!opened) return;
  const { room } = await api<{ room: Detail }>("/rooms/" + opened.code + "/join", { displayName: joinName.value });
  renderRoom(room);
}));

leaveButton.addEventListener("click", () => void withBusy(async () => {
  if (!opened) return;
  await api("/rooms/" + opened.code + "/leave", {});
  closeSocket();
  opened = null;
  history.pushState({}, "", "/salas.html");
  detailPanel.hidden = true;
  element<HTMLElement>("game-area").hidden = true;
  directory.hidden = false;
  await renderDirectory();
}));

element<HTMLButtonElement>("copy-invite").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    connectionState.textContent = "Convite copiado! É só enviar.";
  } catch { inviteLink.focus(); inviteLink.select(); connectionState.textContent = "Selecione e copie o link acima."; }
});

element<HTMLButtonElement>("game-start").addEventListener("click", () => void roomAction("start"));
element<HTMLButtonElement>("game-deal").addEventListener("click", () => void roomAction("deal"));
element<HTMLButtonElement>("game-bet").addEventListener("click", () => void roomAction("bet", {
  bet: Number(element<HTMLSelectElement>("game-wager").value)
}));
for (const [id, action] of [["social-hit", "hit"], ["social-stand", "stand"],
  ["social-double", "double"], ["social-split", "split"]] as const) {
  element<HTMLButtonElement>(id).addEventListener("click", () => void roomAction("action", { action }));
}
element<HTMLButtonElement>("social-refill").addEventListener("click", () => void roomAction("refill"));
element<HTMLButtonElement>("refresh-rooms").addEventListener("click", () => void withBusy(renderDirectory));
window.addEventListener("popstate", () => { closeSocket(); void initialize(); });

async function initialize(): Promise<void> {
  clearError();
  const code = new URLSearchParams(location.search).get("sala");
  if (code) await openRoom(code, false);
  else { opened = null; detailPanel.hidden = true; element<HTMLElement>("game-area").hidden = true; directory.hidden = false; await withBusy(renderDirectory); }
}
void initialize();
