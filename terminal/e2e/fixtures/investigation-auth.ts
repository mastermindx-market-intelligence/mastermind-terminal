// Test-only fixture signer for the Investigation evidence-review loops. NOTHING here may be
// imported by runtime source: it holds the private half of an isolated synthetic ES256 key pair
// whose public half the fixture JWK Set publishes. That key has no production authority and no
// value outside a Playwright run — it exists so the REAL pinned SDK has something genuine to
// verify and a forged token still fails. It runs in the Playwright Node process only. No product
// route reads it, nothing is ever logged, and the browser never receives a key.
import { createSign, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { createChunks, stringToBase64URL } from "@supabase/ssr";
import playwrightConfig from "../../playwright.config";
import {
  E2E_AUTH_MARKER_COOKIE,
  E2E_AUTH_MARKER_PATH,
  E2E_AUTH_MARKER_VALUE,
  FIXTURE_KID,
  fixtureFlagsEnabled,
  fixtureJwksDocument,
  type FixtureEnv,
} from "../../lib/e2e/investigationAuthFixture";

/** PKCS#8 PEM for the synthetic P-256 point published by fixturePublicJwk(). */
const FIXTURE_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgoF4c0BwJatMQaV5M
eNpq+nsRytkTbS/BcJHJWhC7VdahRANCAATjiYJdD47T2qOpSWKPF7ylIyg62FEq
OJlYjKyAv+NNsYlynTGQ2pAfkdAymcavWJ6ALYJ+wzJFfYianjOeqwxu
-----END PRIVATE KEY-----`;

const FIXTURE_SUB = "e2e00000-0000-4000-8000-000000000001"; // synthetic, never a real principal
/** One hour: each affected case finishes well inside it, so the product autoRefresh path stays
 * untouched and no refresh stub exists. */
const FIXTURE_LIFETIME_SECONDS = 3600;

/**
 * The Playwright worker is NOT the server process (its own NODE_ENV is not
 * "development"), so the fixture declares the TEST SERVER's environment by reading it
 * out of playwright.config.ts — the same webServer.env block `next dev` actually starts
 * with. That keeps one source of truth: drop TERMINAL_E2E_VERIFIED_AUTH from the config
 * and this helper refuses to build a bundle, instead of quietly seeding a session that no
 * route would ever select. The server-side gate is still what decides, in the server.
 */
const declaredServer = (playwrightConfig as { webServer?: { env?: Record<string, string> } | { env?: Record<string, string> }[] }).webServer;
const serverEnv = (Array.isArray(declaredServer) ? declaredServer[0] : declaredServer)?.env ?? {};
export const FIXTURE_ORIGIN = serverEnv.NEXT_PUBLIC_SUPABASE_URL ?? "";
const FIXTURE_ISSUER = `${FIXTURE_ORIGIN}/auth/v1`;
export const FIXTURE_SERVER_ENV: FixtureEnv = {
  NODE_ENV: "development", // because the configured command is `npm run dev -- --port …`
  TERMINAL_E2E_FIXTURE: serverEnv.TERMINAL_E2E_FIXTURE,
  TERMINAL_E2E_VERIFIED_AUTH: serverEnv.TERMINAL_E2E_VERIFIED_AUTH,
};

/** The one path the fixture namespace mounts, plus its parent for route interception. */
export const FIXTURE_JWKS_PATH = "/api/__e2e__/supabase/auth/v1/.well-known/jwks.json";

/** Signs one genuine ES256 access token: JOSE r||s via ieee-p1363, not a stub signature. `kid`
 * exists only for the unknown-kid refusal, which nothing else here can produce. */
export function signFixtureAccessToken(input: { sub?: string; sessionId?: string; issuedAt?: number; lifetimeSeconds?: number; kid?: string } = {}) {
  const sub = input.sub ?? FIXTURE_SUB;
  const sessionId = input.sessionId ?? randomUUID();
  const issuedAt = input.issuedAt ?? Math.floor(Date.now() / 1000);
  const lifetimeSeconds = input.lifetimeSeconds ?? FIXTURE_LIFETIME_SECONDS;
  const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT", kid: input.kid ?? FIXTURE_KID }), "utf8").toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    aud: "authenticated",
    iss: FIXTURE_ISSUER,
    sub,
    session_id: sessionId,
    aal: "aal1",
    amr: [{ method: "email", timestamp: issuedAt }],
    role: "authenticated",
    iat: issuedAt,
    exp: issuedAt + lifetimeSeconds,
  }), "utf8").toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = createSign("SHA256").update(signingInput, "utf8")
    .sign({ key: FIXTURE_PRIVATE_KEY_PEM, format: "pem", type: "pkcs8", dsaEncoding: "ieee-p1363" });
  return { accessToken: `${signingInput}.${signature.toString("base64url")}`, sub, sessionId, issuedAt, lifetimeSeconds };
}

export interface FixtureAuthBundle {
  storageKey: string;
  cookieValue: string;
  cookies: { name: string; value: string }[];
  accessToken: string;
  sub: string;
  sessionId: string;
  jwks: { keys: Record<string, unknown>[] };
}

export function createFixtureAuthBundle(env: FixtureEnv = FIXTURE_SERVER_ENV): FixtureAuthBundle {
  if (!fixtureFlagsEnabled(env)) throw new Error("fixture auth is inactive: development plus both dedicated flags are required");
  const signed = signFixtureAccessToken();
  const session = createFixtureSession(signed);
  const storageKey = fixtureSessionCookieName(FIXTURE_ORIGIN);
  const cookieValue = encodeFixtureSession(session);
  return {
    storageKey,
    cookieValue,
    cookies: serializeFixtureSession(storageKey, session),
    accessToken: signed.accessToken,
    sub: signed.sub,
    sessionId: signed.sessionId,
    jwks: fixtureJwksDocument(),
  };
}

/** Seed only the existing same-server fixture origin. A bare domain (no leading dot) and
 * the exact path are Playwright's valid host-only cookie shape; url+path is rejected by
 * its pinned validator. No route interception: browser verification must reach the actual
 * gated public JWKS endpoint. No user/token/refresh endpoint is supplied.
 */
export async function fixtureAuthSetup(page: Page, origin: string = new URL(FIXTURE_ORIGIN).origin, env: FixtureEnv = FIXTURE_SERVER_ENV): Promise<FixtureAuthBundle> {
  const url = new URL(origin);
  const expected = new URL(FIXTURE_ORIGIN);
  if (url.origin !== expected.origin || url.hostname !== "127.0.0.1" || url.protocol !== "http:" || url.username || url.password) {
    throw new Error("fixture cookies require the configured loopback test server");
  }
  const bundle = createFixtureAuthBundle(env);
  const common = { domain: url.hostname, httpOnly: false, secure: false, sameSite: "Lax" as const, expires: Math.floor(Date.now() / 1000) + FIXTURE_LIFETIME_SECONDS };
  await page.context().addCookies([
    ...bundle.cookies.map((cookie) => ({ ...cookie, ...common, path: "/" })),
    { name: E2E_AUTH_MARKER_COOKIE, value: E2E_AUTH_MARKER_VALUE, ...common, path: E2E_AUTH_MARKER_PATH },
  ]);
  return bundle;
}

/** Test-only use of the installed SSR codec/chunker, not a second session format. */
export function fixtureSessionCookieName(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}
export function encodeFixtureSession(session: unknown): string {
  return `base64-${stringToBase64URL(JSON.stringify(session))}`;
}
export function serializeFixtureSession(storageKey: string, session: unknown): { name: string; value: string }[] {
  return createChunks(storageKey, encodeFixtureSession(session));
}

/** The session shape the pinned client persists: access/refresh tokens, expiry in both
 * second-since-epoch forms, and a user whose id is exactly the token's sub. Nothing here is
 * secret and nothing here is trusted — the SDK still verifies, and an application principal
 * stays the Workspace's own comparison rather than something getClaims is claimed to check. */
export function createFixtureSession(input: { sub: string; sessionId: string; accessToken: string; issuedAt: number; lifetimeSeconds: number }): Record<string, unknown> {
  const at = new Date(input.issuedAt * 1000).toISOString();
  return {
    access_token: input.accessToken,
    token_type: "bearer",
    expires_in: input.lifetimeSeconds,
    expires_at: input.issuedAt + input.lifetimeSeconds,
    refresh_token: `fixture-refresh-${input.sessionId}`,
    user: {
      id: input.sub,
      aud: "authenticated",
      role: "authenticated",
      session_id: input.sessionId,
      is_anonymous: false,
      created_at: at,
      updated_at: at,
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      factors: [],
    },
  };
}
