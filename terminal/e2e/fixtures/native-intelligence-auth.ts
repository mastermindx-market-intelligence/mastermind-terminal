import type { Page } from "@playwright/test";
import { FIXTURE_ORIGIN, FIXTURE_SERVER_ENV, signFixtureAccessToken, createFixtureSession,
  fixtureSessionCookieName, serializeFixtureSession } from "./investigation-auth";
import { NATIVE_INTELLIGENCE_FIXTURE_SUBJECT } from "../../lib/e2e/nativeIntelligenceFixture";
/** Test-only signer/SDK codec reused verbatim; no real account or new issuer. */
export async function nativeEntranceAuthSetup(page: Page, origin: string) {
  const expected = new URL(FIXTURE_ORIGIN);
  if (origin !== expected.origin || expected.protocol !== "http:" || expected.hostname !== "127.0.0.1" ||
      FIXTURE_SERVER_ENV.NODE_ENV !== "development" || FIXTURE_SERVER_ENV.TERMINAL_E2E_FIXTURE !== "1" ||
      FIXTURE_SERVER_ENV.TERMINAL_E2E_VERIFIED_AUTH !== "1") throw Error("Wrong native fixture origin/flags");
  const signed = signFixtureAccessToken({ sub: NATIVE_INTELLIGENCE_FIXTURE_SUBJECT });
  const session = createFixtureSession(signed), storageKey = fixtureSessionCookieName(FIXTURE_ORIGIN);
  await page.context().addCookies(serializeFixtureSession(storageKey, session).map(cookie => ({ ...cookie,
    domain: expected.hostname, path: "/", httpOnly: false, secure: false, sameSite: "Lax" as const,
    expires: signed.issuedAt + signed.lifetimeSeconds,
  })));
  return signed;
}
