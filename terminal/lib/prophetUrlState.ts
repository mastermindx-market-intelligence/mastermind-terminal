/**
 * Prophet URL state — shareable deep links for the Prophet surface.
 *
 * TWO key families ride the route the surface is mounted on — canonical
 * `/prophet` or legacy `/options?tab=prophet` — so a deep link, a refresh,
 * and the browser back/forward buttons all restore the same investigation.
 * Invalid values degrade to defaults, never to an error page.
 *
 * Canonical `/prophet` — the Lane A contract (2026-11-12), fixed so the
 * Today / Sector / Company lanes could build in parallel:
 *   `tab`     the primary navigation: `today` (default) | `screener` |
 *             `plans` | `options` | `issue` | `sector`
 *   `sector`  the selected group id (sector journey / Today focus)
 *   `symbol`  the selected company symbol
 *   `sel`     REPEATABLE: the board's ordered compare-selection symbols
 * (plus the `prophet*` keys that predate the contract — `prophetPlan`,
 * `prophetQ`, `prophetState`, `prophetOffset`, `prophetFrom` — which stay the
 * wire form for their own dimensions). A NEW key beyond this contract goes
 * through the COO, not this file.
 *
 * The sector VIEW is not a separate canonical key: `symbol` IS the company
 * setup, `sector` IS that group's population, and neither is the picker. A
 * canonical link therefore carries ONE key set — `tab=sector&symbol=CARR`,
 * never a canonical/legacy mix — and the reader derives the view from the
 * contract keys (`impliedSectorView`). `prophetView` is written only for the
 * one state those keys cannot express (the picker with a group still in
 * context) and is still READ as an override, so links minted before this rule
 * keep working. No new key is introduced for it.
 *
 * Legacy `/options?tab=prophet` keeps the original `prophet*` family
 * exclusively (`prophetLane`, `prophetView`, `prophetGroup`, `prophetSymbol`,
 * `prophetPlan`, `prophetQ`, `prophetState`, `prophetOffset`, `prophetFrom`,
 * and the REPEATABLE `prophetSel` — the legacy spelling of the contract's
 * `sel`, so the same compare selection round-trips on either mount):
 * there the bare `tab` key belongs to the Options hub and must never be
 * written by this codec. Old links parse on both mounts — `prophetLane`'s
 * retired `macro` value (the model-plans desk) reads as the `plans` tab, and
 * `prophetGroup`/`prophetSymbol` are honored wherever `sector`/`symbol` are
 * absent. The legacy default is `plans` (the incumbent desk, unchanged); the
 * canonical default is `today`.
 *
 * `prophetFrom` is a validated return carrier: the sector route and exact
 * selection a reader departed from, so the Prophet investigation can end by
 * restoring the origin precisely. It is navigation context only — same-origin,
 * path-allowlisted, bounded; it grants no authority and can never become an
 * open redirect.
 */
import {
  PROPHET_MEMBER_STATES, SECTOR_MEMBERS_GROUP_ID, SECTOR_MEMBERS_QUERY, SECTOR_MEMBERS_SYMBOL,
  type ProphetMemberState,
} from "./prophetSectorMembers";

/** Keys this codec owns on the legacy mount (plus the hub's own `tab`). */
export const PROPHET_URL_KEYS = ["prophetLane", "prophetView", "prophetGroup", "prophetSymbol",
  "prophetPlan", "prophetQ", "prophetState", "prophetOffset", "prophetFrom", "prophetSel"] as const;
/** The Lane A contract keys this codec owns on the canonical `/prophet` mount. */
export const PROPHET_TAB_KEYS = ["tab", "sector", "symbol", "sel"] as const;

/** Primary navigation. `sector` is the sector journey lane (reached from
 * Today's research links and the Screener tab as well as directly); the
 * retired `macro` value parses as `plans`. */
export type ProphetLane = "today" | "screener" | "plans" | "options" | "issue" | "sector";
export const PROPHET_LANES: readonly ProphetLane[] = ["today", "screener", "plans", "options", "issue", "sector"];
/** Links minted before the Today board (≤ 2026-11-12) name the plans desk `macro`. */
const LEGACY_LANE_ALIASES: Readonly<Record<string, ProphetLane>> = { macro: "plans" };

/** Sector lane reading order (builder card G): overview (context+picker) →
 * population (SX04) → setup (SX03) → compare (T2-07/T2-13). Compare is its own
 * view, not "setup without a symbol": a compare address is self-describing and
 * a setup address always names a company. */
export type ProphetSectorViewMode = "overview" | "population" | "setup" | "compare";
export const PROPHET_SECTOR_VIEWS: readonly ProphetSectorViewMode[] = ["overview", "population", "setup", "compare"];

/** The sector view the canonical contract keys already imply: a symbol is the
 * company setup, a group is its member population, neither is the picker.
 * This is why a canonical link needs no separate view key — the address says
 * `tab=sector&symbol=CARR`, not `…&prophetView=setup`. The one state the keys
 * cannot express (the picker with a group still in context) still writes the
 * existing `prophetView` wire key; no new key is minted. */
export function impliedSectorView(group: string | null, symbol: string | null): ProphetSectorViewMode {
  if (symbol !== null) return "setup";
  if (group !== null) return "population";
  return "overview";
}

/** How the two mounts spell the state. Inferred from the URL's path when a
 * caller does not say; see `prophetMountForPathname`. */
export type ProphetMount = "canonical" | "legacy";

/** `/options…` is the legacy Options-hub mount (its `tab` is the hub's own);
 * every other path — `/prophet` today — is canonical. */
export function prophetMountForPathname(pathname: string): ProphetMount {
  return pathname === "/options" || pathname.startsWith("/options/") ? "legacy" : "canonical";
}

export type ProphetUrlState = {
  lane: ProphetLane;
  view: ProphetSectorViewMode;
  group: string | null;
  symbol: string | null;
  plan: string | null;
  q: string;
  state: ProphetMemberState | null;
  offset: number;
  from: ProphetReturnCarrier | null;
  /** Ordered unique compare-selection (`sel` on the canonical mount). */
  sel: string[];
};

export const DEFAULT_PROPHET_STATE: ProphetUrlState = {
  lane: "today", view: "overview", group: null, symbol: null,
  plan: null, q: "", state: null, offset: 0, from: null, sel: [],
};

/** The legacy mount keeps its incumbent default: the model-plans desk. */
export const DEFAULT_PROPHET_STATE_LEGACY: ProphetUrlState = { ...DEFAULT_PROPHET_STATE, lane: "plans" };

/** Repeatable `sel` ceiling — a compare selection is a handful of names, and a
 * hand-edited URL must not mint an unbounded array. */
export const PROPHET_SEL_MAX = 12;

/** Plan ids the Prophet board selects (`SBUX-BULL-20260702`). */
const PLAN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A lawful `sel` entry is a lawful symbol; order is preserved, duplicates and
 * overflow drop, invalid entries degrade away (never to an error page). */
export function parseProphetSel(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const sel: string[] = [];
  for (const value of values) {
    if (sel.length >= PROPHET_SEL_MAX) break;
    if (!SECTOR_MEMBERS_SYMBOL.test(value) || seen.has(value)) continue;
    seen.add(value);
    sel.push(value);
  }
  return sel;
}

/** Toggle one symbol in a compare selection (pure — callers write the result
 * back through `update({ sel })`). Appends at the end, removal keeps order. */
export function toggleProphetSel(sel: readonly string[], symbol: string): string[] {
  if (!SECTOR_MEMBERS_SYMBOL.test(symbol)) return [...sel];
  const next = sel.filter(entry => entry !== symbol);
  if (next.length === sel.length && next.length < PROPHET_SEL_MAX) next.push(symbol);
  return next;
}

// ── Return carrier ──────────────────────────────────────────────────────────

export const PROPHET_FROM_PARAM = "prophetFrom";
export const PROPHET_FROM_VERSION = 1 as const;
export const PROPHET_FROM_MAX_ENCODED = 2048;
export const PROPHET_FROM_MAX_HREF = 1800;
/** The only same-origin destinations a return may target: the Sector
 * Intelligence surface (canonical route and legacy mount). */
const FROM_PATH_PATTERN = /^\/(sectors|discover)(?=$|\?)/;

export type ProphetReturnCarrier = { v: 1; kind: "sector"; href: string };

/** A carrier href is admissible when it is a bounded, same-origin relative
 * sector URL: allowlisted path, no protocol-relative tricks, no hash, no
 * control characters — and the legacy mount must name the sectors tab. */
export function prophetFromHrefAdmissible(href: string): boolean {
  if (typeof href !== "string" || href.length < 1 || href.length > PROPHET_FROM_MAX_HREF) return false;
  if (!FROM_PATH_PATTERN.test(href)) return false;
  if (href.includes("//") || href.includes("\\") || href.includes("#")) return false;
  if (/[\u0000- ]/.test(href)) return false;
  const queryAt = href.indexOf("?");
  if (href.startsWith("/discover")) {
    const params = new URLSearchParams(queryAt === -1 ? "" : href.slice(queryAt + 1));
    if (params.get("tab") !== "sectors" || params.getAll("tab").length !== 1) return false;
  }
  return true;
}

/** Decode + validate a `prophetFrom` param value. Null for anything outside
 * the envelope — the surface then simply shows no return control. */
export function parseProphetFrom(raw: string | null | undefined): ProphetReturnCarrier | null {
  if (raw === null || raw === undefined) return null;
  if (encodeURIComponent(raw).length > PROPHET_FROM_MAX_ENCODED) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const carrier = value as Partial<ProphetReturnCarrier>;
  if (carrier.v !== PROPHET_FROM_VERSION || carrier.kind !== "sector") return null;
  if (typeof carrier.href !== "string" || !prophetFromHrefAdmissible(carrier.href)) return null;
  return { v: 1, kind: "sector", href: carrier.href };
}

/** Build the carrier's wire form from a sector page's own location. Null when
 * the origin is not an admissible sector surface or the envelope would exceed
 * its budget — the caller then links without a return control rather than
 * dropping the user somewhere unvalidated. The wire form is the RAW JSON: the
 * URL serializer percent-encodes it exactly once (pre-encoding here would
 * double-encode through URLSearchParams and read back undecodable). */
export function encodeProphetFrom(pathname: string, search: string): string | null {
  const href = `${pathname}${search.startsWith("?") ? search : search ? `?${search}` : ""}`;
  if (!prophetFromHrefAdmissible(href)) return null;
  const raw = JSON.stringify({ v: 1, kind: "sector", href });
  return encodeURIComponent(raw).length > PROPHET_FROM_MAX_ENCODED ? null : raw;
}

/** The return address as a link renders it — the validated relative href. */
export function prophetFromReturnHref(carrier: ProphetReturnCarrier): string {
  return carrier.href;
}

// ── State codec ─────────────────────────────────────────────────────────────

const laneOf = (raw: string | null): ProphetLane | null => {
  if (raw === null) return null;
  if ((PROPHET_LANES as readonly string[]).includes(raw)) return raw as ProphetLane;
  return LEGACY_LANE_ALIASES[raw] ?? null;
};

export function parseProphetState(params: URLSearchParams, mount: ProphetMount = "canonical"): ProphetUrlState {
  // Lane/tab: on the canonical mount the contract's `tab` wins; a legacy
  // `prophetLane` still carries the choice (and `macro` still means plans).
  // On the legacy mount the bare `tab` is the Options hub's own — never ours.
  const lane = laneOf(params.get(mount === "canonical" && params.has("tab") ? "tab" : "prophetLane"))
    ?? (mount === "canonical" ? laneOf(params.get("prophetLane")) : null)
    ?? (mount === "canonical" ? DEFAULT_PROPHET_STATE.lane : DEFAULT_PROPHET_STATE_LEGACY.lane);
  const group = mount === "canonical" ? params.get("sector") ?? params.get("prophetGroup") : params.get("prophetGroup");
  const symbol = mount === "canonical" ? params.get("symbol") ?? params.get("prophetSymbol") : params.get("prophetSymbol");
  const admittedGroup = group !== null && SECTOR_MEMBERS_GROUP_ID.test(group) ? group : null;
  const admittedSymbol = symbol !== null && SECTOR_MEMBERS_SYMBOL.test(symbol) ? symbol : null;
  // The view: an explicit `prophetView` (a link minted before the contract, or
  // the picker-with-context state) always wins; otherwise the canonical mount
  // derives it from the contract keys, so a canonical link never mixes families.
  const view = params.get("prophetView");
  const admittedView = (PROPHET_SECTOR_VIEWS as readonly string[]).includes(view ?? "")
    ? view as ProphetSectorViewMode
    : null;
  const plan = params.get("prophetPlan");
  const q = params.get("prophetQ") ?? "";
  const state = params.get("prophetState");
  const offset = params.get("prophetOffset");
  // The compare selection is the contract's `sel` on canonical and the
  // `prophetSel` spelling on legacy; a canonical link that only carries the
  // legacy spelling still reads (the same precedence the group keys use).
  const selValues = mount === "canonical" && params.has("sel")
    ? params.getAll("sel")
    : params.getAll("prophetSel");
  return {
    lane,
    view: admittedView ?? (mount === "canonical" ? impliedSectorView(admittedGroup, admittedSymbol) : DEFAULT_PROPHET_STATE.view),
    group: admittedGroup,
    symbol: admittedSymbol,
    plan: plan !== null && PLAN_ID.test(plan) ? plan : null,
    q: q !== "" && SECTOR_MEMBERS_QUERY.test(q) ? q : "",
    state: state !== null && (PROPHET_MEMBER_STATES as readonly string[]).includes(state) ? state as ProphetMemberState : null,
    offset: offset !== null && /^\d{1,7}$/.test(offset) && Number(offset) <= 1_000_000 ? Number(offset) : 0,
    from: params.getAll(PROPHET_FROM_PARAM).length > 1 ? null : parseProphetFrom(params.get(PROPHET_FROM_PARAM)),
    sel: parseProphetSel(selValues),
  };
}

/** Write the state onto a URL the caller owns. The mount decides the key
 * family — canonical writes the Lane A contract (`tab`/`sector`/`symbol`/
 * `sel`) and the surviving `prophet*` dimensions; legacy writes only the
 * `prophet*` family so the hub's own `tab` is never clobbered. Defaults are
 * restored by parseProphetState and stay OUT of the address so shared links
 * keep their width budget; foreign params are preserved. */
export function writeProphetState(url: URL, state: ProphetUrlState, mount?: ProphetMount): string {
  const resolved = mount ?? prophetMountForPathname(url.pathname);
  if (resolved === "canonical") {
    if (state.lane !== DEFAULT_PROPHET_STATE.lane) url.searchParams.set("tab", state.lane);
    else url.searchParams.delete("tab");
    if (state.group !== null) url.searchParams.set("sector", state.group);
    else url.searchParams.delete("sector");
    if (state.symbol !== null) url.searchParams.set("symbol", state.symbol);
    else url.searchParams.delete("symbol");
    url.searchParams.delete("sel");
    for (const entry of state.sel) url.searchParams.append("sel", entry);
    // Superseded by the contract keys; scrubbed so an old link's stale values
    // can never fight the canonical ones.
    url.searchParams.delete("prophetLane");
    url.searchParams.delete("prophetGroup");
    url.searchParams.delete("prophetSymbol");
    url.searchParams.delete("prophetSel");
  } else {
    // The legacy family keeps the incumbent key ORDER (lane, view, group,
    // symbol, plan, …): deep links minted before the contract — the sector
    // side's Prophet entry among them — are compared as strings, so a
    // reordered write is a visible change even when the state is identical.
    if (state.lane !== DEFAULT_PROPHET_STATE_LEGACY.lane) url.searchParams.set("prophetLane", state.lane);
    else url.searchParams.delete("prophetLane");
    if (state.view !== DEFAULT_PROPHET_STATE.view) url.searchParams.set("prophetView", state.view);
    else url.searchParams.delete("prophetView");
    if (state.group !== null) url.searchParams.set("prophetGroup", state.group);
    else url.searchParams.delete("prophetGroup");
    if (state.symbol !== null) url.searchParams.set("prophetSymbol", state.symbol);
    else url.searchParams.delete("prophetSymbol");
    if (state.plan !== null) url.searchParams.set("prophetPlan", state.plan);
    else url.searchParams.delete("prophetPlan");
    if (state.q !== "") url.searchParams.set("prophetQ", state.q);
    else url.searchParams.delete("prophetQ");
    if (state.state !== null) url.searchParams.set("prophetState", state.state);
    else url.searchParams.delete("prophetState");
    if (state.offset !== 0) url.searchParams.set("prophetOffset", String(state.offset));
    else url.searchParams.delete("prophetOffset");
    const from = state.from !== null
      ? JSON.stringify({ v: state.from.v, kind: state.from.kind, href: state.from.href })
      : null;
    if (from !== null && encodeURIComponent(from).length <= PROPHET_FROM_MAX_ENCODED) {
      url.searchParams.set(PROPHET_FROM_PARAM, from);
    } else url.searchParams.delete(PROPHET_FROM_PARAM);
    // The compare selection keeps its own spelling here: repeatable
    // `prophetSel`, appended last so the older keys keep their positions. The
    // bare contract keys never ride the legacy mount, and the hub's own `tab`
    // (already `prophet` on this route) is never this codec's to touch.
    url.searchParams.delete("prophetSel");
    for (const entry of state.sel) url.searchParams.append("prophetSel", entry);
    return url.pathname + url.search + url.hash;
  }
  // Canonical: the contract keys first (tab, sector, symbol, repeatable sel),
  // then the surviving `prophet*` dimensions. The sector view is NOT written
  // when the contract keys already imply it — `tab=sector&symbol=CARR` is the
  // setup link, `tab=sector&sector=housing` the population link — so one link
  // carries one key set. Only the picker-with-context state (overview while a
  // group is still selected) needs the existing `prophetView` override; the
  // reader treats any explicit value as authoritative, so old links keep
  // working and a stale redundant key is scrubbed on the next write.
  if (state.view !== impliedSectorView(state.group, state.symbol)) url.searchParams.set("prophetView", state.view);
  else url.searchParams.delete("prophetView");
  if (state.plan !== null) url.searchParams.set("prophetPlan", state.plan);
  else url.searchParams.delete("prophetPlan");
  if (state.q !== "") url.searchParams.set("prophetQ", state.q);
  else url.searchParams.delete("prophetQ");
  if (state.state !== null) url.searchParams.set("prophetState", state.state);
  else url.searchParams.delete("prophetState");
  if (state.offset !== 0) url.searchParams.set("prophetOffset", String(state.offset));
  else url.searchParams.delete("prophetOffset");
  const from = state.from !== null
    ? JSON.stringify({ v: state.from.v, kind: state.from.kind, href: state.from.href })
    : null;
  if (from !== null && encodeURIComponent(from).length <= PROPHET_FROM_MAX_ENCODED) {
    url.searchParams.set(PROPHET_FROM_PARAM, from);
  } else url.searchParams.delete(PROPHET_FROM_PARAM);
  return url.pathname + url.search + url.hash;
}

/** A Prophet deep link targeting the mount family the reader is on: canonical
 * `/prophet` (shared shell) or legacy `/options?tab=prophet`. */
export function prophetHref(state: ProphetUrlState, mount: "canonical" | "legacy"): string {
  const base = mount === "canonical" ? new URL("https://local.invalid/prophet") : new URL("https://local.invalid/options");
  if (mount === "legacy") base.searchParams.set("tab", "prophet");
  return writeProphetState(base, state, mount).replace(/^https:\/\/local\.invalid/, "");
}
