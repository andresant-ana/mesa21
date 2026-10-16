
import type { DurableObjectState, Env } from "./types.ts";

type Visibility = "public" | "private";
type Member = { id: string; session: string; name: string; joinedAt: number };
type Room = {
  code: string;
  name: string;
  visibility: Visibility;
  mode: "casual";
  host: string;
  members: Member[];
  spectators: Member[];
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
    gameAvailable: false
  };
}

export class RoomLobby {
  private readonly state: DurableObjectState;
  private queue: Promise<void> = Promise.resolve();

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  fetch(request: Request): Promise<Response> {
    const work = this.queue.then(() => this.handle(request));
    this.queue = work.then(() => undefined, () => undefined);
    return work;
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
      const host = { id: randomCode(), session, name: displayName, joinedAt: now };
      const room: Room = {
        code, name, visibility: body.visibility as Visibility, mode: "casual",
        host: session, members: [host], spectators: [], createdAt: now, touchedAt: now
      };
      stored.rooms.push(room);
      await this.state.storage.put("rooms", stored);
      return result({ room: roomDetails(room, session) }, 201);
    }

    const route = /^\/rooms\/([A-Z0-9]{12})(?:\/(join|leave|stream))?$/.exec(url.pathname);
    if (!route || !CODE_PATTERN.test(route[1]!)) return result({ error: "NOT_FOUND" }, 404);
    const room = stored.rooms.find((entry) => entry.code === route[1]);
    if (!room) return result({ error: "ROOM_NOT_FOUND" }, 404);

    const action = route[2];
    if (!action && request.method === "GET") return result({ room: roomDetails(room, session) });

    if (action === "stream" && request.method === "GET") {
      if (!hasMember(room, session)) return result({ error: "NOT_IN_ROOM" }, 403);
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return result({ error: "UPGRADE_REQUIRED" }, 426);
      if (!this.state.acceptWebSocket) return result({ error: "WEBSOCKET_UNAVAILABLE" }, 501);
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
      const member = { id: randomCode(), session, name, joinedAt: now };
      if (room.members.length < MAX_PLAYERS) room.members.push(member);
      else if (room.spectators.length < MAX_SPECTATORS) room.spectators.push(member);
      else return result({ error: "ROOM_FULL" }, 409);
      room.touchedAt = now;
      await this.state.storage.put("rooms", stored);
      this.broadcast(room);
      return result({ room: roomDetails(room, session) });
    }

    if (action === "leave") {
      if (!hasMember(room, session)) return result({ error: "NOT_IN_ROOM" }, 403);
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

  private broadcast(room: Room): void {
    for (const socket of this.state.getWebSockets?.() ?? []) {
      try {
        const attachment = (socket as CloudflareSocket).deserializeAttachment() as { code: string; session: string } | null;
        if (attachment?.code === room.code) {
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
