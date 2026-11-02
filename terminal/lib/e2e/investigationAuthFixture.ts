// Test-fixture seams for the Investigation evidence-review browser loops. This module decides
// NOTHING about authentication: it publishes the fixture's public key, names the marker that
// SELECTS the existing real-SDK branch. Session serialization stays test-only. The real createClient()/getClaims() pair still verifies signature, kid and
// expiry, and a proof that does not verify still lands on SignupGate. Production can never
// activate it: the gate needs development plus BOTH dedicated flags. The private half of the
// synthetic key pair is not here, and this file imports nothing at all, so no runtime graph can
// reach the test-only signer in e2e/fixtures. Server code only: the Analysis page and the JWK route.
const EXPECTED_FLAG = "1"; // anything else, including a partial flag set, is disabled

/** Host-only path=/analysis marker: no principal, no token, no authority. */
export const E2E_AUTH_MARKER_COOKIE = "mm.e2e-investigation-auth";
export const E2E_AUTH_MARKER_VALUE = "verified-v1";
export const E2E_AUTH_MARKER_PATH = "/analysis";

/** Stable synthetic kid for the fixture's single ES256 public key. */
export const FIXTURE_KID = "e2e-investigation-es256-v1";

/** Public point of the isolated synthetic P-256 pair — public material only, with no service
 * behind it and no value outside a Playwright run. */
const FIXTURE_PUBLIC_POINT = {
  crv: "P-256",
  x: "44mCXQ-O09qjqUlijxe8pSMoOthRKjiZWIysgL_jTbE",
  y: "iXKdMZDakB-R0DKZxq9YnoAtgn7DMkV9iJqeM56rDG4",
} as const;

export interface FixtureEnv {
  NODE_ENV?: string;
  TERMINAL_E2E_FIXTURE?: string;
  TERMINAL_E2E_VERIFIED_AUTH?: string;
}

export function fixtureEnv(): FixtureEnv {
  return process.env as FixtureEnv;
}

/** Exact development AND both dedicated flags at exactly "1". A partial enable keeps local
 * preview: the browser half and the server half of the fixture are meaningless alone. */
export function fixtureFlagsEnabled(env: FixtureEnv = fixtureEnv()): boolean {
  return env.NODE_ENV === "development"
    && env.TERMINAL_E2E_FIXTURE === EXPECTED_FLAG
    && env.TERMINAL_E2E_VERIFIED_AUTH === EXPECTED_FLAG;
}

/** Absent, empty or unrelated values are not the marker. */
export function hasFixtureAuthMarkerCookie(value: string | undefined | null, env: FixtureEnv = fixtureEnv()): boolean {
  return fixtureFlagsEnabled(env) && value === E2E_AUTH_MARKER_VALUE;
}

/** The one decision the Analysis page needs: may this request skip the local-preview seam and
 * take the existing createClient()/getClaims() branch? Only investigations with the exact
 * marker; ordinary preview is unchanged everywhere else. */
export function selectsFixtureAuthBranch(routeKind: string, markerValue: string | undefined | null, env: FixtureEnv = fixtureEnv()): boolean {
  return routeKind === "investigations" && hasFixtureAuthMarkerCookie(markerValue, env);
}

/** The single ES256 public key of the fixture, safe to serve from a JWK Set. */
export function fixturePublicJwk(): Record<string, unknown> {
  return { kty: "EC", ...FIXTURE_PUBLIC_POINT, alg: "ES256", use: "sig", kid: FIXTURE_KID };
}

/** What the pinned SDK fetches from `<auth base>/.well-known/jwks.json`. */
export function fixtureJwksDocument(): { keys: Record<string, unknown>[] } {
  return { keys: [fixturePublicJwk()] };
}

