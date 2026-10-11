// Non-browser proof for the Investigation evidence-review fixture: the gate truth table, the
// pinned session vocabulary, the public-only JWK endpoint, and the REAL pinned SDK verifying and
// refusing the tokens the test-only signer issues. No browser, no server, no network; the
// accepted auth/consumer suites still own the frozen guards.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { createServerClient, createChunks, stringToBase64URL, stringFromBase64URL, combineChunks, MAX_CHUNK_SIZE } from "@supabase/ssr";
import type { Page } from "@playwright/test";
import { fixtureAuthSetup } from "../../e2e/fixtures/investigation-auth";
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  E2E_AUTH_MARKER_VALUE,
  fixtureFlagsEnabled,
  fixtureJwksDocument,
  fixturePublicJwk,
  selectsFixtureAuthBranch,
  type FixtureEnv,
} from "../e2e/investigationAuthFixture";
import { subscribeInvestigationAuthOwner } from "../supabase/investigationAuthOwner";
import type { AuthLifecycleSnapshot, AuthObserver } from "../supabase/authLifecycle";
import { FIXTURE_JWKS_PATH, FIXTURE_ORIGIN, signFixtureAccessToken, createFixtureSession, encodeFixtureSession, serializeFixtureSession, fixtureSessionCookieName } from "../../e2e/fixtures/investigation-auth";

const FIXTURE: FixtureEnv = { NODE_ENV: "development", TERMINAL_E2E_FIXTURE: "1", TERMINAL_E2E_VERIFIED_AUTH: "1" };
const env = (overrides: Partial<FixtureEnv>): FixtureEnv => ({ ...FIXTURE, ...overrides });
const BASE_URL = "http://127.0.0.1:54321";
const JWKS_URL = `${BASE_URL}/auth/v1/.well-known/jwks.json`;
const BASE_KEY = "sb-127-auth-token";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) vi.stubGlobal("crypto", webcrypto); // auth-js polyfills WebCrypto
});

describe("fixture gate truth table", () => {
  it("is active only under development with both dedicated flags at exactly 1", () => {
    expect(fixtureFlagsEnabled(FIXTURE)).toBe(true);
    const disabled = [
      env({ NODE_ENV: "production" }), env({ NODE_ENV: "test" }), env({ NODE_ENV: undefined }), env({ NODE_ENV: "Development" }),
      env({ TERMINAL_E2E_FIXTURE: undefined }), env({ TERMINAL_E2E_FIXTURE: "0" }), env({ TERMINAL_E2E_FIXTURE: "true" }),
      env({ TERMINAL_E2E_VERIFIED_AUTH: undefined }), env({ TERMINAL_E2E_VERIFIED_AUTH: "0" }),
      env({ TERMINAL_E2E_FIXTURE: undefined, TERMINAL_E2E_VERIFIED_AUTH: undefined }),
    ];
    // a partial flag set cannot reach the real-auth branch even with a valid marker
    for (const e of disabled) {
      expect(fixtureFlagsEnabled(e)).toBe(false);
      expect(selectsFixtureAuthBranch("investigations", E2E_AUTH_MARKER_VALUE, e)).toBe(false);
    }
  });

  it("selects the real auth branch only for investigations plus the exact marker", () => {
    for (const kind of ["company", "theses", "invalid_thesis", "unsupported"]) {
      expect(selectsFixtureAuthBranch(kind, E2E_AUTH_MARKER_VALUE, FIXTURE)).toBe(false);
    }
    for (const marker of [undefined, null, "", "verified", ` ${E2E_AUTH_MARKER_VALUE}`, "verified-v2", "eyJhbGciOiJFUzI1NiJ9.x.y"]) {
      expect(selectsFixtureAuthBranch("investigations", marker, FIXTURE)).toBe(false);
    }
    expect(selectsFixtureAuthBranch("investigations", E2E_AUTH_MARKER_VALUE, FIXTURE)).toBe(true);
  });
});

describe("pinned SSR session vocabulary", () => {
  it.each([0, 5000])("round-trips a real SSR session, including chunked metadata size %i", async (size) => {
    const signed = signFixtureAccessToken();
    const session = createFixtureSession(signed);
    (session.user as Record<string, unknown>).user_metadata = { note: "࠾࠿🙂".repeat(size) };
    const storageKey = fixtureSessionCookieName(FIXTURE_ORIGIN);
    expect(storageKey).toBe(BASE_KEY);
    expect(fixtureSessionCookieName("https://abcdefgh.supabase.co")).toBe("sb-abcdefgh-auth-token");
    const cookies = serializeFixtureSession(storageKey, session);
    expect(cookies.every((c) => c.value.length <= MAX_CHUNK_SIZE)).toBe(true);
    expect(cookies[0]!.name).toBe(size ? `${storageKey}.0` : storageKey);
    const encoded = await combineChunks(storageKey, (name) => cookies.find((c) => c.name === name)?.value);
    expect(JSON.parse(stringFromBase64URL(encoded!.slice("base64-".length)))).toEqual(session);
    const requested: string[] = [];
    const client = createServerClient(FIXTURE_ORIGIN, "fixture-anon-key", {
      cookies: { getAll: () => cookies, setAll: () => {} },
      global: { fetch: async (input) => {
        const url = String(input); requested.push(url);
        if (url === `${FIXTURE_ORIGIN}/auth/v1/.well-known/jwks.json`) {
          return new Response(JSON.stringify(fixtureJwksDocument()), { headers: { "Content-Type": "application/json" } });
        }
        throw new Error("unexpected mocked SSR request");
      } },
    });
    // No explicit token: the real SSR reader must find/decode/reassemble the cookie itself.
    const result = await client.auth.getClaims();
    expect(result.error).toBeNull();
    expect(result.data?.claims.sub).toBe(signed.sub);
    expect(requested.every((url) => url === `${FIXTURE_ORIGIN}/auth/v1/.well-known/jwks.json`)).toBe(true);
  });
});

describe("gated public-only JWK endpoint", () => {
  it("serves the public key under the fixture and 404s without it", async () => {
    const { GET } = await import("../../app/api/%5F_e2e__/supabase/auth/v1/.well-known/jwks.json/route");
    const keys = ["NODE_ENV", "TERMINAL_E2E_FIXTURE", "TERMINAL_E2E_VERIFIED_AUTH"] as const;
    const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      Object.assign(process.env, { NODE_ENV: "development", TERMINAL_E2E_FIXTURE: "1", TERMINAL_E2E_VERIFIED_AUTH: "1" });
      const response = await GET();
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual(fixtureJwksDocument());
      expect(body).not.toMatch(/BEGIN PRIVATE KEY|("d"\s*:)|access_token|refresh_token/i); // public material only
      for (const off of [env({ NODE_ENV: "production" }), env({ TERMINAL_E2E_VERIFIED_AUTH: undefined }), env({ TERMINAL_E2E_FIXTURE: undefined })]) {
        Object.assign(process.env, { NODE_ENV: off.NODE_ENV, TERMINAL_E2E_FIXTURE: off.TERMINAL_E2E_FIXTURE, TERMINAL_E2E_VERIFIED_AUTH: off.TERMINAL_E2E_VERIFIED_AUTH });
        expect((await GET()).status).toBe(404);
      }
    } finally {
      for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else Object.assign(process.env, { [key]: previous[key] }); }
    }
    // exactly one mounted path in the fixture namespace, and no private field in its key
    expect(FIXTURE_JWKS_PATH).toBe("/api/__e2e__/supabase/auth/v1/.well-known/jwks.json");
    expect(Object.keys(fixturePublicJwk()).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x", "y"]);
  });
});

describe("the real pinned SDK verifies the fixture session", () => {
  const requested: string[] = [];
  // bounded on purpose: the JWK Set is the only thing this fixture answers, so verification has
  // to travel the SDK's own fetch-and-verify path and any other URL fails the test
  const fetchMock = async (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
    requested.push(url);
    if (url === JWKS_URL) return new Response(JSON.stringify(fixtureJwksDocument()), { status: 200, headers: { "Content-Type": "application/json" } });
    throw new TypeError(`unexpected request from the pinned SDK: ${url}`);
  };

  function clientWith(sessionJson: string | null) {
    const items = new Map<string, string>();
    // The SDK caches JWKS by storage key; isolate this direct-client proof from
    // the separate real SSR cookie-reader proof, which must keep the actual cookie name.
    const directStorageKey = `${BASE_KEY}-direct-sdk-proof`;
    if (sessionJson !== null) items.set(directStorageKey, sessionJson);
    return createClient(BASE_URL, "fixture-anon-key", {
      auth: {
        storageKey: directStorageKey,
        storage: { // synthetic storage in the standard name/shape, not a ready-context stub
          getItem: async (key: string) => items.get(key) ?? null,
          setItem: async (key: string, value: string) => { items.set(key, value); },
          removeItem: async (key: string) => { items.delete(key); },
        },
        persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, flowType: "pkce",
      },
      global: { fetch: fetchMock as unknown as typeof fetch },
    });
  }

  // getClaims(token) with no options: no allowExpired, no keys, no jwks override
  async function verify(token: string, sessionJson: string | null) {
    try {
      const result = await clientWith(sessionJson).auth.getClaims(token);
      return { error: result.error, claims: (result.data as { claims?: Record<string, unknown> } | null)?.claims };
    } catch (error) { return { error, claims: undefined }; }
  }

  it("accepts a validly signed, unexpired synthetic token", async () => {
    requested.length = 0;
    const signed = signFixtureAccessToken();
    const { error, claims } = await verify(signed.accessToken, JSON.stringify(createFixtureSession(signed)));
    expect(error).toBeNull();
    expect(claims).toMatchObject({ sub: signed.sub, session_id: signed.sessionId });
    expect(requested).toContain(JWKS_URL);
    expect(requested.filter((url) => url !== JWKS_URL)).toEqual([]);
  });

  it("refuses a forged payload, an expired token and an unknown kid", async () => {
    requested.length = 0;
    // the signature is kept and only the payload rewritten: what a real forgery looks like
    const parts = signFixtureAccessToken().accessToken.split(".");
    const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    const forged = [parts[0]!, Buffer.from(JSON.stringify({ ...claims, sub: "00000000-0000-4000-8000-000000000000" }), "utf8").toString("base64url"), parts[2]!].join(".");
    expect((await verify(forged, null)).error).toBeTruthy();
    const expired = signFixtureAccessToken({ issuedAt: Math.floor(Date.now() / 1000) - 7200, lifetimeSeconds: 60 });
    expect((await verify(expired.accessToken, null)).error).toBeTruthy();
    expect((await verify(signFixtureAccessToken({ kid: "not-the-fixture-key" }).accessToken, null)).error).toBeTruthy();
    // with no matching key the SDK asked the auth server, which this fixture does not serve:
    // nothing succeeded silently, and no endpoint was invented to make it succeed
    expect(requested[0]).toBe(JWKS_URL);
    expect(requested.some((url) => url !== JWKS_URL)).toBe(true);
  });

  it("binds the observed SDK user to the verified claims through the existing owner", async () => {
    const signed = signFixtureAccessToken();
    const client = clientWith(JSON.stringify(createFixtureSession(signed)));
    await client.auth.getSession();
    const seen: AuthLifecycleSnapshot[] = [];
    const principals: (string | null)[] = [];
    const owner = subscribeInvestigationAuthOwner(
      (snapshot) => { seen.push(snapshot); }, (principal) => { principals.push(principal); },
      () => client.auth as unknown as AuthObserver);
    expect(owner).not.toBeNull();
    await vi.waitFor(() => expect(owner!.getSnapshot().availability).toBe("ready"), { timeout: 5_000 });
    expect(seen.at(-1)?.availability).toBe("ready");
    expect(owner!.getSnapshot().principal_partition).toBe(signed.sub);
    expect(principals).toContain(signed.sub);
    owner!.unsubscribe();
    expect(owner!.getSnapshot().availability).toBe("unavailable");
  });

  it("fails closed on a mismatched SDK user, and invents nothing at all without a session", async () => {
    const signed = signFixtureAccessToken();
    const session = createFixtureSession(signed);
    const mismatched = clientWith(JSON.stringify({ ...session, user: { ...(session.user as Record<string, unknown>), id: "11111111-1111-4000-8000-000000000001" } }));
    await mismatched.auth.getSession();
    const owner = subscribeInvestigationAuthOwner(() => {}, () => {}, () => mismatched.auth as unknown as AuthObserver);
    const guest = clientWith(null);
    await guest.auth.getSession();
    const guestOwner = subscribeInvestigationAuthOwner(() => {}, () => {}, () => guest.auth as unknown as AuthObserver);
    expect(owner).not.toBeNull();
    expect(guestOwner).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(owner!.getSnapshot().availability).not.toBe("ready");
    expect(owner!.getSnapshot().principal_partition).toBeNull();
    expect(guestOwner!.getSnapshot().availability).not.toBe("ready");
    expect(guestOwner!.getSnapshot().principal_partition).toBeNull();
    owner!.unsubscribe();
    guestOwner!.unsubscribe();
  });
});

// Parent counterexamples use the installed package semantics, never a live browser/server.
describe("parent fixture integration counterexamples", () => {
  const require = createRequire(import.meta.url);
  const playwrightRoot = dirname(require.resolve("playwright-core/package.json"));
  const bundled = readFileSync(join(playwrightRoot, "lib/coreBundle.js"), "utf8");
  const begin = bundled.indexOf("function rewriteCookies(cookies)");
  const end = bundled.indexOf("\nfunction parseURL2", begin);
  // Evaluate the exact pinned pure validator; no Playwright client/server is instantiated.
  const rewriteCookies = runInNewContext(`(${bundled.slice(begin, end)})`, {
    assert: (condition: boolean, message: string) => { if (!condition) throw new Error(message); },
    URL, kMaxCookieExpiresDateInSeconds: 253402300799,
  }) as (cookies: Array<Record<string, unknown>>) => Array<Record<string, unknown>>;
  async function seeded() {
    let cookies: Array<Record<string, unknown>> = [];
    const route = vi.fn();
    const page = { route, context: () => ({ addCookies: async (value: typeof cookies) => { cookies = value; } }) };
    await fixtureAuthSetup(page as unknown as Page, new URL(FIXTURE_ORIGIN).origin, FIXTURE);
    return { cookies, route };
  }
  it("configures SDK discovery at the one approved same-origin public JWKS URL", () => {
    const base = new URL(FIXTURE_ORIGIN);
    expect(base.pathname).toBe("/api/__e2e__/supabase");
    expect(new URL(`${FIXTURE_ORIGIN}/auth/v1/.well-known/jwks.json`).pathname).toBe(FIXTURE_JWKS_PATH);
  });
  it("passes the pinned Playwright cookie validator with an exact host and marker path", async () => {
    const { cookies } = await seeded();
    const normalized = rewriteCookies(cookies);
    const marker = normalized.find((c) => c.name === "mm.e2e-investigation-auth");
    expect(marker).toMatchObject({ domain: "127.0.0.1", path: "/analysis", value: "verified-v1" });
    expect(normalized.every((c) => c.domain === "127.0.0.1" && !String(c.domain).startsWith("."))).toBe(true);
  });
  it("uses the pinned SSR base64url serialization and its real chunk convention", () => {
    const session = { text: "࠾࠿🙂" };
    expect(encodeFixtureSession(session)).toBe(`base64-${stringToBase64URL(JSON.stringify(session))}`);
    const longSession = { text: "A".repeat(7000) };
    expect(serializeFixtureSession(BASE_KEY, longSession)).toEqual(createChunks(BASE_KEY, encodeFixtureSession(longSession)));
    expect(serializeFixtureSession(BASE_KEY, longSession)[0]!.name).toBe(`${BASE_KEY}.0`);
  });
  it("does not replace the real gated public JWKS endpoint with browser interception", async () => {
    expect((await seeded()).route).not.toHaveBeenCalled();
  });
  it("places the route outside Next private folders while preserving the approved URL", () => {
    const appPath = "/api/%5F_e2e__/supabase/auth/v1/.well-known/jwks.json/route";
    expect(existsSync(join(process.cwd(), "app", `${appPath}.ts`))).toBe(true);
    const nextRoot = dirname(require.resolve("next/package.json"));
    const devBundler = readFileSync(join(nextRoot, "dist/server/lib/router-utils/setup-dev-bundler.js"), "utf8");
    expect(devBundler).toContain("normalizedPageName.includes('/_')");
    expect(appPath.includes("/_")).toBe(false);
    const { AppPathnameNormalizer } = require(join(nextRoot, "dist/server/normalizers/built/app/app-pathname-normalizer.js"));
    expect(new AppPathnameNormalizer().normalize(appPath)).toBe(FIXTURE_JWKS_PATH);
  });
});
