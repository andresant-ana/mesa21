/**
 * Coarse application-side abuse control. Cloudflare rate-limit bindings are
 * per-colocation approximate limits, not exact global quotas or a WAF.
 * Identity comes from the Cloudflare-managed connecting-IP header and the
 * server-validated visitor cookie, never user-supplied query parameters.
 */
type Binding = { limit(input: { key: string }): Promise<{ success: boolean }> };
type RateEnv = {
  ENVIRONMENT: string;
  ABUSE_API?: Binding;
  ABUSE_AUTH?: Binding;
  ABUSE_SIGNUP?: Binding;
  ABUSE_ROOMS?: Binding;
  ABUSE_SOCKETS?: Binding;
};

const REQUIRED = ["ABUSE_API", "ABUSE_AUTH", "ABUSE_SIGNUP", "ABUSE_ROOMS", "ABUSE_SOCKETS"] as const;

export async function checkAbuseLimit(
  request: Request,
  env: RateEnv,
  pathname: string,
  visitorToken: string | null
): Promise<Response | null> {
  const production = env.ENVIRONMENT === "production";
  if (production && REQUIRED.some((key) => !env[key])) {
    return noCache({ error: "RATE_LIMIT_UNAVAILABLE" }, 503);
  }

  // Cloudflare sets/replaces CF-Connecting-IP at its edge. Do not enable
  // production auth or room access if the edge actor identity is absent.
  const ip = request.headers.get("cf-connecting-ip");
  if (production && (!ip || ip.length > 80 || !/^[a-fA-F0-9:.]+$/.test(ip))) {
    return noCache({ error: "CLIENT_IDENTITY_UNAVAILABLE" }, 503);
  }
  const actor = ip && ip.length <= 80 ? ip : "local-anonymous";
  const checks: Array<[Binding | undefined, string]> = [[env.ABUSE_API, "api:" + actor]];
  const isPost = request.method === "POST";
  if (isPost && pathname === "/api/auth/register") {
    checks.push([env.ABUSE_SIGNUP, "signup:" + actor]);
  }
  if (isPost && ["/api/auth/register", "/api/auth/login", "/api/auth/recover"].includes(pathname)) {
    checks.push([env.ABUSE_AUTH, "auth:" + actor]);
  }
  if (pathname === "/api/rooms" || pathname.startsWith("/api/rooms/")) {
    checks.push([env.ABUSE_ROOMS, "rooms:" + actor]);
    if (pathname.endsWith("/stream")) {
      checks.push([env.ABUSE_SOCKETS, "socket:" + (visitorToken ?? actor)]);
    }
  }

  try {
    for (const [binding, key] of checks) {
      if (binding && !(await binding.limit({ key })).success) {
        return noCache({ error: "RATE_LIMITED" }, 429, 60);
      }
    }
  } catch {
    // Fail closed if a configured security control itself is unavailable.
    return noCache({ error: "RATE_LIMIT_UNAVAILABLE" }, 503);
  }
  return null;
}

function noCache(value: unknown, status: number, retryAfter?: number): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
  if (retryAfter) headers["Retry-After"] = String(retryAfter);
  return new Response(JSON.stringify(value), { status, headers });
}
