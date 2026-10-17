export interface DurableObjectId {
  toString(): string;
}
export interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
export interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm?(timestamp: number): Promise<void>;
  deleteAlarm?(): Promise<void>;
}
export interface DurableObjectState {
  storage: DurableObjectStorage;
  acceptWebSocket?(socket: WebSocket): void;
  getWebSockets?(): WebSocket[];
}
export interface AbuseBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}
export interface Env {
  ABUSE_API?: AbuseBinding;
  ABUSE_AUTH?: AbuseBinding;
  ABUSE_SIGNUP?: AbuseBinding;
  ABUSE_ROOMS?: AbuseBinding;
  ABUSE_SOCKETS?: AbuseBinding;
  GAME_SESSIONS: DurableObjectNamespace;
  ROOM_LOBBY: DurableObjectNamespace;
  ACCOUNT_DIRECTORY: DurableObjectNamespace;
  ASSETS: { fetch(request: Request): Promise<Response> };
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
}
