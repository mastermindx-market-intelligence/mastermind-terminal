/**
 * flowSource.ts — shared server-side data path for the flow feed.
 *
 * Extracted from app/api/flow/route.ts so BOTH the polling GET endpoint and the
 * SSE streaming endpoint (app/api/flow/stream) resolve a payload through one code
 * path: fixture in dev (FLOW_FIXTURE=1), else Python backend → R2 CDN fallback (the
 * Options Prophet published index is R2-first), with
 * the proprietary server-side flowScore attached to the main feed.
 *
 * SERVER-ONLY. Imports fs + the server-only flowScore model — never import from a
 * 'use client' component. See SECURITY.md: the flow_score_v1 weights must not reach
 * the client bundle; attachFlowScores strips them before the payload leaves the box.
 */
import { promises as fs } from "fs";
import path from "path";
import { computeFlowScore, type ScorerInput } from "@/lib/flowScore";
import { FLOW_BACKEND as BACKEND, R2_BASE } from "@/lib/upstreams";
import { type Bar6, tfMinutes, resample, sessionEpoch } from "@/lib/intradayShared";

const FIXTURE_FILE = path.join(process.cwd(), "public", "data", "flow_fixture.json");
const TIDE_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "tide_fixture.json");
const TICKER_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "ticker_fixture.json");
const DTE_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "dte_fixture.json");
const VOL_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "vol_fixture.json");
const GEX_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "gex_fixture.json");
const LEVELS_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "levels_fixture.json");
const AGG_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "agg_fixture.json");
const QUAD_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "quad_fixture.json");
const GRADES_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "grades_fixture.json");
const SCREENER_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "screener_fixture.json");
const CTX_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "ctx_fixture.json");
const LEADERS_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "flow_leaders_fixture.json");
const LEADER_RADAR_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "leader_radar_fixture.json");
const TCTX_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "tctx_fixture.json");
const OICONF_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "oiconf_fixture.json");
const CHAINHEAT_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "chain_heat_fixture.json");
const GEXSTATE_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "gexstate_fixture.json");
const GEXSTATE_INDEX_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "gexstate_index_fixture.json");
const MATRIX_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "matrix_fixture.json");
// Kept as a small companion because matrix_fixture.json is a generated, minified
// multi-root snapshot. The fixture seam overlays ONLY exact (strike,expiry) `unusual`
// annotations; production reads the publisher's flat MatrixDoc directly.
const MATRIX_UNUSUAL_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "matrix_unusual_fixture.json");
const MANIFEST_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "manifest.json");
const PROPHET_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "prophet_fixture.json");
const PROPHET_MARKS_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "prophet_marks_fixture.json");
const OPTIONS_PROPHET_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "options_prophet_fixture.json");
const ENRICH_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "enrich_fixture.json");
const FLOW_IDX_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "flow_idx_fixture.json");
const SURFACE_IDX_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "surface_idx_fixture.json");
const SURFACE_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "surface_fixture.json");
const SURFACE_DATES_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "surface_dates_fixture.json");
const GEX_DATES_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "gex_dates_fixture.json");
// EOD context belt (OEU T-E) — settled-close artifacts mirrored from the macro estate.
const DARKPOOL_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "darkpool_fixture.json");
const VOLREGIME_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "volregime_fixture.json");
const MOVES_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "moves_fixture.json");
// R3 OI suite (Structure tab) — nightly options_hub oi_time/max_pain/oi_change payloads.
const OI_TIME_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "oi_time_fixture.json");
const MAX_PAIN_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "max_pain_fixture.json");
const OI_CHANGE_FIXTURE_FILE = path.join(process.cwd(), "public", "data", "oi_change_fixture.json");


/**
 * A syntactically valid option root, for f-params whose tail is interpolated into a
 * backend path or an R2 object key.
 *
 * ⚠️ SECURITY, not tidiness. Before this existed, `isValidF` accepted ANY non-empty
 * string after `gex:` / `vol:` / `matrix:` / `agg:` / … and `backendPath` / `r2Key`
 * interpolated it raw. `gex:../../admin/secrets` normalises away the `..` segments at
 * fetch time and reads an arbitrary backend endpoint or R2 object — and because the
 * route caches by the f-param string, the result is then served from the shared
 * server-side CACHE under the attacker's key. Path traversal plus cache poisoning from
 * one query parameter.
 *
 * Roots are uppercase alphanumerics with an optional dot or hyphen inside (BRK.B,
 * RDS-A) — never a slash, a dot-dot, a space or a percent escape. 12 chars matches the
 * ticker input's own maxLength.
 */
const ROOT_RE = /^[A-Z0-9]{1,10}(?:[.-][A-Z0-9]{1,4})?$/;

export function isValidRoot(root: string): boolean {
  return root.length > 0 && root.length <= 12 && ROOT_RE.test(root);
}

/** A date segment in a dated f-param. Same reasoning as isValidRoot. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Valid f-param values: existing feed|heat|meta, plus hub params.
// Parameterized sub-types: tide, dte, ticker:{ROOT}, vol:{ROOT}, gex:{ROOT}, oi, hot
export function isValidF(f: string): boolean {
  if (["feed", "heat", "meta", "tide", "dte", "oi", "hot", "ctx", "oiconf", "chainheat"].includes(f)) return true;
  // EOD context belt (OEU T-E). `darkpool` and `volregime` are whole-file artifacts the
  // macro nightly mirrors (scripts/mirror_terminal_context_r2.py); `moves:{ROOT}` is the
  // per-root expected-move band, already published beside gex/vol in the options_hub plane.
  if (f === "darkpool" || f === "volregime") return true;
  if (f.startsWith("moves:")) return isValidRoot(f.slice(6));
  // R3 OI suite (Structure tab). `oi_change` bare = the cross-root board; the
  // root-keyed forms are per-root payloads. All prefixes are disjoint from the
  // exact-match `oi` (oi_movers) above — no overload, no prefix arithmetic.
  if (f === "oi_change") return true;
  if (f.startsWith("oi_time:")) return isValidRoot(f.slice(8));
  if (f.startsWith("max_pain:")) return isValidRoot(f.slice(9));
  if (f.startsWith("oi_change:")) return isValidRoot(f.slice(10));
  if (f.startsWith("ticker:")) return isValidRoot(f.slice(7));
  if (f.startsWith("vol:")) return isValidRoot(f.slice(4));
  if (f.startsWith("gex:")) return isValidRoot(f.slice(4));
  // Named gamma-level weather map. The producer publishes one levels.v1 document
  // per root at levels/{ROOT}.json; keep the root validator on this path just as
  // strictly as the neighboring gex/vol planes.
  if (f.startsWith("levels:")) return isValidRoot(f.slice(7));
  // Aggregate greek trend (Volland parity W2) — options_hub.aggtrend/v1, one row per
  // session back to 2017. Prefix is disjoint from every `gex*` form above.
  if (f.startsWith("agg:")) return isValidRoot(f.slice(4));
  // Cross-root positioning board (W3). A whole-file artifact, deliberately NOT under
  // the `agg:` prefix — `agg:quad` would be a legal-looking read for a root named quad.
  if (f === "quad") return true;
  // Level Report Card (MSC R2.4): per-root scorecard + the cross-universe aggregate.
  // `_universe` is NOT a root (isValidRoot rejects the underscore), so it gets its own
  // literal f — a wildcard through the root form could smuggle path segments.
  if (f.startsWith("grades:")) return isValidRoot(f.slice(7));
  if (f === "grades_universe") return true;
  // Dated GEX-ladder history (R0.10): the sessions index + the per-date full ladder
  // (options_hub/gex_history — WP-GEX-SNAPSHOTS, accruing since 2026-07-16). Distinct
  // prefixes from `gex:` — the 4th char is `_`, not `:` — so neither form can be eaten
  // by the live read (the surface_idx/surface_idx_at rule, one plane over).
  if (f.startsWith("gex_dates:")) return isValidRoot(f.slice(10));
  if (f.startsWith("gex_at:")) {
    const [, root, date] = f.split(":");
    return f.split(":").length === 3 && isValidRoot(root ?? "") && DATE_RE.test(date ?? "");
  }
  if (f.startsWith("tctx:")) return isValidRoot(f.slice(5));
  if (f.startsWith("gexstate:")) return isValidRoot(f.slice(9));
  // R3.2/R3.3: the cross-root positioning aggregate (screener columns, watchlist dot,
  // ticker block). `_index` is NOT a root (underscore), so it gets its own literal f —
  // same reasoning as grades_universe. Disjoint from `gexstate:` (char 9 is `_` vs `:`).
  if (f === "gexstate_index") return true;
  if (f.startsWith("matrix:")) return isValidRoot(f.slice(7));
  // Surface replay store: surface_idx:{ROOT} (frame index) + surface:{ROOT}:{STAMP} (one frame).
  if (f.startsWith("surface_idx:")) return isValidRoot(f.slice(12));
  if (f.startsWith("surface:")) {
    const [, root, stamp] = f.split(":");
    return f.split(":").length === 3 && isValidRoot(root ?? "") && /^[A-Za-z0-9_-]{1,32}$/.test(stamp ?? "");
  }
  // Multi-day replay (macro #3499): the sessions index + the date-keyed copies of the two
  // keys above. `surface_dates:` is one prefix; the dated reads carry an extra DATE segment,
  // so they are distinct prefixes rather than an overload — `surface_idx_at:` cannot be
  // mistaken for `surface_idx:` (12th char `_` vs `:`) and `surface_at:` never matches
  // `surface:`. Legacy today-paths above are untouched and remain the LIVE read.
  if (f.startsWith("surface_dates:")) return isValidRoot(f.slice(14));
  if (f.startsWith("surface_idx_at:")) {
    const [, root, date] = f.split(":");
    return f.split(":").length === 3 && isValidRoot(root ?? "") && DATE_RE.test(date ?? "");
  }
  if (f.startsWith("surface_at:")) {
    const [, root, date, stamp] = f.split(":");
    return f.split(":").length === 4 && isValidRoot(root ?? "") && DATE_RE.test(date ?? "")
      && /^[A-Za-z0-9_-]{1,32}$/.test(stamp ?? "");
  }
  if (f === "manifest") return true;
  if (f === "flow_idx") return true;
  if (f === "prophet_idx") return true;
  if (f === "prophet_marks") return true;
  if (f === "options_prophet_idx") return true;
  if (f === "enrich") return true;
  if (f === "leaders") return true;
  if (f === "radar") return true;
  return false;
}

/**
 * f-param → Python-hub path. Exported for tests: the surface store now has six f-forms
 * (today + dated × index/frame/sessions) whose prefixes differ by one character, and a
 * mis-resolved key fails silently by falling through to R2 and then to null — it would not
 * throw, it would just show an empty field. Pinning the mapping is the only way to catch that.
 */
export function backendPath(f: string): string {
  if (f === "tide") return "/api/flow/tide";
  if (f === "dte") return "/api/flow/dte";
  if (f.startsWith("ticker:")) return `/api/flow/ticker/${f.slice(7)}`;
  if (f.startsWith("vol:")) return `/api/hub/vol/${f.slice(4)}`;
  // Dated GEX history first (surface convention): the prefixes are disjoint from `gex:`,
  // but matching them ahead keeps that independent of prefix arithmetic.
  if (f.startsWith("gex_dates:")) return `/api/hub/gex_history/${f.slice(10)}/dates`;
  if (f.startsWith("gex_at:")) {
    const [, root, date] = f.split(":");
    return `/api/hub/gex_history/${root}/${date}`;
  }
  if (f.startsWith("gex:")) return `/api/hub/gex/${f.slice(4)}`;
  if (f.startsWith("levels:")) return `/api/hub/levels/${f.slice(7)}`;
  if (f.startsWith("agg:")) return `/api/hub/aggtrend/${f.slice(4)}`;
  if (f === "quad") return "/api/hub/quad";
  if (f.startsWith("grades:")) return `/api/hub/level_grades/${f.slice(7)}`;
  if (f === "grades_universe") return "/api/hub/level_grades/_universe";
  if (f === "oi") return "/api/hub/oi";
  if (f === "hot") return "/api/hub/hot";
  if (f === "meta") return "/api/flow/meta";
  if (f === "ctx") return "/api/hub/ctx";
  if (f === "oiconf") return "/api/hub/oiconf";
  if (f === "darkpool") return "/api/hub/darkpool";
  if (f === "volregime") return "/api/hub/volregime";
  if (f.startsWith("moves:")) return `/api/hub/moves/${f.slice(6)}`;
  // R3 OI suite
  if (f.startsWith("oi_time:")) return `/api/hub/oi_time/${f.slice(8)}`;
  if (f.startsWith("max_pain:")) return `/api/hub/max_pain/${f.slice(9)}`;
  if (f === "oi_change") return "/api/hub/oi_change";
  if (f.startsWith("oi_change:")) return `/api/hub/oi_change/${f.slice(10)}`;
  if (f.startsWith("tctx:")) return `/api/hub/tctx/${f.slice(5)}`;
  if (f === "chainheat") return "/api/flow/chainheat";
  if (f.startsWith("gexstate:")) return `/api/hub/gexstate/${f.slice(9)}`;
  if (f === "gexstate_index") return "/api/hub/gexstate/_index";
  if (f.startsWith("matrix:")) return `/api/hub/matrix/${f.slice(7)}`;
  // Surface store: /api/flow/surface/{ROOT}/idx  and  /api/flow/surface/{ROOT}/{STAMP}
  // Dated variants first — the longer prefixes are disjoint from the today-paths, but
  // matching them ahead of the shorter ones keeps that independent of prefix arithmetic.
  if (f.startsWith("surface_dates:")) return `/api/flow/surface/${f.slice(14)}/dates`;
  if (f.startsWith("surface_idx_at:")) {
    const [, root, date] = f.split(":");
    return `/api/flow/surface/${root}/${date}/idx`;
  }
  if (f.startsWith("surface_at:")) {
    const [, root, date, stamp] = f.split(":");
    return `/api/flow/surface/${root}/${date}/${stamp}`;
  }
  if (f.startsWith("surface_idx:")) return `/api/flow/surface/${f.slice(12)}/idx`;
  if (f.startsWith("surface:")) {
    const [, root, stamp] = f.split(":");
    return `/api/flow/surface/${root}/${stamp}`;
  }
  if (f === "manifest") return "/api/flow/manifest";
  if (f === "flow_idx") return "/api/flow/flow_idx";
  if (f === "prophet_idx") return "/api/hub/prophet";
  if (f === "prophet_marks") return "/api/hub/prophet_marks";
  if (f === "options_prophet_idx") return "/api/hub/options_prophet";
  if (f === "enrich") return "/api/flow/enrich";
  if (f === "leaders") return "/api/flow/leaders";
  if (f === "radar") return "/api/flow/radar";
  return `/api/flow/${f}`;
}

/** f-param → R2 object key. Exported for tests — see backendPath. */
export function r2Key(f: string): string {
  if (f === "meta") return "live_flow/meta.json";
  if (f === "tide") return "live_flow/tide_current.json";
  if (f === "dte") return "live_flow/dte_tide_current.json";
  if (f.startsWith("ticker:")) return `live_flow/tickers/${f.slice(7)}.json`;
  if (f.startsWith("vol:")) return `options_hub/vol/${f.slice(4)}.json`;
  // Dated GEX-ladder history on R2: options_hub/gex_history/{ROOT}/{DATE}.json (the full
  // options_hub.gex/v1 payload, keyed by the payload's own asof) + the dates.json index
  // the macro hub maintains beside it. Matched ahead of `gex:` per the surface convention.
  if (f.startsWith("gex_dates:")) return `options_hub/gex_history/${f.slice(10)}/dates.json`;
  if (f.startsWith("gex_at:")) {
    const [, root, date] = f.split(":");
    return `options_hub/gex_history/${root}/${date}.json`;
  }
  if (f.startsWith("gex:")) return `options_hub/gex/${f.slice(4)}.json`;
  if (f.startsWith("levels:")) return `levels/${f.slice(7)}.json`;
  if (f.startsWith("agg:")) return `options_hub/aggtrend/${f.slice(4)}.json`;
  if (f === "quad") return "options_hub/quad.json";
  if (f.startsWith("grades:")) return `options_hub/level_grades/${f.slice(7)}.json`;
  if (f === "grades_universe") return "options_hub/level_grades/_universe.json";
  if (f === "oi") return "options_hub/oi_movers.json";
  if (f === "hot") return "options_hub/hot_contracts.json";
  if (f === "ctx") return "options_hub/context.json";
  if (f === "oiconf") return "options_hub/oi_confirmed.json";
  // EOD context belt. darkpool/vol-regime live at the bucket ROOT (macro mirrors whole
  // files under their own names, not under options_hub/) — see mirror_terminal_context_r2.
  if (f === "darkpool") return "darkpool/eod.json";
  if (f === "volregime") return "vol/regime.json";
  if (f.startsWith("moves:")) return `options_hub/moves/${f.slice(6)}.json`;
  // R3 OI suite: per-root payloads beside vol/gex/moves in the options_hub
  // plane; the bare oi_change is the cross-root board (also the options_hub_oi
  // dead-man beacon on the macro side).
  if (f.startsWith("oi_time:")) return `options_hub/oi_time/${f.slice(8)}.json`;
  if (f.startsWith("max_pain:")) return `options_hub/max_pain/${f.slice(9)}.json`;
  if (f === "oi_change") return "options_hub/oi_change.json";
  if (f.startsWith("oi_change:")) return `options_hub/oi_change/${f.slice(10)}.json`;
  if (f.startsWith("tctx:")) return `options_hub/tickers_ctx/${f.slice(5)}.json`;
  if (f === "chainheat") return "live_flow/chain_heat_current.json";
  if (f.startsWith("gexstate:")) return `options_structure/gex_state/${f.slice(9)}.json`;
  if (f === "gexstate_index") return "options_structure/gex_state/_index.json";
  if (f.startsWith("matrix:")) return `options_structure/matrix/${f.slice(7)}.json`;
  // Surface store on R2: live_flow/surface/{ROOT}/idx.json + live_flow/surface/{ROOT}/{STAMP}.json
  // plus the date-keyed copies the poller writes beside them (macro build_flow_surface.py):
  // live_flow/surface/{ROOT}/dates.json, {ROOT}/{DATE}/idx.json, {ROOT}/{DATE}/{STAMP}.json.
  if (f.startsWith("surface_dates:")) return `live_flow/surface/${f.slice(14)}/dates.json`;
  if (f.startsWith("surface_idx_at:")) {
    const [, root, date] = f.split(":");
    return `live_flow/surface/${root}/${date}/idx.json`;
  }
  if (f.startsWith("surface_at:")) {
    const [, root, date, stamp] = f.split(":");
    return `live_flow/surface/${root}/${date}/${stamp}.json`;
  }
  if (f.startsWith("surface_idx:")) return `live_flow/surface/${f.slice(12)}/idx.json`;
  if (f.startsWith("surface:")) {
    const [, root, stamp] = f.split(":");
    return `live_flow/surface/${root}/${stamp}.json`;
  }
  if (f === "manifest") return "live_flow/manifest.json";
  if (f === "flow_idx") return "live_flow/flow_idx.json";
  // prophet_idx intentionally has NO r2Key mapping — DEC:B1-PROPHET-PUBLIC-SPLIT
  // (Sol Day-5, 2026-08-21). tryFetchUpstream skips the "r2" source for this f
  // outright, so this mapping would be dead/unreachable in production; it is
  // omitted rather than left as a live landmine for a future caller to find.
  if (f === "prophet_marks") return "live_flow/prophet_marks.json";
  if (f === "options_prophet_idx") return "options_prophet/index.json";
  if (f === "enrich") return "live_flow/enrich_current.json";
  if (f === "leaders") return "flowleaders/leaders.json";
  if (f === "radar") return "leaderradar/radar.json";
  return `live_flow/${f}_current.json`;
}

async function fetchWithUA(url: string): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "mastermind-feed/1.0" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Attach the proprietary flow_score_v1 result to each event of the main feed
 * payload, SERVER-SIDE, so the browser receives only the computed
 * {score, tier, components:[{key,label,value}]} — never the model weights/curves.
 * No-op for any f that isn't the main feed. Mutates events in place; a malformed
 * event fails soft to a zero score rather than breaking the whole feed.
 */
export function attachFlowScores(f: string, data: Record<string, unknown>): void {
  if (f !== "feed") return;
  const events = (data as { events?: unknown }).events;
  if (!Array.isArray(events)) return;
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const rec = ev as Record<string, unknown>;
    try {
      const { score, tier, components } = computeFlowScore(ev as unknown as ScorerInput);
      rec.flowScore = {
        score: Number.isFinite(score) ? score : 0,
        tier,
        components: components.map((c) => ({
          key: c.key,
          label: c.label,
          value: Number.isFinite(c.value) ? c.value : 0,
        })),
      };
    } catch {
      rec.flowScore = { score: 0, tier: "LOW", components: [] };
    }
  }
}

// ── Surface fixture helpers (multi-day replay) ───────────────────────────────
//
// The fixture family carries ONE canonical full-day session per root. Multi-day replay is
// exercised by serving that same session under each date the sessions fixture lists, RE-DATED
// so every stamp the UI shows describes the requested session. A date the sessions fixture
// does not list is refused (honest empty) — dev must never be able to invent a session that
// production's retention prune would not have.

const emptySurfaceIndex = (): Record<string, unknown> => ({
  date: "", stamps: [], latest: null, cadenceSec: 0, source: "fixture-empty",
});

const emptySurfaceFrame = (): Record<string, unknown> => ({
  spot: null, price_levels: [], time_steps: [], grids: {}, asof: "", cadence: "",
});

const emptySurfaceDates = (root: string): Record<string, unknown> => ({
  root, dates: [], latest: null, count: 0, retain: 0, cadenceSec: 0, cadence: "",
  asof: "", source: "fixture-empty",
});

/** Swap the YYYY-MM-DD prefix of an ISO-ish stamp for `date` (passthrough if it has none). */
function redate(asof: unknown, date: string): string {
  const s = typeof asof === "string" ? asof : "";
  if (!/^\d{4}-\d{2}-\d{2}/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return s;
  return date + s.slice(10);
}

/** True when the sessions fixture lists `date` for `root` (missing fixture → false). */
async function fixtureHasSession(root: string, date: string): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  try {
    const raw = await fs.readFile(SURFACE_DATES_FIXTURE_FILE, "utf8");
    const all = JSON.parse(raw) as Record<string, { dates?: unknown }>;
    const dates = all[root]?.dates;
    return Array.isArray(dates) && dates.includes(date);
  } catch {
    return false;
  }
}

// ── Dated GEX-ladder fixture helpers (R0.10) ─────────────────────────────────
//
// Same doctrine as the surface family above: ONE canonical gex payload per root stands in
// for every archived session, re-dated so the payload describes the requested date; a date
// the gex sessions fixture does not list is refused with the honest empty {} — which is
// exactly what a prod accrual hole (07-18/07-20 style 404) resolves to, so dev exercises
// the missing-session state the UI must carry.

const emptyGexDates = (root: string): Record<string, unknown> => ({
  schema: "options_hub.gex_dates/v1",
  root, dates: [], latest: null, count: 0, asof: "", source: "fixture-empty",
});

/** True when the GEX sessions fixture lists `date` for `root` (missing fixture → false). */
async function gexFixtureHasSession(root: string, date: string): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  try {
    const raw = await fs.readFile(GEX_DATES_FIXTURE_FILE, "utf8");
    const all = JSON.parse(raw) as Record<string, { dates?: unknown }>;
    const dates = all[root]?.dates;
    return Array.isArray(dates) && dates.includes(date);
  } catch {
    return false;
  }
}

export async function fixtureFor(f: string): Promise<Record<string, unknown>> {
  if (f === "tide") {
    const raw = await fs.readFile(TIDE_FIXTURE_FILE, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  }
  if (f === "dte") {
    const raw = await fs.readFile(DTE_FIXTURE_FILE, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  }
  // Ticker drills are keyed by root. An unknown root returns {} (honest empty) rather
  // than the first key's payload — another ticker's tape wearing the wrong header is
  // worse than none (gex:/moves: convention). Consumers gate on payload.day before
  // rendering, so {} lands in the same "no drill data" state a prod 503 produces.
  if (f.startsWith("ticker:")) {
    const root = f.slice(7);
    const raw = await fs.readFile(TICKER_FIXTURE_FILE, "utf8");
    const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    return all[root] ?? {};
  }
  // Per-root IV context, keyed by root. An unknown root returns {} (honest empty), never
  // the first key's payload: OptionsHubView only renders vol under a root-match guard (the
  // fallback was fetched-but-never-shown there), but the Exposure Desk's Structure strip
  // rendered the substituted root's IV percentile under the selected ticker's name — the
  // wrong-root hazard the ticker:/gex:/moves:/gexstate: branches already refuse.
  if (f.startsWith("vol:")) {
    const root = f.slice(4).toUpperCase();
    const raw = await fs.readFile(VOL_FIXTURE_FILE, "utf8");
    const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    return all[root] ?? {};
  }
  // GEX fixtures keyed by root. Unknown roots return {} (empty payload) rather than
  // falling back to SPY — so dev matches prod's honest "no GEX yet" empty state.
  if (f.startsWith("gex:")) {
    const root = f.slice(4).toUpperCase();
    const raw = await fs.readFile(GEX_FIXTURE_FILE, "utf8");
    const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    return all[root] ?? {};
  }
  // levels.v1 fixtures are keyed by root so fixture mode exercises the same
  // identity boundary as the live per-root R2 objects. Never substitute SPY for
  // an unknown root: a plausible board under the wrong ticker is worse than empty.
  if (f.startsWith("levels:")) {
    const root = f.slice(7).toUpperCase();
    try {
      const raw = await fs.readFile(LEVELS_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      return all[root] ?? {};
    } catch {
      return {};
    }
  }
  if (f === "quad") {
    try {
      const raw = await fs.readFile(QUAD_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  // Level report cards, keyed by root ("_universe" for the aggregate). Wrong-root
  // refusal as everywhere: a hold-rate under the wrong ticker's header reads as fact.
  if (f.startsWith("grades:") || f === "grades_universe") {
    const key = f === "grades_universe" ? "_universe" : f.slice(7).toUpperCase();
    try {
      const raw = await fs.readFile(GRADES_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      return all[key] ?? {};
    } catch {
      return {};
    }
  }
  // Aggregate greek trend, keyed by root. Same wrong-root refusal as gex:/vol: —
  // a nine-year positioning history under the wrong ticker's header would be read
  // as fact and is far worse than an empty card.
  if (f.startsWith("agg:")) {
    const root = f.slice(4).toUpperCase();
    try {
      const raw = await fs.readFile(AGG_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      return all[root] ?? {};
    } catch {
      return {};
    }
  }
  // GEX sessions index (dated ladder replay) — keyed by ROOT. Unknown roots return an
  // honest empty list; the desk then hides the session dropdown and keeps only the
  // scrubber's explicit per-date probe.
  if (f.startsWith("gex_dates:")) {
    const root = f.slice(10).toUpperCase();
    try {
      const raw = await fs.readFile(GEX_DATES_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      return all[root] ?? emptyGexDates(root);
    } catch {
      return emptyGexDates(root);
    }
  }
  // Archived full ladder for one session. The canonical gex payload stands in for every
  // listed date, RE-DATED so asof describes the requested session, with history[] cut to
  // the sessions that had settled by then (an archived snapshot cannot know its future).
  // A date the sessions fixture doesn't list — including the deliberate accrual hole —
  // returns {} : the same honest missing-session state a prod 404 produces.
  if (f.startsWith("gex_at:")) {
    const [, rootRaw, date] = f.split(":");
    const root = (rootRaw ?? "").toUpperCase();
    if (!(await gexFixtureHasSession(root, date ?? ""))) return {};
    try {
      const raw = await fs.readFile(GEX_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      const full = all[root];
      if (!full) return {};
      const history = Array.isArray(full.history)
        ? (full.history as { date?: string }[]).filter(
            (h) => typeof h?.date === "string" && h.date <= date,
          )
        : full.history;
      return { ...full, asof: redate(full.asof, date), history };
    } catch {
      return {};
    }
  }
  if (f === "oi" || f === "hot") {
    const raw = await fs.readFile(SCREENER_FIXTURE_FILE, "utf8");
    const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    return all[f] ?? {};
  }
  if (f === "ctx") {
    try {
      const raw = await fs.readFile(CTX_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return {}; }
  }
  if (f === "oiconf") {
    try {
      const raw = await fs.readFile(OICONF_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return { confirmed: [] }; }
  }
  if (f === "chainheat") {
    try {
      const raw = await fs.readFile(CHAINHEAT_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return { schema: "options_flow.chain_heat/v1", campaigns: [] }; }
  }
  // ── EOD context belt (OEU T-E) ──────────────────────────────────────────────
  // Each falls back to a SHAPE-VALID EMPTY, never to a neighbouring root's data: the belt
  // reads "not covered" off an empty universe / absent game_plan, which is exactly what a
  // pre-first-nightly 404 should look like. Deleting a fixture is therefore a legitimate
  // way to exercise the absent state in dev.
  if (f === "darkpool") {
    try {
      const raw = await fs.readFile(DARKPOOL_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return { schema: "darkpool_eod.v1", tier: "eod", asof: "", universe: [] }; }
  }
  if (f === "volregime") {
    try {
      const raw = await fs.readFile(VOLREGIME_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return { schema: "vol_regime.v1", asof: "", snapshot: null, game_plan: null }; }
  }
  // Expected-move bands are keyed by root. An unknown root returns {} rather than SPY's
  // band — a wrong ticker's expected move is worse than none (gex: fixture convention).
  if (f.startsWith("moves:")) {
    const root = f.slice(6).toUpperCase();
    try {
      const raw = await fs.readFile(MOVES_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      return all[root] ?? {};
    } catch { return {}; }
  }
  // R3 OI suite. Per-root feeds keyed by root, honest {} for an unknown root
  // (whole-family convention — locked by hubFixtures.test.ts). The bare
  // `oi_change` serves the cross-root board from the same file's lowercase
  // "cross" key (real roots are uppercase, so the key can never collide).
  if (f.startsWith("oi_time:")) {
    const root = f.slice(8).toUpperCase();
    try {
      const raw = await fs.readFile(OI_TIME_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      return all[root] ?? {};
    } catch { return {}; }
  }
  if (f.startsWith("max_pain:")) {
    const root = f.slice(9).toUpperCase();
    try {
      const raw = await fs.readFile(MAX_PAIN_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      return all[root] ?? {};
    } catch { return {}; }
  }
  if (f === "oi_change" || f.startsWith("oi_change:")) {
    const key = f === "oi_change" ? "cross" : f.slice(10).toUpperCase();
    try {
      const raw = await fs.readFile(OI_CHANGE_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      return all[key] ?? {};
    } catch { return {}; }
  }
  // Ticker z-context, keyed by root. Unknown roots return {} — the drill's z-chips then
  // render their warming "—" state (history_n 0) instead of another ticker's z-scores
  // wearing the selected root's header (the first-key fallback dressed the QQQ drill in
  // NVDA's Net-Prem/Vol>OI z-chips).
  if (f.startsWith("tctx:")) {
    const root = f.slice(5).toUpperCase();
    try {
      const raw = await fs.readFile(TCTX_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      return all[root] ?? {};
    } catch { return {}; }
  }
  // gex_state is a PER-ROOT store in production (options_structure/gex_state/{ROOT}.json).
  // The fixture was served root-blind, so every ticker in dev wore SPY's walls, flip and max
  // pain — invisible until the EOD context belt (OEU T-E) put those numbers beside the
  // ladder's own and they disagreed. Now: a root-keyed fixture is indexed; a single-root
  // fixture answers ONLY for the root it declares, and every other ticker gets the honest
  // empty that production would give it. Consumers already handle the empty (MarketStateCard
  // renders "state computing"; the belt falls back to the ladder payload and discloses it).
  if (f.startsWith("gexstate:")) {
    const root = f.slice(9).toUpperCase();
    try {
      const raw = await fs.readFile(GEXSTATE_FIXTURE_FILE, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.root === "string" || typeof parsed.schema === "string") {
        return String(parsed.root ?? "").toUpperCase() === root ? parsed : {};
      }
      const all = parsed as Record<string, Record<string, unknown>>;
      return all[root] ?? {};
    } catch { return {}; }
  }
  // R3.2/R3.3: the cross-root aggregate. Dev serves its own fixture file (index-shaped —
  // schema/asof/n_roots/rows) so screener columns + watchlist dots exercise the real
  // parse path; a missing file returns {} = prod's honest degrade-to-absent.
  if (f === "gexstate_index") {
    try {
      const raw = await fs.readFile(GEXSTATE_INDEX_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return {}; }
  }
  // Expiry matrix, keyed by root. In production the store exists only for some roots and
  // every consumer is built for absence (GexDeskView/SurfacePane gate on an array `cells`;
  // GexDeskView.readMatrix nulls a cells-less payload before the grid). Unknown roots
  // return {} — the old SPY fallback fed the SPY/QQQ/IWM confluence board the same matrix three
  // times over, fabricating perfect cross-index alignment in dev.
  if (f.startsWith("matrix:")) {
    const root = f.slice(7).toUpperCase();
    try {
      const raw = await fs.readFile(MATRIX_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      const entry = all[root];
      if (!entry || !Array.isArray(entry.cells)) return {};
      try {
        const unusualRaw = await fs.readFile(MATRIX_UNUSUAL_FIXTURE_FILE, "utf8");
        const unusualAll = JSON.parse(unusualRaw) as Record<string, unknown[]>;
        const patches = Array.isArray(unusualAll[root]) ? unusualAll[root] : [];
        const byIdentity = new Map<string, Record<string, unknown>>();
        for (const patch of patches) {
          if (!patch || typeof patch !== "object" || Array.isArray(patch)) continue;
          const p = patch as Record<string, unknown>;
          if (typeof p.strike !== "number" || !Number.isFinite(p.strike) || typeof p.expiry !== "string") continue;
          byIdentity.set(`${p.expiry}|${p.strike}`, p);
        }
        return {
          ...entry,
          cells: entry.cells.map((cell) => {
            if (!cell || typeof cell !== "object" || Array.isArray(cell)) return cell;
            const c = cell as Record<string, unknown>;
            const patch = byIdentity.get(`${String(c.expiry ?? "")}|${String(c.strike ?? "")}`);
            return patch ? { ...c, unusual: patch.unusual } : c;
          }),
        };
      } catch {
        // Companion absence exercises the honest pre-baseline state; the matrix stays usable.
        return entry;
      }
    } catch { return {}; }
  }
  if (f === "manifest") {
    try {
      const raw = await fs.readFile(MANIFEST_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return { symbols: {}, as_of: "", source: "fixture" }; }
  }
  if (f === "flow_idx") {
    try {
      const raw = await fs.readFile(FLOW_IDX_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return { rows: [], as_of: "", source: "fixture-empty" }; }
  }
  // Sessions index (multi-day replay) — keyed by ROOT. Unknown roots return an honest empty
  // list, which the Terminal reads as "no archived sessions" and hides the session picker.
  if (f.startsWith("surface_dates:")) {
    const root = f.slice(14).toUpperCase();
    try {
      const raw = await fs.readFile(SURFACE_DATES_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      return all[root] ?? emptySurfaceDates(root);
    } catch {
      return emptySurfaceDates(root);
    }
  }
  // Surface frame index — keyed by ROOT (today) or by ROOT+DATE (an archived session).
  // Unknown roots — and dates the sessions index doesn't list — return an honest empty
  // index rather than re-serving today's stamps under someone else's date.
  if (f.startsWith("surface_idx:") || f.startsWith("surface_idx_at:")) {
    const dated = f.startsWith("surface_idx_at:");
    const [, rootRaw, dateRaw] = f.split(":");
    const root = (dated ? rootRaw : f.slice(12)).toUpperCase();
    const date = dated ? dateRaw : "";
    if (dated && !(await fixtureHasSession(root, date))) return emptySurfaceIndex();
    try {
      const raw = await fs.readFile(SURFACE_IDX_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      const idx = all[root];
      if (!idx) return emptySurfaceIndex();
      // One canonical fixture session stands in for every retained date: re-date it so the
      // archived index describes the requested session, not the fixture's own.
      return dated ? { ...idx, date, asof: redate(idx.asof, date) } : idx;
    } catch {
      return emptySurfaceIndex();
    }
  }
  // Surface frame for a given stamp — the fixture stores ONE canonical full-day frame per
  // root; we truncate time_steps + each metric grid to the realized-so-far window for the
  // requested stamp (replay = the surface as it existed at that time). Unknown root/stamp →
  // empty frame (honest "no surface data" state), never fabricated. The `surface_at:` form
  // carries an explicit session DATE; it serves the same truncated frame re-dated to that
  // session, and refuses any date the sessions index doesn't list.
  if (f.startsWith("surface:") || f.startsWith("surface_at:")) {
    const dated = f.startsWith("surface_at:");
    const parts = f.split(":");
    const root = (parts[1] ?? "").toUpperCase();
    const date = dated ? parts[2] ?? "" : "";
    const stamp = dated ? parts[3] ?? "" : parts[2] ?? "";
    if (dated && !(await fixtureHasSession(root, date))) return emptySurfaceFrame();
    try {
      const raw = await fs.readFile(SURFACE_FIXTURE_FILE, "utf8");
      const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      const full = all[root];
      if (!full) return emptySurfaceFrame();
      const stamps = (full.stamps as string[]) ?? [];
      const times = (full.time_steps as string[]) ?? [];
      const idx = stamps.indexOf(stamp);
      const upto = idx >= 0 ? idx + 1 : times.length; // unknown stamp → full day
      const gridsFull = (full.grids as Record<string, number[][]>) ?? {};
      const grids: Record<string, number[][]> = {};
      for (const [m, g] of Object.entries(gridsFull)) grids[m] = g.map((row) => row.slice(0, upto));
      const spotPath = (full.spot_path as number[] | undefined) ?? null;
      const sessionDate = dated ? date : (full.session_date as string | undefined);
      return {
        spot: spotPath ? spotPath[Math.max(0, upto - 1)] ?? full.spot : full.spot,
        price_levels: full.price_levels,
        time_steps: times.slice(0, upto),
        grids,
        asof: dated ? redate(full.asof, date) : full.asof,
        cadence: full.cadence,
        metrics: full.metrics,
        root,
        session_date: sessionDate,
      } as Record<string, unknown>;
    } catch {
      return emptySurfaceFrame();
    }
  }
  if (f === "prophet_idx") {
    try {
      const raw = await fs.readFile(PROPHET_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return { schema: "prophet.index/v1", asof: "", plans: [] }; }
  }
  if (f === "prophet_marks") {
    try {
      const raw = await fs.readFile(PROPHET_MARKS_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return { schema: "prophet.live_marks/v1", asof_utc: "", session_date: "", marks: {} }; }
  }
  if (f === "options_prophet_idx") {
    try {
      const raw = await fs.readFile(OPTIONS_PROPHET_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {
        schema: "options.prophet_shadow/v1",
        as_of: "",
        authority: "display_only",
        mode: "shadow",
        opportunities: [],
        watchlist: [],
      };
    }
  }
  if (f === "radar") {
    try {
      const raw = await fs.readFile(LEADER_RADAR_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return { schema: "leader_radar.v1", cold_start: true, rows: [], regime: {}, coverage: {} }; }
  }
  if (f === "leaders") {
    try {
      const raw = await fs.readFile(LEADERS_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return { schema: "flow_leaders.v1", cold_start: true, board_a: [], board_b: [], board_a_total: 0 }; }
  }
  if (f === "enrich") {
    try {
      const raw = await fs.readFile(ENRICH_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {
        schema: "flow.enrich/v1", asof: "", session_date: "",
        thresholds: { elite_q: 66, strong_q: 60, high_q: 55, medium_q: 48 },
        events: {}, confirmed_yesterday: [],
      };
    }
  }
  const raw = await fs.readFile(FIXTURE_FILE, "utf8");
  const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
  return all[f] ?? {};
}

// ── Fixture intraday candles (DEV ONLY) ──────────────────────────────────────
//
// The Surface pane draws a heat field (surface fixture) AND price candles (/api/intraday). With no
// market-data key and an empty history store, dev showed the field with no candles at all. These
// helpers derive candles from the surface fixture's OWN spot_path so both layers share one
// synthetic price scale.
//
// NEVER let this reach production. The ONLY caller (app/api/intraday/route.ts) gates strictly on
// FLOW_FIXTURE === "1", a dev-only flag. Deliberately NOT a data file: public/data/intraday/ is not
// gitignored and intradayStore.withStoredHistory() reads it UNCONDITIONALLY, so a synthetic bar file
// there would serve fabricated SPY market data to real users.

/**
 * Deterministic [0,1) hash of a bar index — integer math only (Math.imul fmix32), so the wiggle is
 * byte-identical on every run/platform and fixture screenshots don't churn. Never Math.random().
 */
function hash01(i: number): number {
  let x = (i + 1) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 2246822507) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

/** 2-dp price rounding (named `round2`, not `r2` — this file's `r2Key`/`R2_BASE` mean Cloudflare R2). */
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * FLOW_FIXTURE-only intraday candles for a surface-fixture root, on the SAME time axis and price
 * scale as the surface heat field.
 *
 * One Bar6 per fixture time step: close = spot_path[i], open = spot_path[i-1] (first bar opens flat),
 * wicks = a deterministic 5–20 bp extension beyond the body. Epochs use `sessionEpoch` — the app's
 * display-epoch convention, the same one `etDisplay` gives real Polygon bars — so these candles sit
 * on exactly the axis production candles would, and line up with the heat field. Bars come back ascending and epoch-unique.
 *
 * `tf` honoured by resampling the 5-min base upward (tfMinutes > 5). Sub-5m timeframes get the 5m
 * series unchanged — the fixture has no finer granularity to synthesize from.
 *
 * Returns null when the root has no surface fixture (or the fixture lacks a usable spot_path), so
 * the caller falls through to the real path instead of inventing a price series.
 */
export async function intradayFixture(sym: string, tf: string): Promise<Bar6[] | null> {
  const root = (sym || "").trim().toUpperCase();
  if (!root) return null;
  let full: Record<string, unknown> | undefined;
  try {
    const raw = await fs.readFile(SURFACE_FIXTURE_FILE, "utf8");
    const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    full = all[root];
  } catch {
    return null;
  }
  if (!full) return null;

  const times = Array.isArray(full.time_steps) ? (full.time_steps as string[]) : [];
  const spotPath = Array.isArray(full.spot_path) ? (full.spot_path as number[]) : [];
  const date = typeof full.session_date === "string" ? full.session_date : "";
  const n = Math.min(times.length, spotPath.length);
  if (!date || n === 0) return null;

  const base: Bar6[] = [];
  for (let i = 0; i < n; i++) {
    const hhmm = String(times[i] ?? "");
    const [hh, mm] = hhmm.split(":").map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
    const close = Number(spotPath[i]);
    const open = Number(i > 0 ? spotPath[i - 1] : spotPath[0]);
    if (!Number.isFinite(close) || !Number.isFinite(open)) continue;
    const epoch = sessionEpoch(date, hhmm);
    if (!Number.isFinite(epoch)) continue;
    const jHi = 0.0005 + hash01(2 * i) * 0.0015;      // 5–20 bp
    const jLo = 0.0005 + hash01(2 * i + 1) * 0.0015;
    // clamp after rounding so a 2-dp high can never land inside the body
    const high = Math.max(round2(Math.max(open, close) * (1 + jHi)), open, close);
    const low = Math.min(round2(Math.min(open, close) * (1 - jLo)), open, close);
    const vol = 400_000 + Math.round(hash01(i + 977) * 1_600_000);
    base.push([epoch, round2(open), high, low, round2(close), vol]);
  }
  if (!base.length) return null;

  base.sort((a, b) => a[0] - b[0]);
  const bars: Bar6[] = [];
  let last = -1;
  for (const b of base) { if (b[0] !== last) { bars.push(b); last = b[0]; } } // ascending + unique

  const mins = tfMinutes(tf);
  return mins > 5 ? resample(bars, mins) : bars;
}

/**
 * Fetch a payload from the live upstream: Python backend first, R2 CDN fallback.
 * Options Prophet is an artifact-native feed, so it deliberately probes its
 * published R2 index before the backend route. This avoids paying the backend's
 * timeout on every first load when that optional route is absent or deploying.
 * `manifest` is a local static file on this box. Returns null when every source
 * fails. (No scoring, no cache — callers own that.)
 */
export type FlowUpstreamSource = "backend" | "r2";

export function upstreamSourceOrder(f: string): FlowUpstreamSource[] {
  return f === "options_prophet_idx" ? ["r2", "backend"] : ["backend", "r2"];
}

export async function tryFetchUpstream(f: string): Promise<Record<string, unknown> | null> {
  if (f === "manifest") {
    try {
      const raw = await fs.readFile(MANIFEST_FIXTURE_FILE, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  for (const source of upstreamSourceOrder(f)) {
    // DEC:B1-PROPHET-PUBLIC-SPLIT (Sol Day-5, 2026-08-21): the full US Prophet
    // plan book is premium/private. prophet_idx must never fall through to the
    // anonymous public R2 object — when the backend is unavailable the caller
    // fails closed (503 / stale in-memory cache), never anonymous fallthrough.
    if (source === "r2" && f === "prophet_idx") continue;
    try {
      const url = source === "r2"
        ? `${R2_BASE}/${r2Key(f)}`
        : `${BACKEND}${backendPath(f)}`;
      return await fetchWithUA(url);
    } catch {
      // Continue to the next configured source.
    }
  }
  // DEC:B1-MACRO-PRIVATE-CUTOVER: the canonical Macro repo is now private and its
  // GitHub Pages mirror is retired, so `flow_idx` no longer has an anonymous public
  // fallback here. It is supplied by backend -> R2 (`live_flow/flow_idx.json`,
  // refreshed nightly by the macro repo's `scripts/mirror_flow_idx.py`); when both
  // of those fail this path fails closed (null -> caller's 503 / stale cache)
  // rather than reading an anonymous public copy.
  return null;
}

/**
 * Resolve a fresh, scored payload for `f` — fixture in dev, else live upstream.
 * No caching: callers (GET's SWR cache, the SSE poll loop) decide freshness.
 * Returns null when unavailable.
 */
export async function loadFlowFresh(f: string): Promise<Record<string, unknown> | null> {
  if (process.env.FLOW_FIXTURE === "1") {
    try {
      const data = await fixtureFor(f);
      attachFlowScores(f, data);
      return data;
    } catch {
      return null;
    }
  }
  const data = await tryFetchUpstream(f);
  if (data) attachFlowScores(f, data);
  return data;
}
