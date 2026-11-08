import type { Page } from "@playwright/test";
import { signFixtureAccessTokenForServer, createFixtureSession,
  fixtureSessionCookieName, serializeFixtureSession } from "./investigation-auth";
import incumbent from "../../playwright.config";
import { nativeFixtureServerEnvironment } from "./native-intelligence-contract";
import { NATIVE_INTELLIGENCE_FIXTURE_SUBJECT } from "../../lib/e2e/nativeIntelligenceFixture";
const server = Array.isArray(incumbent.webServer) ? incumbent.webServer[0] : incumbent.webServer;
export const NATIVE_FIXTURE_SERVER_ENV = nativeFixtureServerEnvironment(incumbent.use?.baseURL, server?.url, server?.env);
const FIXTURE_ORIGIN = NATIVE_FIXTURE_SERVER_ENV.NEXT_PUBLIC_SUPABASE_URL;
/** Same isolated signer/SDK codec; issuer follows only this owned invocation. */
export async function nativeEntranceAuthSetup(page: Page, origin: string) {
  const expected = new URL(FIXTURE_ORIGIN);
  if (origin !== expected.origin || expected.protocol !== "http:" || expected.hostname !== "127.0.0.1" ||
      NATIVE_FIXTURE_SERVER_ENV.NODE_ENV !== "development" || NATIVE_FIXTURE_SERVER_ENV.TERMINAL_E2E_FIXTURE !== "1" ||
      NATIVE_FIXTURE_SERVER_ENV.TERMINAL_E2E_VERIFIED_AUTH !== "1") throw Error("Wrong native fixture origin/flags");
  const signed = signFixtureAccessTokenForServer(NATIVE_FIXTURE_SERVER_ENV, { sub: NATIVE_INTELLIGENCE_FIXTURE_SUBJECT });
  const session = createFixtureSession(signed), storageKey = fixtureSessionCookieName(FIXTURE_ORIGIN);
  await page.context().addCookies(serializeFixtureSession(storageKey, session).map(cookie => ({ ...cookie,
    domain: expected.hostname, path: "/", httpOnly: false, secure: false, sameSite: "Lax" as const,
    expires: signed.issuedAt + signed.lifetimeSeconds,
  })));
  return signed;
}
