# Terminal auction presentation repair — frozen source handoff

## Decision

The requested compact presentation repair is ready for the canonical Terminal native and browser gates. Four changed files are enumerated with their preimages and final SHA-256 values in `MANIFEST.json`. No remote file was written, no remote process was started, and the root browser process was not accessed.

The default open panel now uses the existing `var(--text)` foreground for the event title, offering amount and deadline. Event names, six security classes and four lifecycle states have readable EN/ZH labels. The title is localized from the existing producer label; the original label remains in the source disclosure. Issue-date language explicitly says settlement has not been observed. Research/context-only, not-scored, unknown freshness, unavailable/denied and unknown-field states remain explicit.

Dollar strings are grouped lexically, preserving all decimal digits and trailing zeros without passing through `Number`. For example, `9007199254740993.0100` displays as `9,007,199,254,740,993.0100 USD`. The ungrouped exact source spelling remains in the event disclosure. The visible competitive deadline normalizes accepted offsets to UTC and retains up to the original six fractional digits; its exact source timestamp also remains available.

Each event has a native **Source details** disclosure with raw identifier, original label/class, known-at clock, exact deadline, source/physical/issue-state codes, source amount, all result keys/values, null reasons and official source link. A separate native **Source observations** disclosure retains the context cutoff/observation clocks and the existing complete source-health presentation. These disclosures are closed by default. The primary list does not show raw IDs, enum codes, null reason codes or result object keys.

## Source scope and guards

Copy/apply only the four files in `MANIFEST.json`: `SovereignAuctionContext.tsx`, the `sa*` additions in `i18n.tsx`, `sovereignAuctionComponent.test.tsx`, and the owned E2E spec. The E2E config and corrected fixtures require no change.

The entire component state/auth/effect/projection segment was compared byte-for-byte with its recorded preimage and is identical. Model, `/api/nw` proxy, both corrected fixtures, and the prior final lint manifest hashes are unchanged. The actual TerminalShell mount remains root-owned and was not accessed. The previous aggregate manifests are historical; this repair has its own exact manifest. The final lint receipt remains intact and still describes its earlier logged source snapshot.

## Checks actually executed

- `node ui_verification/presentation_final/check_presentation_helpers.mjs`: six precision/grouping cases, 148 title checks over both languages and the real 74-event capture, and three UTC deadline cases passed. This executes the exact helper definitions through Node's native TypeScript stripper.
- `node --check ui_verification/terminal/e2e/sovereign-auction-context.spec.ts`: passed.
- SHA guards, byte identity of the auth/effect/state/projection region, and `sa*`-only i18n changes: passed.
- Independent read-only review by `/root/mastermind_consumer_verification`: no blocker found in amount precision, terminology, settlement limits, disclosure preservation or React escaping. The later deadline offset normalization has three local exact checks; its original raw timestamp remains available.

Local React, Vitest, TypeScript/TSX compiler and Playwright packages are not installed in this scratch environment. There is no claim of a native TSX/React test pass or new screenshot review from this repair.

## Canonical next gates

From root's existing canonical `terminal` directory with its installed dependencies:

```sh
./node_modules/.bin/vitest run lib/__tests__/nwRoute.test.ts lib/__tests__/sovereignAuctionContext.test.ts lib/__tests__/sovereignAuctionComponent.test.tsx
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint components/SovereignAuctionContext.tsx lib/i18n.tsx
./node_modules/.bin/playwright test --config=playwright.sovereign-auctions.config.ts
```

Retain root's dedicated free `TERMINAL_E2E_PORT` for the last command. Do not rerun broad TerminalShell lint to adjudicate this leaf repair; the preserved earlier receipt shows 54 inherited errors and 14 inherited warnings, with no introduced diagnostic in that snapshot.

The E2E spec still runs the existing 18-case matrix on the actual `/terminal` mount: EN/ZH; canonical dark plus a clearly labeled alternate-attribute diagnostic; desktop/tablet/mobile; expansion, results, degraded/unavailable/denied states and incumbent invariance. Direct-child summary locators avoid ambiguity introduced by nested native disclosures. The spec explicitly opens source disclosures and checks raw identity/clock/state/null/result evidence inside them, while asserting that raw codes are absent from the primary event summaries. Screenshots remain required for contrast, clipping and small-screen readability. Loopback fixture tests do not establish production host entitlement, live upstream availability, real-account auth or production CSP.
