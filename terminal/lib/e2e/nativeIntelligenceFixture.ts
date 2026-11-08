import { createPublicKey, verify } from "node:crypto";
import { fixtureFlagsEnabled, fixtureJwksDocument, FIXTURE_KID, type FixtureEnv } from "./investigationAuthFixture";

/** Existing synthetic issuer/key; a distinct subject limits this additive read fixture.
 * No token/refresh/session issuance, database, credential, or production authority.
 */
export const NATIVE_INTELLIGENCE_FIXTURE_SUBJECT = "e2e00000-0000-4000-8000-000000000017";
export const NATIVE_INTELLIGENCE_USER_PATH = "/api/__e2e__/supabase/auth/v1/user";
export const NATIVE_INTELLIGENCE_BILLING_BASE_PATH = "/api/__e2e__/native-intelligence/billing";
type Env = FixtureEnv & { TERMINAL_E2E_NATIVE_INTELLIGENCE?: string; NEXT_PUBLIC_SUPABASE_URL?: string; BILLING_GATEWAY_BASE?: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
function jsonPart(part: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) return null;
  const bytes = Buffer.from(part, "base64url");
  if (bytes.toString("base64url") !== part) return null;
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  return object(value) ? value : null;
}
/** Pure request verifier used only by the two new development fixture GETs. */
export function nativeFixturePrincipal(request: Request, kind: "user" | "billing", env: Env = process.env, now = Date.now()) {
  if (!fixtureFlagsEnabled(env) || env.TERMINAL_E2E_NATIVE_INTELLIGENCE !== "1") return null;
  try {
    const auth = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (auth.protocol !== "http:" || auth.hostname !== "127.0.0.1" || !auth.port || auth.port === "0" || auth.username || auth.password ||
        auth.pathname !== "/api/__e2e__/supabase" || auth.search || auth.hash ||
        env.BILLING_GATEWAY_BASE !== auth.origin + NATIVE_INTELLIGENCE_BILLING_BASE_PATH) return null;
    const url = new URL(request.url), origin = request.headers.get("origin");
    const path = kind === "user" ? NATIVE_INTELLIGENCE_USER_PATH : `${NATIVE_INTELLIGENCE_BILLING_BASE_PATH}/api/me`;
    if (request.method !== "GET" || url.origin !== auth.origin || url.pathname !== path || url.search || url.hash ||
        (origin !== null && origin !== auth.origin)) return null;
    const bearer = request.headers.get("authorization");
    if (!bearer?.startsWith("Bearer ") || bearer.length > 4096) return null;
    const token = bearer.slice(7), parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = jsonPart(parts[0]), claims = jsonPart(parts[1]);
    if (!header || !claims || header.alg !== "ES256" || header.typ !== "JWT" || header.kid !== FIXTURE_KID ||
        !/^[A-Za-z0-9_-]+$/.test(parts[2])) return null;
    const signature = Buffer.from(parts[2], "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== parts[2]) return null;
    const publicKey = createPublicKey({ key: fixtureJwksDocument().keys[0], format: "jwk" });
    if (!verify("sha256", Buffer.from(parts[0] + "." + parts[1]), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)) return null;
    const seconds = Math.floor(now / 1000);
    if (!Number.isSafeInteger(seconds) || claims.sub !== NATIVE_INTELLIGENCE_FIXTURE_SUBJECT ||
        claims.iss !== auth.href + "/auth/v1" || claims.aud !== "authenticated" || claims.role !== "authenticated" ||
        typeof claims.session_id !== "string" || !uuid.test(claims.session_id) ||
        typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat) || claims.iat > seconds + 30 ||
        typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp <= seconds ||
        claims.exp <= claims.iat || claims.exp - claims.iat > 3600) return null;
    return { sub: NATIVE_INTELLIGENCE_FIXTURE_SUBJECT, sessionId: claims.session_id, issuedAt: claims.iat };
  } catch { return null; }
}
export function nativeFixtureRead(request: Request, kind: "user" | "billing", env: Env = process.env) {
  const principal = nativeFixturePrincipal(request, kind, env);
  if (!principal) return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const body = kind === "billing" ? { tier: "unlimited", features: [], status: "active" } : {
    id: principal.sub, aud: "authenticated", role: "authenticated", session_id: principal.sessionId,
    email: "native-intelligence-fixture@example.invalid", app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {}, identities: [], factors: [], is_anonymous: false,
    created_at: new Date(principal.issuedAt * 1000).toISOString(), updated_at: new Date(principal.issuedAt * 1000).toISOString(),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
