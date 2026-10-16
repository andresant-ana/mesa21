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
}
export interface DurableObjectState {
  storage: DurableObjectStorage;
}
export interface Env {
  GAME_SESSIONS: DurableObjectNamespace;
  ASSETS: { fetch(request: Request): Promise<Response> };
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
}
