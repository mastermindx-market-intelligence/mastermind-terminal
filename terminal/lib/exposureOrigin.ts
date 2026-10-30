import { parseSectorState, writeSectorState, type MemberSort, type SectorState } from "@/lib/sectorIntelligence";

/** Where an Exposure reading came from: a Sector Central holding, carried so the
 * reader can step the same cohort and return to the exact selection. The envelope
 * travels in its own query parameter, never inside the `#exposure=` chart hash.
 * It is navigation context only: it grants neither source access nor authority.
 */
export const EXPOSURE_ORIGIN_PARAM = "origin";
export const EXPOSURE_ORIGIN_VERSION = 1 as const;
export const EXPOSURE_ORIGIN_MAX_ENCODED = 1024;
export const EXPOSURE_ORIGIN_MAX_RETURN = 512;
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

const KEY_PATTERN = /^[a-z][a-z0-9_-]{0,79}$/;
const TICKER_PATTERN = /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/;
const HASH_PATTERN = /^[A-Za-z0-9:_.-]{8,128}$/;
const SORTS: readonly MemberSort[] = ["source", "return", "relative", "ticker"];
const ORIGIN_ORDER = ["v", "kind", "returnHref", "sector", "group", "company", "index", "count", "sort", "query", "asOf", "contentHash", "method", "benchmark"] as const;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_URL = "https://mastermind.invalid/discover";
const RETURN_PREFIX = "/discover?";

/** Canonical YYYY-MM-DD that survives Date.UTC (2026-02-30 does not exist). */
const calendarDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !DAY_PATTERN.test(value)) return false;
  const parsed = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))));
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const isTickerLike = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 20 && TICKER_PATTERN.test(value);

/** The return address must stay a bounded relative /discover selection that reads
 * back into exactly the sector state this envelope claims to come from. */
function returnHrefMatches(origin: ExposureOrigin): boolean {
  const href = origin.returnHref;
  if (typeof href !== "string" || href.length < 1 || href.length > EXPOSURE_ORIGIN_MAX_RETURN) return false;
  if (!href.startsWith(RETURN_PREFIX)) return false;
  if (href.includes("#") || href.includes("\\") || href.includes("//") || /\s/.test(href) || /[\u0000-\u001f]/.test(href)) return false;
  const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
  if (params.get("tab") !== "sectors") return false;
  const state = parseSectorState(params);
  return state.sector === origin.sector && state.group === origin.group
    && state.sort === origin.sort && state.query === origin.query && state.company === origin.company;
}

export function isExposureOrigin(value: unknown): value is ExposureOrigin {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Object.keys(value).length !== ORIGIN_ORDER.length || !ORIGIN_ORDER.every(key => Object.hasOwn(value, key))) return false;
  const origin = value as ExposureOrigin;
  if (origin.v !== EXPOSURE_ORIGIN_VERSION || origin.kind !== "sector" || origin.method !== EXPOSURE_ORIGIN_METHOD) return false;
  if (!returnHrefMatches(origin)) return false;
  if (typeof origin.sector !== "string" || !KEY_PATTERN.test(origin.sector)) return false;
  if (typeof origin.group !== "string" || !KEY_PATTERN.test(origin.group)) return false;
  if (!isTickerLike(origin.company)) return false;
  if (origin.count !== null && (!Number.isSafeInteger(origin.count) || origin.count < 1 || origin.count > EXPOSURE_ORIGIN_MAX_COUNT)) return false;
  if (origin.index !== null && (!Number.isSafeInteger(origin.index) || origin.index < 0 || origin.count === null || origin.index >= origin.count)) return false;
  if (!SORTS.includes(origin.sort)) return false;
  if (typeof origin.query !== "string" || origin.query.length > 40) return false;
  if (origin.asOf !== null && !calendarDay(origin.asOf)) return false;
  if (origin.contentHash !== null && (typeof origin.contentHash !== "string" || !HASH_PATTERN.test(origin.contentHash))) return false;
  if (origin.benchmark !== null && !isTickerLike(origin.benchmark)) return false;
  return true;
}

export function parseExposureOrigin(search: string | URLSearchParams | null | undefined): ExposureOrigin | null {
  try {
    const params = search instanceof URLSearchParams ? search : new URLSearchParams(typeof search === "string" ? search : "");
    // URLSearchParams already decoded the wire form once; the cap is on the wire length.
    const raw = params.get(EXPOSURE_ORIGIN_PARAM);
    if (raw === null || encodeURIComponent(raw).length > EXPOSURE_ORIGIN_MAX_ENCODED) return null;
    const value: unknown = JSON.parse(raw);
    return isExposureOrigin(value) ? value : null;
  } catch { return null; }
}

export function encodeExposureOrigin(origin: ExposureOrigin): string | null {
  if (!isExposureOrigin(origin)) return null;
  const encoded = encodeURIComponent(JSON.stringify({
    v: origin.v, kind: origin.kind, returnHref: origin.returnHref, sector: origin.sector, group: origin.group,
    company: origin.company, index: origin.index, count: origin.count, sort: origin.sort, query: origin.query,
    asOf: origin.asOf, contentHash: origin.contentHash, method: origin.method, benchmark: origin.benchmark,
  }));
  return encoded.length > EXPOSURE_ORIGIN_MAX_ENCODED ? null : encoded;
}

export function withExposureOrigin(href: string, origin: ExposureOrigin | null): string {
  if (origin === null) return href;
  const encoded = encodeExposureOrigin(origin);
  if (encoded === null) return href;
  const hashAt = href.indexOf("#");
  const base = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const queryAt = base.indexOf("?");
  const path = queryAt === -1 ? base : base.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? "" : base.slice(queryAt + 1));
  params.delete(EXPOSURE_ORIGIN_PARAM);
  // `encoded` is already the wire form; appending it raw keeps the URL single-encoded.
  const search = params.toString();
  return `${path}?${search ? `${search}&` : ""}${EXPOSURE_ORIGIN_PARAM}=${encoded}${hash}`;
}

/** The return address as a link renders it: the constant /discover path followed by the
 * validated selection query, never the wire string itself. isExposureOrigin guarantees the
 * prefix, so for any accepted envelope this is byte-identical to returnHref. */
export function exposureOriginReturnHref(origin: ExposureOrigin): string {
  return `/discover?${origin.returnHref.slice(RETURN_PREFIX.length)}`;
}

export function stripExposureOrigin(href: string): string {
  const hashAt = href.indexOf("#");
  const base = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const queryAt = base.indexOf("?");
  const path = queryAt === -1 ? base : base.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? "" : base.slice(queryAt + 1));
  params.delete(EXPOSURE_ORIGIN_PARAM);
  const search = params.toString();
  return `${path}${search ? `?${search}` : ""}${hash}`;
}

export function sectorOriginFromState(input: {
  state: SectorState; company: string; roster: readonly string[];
  asOf: string | null; contentHash: string | null; benchmark: string | null;
}): ExposureOrigin | null {
  const { state, company, roster } = input;
  if (!isTickerLike(company)) return null;
  const written = writeSectorState(new URL(LOCAL_URL), { ...state, company });
  const hashAt = written.indexOf("#");
  const returnHref = hashAt === -1 ? written : written.slice(0, hashAt);
  if (returnHref.length < 1 || returnHref.length > EXPOSURE_ORIGIN_MAX_RETURN) return null;
  const at = roster.indexOf(company);
  const count = roster.length >= 1 && roster.length <= EXPOSURE_ORIGIN_MAX_COUNT ? roster.length : null;
  const origin: ExposureOrigin = {
    v: EXPOSURE_ORIGIN_VERSION, kind: "sector", returnHref, sector: state.sector, group: state.group,
    company, index: count !== null && at >= 0 ? at : null, count, sort: state.sort, query: state.query,
    asOf: calendarDay(input.asOf) ? input.asOf : null,
    contentHash: input.contentHash !== null && HASH_PATTERN.test(input.contentHash) ? input.contentHash : null,
    method: EXPOSURE_ORIGIN_METHOD,
    benchmark: isTickerLike(input.benchmark) ? input.benchmark : null,
  };
  return isExposureOrigin(origin) ? origin : null;
}

export function exposureOriginStep(origin: ExposureOrigin, roster: readonly string[], direction: -1 | 1): { company: string; index: number } | null {
  if (origin.index === null || roster[origin.index] !== origin.company) return null;
  const target = origin.index + direction;
  if (target < 0 || target >= roster.length) return null;
  return { company: roster[target], index: target };
}

export function exposureOriginRosterState(origin: ExposureOrigin, receipt: { contentHash: string | null } | null, roster: readonly string[] | null): ExposureOriginRosterState {
  if (receipt === null || roster === null) return "unavailable";
  if (receipt.contentHash !== null && origin.contentHash === receipt.contentHash
    && (origin.index === null || roster[origin.index] === origin.company)) return "exact";
  return "changed";
}

export function exposureOriginForCompany(origin: ExposureOrigin, company: string, index: number): ExposureOrigin {
  const state = parseSectorState(new URLSearchParams(origin.returnHref.slice(origin.returnHref.indexOf("?") + 1)));
  const written = writeSectorState(new URL(LOCAL_URL), { ...state, company });
  const hashAt = written.indexOf("#");
  const candidate: ExposureOrigin = { ...origin, company, index, returnHref: hashAt === -1 ? written : written.slice(0, hashAt) };
  return isExposureOrigin(candidate) ? candidate : origin;
}
