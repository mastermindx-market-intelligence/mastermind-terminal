/**
 * Prophet URL state — shareable deep links for the Prophet surface.
 *
 * The codec owns the `prophet*` query family (`prophetLane`, `prophetView`,
 * `prophetGroup`, `prophetSymbol`, `prophetPlan`, `prophetQ`, `prophetState`,
 * `prophetOffset`, `prophetFrom`). It rides the route the surface is mounted
 * on — canonical `/prophet` or legacy `/options?tab=prophet` — so a deep link,
 * a refresh, and the browser back/forward buttons all restore the same
 * investigation. Invalid values degrade to defaults, never to an error page.
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

export const PROPHET_URL_KEYS = ["prophetLane", "prophetView", "prophetGroup", "prophetSymbol",
  "prophetPlan", "prophetQ", "prophetState", "prophetOffset", "prophetFrom"] as const;

export type ProphetLane = "macro" | "options" | "issue" | "sector";
export const PROPHET_LANES: readonly ProphetLane[] = ["macro", "options", "issue", "sector"];
/** Sector lane reading order (builder card G): overview (context+picker) →
 * population (SX04) → setup (SX03). */
export type ProphetSectorViewMode = "overview" | "population" | "setup";
export const PROPHET_SECTOR_VIEWS: readonly ProphetSectorViewMode[] = ["overview", "population", "setup"];

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
};

export const DEFAULT_PROPHET_STATE: ProphetUrlState = {
  lane: "macro", view: "overview", group: null, symbol: null,
  plan: null, q: "", state: null, offset: 0, from: null,
};

/** Plan ids the Prophet board selects (`SBUX-BULL-20260702`). */
const PLAN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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
 * dropping the user somewhere unvalidated. */
export function encodeProphetFrom(pathname: string, search: string): string | null {
  const href = `${pathname}${search.startsWith("?") ? search : search ? `?${search}` : ""}`;
  if (!prophetFromHrefAdmissible(href)) return null;
  const encoded = encodeURIComponent(JSON.stringify({ v: 1, kind: "sector", href }));
  return encoded.length > PROPHET_FROM_MAX_ENCODED ? null : encoded;
}

/** The return address as a link renders it — the validated relative href. */
export function prophetFromReturnHref(carrier: ProphetReturnCarrier): string {
  return carrier.href;
}

// ── State codec ─────────────────────────────────────────────────────────────

export function parseProphetState(params: URLSearchParams): ProphetUrlState {
  const lane = params.get("prophetLane");
  const view = params.get("prophetView");
  const group = params.get("prophetGroup");
  const symbol = params.get("prophetSymbol");
  const plan = params.get("prophetPlan");
  const q = params.get("prophetQ") ?? "";
  const state = params.get("prophetState");
  const offset = params.get("prophetOffset");
  return {
    lane: (PROPHET_LANES as readonly string[]).includes(lane ?? "") ? lane as ProphetLane : "macro",
    view: (PROPHET_SECTOR_VIEWS as readonly string[]).includes(view ?? "") ? view as ProphetSectorViewMode : "overview",
    group: group !== null && SECTOR_MEMBERS_GROUP_ID.test(group) ? group : null,
    symbol: symbol !== null && SECTOR_MEMBERS_SYMBOL.test(symbol) ? symbol : null,
    plan: plan !== null && PLAN_ID.test(plan) ? plan : null,
    q: q !== "" && SECTOR_MEMBERS_QUERY.test(q) ? q : "",
    state: state !== null && (PROPHET_MEMBER_STATES as readonly string[]).includes(state) ? state as ProphetMemberState : null,
    offset: offset !== null && /^\d{1,7}$/.test(offset) && Number(offset) <= 1_000_000 ? Number(offset) : 0,
    from: params.getAll(PROPHET_FROM_PARAM).length > 1 ? null : parseProphetFrom(params.get(PROPHET_FROM_PARAM)),
  };
}

/** Write the `prophet*` family onto a URL the caller owns. Defaults are
 * restored by parseProphetState and stay OUT of the address so shared links
 * keep their width budget; non-prophet params (e.g. `tab`) are preserved. */
export function writeProphetState(url: URL, state: ProphetUrlState): string {
  if (state.lane !== DEFAULT_PROPHET_STATE.lane) url.searchParams.set("prophetLane", state.lane);
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
    ? encodeURIComponent(JSON.stringify({ v: state.from.v, kind: state.from.kind, href: state.from.href }))
    : null;
  if (from !== null && from.length <= PROPHET_FROM_MAX_ENCODED) url.searchParams.set(PROPHET_FROM_PARAM, from);
  else url.searchParams.delete(PROPHET_FROM_PARAM);
  return url.pathname + url.search + url.hash;
}

/** A Prophet deep link targeting the mount family the reader is on: canonical
 * `/prophet` (shared shell) or legacy `/options?tab=prophet`. */
export function prophetHref(state: ProphetUrlState, mount: "canonical" | "legacy"): string {
  const base = mount === "canonical" ? new URL("https://local.invalid/prophet") : new URL("https://local.invalid/options");
  if (mount === "legacy") base.searchParams.set("tab", "prophet");
  return writeProphetState(base, state).replace(/^https:\/\/local\.invalid/, "");
}
