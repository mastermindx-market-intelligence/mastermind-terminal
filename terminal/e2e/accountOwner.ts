import { ownerKeyFor } from "../lib/accountIdentity";
import { fixtureUserId } from "../lib/watchlistsFixtureDb";

/**
 * The owner key the E2E fixture identities resolve to.
 *
 * The fixture harness is unusually well suited to the E1 boundary: `TERMINAL_E2E_EMAIL` is a
 * process-wide env var, so EVERY fixture account signs in at the SAME ADDRESS, while
 * `fixtureUserId(storeKey)` gives each `mm_e2e_wl` cookie value its own auth uuid. Two fixture
 * accounts therefore differ in exactly the dimension the boundary is supposed to be drawn on —
 * which makes a browser spec that switches between them a real discriminator for "was this
 * keyed on the email or on the immutable id?", not a paraphrase of the implementation.
 */
export function e2eAccountOwner(storeKey = "default"): string {
  return ownerKeyFor(fixtureUserId(storeKey));
}

/** Owner-scoped market preference envelope (`{ "<owner>": <payload> }`). */
export const MARKET_PREFS_KEY = "mm.marketPrefs.v2";
/** The pre-boundary unscoped slot. Must never carry account state again. */
export const LEGACY_MARKET_PREFS_KEY = "mm.marketPrefs";
