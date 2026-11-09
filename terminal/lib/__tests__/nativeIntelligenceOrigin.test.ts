import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import incumbent from "../../playwright.config";
import dedicated from "../../playwright.intelligence.config";
import { nativeFixtureServerEnvironment } from "../../e2e/fixtures/native-intelligence-contract";
import { NATIVE_FIXTURE_SERVER_ENV, nativeEntranceAuthSetup } from "../../e2e/fixtures/native-intelligence-auth";
import { FIXTURE_ORIGIN, FIXTURE_SERVER_ENV, signFixtureAccessToken, signFixtureAccessTokenForServer } from "../../e2e/fixtures/investigation-auth";
import { NATIVE_INTELLIGENCE_FIXTURE_SUBJECT as SUBJECT, nativeFixturePrincipal, NATIVE_INTELLIGENCE_USER_PATH as USER } from "../e2e/nativeIntelligenceFixture";

const env = NATIVE_FIXTURE_SERVER_ENV;
const origin = new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin;
const read = (token: string) => new Request(origin + USER, { headers: { Authorization: `Bearer ${token}` } });
afterEach(() => vi.unstubAllEnvs());
describe("c30 dedicated fixture origin, without changing default/production auth", () => {
  it("binds the actual declared runner origin; default c30 auth declaration stays unchanged", () => {
    const before = JSON.stringify(incumbent.webServer);
    const server = Array.isArray(dedicated.webServer) ? dedicated.webServer[0] : dedicated.webServer;
    expect(new URL(incumbent.use!.baseURL!).origin).toBe(origin);
    expect(server?.env?.NEXT_PUBLIC_SUPABASE_URL).toBe(origin + "/api/__e2e__/supabase");
    for (const flag of ["TERMINAL_E2E_FIXTURE", "TERMINAL_E2E_VERIFIED_AUTH", "TERMINAL_E2E_NATIVE_INTELLIGENCE"])
      expect(server?.env?.[flag]).toBe("1");
    expect(server?.env?.BILLING_GATEWAY_BASE).toBe(env.BILLING_GATEWAY_BASE);
    expect(server?.reuseExistingServer).toBe(false);
    expect(FIXTURE_ORIGIN).toBe("http://127.0.0.1:54321");
    expect(FIXTURE_SERVER_ENV.TERMINAL_E2E_VERIFIED_AUTH).toBeUndefined();
    expect(JSON.stringify(incumbent.webServer)).toBe(before);
  });
  it("seeds only host cookies for the declared native subject with no Analysis marker or interception", async () => {
    const added: unknown[][] = [];
    const page = { context: () => ({ addCookies: async (cookies: unknown[]) => { added.push(cookies); } }) } as unknown as Page;
    const token = await nativeEntranceAuthSetup(page, origin);
    expect(nativeFixturePrincipal(read(token.accessToken), "user", env)?.sub).toBe(SUBJECT);
    expect(added).toHaveLength(1);
    for (const cookie of added[0] as { domain: string; path: string; name: string }[]) {
      expect(cookie.domain).toBe("127.0.0.1"); expect(cookie.path).toBe("/");
      expect(cookie.name).not.toBe("mm.e2e-investigation-auth");
    }
    await expect(nativeEntranceAuthSetup(page, "http://127.0.0.1:3199")).rejects.toThrow("Wrong native fixture origin/flags");
    expect(added).toHaveLength(1);
  });
  it("rejects a genuinely signed wrong issuer independently of subject/signature", () => {
    const otherOrigin = "http://127.0.0.1:3199"; // negative token data only; no endpoint started or accessed
    const other = nativeFixtureServerEnvironment(otherOrigin, otherOrigin + "/terminal?symbol=NVDA");
    const token = signFixtureAccessTokenForServer(other, { sub: SUBJECT });
    expect(nativeFixturePrincipal(read(token.accessToken), "user", env)).toBeNull();
    expect(nativeFixturePrincipal(read(signFixtureAccessToken({ sub: SUBJECT }).accessToken), "user", env)).toBeNull();
  });
  it.each([
    [undefined, origin + "/terminal", {}],
    ["https://foreign.test", "https://foreign.test/terminal", {}],
    ["http://localhost:3108", "http://localhost:3108/terminal", {}],
    ["http://127.0.0.1:0", "http://127.0.0.1:0/terminal", {}],
    [origin, "http://127.0.0.1:3199/terminal", {}],
    [origin, origin + "/terminal", { NODE_ENV: "production" }],
    [origin, origin + "/terminal", { NODE_ENV: "test" }],
  ] as const)("refuses a non-owned or non-dev declaration %s", (base, url, flags) => {
    expect(() => nativeFixtureServerEnvironment(base, url, flags)).toThrow();
  });
  it.each([
    {}, { ...env, NODE_ENV: "production" }, { ...env, TERMINAL_E2E_VERIFIED_AUTH: undefined },
    { ...env, TERMINAL_E2E_NATIVE_INTELLIGENCE: undefined }, { ...env, NEXT_PUBLIC_SUPABASE_URL: "https://foreign.test/api/__e2e__/supabase" },
    { ...env, BILLING_GATEWAY_BASE: "https://foreign.test" },
  ])("will not sign from incomplete/foreign authority", configuration => {
    expect(() => signFixtureAccessTokenForServer(configuration, { sub: SUBJECT })).toThrow();
  });
  it("public-only JWKS remains default404/production404 and requires the original two flags", async () => {
    const { GET } = await import("../../app/api/%5F_e2e__/supabase/auth/v1/.well-known/jwks.json/route");
    for (const nodeEnv of ["production", "test"]) {
      vi.stubEnv("NODE_ENV", nodeEnv); vi.stubEnv("TERMINAL_E2E_FIXTURE", "1"); vi.stubEnv("TERMINAL_E2E_VERIFIED_AUTH", "1");
      expect((await GET()).status).toBe(404);
    }
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("TERMINAL_E2E_VERIFIED_AUTH", undefined);
    expect((await GET()).status).toBe(404);
    vi.stubEnv("TERMINAL_E2E_VERIFIED_AUTH", "1");
    const response = await GET(); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.keys).toHaveLength(1); expect(body.keys[0]).not.toHaveProperty("d");
  });
});
