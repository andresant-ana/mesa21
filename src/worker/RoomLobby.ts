
import type { DurableObjectState, Env } from "./types.ts";
import { RESHUFFLE_REMAINING_CARDS, STARTING_CASUAL_CREDITS, MIN_BET } from "../domain/blackjack.ts";
import { dealTable, openBetting, placeTableBet, playTableAction, publicTable, TableError } from "../domain/socialGame.ts";
import type { Action, Card } from "../domain/blackjack.ts";
import type { TableRound } from "../domain/socialGame.ts";
import { newAuditedShoe, retireShoe, publicShoeCommitment } from "../domain/shoeAudit.ts";
import type { ShoeAuditState } from "../domain/shoeAudit.ts";

type Visibility = "public" | "private";
type Member = { id: string; session: string; name: string; joinedAt: number; credits: number };
type Room = {
  code: string;
  name: string;
  visibility: Visibility;
  mode: "casual";
  host: string;
  members: Member[];
  spectators: Member[];
  round: TableRound | null;
  audit?: ShoeAuditState | null;
  createdAt: number;
  touchedAt: number;
};
type Stored = { rooms: Room[] };
type CloudflareSocket = WebSocket & {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};
declare const WebSocketPair: { new (): { 0: WebSocket; 1: CloudflareSocket } };

const MAX_ROOMS = 80;
const MAX_PLAYERS = 5;
const MAX_SPECTATORS = 20;
const MAX_SOCKETS_PER_SESSION = 2;
const MAX_SOCKETS_PER_ROOM = 40;
const MAX_TOTAL_SOCKETS = 256;
const TTL_MS = 24 * 60 * 60 * 1_000;
const CODE_PATTERN = /^[A-Z0-9]{12}$/;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function safeName(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > max || /[\u0000-\u001f\u007f<>]/.test(name)) return null;
  return name;
}

function result(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function publicRoom(room: Room) {
  return {
    code: room.code,
    name: room.name,
    visibility: room.visibility,
    mode: room.mode,
    players: room.members.length,
    capacity: MAX_PLAYERS,
    spectators: room.spectators.length,
    hostName: room.members.find((member) => member.session === room.host)?.name ?? "",
    phase: room.round?.phase ?? "waiting",
    createdAt: room.createdAt
  };
}

function roomDetails(room: Room, session: string) {
  const self = [...room.members, ...room.spectators].find((m) => m.session === session);
  return {
    ...publicRoom(room),
    role: !self ? "visitor" : room.members.includes(self) ? "player" : "spectator",
    isHost: room.host === session,
    members: room.members.map(({ id, name }) => ({ id, name, isHost: room.members.find((m) => m.id === id)?.session === room.host })),
    spectatorsList: room.spectators.map(({ id, name }) => ({ id, name })),
    mySeatId: self?.id ?? null,
    myCredits: self && room.members.includes(self) ? self.credits : null,
    round: room.round ? publicTable(room.round) : null,
    shoeAudit: publicShoeCommitment(room.audit),
    gameAvailable: true
  };
}

export class RoomLobby {
  private readonly state: DurableObjectState;
  private queue: Promise<void> = Promise.resolve();

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  fetch(request: Request): Promise<Response> {
    const work = this.queue.then(() => this.handle(request)).catch((error: unknown) => {
      if (error instanceof TableError) return result({ error: error.code }, 409);
      return result({ error: "INTERNAL_ERROR" }, 500);
    });
    this.queue = work.then(() => undefined, () => undefined);
    return work;
  }

  async alarm(): Promise<void> {
    const work = this.queue.then(() => this.handleAlarm());
    this.queue = work.then(() => undefined, () => undefined);
    await work;
  }

  private async handleAlarm(): Promise<void> {
    const stored = (await this.state.storage.get<Stored>("rooms")) ?? { rooms: [] };
    const now = Date.now();
    for (const room of stored.rooms) {
      const round = room.round;
      if (!round || round.deadlineAt === null || round.deadlineAt > now) continue;
      if (round.phase === "betting") {
        if (round.seats.some((seat) => seat.wager > 0)) {
          dealTable(round, room.members);
        } else {
          room.round = null;
        }
      } else if (round.phase === "playing") {
        const currentSeat = round.seats[round.turn];
        if (currentSeat) playTableAction(round, room.members, currentSeat.id, "stand");
      }
      room.touchedAt = now;
      this.broadcast(room);
    }
    await this.state.storage.put("rooms", stored);
    await this.scheduleAlarm(stored);
  }

  private async scheduleAlarm(stored: Stored): Promise<void> {
    const deadlines = stored.rooms.flatMap((room) => {
      const deadline = room.round?.deadlineAt;
      return typeof deadline === "number" ? [deadline] : [];
    });
    if (deadlines.length) await this.state.storage.setAlarm?.(Math.min(...deadlines));
    else await this.state.storage.deleteAlarm?.();
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const session = request.headers.get("x-mesa21-session") ?? "";
    if (!SESSION_PATTERN.test(session)) return result({ error: "UNAUTHORIZED" }, 401);

    const stored = (await this.state.storage.get<Stored>("rooms")) ?? { rooms: [] };
    const now = Date.now();
    const live = stored.rooms.filter((room) => now - room.touchedAt < TTL_MS);
    if (live.length !== stored.rooms.length) {
      stored.rooms = live;
      await this.state.storage.put("rooms", stored);
    }

    if (url.pathname === "/rooms" && request.method === "GET") {
      return result({ rooms: stored.rooms.filter((room) => room.visibility === "public").map(publicRoom) });
    }

    if (url.pathname === "/rooms" && request.method === "POST") {
      const body = await parseBody(request);
      if (!body) return result({ error: "INVALID_REQUEST" }, 400);
      if (body.mode === "ranked") return result({ error: "RANKED_UNAVAILABLE" }, 409);
      const name = safeName(body.name, 42);
      const displayName = safeName(body.displayName, 20);
      if (!name || !displayName || !["public", "private"].includes(String(body.visibility)) || body.mode !== "casual") {
        return result({ error: "INVALID_ROOM" }, 400);
      }
      if (stored.rooms.some((room) => hasMember(room, session))) return result({ error: "ALREADY_IN_ROOM" }, 409);
      if (stored.rooms.length >= MAX_ROOMS) return result({ error: "ROOM_LIMIT_REACHED" }, 429);
      let code = randomCode();
      while (stored.rooms.some((room) => room.code === code)) code = randomCode();
      const host = { id: randomCode(), session, name: displayName, joinedAt: now, credits: STARTING_CASUAL_CREDITS };
      const room: Room = {
        code, name, visibility: body.visibility as Visibility, mode: "casual",
        host: session, members: [host], spectators: [], round: null, audit: null, createdAt: now, touchedAt: now
      };
      stored.rooms.push(room);
      await this.state.storage.put("rooms", stored);
      return result({ room: roomDetails(room, session) }, 201);
    }

    const route = /^\/rooms\/([A-Z0-9]{12})(?:\/(join|leave|stream|start|bet|deal|action|refill|audit))?$/.exec(url.pathname);
    if (!route || !CODE_PATTERN.test(route[1]!)) return result({ error: "NOT_FOUND" }, 404);
    const room = stored.rooms.find((entry) => entry.code === route[1]);
    if (!room) return result({ error: "ROOM_NOT_FOUND" }, 404);

    const action = route[2];
    if (!action && request.method === "GET") return result({ room: roomDetails(room, session) });
    if (action === "audit" && request.method === "GET") return result({ current: publicShoeCommitment(room.audit), revealed: room.audit?.revealed ?? [] });

    if (action === "stream" && request.method === "GET") {
      if (!hasMember(room, session)) return result({ error: "NOT_IN_ROOM" }, 403);
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return result({ error: "UPGRADE_REQUIRED" }, 426);
      if (!this.state.acceptWebSocket || !this.state.getWebSockets) {
        return result({ error: "WEBSOCKET_UNAVAILABLE" }, 501);
      }
      const sockets = this.state.getWebSockets();
      if (sockets.length >= MAX_TOTAL_SOCKETS) return result({ error: "SOCKET_CAPACITY" }, 429);
      let openForRoom = 0;
      let openForSession = 0;
      for (const socket of sockets) {
        try {
          const owner = (socket as CloudflareSocket).deserializeAttachment() as { code?: string; session?: string } | null;
          if (owner?.code !== room.code) continue;
          openForRoom++;
          if (owner.session === session) openForSession++;
        } catch { /* malformed socket attachment: not counted as a member */ }
      }
      if (openForRoom >= MAX_SOCKETS_PER_ROOM || openForSession >= MAX_SOCKETS_PER_SESSION) {
        return result({ error: "SOCKET_CAPACITY" }, 429);
      }
      const pair = new WebSocketPair();
      const server = pair[1];
      server.serializeAttachment({ code: room.code, session });
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "room", room: roomDetails(room, session) }));
      return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit & { webSocket: WebSocket });
    }

    if (request.method !== "POST") return result({ error: "METHOD_NOT_ALLOWED" }, 405);

    if (action === "join") {
      if (hasMember(room, session)) return result({ room: roomDetails(room, session) });
      const body = await parseBody(request);
      if (!body) return result({ error: "INVALID_REQUEST" }, 400);
      const name = safeName(body.displayName, 20);
      if (!name) return result({ error: "INVALID_NAME" }, 400);
      if ([...room.members, ...room.spectators].some((m) => m.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
        return result({ error: "NAME_TAKEN" }, 409);
      }
      if (stored.rooms.some((entry) => hasMember(entry, session))) return result({ error: "ALREADY_IN_ROOM" }, 409);
      const member = { id: randomCode(), session, name, joinedAt: now, credits: STARTING_CASUAL_CREDITS };
      if (room.members.length < MAX_PLAYERS && (!room.round || room.round.phase === "finished")) room.members.push(member);
      else if (room.spectators.length < MAX_SPECTATORS) room.spectators.push(member);
      else return result({ error: "ROOM_FULL" }, 409);
      room.touchedAt = now;
      await this.state.storage.put("rooms", stored);
      this.broadcast(room);
      return result({ room: roomDetails(room, session) });
    }


    if (action === "start") {
      if (room.host !== session) return result({ error: "HOST_ONLY" }, 403);
      if (room.round && room.round.phase !== "finished") return result({ error: "ROUND_ACTIVE" }, 409);
      const previous = room.round?.shoe;
      const shoe = previous && previous.length > RESHUFFLE_REMAINING_CARDS ? previous : createShuffledShoe();
      room.round = openBetting(room.members, shoe);
      room.touchedAt = now;
      await this.state.storage.put("rooms", stored);
      await this.scheduleAlarm(stored);
      this.broadcast(room);
      return result({ room: roomDetails(room, session) });
    }

    if (action === "bet") {
      const member = room.members.find((player) => player.session === session);
      if (!member || !room.round) return result({ error: "NOT_SEATED" }, 403);
      const body = await parseBody(request);
      if (!body) return result({ error: "INVALID_REQUEST" }, 400);
      placeTableBet(room.round, member, body.bet as number);
      if (room.round.seats.every((seat) => seat.wager > 0)) dealTable(room.round, room.members);
      room.touchedAt = now;
      await this.state.storage.put("rooms", stored);
      await this.scheduleAlarm(stored);
      this.broadcast(room);
      return result({ room: roomDetails(room, session) });
    }

    if (action === "deal") {
      if (room.host !== session) return result({ error: "HOST_ONLY" }, 403);
      if (!room.round) return result({ error: "NO_ACTIVE_ROUND" }, 409);
      dealTable(room.round, room.members);
      room.touchedAt = now;
      await this.state.storage.put("rooms", stored);
      await this.scheduleAlarm(stored);
      this.broadcast(room);
      return result({ room: roomDetails(room, session) });
    }

    if (action === "action") {
      const member = room.members.find((player) => player.session === session);
      if (!member || !room.round) return result({ error: "NOT_SEATED" }, 403);
      const body = await parseBody(request);
      if (!body || !["hit", "stand", "double", "split"].includes(String(body.action))) {
        return result({ error: "INVALID_ACTION" }, 400);
      }
      playTableAction(room.round, room.members, member.id, body.action as Action);
      room.touchedAt = now;
      await this.state.storage.put("rooms", stored);
      await this.scheduleAlarm(stored);
      this.broadcast(room);
      return result({ room: roomDetails(room, session) });
    }

    if (action === "refill") {
      const member = room.members.find((player) => player.session === session);
      if (!member) return result({ error: "NOT_SEATED" }, 403);
      if (room.round && room.round.phase !== "finished") return result({ error: "ROUND_ACTIVE" }, 409);
      if (member.credits >= MIN_BET) return result({ error: "REFILL_NOT_AVAILABLE" }, 409);
      member.credits = STARTING_CASUAL_CREDITS;
      room.touchedAt = now;
      await this.state.storage.put("rooms", stored);
      this.broadcast(room);
      return result({ room: roomDetails(room, session) });
    }

    if (action === "leave") {
      if (!hasMember(room, session)) return result({ error: "NOT_IN_ROOM" }, 403);
      if (room.members.some((m) => m.session === session) && room.round && room.round.phase !== "finished") {
        return result({ error: "ROUND_ACTIVE" }, 409);
      }
      this.closeMemberSockets(room.code, session);
      room.members = room.members.filter((m) => m.session !== session);
      room.spectators = room.spectators.filter((m) => m.session !== session);
      if (room.members.length === 0 && room.spectators.length > 0) room.members.push(room.spectators.shift()!);
      if (room.members.length === 0) stored.rooms = stored.rooms.filter((r) => r.code !== room.code);
      else if (room.host === session) room.host = room.members[0]!.session;
      room.touchedAt = now;
      await this.state.storage.put("rooms", stored);
      this.broadcast(room);
      return result({ ok: true });
    }
    return result({ error: "NOT_FOUND" }, 404);
  }

  private closeMemberSockets(code: string, session: string): void {
    for (const socket of this.state.getWebSockets?.() ?? []) {
      try {
        const owner = (socket as CloudflareSocket).deserializeAttachment() as { code?: string; session?: string } | null;
        if (owner?.code === code && owner.session === session) {
          socket.close(1008, "Você saiu da sala");
        }
      } catch { /* Dead sockets are not authoritative. */ }
    }
  }

  private broadcast(room: Room): void {
    for (const socket of this.state.getWebSockets?.() ?? []) {
      try {
        const attachment = (socket as CloudflareSocket).deserializeAttachment() as { code: string; session: string } | null;
        if (attachment?.code === room.code) {
          // Leaving a room revokes receipt of further snapshots, including private-room state.
          if (!hasMember(room, attachment.session)) {
            socket.close(1008, "Participação encerrada");
            continue;
          }
          socket.send(JSON.stringify({ type: "room", room: roomDetails(room, attachment.session) }));
        }
      } catch {
        // A dead socket is ignored; the room snapshot stays authoritative in storage.
      }
    }
  }

  webSocketMessage(_socket: WebSocket, _message: string | ArrayBuffer): void {
    // The server owns room mutations. Clients may not mutate state over WebSocket.
  }

  webSocketClose(socket: WebSocket): void {
    try { socket.close(1000, "Conexão encerrada"); } catch { /* already closed */ }
  }

  webSocketError(socket: WebSocket): void {
    try { socket.close(1011, "Erro de conexão"); } catch { /* already closed */ }
  }
}

function hasMember(room: Room, session: string): boolean {
  return room.members.some((member) => member.session === session) ||
    room.spectators.some((member) => member.session === session);
}

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
