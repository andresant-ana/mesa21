import type { Env } from "./types.ts";

export { GameSession } from "./GameSession.ts";
export { RoomLobby } from "./RoomLobby.ts";
export { AccountDirectory } from "./AccountDirectory.ts";

const SESSION_COOKIE = "mesa21_session";
const AUTH_COOKIE = "mesa21_auth";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!["GET", "POST"].includes(request.method)) return apiJson({ error: "METHOD_NOT_ALLOWED" }, 405);

    const isRoomRequest = url.pathname === "/api/rooms" || url.pathname.startsWith("/api/rooms/");
    const isAuthRequest = url.pathname.startsWith("/api/auth/");
    const isAccountRequest = isAuthRequest || url.pathname === "/api/wallet" || url.pathname.startsWith("/api/wallet/") ||
      url.pathname === "/api/ranking" || url.pathname.startsWith("/api/ranked/");
    const isSocketRequest = isRoomRequest && url.pathname.endsWith("/stream");
    if (isSocketRequest) {
      const origin = request.headers.get("origin");
      const allowedOrigins = new Set([url.origin, ...env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)]);
      if (!origin || !allowedOrigins.has(origin)) return apiJson({ error: "ORIGIN_NOT_ALLOWED" }, 403);
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return apiJson({ error: "UPGRADE_REQUIRED" }, 426);
      }
      if (!getCookie(request.headers.get("cookie"), SESSION_COOKIE)) return apiJson({ error: "UNAUTHORIZED" }, 401);
    }

    let requestBody: ArrayBuffer | null = null;
    if (request.method === "POST") {
      const contentType = request.headers.get("content-type") ?? "";
      const origin = request.headers.get("origin");
      const allowedOrigins = new Set([url.origin, ...env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)]);
      if (!contentType.toLowerCase().startsWith("application/json")) return apiJson({ error: "UNSUPPORTED_MEDIA_TYPE" }, 415);
      if (!origin || !allowedOrigins.has(origin)) return apiJson({ error: "ORIGIN_NOT_ALLOWED" }, 403);
      const contentLength = Number(request.headers.get("content-length") ?? 0);
      if (contentLength > 4_096) return apiJson({ error: "REQUEST_TOO_LARGE" }, 413);
      requestBody = await request.arrayBuffer();
      if (requestBody.byteLength > 4_096) return apiJson({ error: "REQUEST_TOO_LARGE" }, 413);
    }

    const token = getCookie(request.headers.get("cookie"), SESSION_COOKIE) ?? createSessionToken();
    const namespace = isRoomRequest ? env.ROOM_LOBBY : isAccountRequest ? env.ACCOUNT_DIRECTORY : env.GAME_SESSIONS;
    const id = namespace.idFromName(isRoomRequest ? "global-v1" : isAccountRequest ? "accounts-v1" : token);
    const stub = namespace.get(id);
    const headers = new Headers(request.headers);
    // Never trust client-supplied identity forwarding headers.
    headers.delete("x-mesa21-session");
    headers.delete("x-mesa21-auth-token");
    if (isRoomRequest) headers.set("x-mesa21-session", token);
    if (isAccountRequest) headers.set("x-mesa21-auth-token", getCookie(request.headers.get("cookie"), AUTH_COOKIE) ?? "");
    let response: Response;
    try {
      response = await stub.fetch(new Request("https://mesa21.internal" + url.pathname.replace(/^\/api/, "") + url.search, {
        method: request.method,
        headers,
        body: requestBody
      }));
    } catch {
      return apiJson({ error: "SERVICE_UNAVAILABLE" }, 503);
    }

    // WebSocket upgrade responses must retain the Cloudflare webSocket handle.
    if (isSocketRequest && response.status === 101) return response;

    // Strip private credentials returned by the trusted Durable Object.
    let payload: Record<string, unknown> | null = null;
    if (isAccountRequest && response.headers.get("content-type")?.includes("application/json")) {
      try {
        const candidate: unknown = await response.json();
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
          payload = candidate as Record<string, unknown>;
        }
      } catch { return apiJson({ error: "SERVICE_UNAVAILABLE" }, 503); }
    }
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.set("Referrer-Policy", "same-origin");
    if (payload) {
      const authToken = payload.authToken;
      const clearAuth = payload.clearAuth === true;
      delete payload.authToken;
      delete payload.clearAuth;
      const secure = url.protocol === "https:" ? "; Secure" : "";
      if (typeof authToken === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(authToken)) {
        responseHeaders.append("Set-Cookie", AUTH_COOKIE + "=" + authToken +
          "; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000" + secure);
      } else if (clearAuth) {
        responseHeaders.append("Set-Cookie", AUTH_COOKIE +
          "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + secure);
      }
    }
    if (!getCookie(request.headers.get("cookie"), SESSION_COOKIE)) {
      // Enforce Secure on HTTPS regardless of the deployment environment flag.
      const secure = url.protocol === "https:" ? "; Secure" : "";
      responseHeaders.append("Set-Cookie", SESSION_COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000" + secure);
    }
    return new Response(payload ? JSON.stringify(payload) : response.body, { status: response.status, headers: responseHeaders });
  }
};

function getCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name && value.length > 0) {
      const token = value.join("=");
      return /^[A-Za-z0-9_-]{40,64}$/.test(token) ? token : null;
    }
  }
  return null;
}

function createSessionToken(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function apiJson(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin"
    }
  });
}
