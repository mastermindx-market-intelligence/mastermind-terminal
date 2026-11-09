import "next/dist/server/node-environment-baseline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signFixtureAccessToken, signFixtureAccessTokenForServer, createFixtureSession,
  serializeFixtureSession } from "../../e2e/fixtures/investigation-auth";
import { NATIVE_FIXTURE_SERVER_ENV as env } from "../../e2e/fixtures/native-intelligence-auth";
import { NATIVE_INTELLIGENCE_FIXTURE_SUBJECT as SUBJECT, nativeFixturePrincipal, nativeFixtureRead,
  NATIVE_INTELLIGENCE_USER_PATH as USER } from "../e2e/nativeIntelligenceFixture";
import { isBlockedNativeAppearanceIntent } from "../../e2e/fixtures/native-intelligence-contract";
const state = vi.hoisted(() => ({ jar: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => state.jar, set: vi.fn() }) }));
const claims = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
const EMAIL = "native-intelligence-fixture@example.invalid";
beforeEach(() => { vi.resetModules(); state.jar = []; });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("existing synthetic native identity can reach the real Settings control", () => {
  it("adds only its fixed existing user-response email, never caller-selected display identity", async () => {
    const input = { sub: SUBJECT, email: "caller-selected@foreign.invalid" };
    const signed = signFixtureAccessTokenForServer(env, input);
    expect(claims(signed.accessToken).email).toBe(EMAIL);
    const req = new Request(new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin + USER,
      { headers: { Authorization: `Bearer ${signed.accessToken}` } });
    expect(nativeFixturePrincipal(req, "user", env)?.sub).toBe(SUBJECT); // real signature/issuer/subject verifier
    expect((await nativeFixtureRead(req, "user", env).json()).email).toBe(claims(signed.accessToken).email);
  });
  it("keeps default and other subjects unchanged; no extra native membership is granted", () => {
    expect(claims(signFixtureAccessToken({ sub: SUBJECT }).accessToken)).not.toHaveProperty("email");
    const signed = signFixtureAccessTokenForServer(env, { sub: "e2e00000-0000-4000-8000-000000000018" });
    expect(claims(signed.accessToken)).not.toHaveProperty("email");
    expect(nativeFixturePrincipal(new Request(new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin + USER,
      { headers: { Authorization: `Bearer ${signed.accessToken}` } }), "user", env)).toBeNull();
  });
  it("actual unchanged SDK claims and chrome reader receive the signed display email through public JWKS", async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-anon-key");
    const signed = signFixtureAccessTokenForServer(env, { sub: SUBJECT });
    state.jar = serializeFixtureSession("sb-127-auth-token", createFixtureSession(signed));
    const { GET } = await import("../../app/api/%5F_e2e__/supabase/auth/v1/.well-known/jwks.json/route");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.method !== "GET" || req.url !== env.NEXT_PUBLIC_SUPABASE_URL + "/auth/v1/.well-known/jwks.json")
        throw Error("UNDECLARED_FIXTURE_TRANSPORT");
      return GET();
    }));
    const { readShellClaims } = await import("../shared-shell/memberIdentity");
    expect(await readShellClaims()).toEqual({ state: "ready", subjectId: SUBJECT, email: EMAIL });
  });
});

describe("appearance intent observations never authorize mutation transport", () => {
  const pathname = "/api/__e2e__/supabase/auth/v1/user";
  it.each([{ data: { theme_auto: "1" } }, { data: { theme: "light", theme_auto: "0", prefs: { theme: "light", themeAuto: "0" } } }])(
    "recognizes only the exact existing theme metadata shape", body => {
      expect(isBlockedNativeAppearanceIntent("PUT", pathname, body)).toBe(true);
    });
  it.each([null, {}, { data: {} }, { data: { email: EMAIL } }, { data: { role: "admin" } },
    { data: { theme_auto: true } }, { data: { prefs: { themeAuto: "1", lang: "zh" } } },
    { data: { theme: "dark" }, password: "test-only-unqualified" }])("never categorizes other writes as appearance", body => {
    expect(isBlockedNativeAppearanceIntent("PUT", pathname, body)).toBe(false);
  });
  it.each([["POST", pathname], ["PUT", "/api/investigations"], ["PUT", pathname + "/token"]])(
    "retains the exact method/path boundary", (method, target) => {
      expect(isBlockedNativeAppearanceIntent(method, target, { data: { theme_auto: "1" } })).toBe(false);
    });
});
