import "next/dist/server/node-environment-baseline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeFixturePrincipal, nativeFixtureRead, NATIVE_INTELLIGENCE_FIXTURE_SUBJECT as SUBJECT,
  NATIVE_INTELLIGENCE_USER_PATH as USER, NATIVE_INTELLIGENCE_BILLING_BASE_PATH as BILLING } from "../e2e/nativeIntelligenceFixture";
import { signFixtureAccessToken, createFixtureSession, serializeFixtureSession, FIXTURE_ORIGIN } from "../../e2e/fixtures/investigation-auth";
const state = vi.hoisted(() => ({ jar: [] as {name:string;value:string}[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => state.jar, set: vi.fn() }) }));
const origin = new URL(FIXTURE_ORIGIN).origin;
const env = { NODE_ENV: "development", TERMINAL_E2E_FIXTURE: "1", TERMINAL_E2E_VERIFIED_AUTH: "1",
  TERMINAL_E2E_NATIVE_INTELLIGENCE: "1", NEXT_PUBLIC_SUPABASE_URL: FIXTURE_ORIGIN, BILLING_GATEWAY_BASE: origin + BILLING };
const signed = (extra: Parameters<typeof signFixtureAccessToken>[0] = {}) => signFixtureAccessToken({ sub: SUBJECT, ...extra });
const req = (token = signed().accessToken, path = USER, method = "GET", requestOrigin = origin) =>
  new Request(requestOrigin + path, { method, headers: { Authorization: `Bearer ${token}` } });
beforeEach(() => { vi.resetModules(); state.jar = []; });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("finite new native entrance read fixture; never production authority", () => {
  it.each([{}, { ...env, NODE_ENV: "production" }, { ...env, NODE_ENV: "test" },
    { ...env, TERMINAL_E2E_FIXTURE: "0" }, { ...env, TERMINAL_E2E_VERIFIED_AUTH: undefined },
    { ...env, TERMINAL_E2E_NATIVE_INTELLIGENCE: undefined }, { ...env, TERMINAL_E2E_NATIVE_INTELLIGENCE: "true" }])("default/partial/production stays 404 (%j)", configuration => {
    expect(nativeFixtureRead(req(), "user", configuration).status).toBe(404);
    expect(nativeFixtureRead(req(signed().accessToken, BILLING + "/api/me"), "billing", configuration).status).toBe(404);
  });
  it("verifies the unchanged isolated signer and only the distinct new subject", () => {
    const token = signed(); expect(nativeFixturePrincipal(req(token.accessToken), "user", env)?.sub).toBe(SUBJECT);
    expect(nativeFixturePrincipal(req(signFixtureAccessToken().accessToken), "user", env)).toBeNull(); // incumbent fixture subject
    expect(nativeFixturePrincipal(req(signed({sub:"e2e00000-0000-4000-8000-000000000018"}).accessToken), "user", env)).toBeNull();
  });
  it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD"])("refuses method %s", method => {
    expect(nativeFixtureRead(req(signed().accessToken, USER, method), "user", env).status).toBe(404);
  });
  it("refuses wrong target/origin/issuer and query smuggling", () => {
    const token = signed().accessToken;
    for (const request of [req(token, USER, "GET", "http://127.0.0.1:3199"), req(token, USER + "?scope=other"),
      req(token, "/api/__e2e__/supabase/auth/v1/token"), req(token, USER, "GET", "https://www.mastermind-x.com")])
      expect(nativeFixturePrincipal(request, "user", env)).toBeNull();
    const cross = req(token); cross.headers.set("origin", "https://foreign.test");
    expect(nativeFixturePrincipal(cross, "user", env)).toBeNull();
    expect(nativeFixturePrincipal(req(token), "user", { ...env, NEXT_PUBLIC_SUPABASE_URL: FIXTURE_ORIGIN + "/" })).toBeNull();
    expect(nativeFixturePrincipal(req(token), "user", { ...env, BILLING_GATEWAY_BASE: "https://www.mastermind-x.com" })).toBeNull();
    const changedOrigin = "http://127.0.0.1:3199";
    expect(nativeFixturePrincipal(req(token, USER, "GET", changedOrigin), "user", { ...env,
      NEXT_PUBLIC_SUPABASE_URL: changedOrigin + "/api/__e2e__/supabase", BILLING_GATEWAY_BASE: changedOrigin + BILLING })).toBeNull();
  });
  it("refuses malformed/tampered/expired/future/oversized/unknown-key tokens", () => {
    const good = signed().accessToken, pieces = good.split(".");
    const tokens = ["", "garbage", good + "=", "x".repeat(5000),
      pieces[0] + "." + Buffer.from(JSON.stringify({sub:SUBJECT})).toString("base64url") + "." + pieces[2],
      signed({ issuedAt: Math.floor(Date.now()/1000)-4000 }).accessToken,
      signed({ issuedAt: Math.floor(Date.now()/1000)+60 }).accessToken,
      signed({ lifetimeSeconds: 3601 }).accessToken, signed({ kid: "foreign" }).accessToken,
      signed({ sessionId: "not-a-uuid" }).accessToken];
    for (const token of tokens) expect(nativeFixturePrincipal(req(token), "user", env), "invalid token refused").toBeNull();
    const missing = new Request(origin + USER);
    expect(nativeFixtureRead(missing,"user",env).status).toBe(404);
  });
  it("returns only a no-store fixed fixture read and no token/refresh capability", async () => {
    const token = signed().accessToken;
    const response = nativeFixtureRead(req(token), "user", env);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const user = await response.json(); expect(user.id).toBe(SUBJECT); expect(user).not.toHaveProperty("access_token");
    const ent = nativeFixtureRead(req(token, BILLING+"/api/me"), "billing", env);
    expect(await ent.json()).toEqual({tier:"unlimited",features:[],status:"active"});
  });
  it("real unchanged server SDK getUser and billing gate traverse the exact fixture transport", async () => {
    for (const [key,value] of Object.entries(env)) vi.stubEnv(key,value);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-anon-key");
    const token = signed(); state.jar = serializeFixtureSession("sb-127-auth-token", createFixtureSession(token));
    const { GET: userGET } = await import("../../app/api/%5F_e2e__/supabase/auth/v1/user/route");
    const { GET: billingGET } = await import("../../app/api/%5F_e2e__/native-intelligence/billing/api/me/route");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo|URL, init?: RequestInit) => {
      const request = new Request(input,init), path = new URL(request.url).pathname;
      calls.push(request.method + " " + path);
      if (path === USER) return userGET(request);
      if (path === BILLING+"/api/me") return billingGET(request);
      throw Error("UNDECLARED_SOURCE_FIXTURE_TRANSPORT");
    }));
    const { readShellMember } = await import("../shared-shell/memberIdentity");
    const { getLiveOptionsAccess } = await import("../entitlement");
    expect(await readShellMember()).toEqual({state:"ready",subjectId:SUBJECT});
    expect(await getLiveOptionsAccess()).toBe("allowed");
    expect(calls).toEqual(["GET "+USER,"GET "+USER,"GET "+BILLING+"/api/me"]);
    // Other synthetic subjects cannot acquire the same server authority.
    state.jar = serializeFixtureSession("sb-127-auth-token", createFixtureSession(signFixtureAccessToken()));
    expect(await readShellMember()).toEqual({state:"unavailable"}); // 404 is not a forged guest or member
    expect(await getLiveOptionsAccess()).toBe("denied");
  });
});
