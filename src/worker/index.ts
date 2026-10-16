import type { Env } from "./types.ts";

export { GameSession } from "./GameSession.ts";

const SESSION_COOKIE = "mesa21_session";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!["GET", "POST"].includes(request.method)) return apiJson({ error: "METHOD_NOT_ALLOWED" }, 405);

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
    const id = env.GAME_SESSIONS.idFromName(token);
    const stub = env.GAME_SESSIONS.get(id);
    let response: Response;
    try {
      response = await stub.fetch(new Request("https://mesa21.internal" + url.pathname.replace(/^\/api/, ""), {
        method: request.method,
        headers: request.headers,
        body: requestBody
      }));
    } catch {
      return apiJson({ error: "SERVICE_UNAVAILABLE" }, 503);
    }

    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "same-origin");
    if (!getCookie(request.headers.get("cookie"), SESSION_COOKIE)) {
      const secure = env.ENVIRONMENT === "production" ? "; Secure" : "";
      headers.append("Set-Cookie", SESSION_COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000" + secure);
    }
    return new Response(response.body, { status: response.status, headers });
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
