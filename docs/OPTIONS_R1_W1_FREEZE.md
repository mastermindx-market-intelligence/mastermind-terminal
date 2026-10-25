# Options R1 — W1 freeze (Packet 0)

Status: FROZEN 2026-10-21 by the meta-CEO seat. Lanes implement exactly what is written here; the seat integrates. Program record: `docs/OPTIONS_R1_PROGRAM.md`.

## 0. Owner map (existing code; read before touching anything)

| Concern | Owner | Rule |
|---|---|---|
| Chart link request | `terminal/lib/exposureChartLink.ts` — `ExposureChartRequest` v1, exact-key validator, `#exposure=` hash, `exposureChartHref`, `exposureMapHref`, fingerprints | never edited; origin rides beside it |
| Chart reference overlay | `terminal/components/exposure-map/ExposureChartReference.tsx` | "Return to Exposure" carries the origin back (seat) |
| Exposure map / desk | `ExposureMap.tsx` (`initialRequest`, `openMainChart`), `GexDeskView.tsx` (`exposureReturn`; URL seams `?symbol=`, `?view=`, `tab=prism`) | seat wires the strip and the inspector |
| Matched change | `terminal/lib/exposureReportedChange.ts` — `compareReportedGamma`, basis `matched_reported_gamma/v1`, populations separate, velocity/percent null | never edited; inspector is a view model over it |
| Sector state | `terminal/lib/sectorIntelligence.ts` — `parseSectorState`/`writeSectorState`, `groupRows`/`members`/`sortMembers`, `companyHref`, `sectorMeasuredRead` | never edited |
| Sector Central UI | `SectorIntelligenceWorkspace.tsx` (scroll/focus via `data-sector-return-focus`, `data-sector-choice`), `SectorCompanyTable.tsx` (outbound links at lines 193–194), `SectorRotationMap.tsx` (`rotationQuadrant`, trail SVG) | seat edits |
| Investigations | `investigationContracts.ts` / `investigations.ts` / `investigationSave.ts` (`INVESTIGATION_ADMISSION`, manifest v2) | W2C only, through the command path |
| Alerts | existing alerts owner (5-min VPS cron) | W3C only |

## 0.1 Scoped dependency ledger

| Dependency | Finding (2026-10-21) | Scope of the hold |
|---|---|---|
| O-OPT Phase-0 results | `data/oracle/gauntlet/oopt_results.json`, `p3_trial_ledger.json`, registry id `oracle_oopt_phase0` all absent at Macro `90eb4df17` | blocks W4C predictive/confirmation admission only |
| Within-session history producer | none exists; v1 requires strictly increasing source-session dates | blocks W4A replay only |
| Original EMA method | not frozen (formula/seed/endpoint/convergence) | blocks W2A; incumbent 63/21 stays, never relabelled JdK |
| Independent authenticated client | needed for W2C persistence proof | blocks W2C acceptance, not its build |
| Terminal `origin/master` | moved to `ea7b20286` (#1093) after the pin; sibling R2 lanes touch `lib/exposureMap.ts`/`exposureMapProjection.ts` | rebase before PR; rerun exposure suites |

## 0.2 Test baseline handed down

At `e3ca39a82`: vitest 864 files / 14534 passed / 4 todo; `npx tsc --noEmit` exit 0; `node scripts/check_plain_language.mjs --json` must stay at blocking 0. Lanes run only their named suites plus the neighbours listed in their packet.

## 0.3 W2C candidate types (NOT built in W1; recorded so W1 contracts stay compatible)

`InvestigationContextVNext` = `{ v: 2; carrier: "exposure_chart_request/v1" | "sector_origin/v1"; request: ExposureChartRequest | null; origin: ExposureOrigin | null; evidence: EvidenceEnvelope<unknown>[] }`; `EvidenceEnvelope<T> = { kind: string; version: string; sourceFingerprint: string; asOf: string | null; payload: T }`. Admission through `INVESTIGATION_ADMISSION` additions in `investigations.ts`, never a parallel store.

---

# W1A frozen spec — sector origin envelope and Exposure origin strip

Baseline: Terminal `e3ca39a82d9713061e5e27ac0cd3ac1d249af127` (origin/master at planning time; the lane worktree is pinned there). Paths are relative to the repository root; the Next.js app root is `terminal/`.

## A1. Owner boundaries (binding)

- `terminal/lib/exposureChartLink.ts` (`ExposureChartRequest` v1) is NOT edited. Its validator rejects unknown keys, so the origin travels in a separate `origin` query parameter and never inside the `#exposure=` hash.
- `terminal/lib/sectorIntelligence.ts` is NOT edited. Import `parseSectorState`, `writeSectorState`, `groupRows`, `members`, `sortMembers`, `object`, `text` and the types `SectorState`, `MemberSort`, `FeedReceipt` from `@/lib/sectorIntelligence`.
- No component outside the owned list is edited. Wiring into `ExposureMap.tsx`, `ExposureChartReference.tsx`, `SectorCompanyTable.tsx`, `SectorIntelligenceWorkspace.tsx` and `GexDeskView.tsx` is done by the seat after this lane returns.
- No `any`, no `@ts-ignore`, no new dependencies, no `window`/`location` access inside the library file.

## A2. `terminal/lib/exposureOrigin.ts` (new, pure, no React, no fetch)

```ts
import { parseSectorState, writeSectorState, type MemberSort, type SectorState } from "@/lib/sectorIntelligence";

export const EXPOSURE_ORIGIN_PARAM = "origin";
export const EXPOSURE_ORIGIN_VERSION = 1 as const;
export const EXPOSURE_ORIGIN_MAX_ENCODED = 1024;   // bound on the encoded query value
export const EXPOSURE_ORIGIN_MAX_RETURN = 512;     // bound on returnHref
export const EXPOSURE_ORIGIN_MAX_COUNT = 500;
export const EXPOSURE_ORIGIN_METHOD = "incumbent_rs_63_21/v1" as const;

export interface ExposureOrigin {
  v: 1;
  kind: "sector";
  returnHref: string;
  sector: string;
  group: string;
  company: string;
  index: number | null;
  count: number | null;
  sort: MemberSort;
  query: string;
  asOf: string | null;
  contentHash: string | null;
  method: typeof EXPOSURE_ORIGIN_METHOD;
  benchmark: string | null;
}
export type ExposureOriginRosterState = "exact" | "changed" | "unavailable";

export function isExposureOrigin(value: unknown): value is ExposureOrigin;
export function parseExposureOrigin(search: string | URLSearchParams | null | undefined): ExposureOrigin | null;
export function encodeExposureOrigin(origin: ExposureOrigin): string | null;
export function withExposureOrigin(href: string, origin: ExposureOrigin | null): string;
export function stripExposureOrigin(href: string): string;
export function sectorOriginFromState(input: { state: SectorState; company: string; roster: readonly string[]; asOf: string | null; contentHash: string | null; benchmark: string | null }): ExposureOrigin | null;
export function exposureOriginStep(origin: ExposureOrigin, roster: readonly string[], direction: -1 | 1): { company: string; index: number } | null;
export function exposureOriginRosterState(origin: ExposureOrigin, receipt: { contentHash: string | null } | null, roster: readonly string[] | null): ExposureOriginRosterState;
export function exposureOriginForCompany(origin: ExposureOrigin, company: string, index: number): ExposureOrigin;
```

`isExposureOrigin` rules. The value must be a plain object whose own keys are exactly the fourteen interface keys (no extra key, no missing key; order of keys in the input does not matter):
- `v` === 1 (a number). "1", 2, 0, undefined → false.
- `kind` === "sector".
- `returnHref`: string of 1..512 chars; starts with `/discover?`; contains no `#`, no `\`, no `//`, no whitespace, no character below U+0020. Let `params = new URLSearchParams(returnHref.slice(returnHref.indexOf("?") + 1))`; require `params.get("tab") === "sectors"` and `parseSectorState(params)` to return `sector`, `group`, `sort`, `query` and `company` equal to the origin's own fields.
- `sector`, `group`: match `/^[a-z][a-z0-9_-]{0,79}$/`.
- `company`: match `/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/` and length ≤ 20.
- `count`: null or a safe integer in 1..500.
- `index`: null or a safe integer ≥ 0; a non-null `index` requires a non-null `count` and `index < count`.
- `sort`: one of "source" | "return" | "relative" | "ticker".
- `query`: string of ≤ 40 chars.
- `asOf`: null or a canonical `YYYY-MM-DD` that round-trips through `Date.UTC` (2026-02-30 is rejected).
- `contentHash`: null or `/^[A-Za-z0-9:_.-]{8,128}$/`.
- `method` === "incumbent_rs_63_21/v1".
- `benchmark`: null or the same pattern and bound as `company`.

`parseExposureOrigin(search)`: accepts "?a=b", "a=b", a `URLSearchParams`, null or undefined. Reads the `origin` parameter. Absent → null. Raw value longer than 1024 chars → null. `decodeURIComponent` then `JSON.parse` inside try/catch → null on throw. Not a plain object → null. `isExposureOrigin` false → null (this is how an unsupported `v` is ignored). Never throws.

`encodeExposureOrigin(origin)`: `isExposureOrigin` false → null. Serialise a fresh object literal written in the interface key order (canonical key order), `JSON.stringify`, then `encodeURIComponent`. Result longer than 1024 chars → null.

`withExposureOrigin(href, origin)`: origin null, or encode null → return `href` unchanged. Otherwise split `href` at the first `#` into base and hash; split base at the first `?` into path and search; `new URLSearchParams(search)`; `set("origin", encoded)`; return `path + "?" + params.toString() + (hash === undefined ? "" : "#" + hash)`. The hash is carried byte for byte (never re-encoded). Works for relative hrefs such as `/options?tab=prism&symbol=NVDA&view=chart#exposure=%7B...` and `/terminal?symbol=NVDA#exposure=...`. Replaces an existing `origin`. Do not use `new URL(href)` without a base.

`stripExposureOrigin(href)`: same split; delete `origin`; when no parameters remain omit the `?`; the hash is preserved verbatim.

`sectorOriginFromState({ state, company, roster, asOf, contentHash, benchmark })`: `company` must match the company pattern else null. `const url = new URL("https://mastermind.invalid/discover"); const written = writeSectorState(url, { ...state, company });` (`writeSectorState` returns pathname + search + hash) — drop anything from `#` on; longer than 512 → null. `index = roster.indexOf(company)` (null when −1); `count = roster.length` when 1..500 else null (and then index is null). `asOf`, `contentHash`, `benchmark` are kept only when they satisfy their rules, otherwise null. Build the object, validate with `isExposureOrigin`, return it or null.

`exposureOriginStep(origin, roster, direction)`: requires `origin.index !== null` and `roster[origin.index] === origin.company`; `target = origin.index + direction`; must satisfy `0 ≤ target < roster.length`; return `{ company: roster[target], index: target }` else null. Never wraps around.

`exposureOriginRosterState(origin, receipt, roster)`: `receipt === null || roster === null` → "unavailable". "exact" when `receipt.contentHash !== null && origin.contentHash === receipt.contentHash && (origin.index === null || roster[origin.index] === origin.company)`. Otherwise "changed".

`exposureOriginForCompany(origin, company, index)`: returns a copy with `company` and `index` replaced and `returnHref` rewritten: parse the original `returnHref` search with `parseSectorState`, set `company`, write it through `writeSectorState` on `new URL("https://mastermind.invalid/discover")`, drop any hash. If the copy fails `isExposureOrigin`, return the original origin unchanged.

## A3. `terminal/components/exposure-map/useExposureOriginRoster.ts` (new client hook)

```ts
import type { ExposureOrigin, ExposureOriginRosterState } from "@/lib/exposureOrigin";
export interface ExposureOriginRoster { state: "loading" | ExposureOriginRosterState; tickers: readonly string[] | null; asOf: string | null; contentHash: string | null; groupLabel: string | null }
export function useExposureOriginRoster(origin: ExposureOrigin | null): ExposureOriginRoster;
```
- `origin === null` → `{ state: "unavailable", tickers: null, asOf: null, contentHash: null, groupLabel: null }` and no fetch.
- Otherwise state starts "loading". On mount and whenever `origin.sector`, `origin.group`, `origin.sort`, `origin.query` or `origin.contentHash` change: `fetch("/api/sector-intelligence?source=confluence", { cache: "no-store", credentials: "same-origin", signal })`. Parse `body = object(await res.json())`, `receipt = object(body.receipt)`. Require `res.ok`, `receipt.source === "confluence"` and `text(receipt.status) === "ready"`; otherwise state "unavailable".
- Derive `groups = groupRows(body.data)`, `group = groups.find(r => r.key === origin.group) || {}`, `tickers = sortMembers(members(group), origin.sort, origin.query).map(m => m.ticker)`, `groupLabel = text(group.label) || null`, `asOf = text(receipt.asOf) || null`, `contentHash = text(receipt.contentHash) || null`. `tickers.length === 0` → "unavailable"; otherwise `state = exposureOriginRosterState(origin, { contentHash }, tickers)`.
- Network or JSON errors → "unavailable". Abort on unmount with an `AbortController`; ignore responses from a superseded effect. No retry, no polling, no cache beyond the component lifetime.

## A4. `terminal/components/exposure-map/exposureOriginStrings.ts` (new)

Same shape as `exposureMapStrings.ts`: `const COPY = { key: [en, zh] as const … }`, `export type ExposureOriginKey = keyof typeof COPY`, `export const exposureOriginT = (lang: "en" | "zh") => (key: ExposureOriginKey): string`, and `export function fill(template: string, vars: Record<string, string | number>): string` replacing `{name}` tokens. Exact keys and copy:

| key | en | zh |
|---|---|---|
| fromSectorCentral | From Sector Central | 来自板块中心 |
| backToSectorCentral | Back to Sector Central | 返回板块中心 |
| previousCompany | Previous company | 上一家公司 |
| nextCompany | Next company | 下一家公司 |
| positionOf | {index} of {count} | 第 {index}/{count} 家 |
| asOf | as of {date} | 截至 {date} |
| rosterLoading | Checking the sector roster… | 正在核对板块名单… |
| rosterExact | Same roster as when you left. | 名单与离开时一致。 |
| rosterChanged | The sector roster changed since you left. Stepping is paused; go back to choose again. | 板块名单已更新。已暂停切换，请返回重新选择。 |
| rosterUnavailable | The sector roster could not be checked. Back still works. | 暂时无法核对板块名单，仍可返回。 |
| methodIncumbent | Relative strength, 63-day and 21-day | 相对强度（63 日与 21 日） |
| benchmarkRelative | relative to {benchmark} | 相对 {benchmark} |
| originNavLabel | Sector origin | 板块来源 |

No user-visible string may contain an enum slug, snake_case, a code or a raw key.

## A5. `terminal/components/exposure-map/ExposureOriginStrip.tsx` (new, `"use client"`)

```ts
export interface ExposureOriginStripProps { origin: ExposureOrigin; lang: "en" | "zh"; roster: ExposureOriginRoster; onStep: (next: { company: string; index: number }) => void }
export default function ExposureOriginStrip(props: ExposureOriginStripProps): JSX.Element
```
Render one `<nav className={styles.strip} aria-label={t("originNavLabel")} data-testid="exposure-origin-strip" data-state={roster.state}>` containing, in order:
1. `<span className={styles.eyebrow}>{t("fromSectorCentral")}</span>`
2. `<span className={styles.context}>` with `<strong>{roster.groupLabel ?? origin.group}</strong>`, `<span>{origin.company}</span>`, then when `origin.index !== null && origin.count !== null` `<span>{fill(t("positionOf"), { index: origin.index + 1, count: origin.count })}</span>`, then when `origin.asOf` `<span>{fill(t("asOf"), { date: origin.asOf })}</span>`, then `<span className={styles.method}>{t("methodIncumbent")}{origin.benchmark ? " · " + fill(t("benchmarkRelative"), { benchmark: origin.benchmark }) : ""}</span>`.
3. `<span className={styles.actions}>` with `<a href={origin.returnHref} data-testid="exposure-origin-back">← {t("backToSectorCentral")}</a>`, `<button type="button" data-testid="exposure-origin-prev" aria-label={t("previousCompany")} disabled={!prev} onClick={() => prev && props.onStep(prev)}>‹ {prev?.company ?? "—"}</button>`, `<button type="button" data-testid="exposure-origin-next" aria-label={t("nextCompany")} disabled={!next} onClick={() => next && props.onStep(next)}>{next?.company ?? "—"} ›</button>` where `prev = roster.state === "exact" && roster.tickers ? exposureOriginStep(origin, roster.tickers, -1) : null` and `next` likewise with `+1`.
4. `<p role="status" className={styles.note}>` showing rosterLoading / rosterExact / rosterChanged / rosterUnavailable by `roster.state`.
No fetch, no router, no `window` access inside the component: the parent owns navigation through `onStep` and the plain anchor.

## A6. `terminal/components/exposure-map/ExposureOriginStrip.module.css` (new)

Tokens only, no hex colours. Use the tokens already used by `ExposureMap.module.css`: `var(--panel)`, `var(--line)`, `var(--text)`, `var(--text-2)`, `var(--muted)`, `var(--hover)`, `var(--brand-2)` (focus ring). `.strip { display:flex; flex-wrap:wrap; align-items:center; gap:10px 16px; padding:10px 14px; border:1px solid var(--line); border-radius:10px; background:var(--panel); color:var(--text); font-size:11px; }` `.eyebrow { color:var(--text-2); font-size:9px; letter-spacing:.12em; font-weight:600; text-transform:uppercase; }` `.context { display:inline-flex; flex-wrap:wrap; align-items:baseline; gap:8px; }` `.context strong { font-weight:650; }` `.method { color:var(--muted); }` `.actions { margin-inline-start:auto; display:flex; gap:6px; }` `.actions a, .actions button { display:inline-flex; align-items:center; min-height:36px; padding:7px 10px; border:1px solid var(--line); border-radius:6px; background:none; color:inherit; font:inherit; text-decoration:none; cursor:pointer; }` `.actions button:disabled { opacity:.48; cursor:default; }` `.actions a:focus-visible, .actions button:focus-visible { outline:2px solid var(--brand-2); outline-offset:3px; }` `.note { width:100%; margin:0; color:var(--text-2); line-height:1.6; }` `@media (max-width:640px) { .actions { margin-inline-start:0; width:100%; } .actions > * { flex:1 1 auto; justify-content:center; } }`.

## A7. Tests (vitest; the suite default is plain Node; component files opt into jsdom with the `// @vitest-environment jsdom` pragma and render with `createRoot` + `act` exactly like `terminal/lib/__tests__/CommandPalette.test.tsx`)

`terminal/lib/__tests__/exposureOrigin.test.ts` — at least these `it` names, each able to fail:
- "accepts a well-formed sector origin and round-trips through encode and parse"
- "rejects an extra key, a missing key and an unsupported version"
- "rejects an oversize encoded value and malformed JSON without throwing"
- "rejects a returnHref that is absolute, protocol-relative, carries a hash, or does not re-parse to the same sector state"
- "rejects index without count, index at or above count, count above 500 and a non-integer index"
- "rejects an impossible asOf date and a malformed contentHash"
- "withExposureOrigin adds the parameter to a relative href and carries the exposure hash byte for byte"
- "withExposureOrigin replaces an existing origin; stripExposureOrigin removes it and the dangling question mark"
- "sectorOriginFromState writes a returnHref that parseSectorState reads back with the same sector, group, sort, query and company"
- "exposureOriginStep never wraps: null at the first and last positions and when the roster no longer matches"
- "exposureOriginRosterState is exact only on equal non-null hashes and a matching position, changed on a different hash or position, unavailable without a receipt or roster"
- "exposureOriginForCompany rewrites company, index and returnHref consistently"

`terminal/lib/__tests__/ExposureOriginStrip.test.tsx` (jsdom) — at least:
- "renders the back link to returnHref with English and Chinese labels"
- "disables stepping while the roster is loading, changed or unavailable"
- "steps to the previous and next company when the roster is exact and calls onStep with the ticker and index"
- "shows the position, date and method line from the origin"
- "exposes data-state and an aria-labelled navigation landmark"

`terminal/lib/__tests__/useExposureOriginRoster.test.tsx` (jsdom; `vi.stubGlobal("fetch", …)`; render a probe component that prints the hook result) — at least:
- "returns exact with the sorted roster when the confluence receipt hash matches"
- "returns changed when the receipt hash differs"
- "returns unavailable on a non-ready receipt, on a network error, and for a null origin without fetching"

---

# W1B frozen spec — rotation eligibility, boundary and unavailable states

Baseline: Terminal `e3ca39a82d9713061e5e27ac0cd3ac1d249af127`. Paths are relative to the repository root; the Next.js app root is `terminal/`.

## B1. Why

`terminal/components/sector-intelligence/SectorRotationMap.tsx` has `rotationQuadrant(rs63, rs21)` which returns "leading" for `rs63 >= 0 && rs21 >= 0`. A member whose relative strength fell through to exactly 0 (missing peer, degenerate standardisation, zero-filled source) is therefore drawn as Leading. This lane builds the pure placement library that replaces that rule. The seat wires it into the map after the lane returns; this lane does not edit the component.

## B2. Owner boundaries (binding)

- Owned: `terminal/lib/rotationEligibility.ts` (new) and `terminal/lib/__tests__/rotationEligibility.test.ts` (new). Nothing else.
- The library imports nothing from `components/`. It may import `type Lang` from `@/lib/i18n` or declare `"en" | "zh"` inline.
- No `any`, no `@ts-ignore`, no new dependencies. Compact 2-space style like the neighbouring `lib/` files.

## B3. `terminal/lib/rotationEligibility.ts`

```ts
export const ROTATION_METHOD_INCUMBENT = "incumbent_rs_63_21/v1" as const;
export type RotationQuadrant = "leading" | "improving" | "lagging" | "weakening";
export type RotationAxis = "rs63" | "rs21";
export type RotationUnavailableReason = "unmeasured" | "missing" | "nonfinite";
export type RotationPlacement =
  | { state: "placed"; quadrant: RotationQuadrant; rs63: number; rs21: number }
  | { state: "boundary"; axes: RotationAxis[]; nearest: RotationQuadrant[]; rs63: number; rs21: number }
  | { state: "unavailable"; reason: RotationUnavailableReason; axes: RotationAxis[]; reasonCode: string | null };
export interface RotationPlacementOptions { measured?: boolean; reasonCode?: string | null }
export function placeRotation(rs63: unknown, rs21: unknown, options?: RotationPlacementOptions): RotationPlacement;

export interface RotationCohortRow { id: string; rs63: unknown; rs21: unknown; measured?: boolean; reasonCode?: string | null }
export type RotationDispersion = "ok" | "constant" | "insufficient";
export interface RotationCohortPlacement {
  placements: Map<string, RotationPlacement>;      // insertion order = input order; duplicate ids keep the FIRST row
  counts: { placed: number; boundary: number; unavailable: number; byQuadrant: Record<RotationQuadrant, number> };
  dispersion: { rs63: RotationDispersion; rs21: RotationDispersion; finiteN: number };
  universe: { expected: number; measured: number };   // expected = distinct ids; measured = placed + boundary
}
export function placeRotationCohort(rows: readonly RotationCohortRow[]): RotationCohortPlacement;

export type RotationContext =
  | { basis: "benchmark_relative"; benchmark: string; asOf: string | null; method: typeof ROTATION_METHOD_INCUMBENT }
  | { basis: "peer_standardized"; expectedN: number; measuredN: number; asOf: string | null; method: typeof ROTATION_METHOD_INCUMBENT };
export function rotationContextLabel(context: RotationContext, lang: "en" | "zh"): string;
export function rotationPlacementLabel(placement: RotationPlacement, lang: "en" | "zh"): string;
export function rotationShownReceipt(shown: number, universe: number, lang: "en" | "zh"): string;
export function isRotationBoundaryValue(value: number): boolean;   // Object.is(value, 0) || Object.is(value, -0)
```

### `placeRotation` rules (precedence top to bottom)
1. `options.measured === false` → `{ state: "unavailable", reason: "unmeasured", axes: [], reasonCode: options.reasonCode ?? null }`.
2. An axis that is `null` or `undefined` → reason "missing"; `axes` lists every missing axis in the order `["rs63", "rs21"]`; `reasonCode: options?.reasonCode ?? null`.
3. An axis that is not a number, or is `NaN`, `Infinity` or `-Infinity` → reason "nonfinite", `axes` lists every such axis (a missing axis and a nonfinite axis together report "missing" with both axes listed, because missing has precedence).
4. An axis that is exactly `0` or `-0` → `{ state: "boundary", axes, nearest, rs63, rs21 }` where `rs63`/`rs21` are normalised with `+0` (never `-0`). `nearest`: only `rs63` zero and `rs21 > 0` → `["leading", "improving"]`; only `rs63` zero and `rs21 < 0` → `["weakening", "lagging"]`; only `rs21` zero and `rs63 > 0` → `["leading", "weakening"]`; only `rs21` zero and `rs63 < 0` → `["improving", "lagging"]`; both zero → `["leading", "improving", "lagging", "weakening"]`.
5. Otherwise placed: `rs63 > 0 && rs21 > 0` leading; `rs63 < 0 && rs21 > 0` improving; `rs63 < 0 && rs21 < 0` lagging; `rs63 > 0 && rs21 < 0` weakening.

A boundary or unavailable result is never "leading". Values are never coerced from strings; `"0.5"` is nonfinite.

### `placeRotationCohort` rules
- One `placeRotation(row.rs63, row.rs21, { measured: row.measured, reasonCode: row.reasonCode })` per distinct id (the first occurrence of a duplicate id wins; later duplicates are ignored and do not count toward `expected`).
- `counts.byQuadrant` counts placed rows only; `boundary` rows are counted in `counts.boundary`, not in any quadrant.
- `dispersion` per axis is computed over the finite axis values of placed and boundary rows: fewer than 2 values → "insufficient"; all values within `1e-12` of the first → "constant"; otherwise "ok". `finiteN` = number of rows that are placed or boundary.
- `universe.expected` = number of distinct ids; `universe.measured` = placed + boundary.
- Filtering is the caller's concern: calling the cohort function on a subset must give each surviving id a placement equal (deep) to its placement in the full cohort. The function must not standardise, rescale or rank; it only classifies.

### Labels (plain language; no slug, underscore, enum or code may appear in any returned string)
- `rotationContextLabel`: benchmark_relative → en `Relative to {benchmark}` / zh `相对 {benchmark}`; peer_standardized → en `Peer-standardized · {measuredN} of {expectedN} measured` / zh `同业标准化 · 已计量 {measuredN}/{expectedN}`; when `asOf` is non-null append en ` · as of {asOf}` / zh ` · 截至 {asOf}`.
- `rotationPlacementLabel`: placed → en Leading / Improving / Lagging / Weakening, zh 领先 / 改善 / 落后 / 走弱; boundary → en `On the boundary` / zh `处于边界`; unavailable → en `Not placed · not measured` / `Not placed · missing` / `Not placed · invalid value`, zh `未定位 · 未计量` / `未定位 · 数据缺失` / `未定位 · 数值无效`.
- `rotationShownReceipt(shown, universe, lang)`: en `Showing {shown} of {universe} · filters never change the numbers`, zh `显示 {shown}/{universe} · 筛选不改变数值`.

## B4. `terminal/lib/__tests__/rotationEligibility.test.ts` — at least these `it` names, each able to fail

- "an exact zero on either axis is a boundary, never leading" — the falsifier for the trap: `placeRotation(0, 0)`, `placeRotation(0, 1.2)`, `placeRotation(-0, -0.4)`, `placeRotation(0.7, 0)` are all `state: "boundary"` with the nearest sets from B3, and none has `quadrant`.
- "null, undefined and a missing axis report missing with the affected axes in order"
- "NaN, infinities, strings and booleans report nonfinite and are never coerced"
- "an unmeasured row reports unmeasured with its reason code and takes precedence over missing"
- "missing takes precedence over nonfinite when both occur"
- "each quadrant is placed from the sign pair" (four cases)
- "boundary values are normalised to +0"
- "the cohort keeps input order, ignores duplicate ids and counts boundary rows outside the quadrants"
- "dispersion is insufficient below two finite values, constant on identical values and ok otherwise"
- "a filtered subset reproduces the full cohort's placements for the surviving ids and leaves the universe to the caller"
- "context labels name the benchmark or the measured share and the date in both languages"
- "placement labels and the shown receipt contain no slug, underscore or code in either language" — assert `/[_]|rs63|rs21|leading|improving|lagging|weakening|unmeasured|nonfinite/i` does not match any zh string and `/[_]|rs63|rs21|nonfinite|unmeasured/` does not match any en string (en quadrant names are words, so they are allowed in en only).
Count: at least 18 assertions-bearing `it` blocks.

---

# W1C frozen spec — reported-Gamma change inspector (view model + panel)

Baseline: Terminal `e3ca39a82d9713061e5e27ac0cd3ac1d249af127`. Paths are relative to the repository root; the Next.js app root is `terminal/`.

## C1. Why and boundaries

`terminal/lib/exposureReportedChange.ts` already owns the matched comparison (`compareReportedGamma(current, previous, originMs)` → `ReportedGammaChange`, basis `matched_reported_gamma/v1`; read that file first for the exact types: `ReportedGammaSnapshot`, `ReportedGammaMember`, `ReportedGammaStats`, `ReportedGammaPopulation`, `ReportedGammaChange`). It is NOT edited and its logic is never re-implemented. This lane builds a pure, descriptive view model over its output and a presentational panel. No causal, predictive, flow or dealer-behaviour language anywhere: the inspector says what changed between two reported sessions, never why.

- Owned: `terminal/lib/exposureChangeInspector.ts` (new), `terminal/lib/__tests__/exposureChangeInspector.test.ts` (new), `terminal/lib/__tests__/exposureChangeInspectorCopy.test.ts` (new), `terminal/components/exposure-map/exposureChangeInspectorStrings.ts` (new), `terminal/components/exposure-map/ExposureChangeInspector.tsx` (new), `terminal/components/exposure-map/ExposureChangeInspector.module.css` (new), `terminal/lib/__tests__/ExposureChangeInspector.test.tsx` (new). Nothing else. Wiring into `ExposureMap.tsx` ("changes" detail) is done by the seat afterwards.
- No `any`, no `@ts-ignore`, no new dependencies, no fetch, no router, no `window` in the library.

## C2. `terminal/lib/exposureChangeInspector.ts`

```ts
import type { ReportedGammaChange } from "@/lib/exposureReportedChange";

export const CHANGE_INSPECTOR_BASIS = "matched_reported_gamma/v1" as const;
export const CHANGE_INSPECTOR_TOP_K = 8;
export const CHANGE_INSPECTOR_MAX_K = 50;
export const CHANGE_INSPECTOR_FLAT_USD = 0.5;

export type ChangeInspectorState = "data" | "unavailable" | "single_session" | "invalid";
export type ChangeInspectorReason =
  | "missing_basis" | "identity" | "scope" | "definition" | "time" | "malformed" | "empty_intersection"   // from ReportedGammaChange
  | "one_session" | "malformed_input";

export interface ChangeInspectorRow {
  strike: number; contracts: number;
  previousNetUsd: number; currentNetUsd: number;
  signedChangeUsd: number; netMagnitudeChangeUsd: number; grossChangeUsd: number;
  direction: "up" | "down" | "flat";     // sign of signedChangeUsd; |x| < CHANGE_INSPECTOR_FLAT_USD → "flat"
  focus: boolean;                          // true when strike === input.focusStrike
}
export interface ChangeInspectorInput {
  change: ReportedGammaChange | null | undefined;
  currentSession: string | null;         // YYYY-MM-DD or null
  previousSession: string | null;
  focusStrike?: number | null;
  topK?: number;                          // default CHANGE_INSPECTOR_TOP_K, clamped to 1..CHANGE_INSPECTOR_MAX_K
}
export interface ChangeInspectorModel {
  state: ChangeInspectorState;
  basis: typeof CHANGE_INSPECTOR_BASIS;
  reason: ChangeInspectorReason | null;  // null only when state === "data"
  sessions: { previous: string | null; current: string | null };
  populations: { matched: number; previousOnly: number; currentOnly: number; qualificationLost: number; qualificationGained: number; unavailableEither: number; previousObserved: number; currentObserved: number } | null;
  aggregate: { contracts: number | null; previousNetUsd: number | null; currentNetUsd: number | null; signedChangeUsd: number | null; netMagnitudeChangeUsd: number | null; grossChangeUsd: number | null };
  rows: ChangeInspectorRow[];            // sorted by |netMagnitudeChangeUsd| desc, ties by strike asc; top-K; a focus row outside the top-K is appended last
  more: number;                           // byStrike.length − rows that came from the top-K (the appended focus row is not subtracted)
  focus: { strike: number; included: boolean; inTopK: boolean } | null;
  velocity: null;
  percentChange: null;
}
export function buildChangeInspector(input: ChangeInspectorInput): ChangeInspectorModel;
export function formatUsdCompact(value: number | null, signed?: boolean): string;
```

State rules:
- `change` null/undefined and exactly one of the sessions non-null → `single_session`, reason `one_session`.
- `change` null/undefined otherwise → `unavailable`, reason `missing_basis`.
- `change.state === "unavailable"` → `unavailable` with `change.reason`.
- `change.state === "data"` but malformed → `invalid`, reason `malformed_input`. Malformed means: `aggregate` or `population` not objects, any `ReportedGammaStats` field not a finite number, any population count not a non-negative safe integer, `byStrike` not an array, a byStrike entry whose `strike` is not a finite positive number or whose stats are not finite, or `change.basis !== "matched_reported_gamma/v1"`.
- Otherwise `data`. `populations` is filled from `change.population` (`matched` = `matchedQualified`, `previousOnly` = `previousOnlyReported`, `currentOnly` = `currentOnlyReported`); populations are never summed into a change figure. `aggregate` copies the aggregate stats. In every non-data state `populations` is null, every `aggregate` field is null, `rows` is empty, `more` is 0 and `focus` is null.
- `sessions` always echoes the input sessions, validated to canonical `YYYY-MM-DD` (otherwise null).
- `velocity` and `percentChange` are always null (type-level).

`formatUsdCompact(value, signed = true)`: null or non-finite → `"—"`. Absolute value ≥ 1e9 → `B`, ≥ 1e6 → `M`, ≥ 1e3 → `K`, else whole dollars; 2 decimals for B/M/K trimmed of trailing zeros (`1.2B`, `340M`, `12.5K`); prefix `$`; negative uses the minus sign `−` (U+2212); when `signed` is true a positive value is prefixed `+`; zero is `$0` without sign.

## C3. `terminal/components/exposure-map/exposureChangeInspectorStrings.ts`

Same shape as `exposureMapStrings.ts` (`COPY` of `[en, zh]`, `ExposureChangeInspectorKey`, `exposureChangeInspectorT(lang)`, and `fill(template, vars)` for `{name}` tokens). Exact keys and copy (descriptive only):

| key | en | zh |
|---|---|---|
| title | What changed in reported Gamma? | 报告 Gamma 有何变化？ |
| basis | Matched reported Gamma · same contracts on both sessions | 匹配的报告 Gamma · 两个交易日相同合约 |
| sessions | {previous} → {current} | {previous} → {current} |
| contracts | {n} contracts matched | 匹配 {n} 份合约 |
| matched | Matched | 已匹配 |
| previousOnly | Only in previous | 仅前一交易日 |
| currentOnly | Only in current | 仅当前交易日 |
| qualificationLost | Lost qualification | 失去资格 |
| qualificationGained | Gained qualification | 获得资格 |
| populationsNote | Counted separately; never added into the change. | 分别计数，不计入变化量。 |
| netChange | Net change | 净变化 |
| netMagnitude | Net magnitude change | 净幅度变化 |
| grossChange | Gross change | 总变化 |
| previousNet | Previous net | 前一交易日净值 |
| currentNet | Current net | 当前净值 |
| strike | Strike | 行权价 |
| moreStrikes | {n} more strikes | 另有 {n} 个行权价 |
| focusOutsideTop | Selected strike shown below the largest changes. | 所选行权价显示在最大变化之后。 |
| velocityNote | Two sessions only: no rate, no percent, no attribution. | 仅两个交易日：不计算速率、百分比或归因。 |
| noteDescriptive | Reported Gamma is a dated measurement, not observed dealer inventory. | 报告 Gamma 是按日期计量的数据，不是实际做市商库存。 |
| stateMissingBasis | No earlier reported session to match. | 没有可匹配的更早交易日。 |
| stateIdentity | The two sessions describe different instruments. | 两个交易日对应不同标的。 |
| stateScope | The two sessions use a different scope. | 两个交易日的范围不同。 |
| stateDefinition | The two sessions use a different definition. | 两个交易日的定义不同。 |
| stateTime | The sessions are out of order or undated. | 交易日顺序错误或缺少日期。 |
| stateMalformed | The source records could not be read. | 无法读取来源记录。 |
| stateEmptyIntersection | No contract appears on both sessions. | 没有合约同时出现在两个交易日。 |
| stateOneSession | Only one reported session is available; a comparison needs two. | 仅有一个交易日的数据，比较需要两个。 |
| stateInvalid | The comparison record could not be read. | 无法读取比较记录。 |
| selectStrike | Select strike {strike} | 选择行权价 {strike} |

Banned vocabulary (must not appear in any string, either language, including interpolated outputs): en `/\b(because|caused?|causes|driven by|due to|dealers? (bought|sold|are|were)|positioning|hedging|flows?|predicts?|will|momentum|bullish|bearish|squeeze|pinned?)\b/i`; zh `/(因为|导致|由于|做市商(买入|卖出)|持仓意图|对冲|资金流|预测|将会|看涨|看跌|轧空|钉住)/`.

## C4. `terminal/components/exposure-map/ExposureChangeInspector.tsx` (`"use client"`, presentational)

```ts
export interface ExposureChangeInspectorProps { model: ChangeInspectorModel; lang: "en" | "zh"; selectedStrike?: number | null; onSelectStrike?: (strike: number) => void }
export default function ExposureChangeInspector(props: ExposureChangeInspectorProps): JSX.Element
```
Render `<section className={styles.inspector} data-testid="exposure-change-inspector" data-state={model.state}>`:
1. Header: `<h3>{t("title")}</h3>` and a basis pill `<span className={styles.pill}>{t("basis")}</span>`; when both sessions are present `<p className={styles.sessions}>{fill(t("sessions"), …)}</p>`.
2. When `state !== "data"`: `<p role="status" className={styles.note}>` with the state string mapped from `reason` (`missing_basis`→stateMissingBasis, `identity`→stateIdentity, `scope`→stateScope, `definition`→stateDefinition, `time`→stateTime, `malformed`→stateMalformed, `empty_intersection`→stateEmptyIntersection, `one_session`→stateOneSession, `malformed_input`→stateInvalid), then the velocityNote, then stop.
3. When data: a populations grid of five cells (matched, previousOnly, currentOnly, qualificationLost, qualificationGained) each `<div className={styles.cell}><span>{label}</span><strong>{count}</strong></div>`, followed by `<p className={styles.note}>{t("populationsNote")}</p>`; an aggregate row of three stats (netChange, netMagnitude, grossChange) using `formatUsdCompact` and `data-sign="positive" | "negative"` on the value (`netMagnitude` and `gross` use `data-sign` from their own sign too); a `<p className={styles.sub}>{fill(t("contracts"), { n })}</p>`.
4. A table (`<table>` with `<caption className={styles.srOnly}>{t("title")}</caption>`) with columns strike / netChange / netMagnitude / grossChange / previousNet → currentNet. Each row is a `<tr data-focus={row.focus || undefined}>` whose first cell holds `<button type="button" aria-pressed={selectedStrike === row.strike} aria-label={fill(t("selectStrike"), { strike })} onClick={() => onSelectStrike?.(row.strike)}>{strike}</button>`; money cells carry `data-sign`. After the table: `more > 0` → `<p className={styles.note}>{fill(t("moreStrikes"), { n: more })}</p>`; `focus && focus.included && !focus.inTopK` → `<p className={styles.note}>{t("focusOutsideTop")}</p>`.
5. Always: `<p className={styles.note}>{t("velocityNote")}</p><p className={styles.note}>{t("noteDescriptive")}</p>`.

## C5. `terminal/components/exposure-map/ExposureChangeInspector.module.css`

Tokens only (`var(--panel)`, `var(--line)`, `var(--text)`, `var(--text-2)`, `var(--muted)`, `var(--hover)`, `var(--brand-2)`, `var(--positive,#2ebc95)`, `var(--negative,#df718e)` exactly as `ExposureMap.module.css` declares them on `.map`). `.inspector { display:flex; flex-direction:column; gap:12px; font-variant-numeric:tabular-nums; }` `.inspector h3 { margin:0; font-size:14px; font-weight:650; }` `.pill` like `.badge` in ExposureMap (border 1px solid var(--line), radius 20px, padding 6px 10px, font-size 10px). `.grid { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--panel); }` `.cell { padding:12px 14px; border-inline-end:1px solid var(--line); display:flex; flex-direction:column; gap:6px; }` `.cell:last-child { border-inline-end:0; }` `.cell span { font-size:10px; color:var(--text-2); }` `.cell strong { font-size:18px; font-weight:650; }` `.stats` same grid with three columns. `[data-sign="positive"] { color:var(--positive,#2ebc95); } [data-sign="negative"] { color:var(--negative,#df718e); }` Table: `width:100%; border-collapse:collapse; font-size:11px;` header cells `text-align:end; color:var(--text-2); font-weight:600; padding:8px 10px; border-bottom:1px solid var(--line);`, first column `text-align:start`; row buttons `min-height:32px; padding:4px 8px; border:1px solid transparent; border-radius:6px; background:none; color:inherit; font:inherit;` with `[aria-pressed="true"] { background:var(--hover); border-color:var(--line); }` and `:focus-visible { outline:2px solid var(--brand-2); outline-offset:2px; }`. `.note { margin:0; font-size:11px; line-height:1.6; color:var(--text-2); }` `.srOnly` standard visually-hidden rule. `@media (max-width:640px) { .grid, .stats { grid-template-columns:repeat(2, minmax(0,1fr)); } .cell { border-bottom:1px solid var(--line); } }`.

## C6. Tests (vitest; component tests use the `// @vitest-environment jsdom` pragma and `createRoot` + `act` as in `terminal/lib/__tests__/CommandPalette.test.tsx`)

Build real inputs with `compareReportedGamma` from `@/lib/exposureReportedChange` using two small snapshots (read the file for required snapshot fields; members are `{ expiry, strike, right, valueUsd }`), plus hand-built malformed objects.

`terminal/lib/__tests__/exposureChangeInspector.test.ts` — at least:
- "builds a data model from a matched comparison with populations kept apart from the change"
- "sorts rows by absolute net magnitude change, ties by strike, and limits to the top K"
- "appends the focus strike after the top K and reports it as included but outside the top K"
- "reports more as the number of strikes beyond the top K"
- "clamps topK to 1..50"
- "returns single_session when only one session is present and unavailable with missing_basis when both are present without a comparison"
- "passes every unavailable reason through from the comparison"
- "returns invalid for a non-finite aggregate, a negative population count, a non-array byStrike and a wrong basis"
- "keeps velocity and percentChange null and never derives a rate"
- "echoes only canonical session dates"
- "formatUsdCompact formats thresholds, the minus sign, the plus sign and null"
`terminal/lib/__tests__/exposureChangeInspectorCopy.test.ts` — at least:
- "no English string in the inspector copy uses causal, predictive or dealer-behaviour vocabulary"
- "no Chinese string in the inspector copy uses causal, predictive or dealer-behaviour vocabulary"
- "every key has a non-empty English and Chinese string and the Chinese string contains CJK characters"
`terminal/lib/__tests__/ExposureChangeInspector.test.tsx` (jsdom) — at least:
- "renders the data state with populations, aggregate and rows in English and Chinese"
- "renders each non-data state with its status note and the velocity note"
- "marks the selected strike pressed and calls onSelectStrike with the strike"
- "flags the appended focus row and the more-strikes note"
- "renders no banned vocabulary in either language" (run both regexes from C3 over `container.textContent`).
