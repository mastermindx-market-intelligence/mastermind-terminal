"use client";
import { VolRegimeChip } from "@/components/eodcontext/VolRegimeChip";
/**
 * GexDeskView — GEX desk surface (Wave 2, MomoEdge parity).
 *
 * Layout:
 *   Top    — ticker input + spot price + asof badge
 *   Second — GexSummaryBar (Net GEX / Call Wall / Put Support / Magnet / Flip / etc.)
 *   Body   — two-pane:
 *              Left  — GexGuide (color legend + collapsible how-to-read) + StrikeLadder
 *              Right — MarketStateCard (regime + state metrics + passport)
 *
 * State owned here:
 *   - ticker (default "SPY")
 *   - gexPayload (from /api/flow?f=gex:<ROOT>)
 *   - statePayload (from /api/flow?f=gexstate:<ROOT> — selected-root guarded read)
 *   - selectedExpiry (expiry filter chip)
 *   - polling interval (~60s)
 *
 * HONESTY DOCTRINE:
 *   - GEX levels are a LEVELS MAP, display-only until forward-vol gate (~Sept 2026).
 *   - Dealer-sign is an assumption; magnitude is the reliable read.
 *   - Single-name regime is near-constant — disclosed in MarketStateCard passport.
 *   - No "validated", "predictive", or asserted-direction copy anywhere.
 *
 * Integration note:
 *   The integrator wires this view into OptionsHubView.tsx under the "gex" tab.
 *   The f-param routing (/api/flow?f=gex:<ROOT>) is handled by the existing route.ts.
 *   This component codes against those endpoints; the integrator adds the tab entry.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { flowGetResult, flowInvalidate, type FlowOutcome } from "@/lib/flowClientCache";
import { isValidRoot } from "@/lib/flowRoot";
import { useFlowStream } from "@/lib/flowStream";
import { useLang } from "@/lib/i18n";
import { GEX_QUICK_ROOTS, GEX_AUTOCOMPLETE_ROOTS } from "@/lib/optionsRoots";
import { trackSearch } from "@/lib/searchTrack";
import { makeGexT } from "./gexStrings";
import type { GexDeskKey } from "./gexStrings";
import { GexSummaryBar } from "./GexSummaryBar";
import { StrikeLadder } from "./StrikeLadder";
import { ExpiryBars } from "./ExpiryBars";
import { GexHistory } from "./GexHistory";
import { ExposureExpiryDrawer } from "./ExposureExpiryDrawer";
import { MarketStateCard } from "./MarketStateCard";
import type { GexStatePayload, StateReadStatus } from "./MarketStateCard";
import { GexGuide } from "./GexGuide";
import { ExposureMatrix } from "./ExposureMatrix";
import { HeatSeekerCard } from "./HeatSeekerCard";
import {
  isMatrixDocForRoot,
  readGexStateForRoot,
  mergeMatrixLevels,
  type MatrixDoc,
  type MatrixRead,
} from "./matrixDoc";
import { EodContextBelt } from "@/components/eodcontext/EodContextBelt";
import { useEodContext } from "@/components/eodcontext/useEodContext";
import { isGexDates, gexSessionOf } from "@/lib/gexSessions";
// PP1-D — Matrix view opens on the shared gamma map. The desk mounts the same
// companion the rail uses (lib/__tests__/optionsCompanionHost.test.tsx locks host=page
// behavior: no header, no close button, no chart pin button, no link back to the desk,
// Escape left to the page, gamma perspective forced without overwriting the rail's
// saved perspective, scope (expiries/window/normalisation) shared through localStorage).
// The desk passes access="allowed" because the page already rendered the entitlement
// gate (app/(shell)/options/page.tsx: FLOW_FIXTURE=1 OR hasLiveOptions() — the same gate
// as /api/flow), so anything inside the desk is already entitled.
// The map and its inspector go side by side when the companion's .mapHost container is
// at least 640px wide (the inspector column is clamp(288px,28%,320px)). The companion's
// grid height is set by its host through custom properties --matrix-rail-max /
// --matrix-rail-max-touch / --matrix-rail-max-phone (components/shared/
// StrikeExpiryMatrixRail.module.css, which we do NOT edit). We set the desktop and
// tablet values inline on a wrapper we own; the phone default applies unless item 5's
// phone threshold fails. The companion calls onPin(null) on mount and when symbol/access
// changes, so onPin MUST be a stable no-op — a per-render closure would force the
// companion to re-pin and reset scope on every parent render.
const OptionsCompanion = dynamic(
  () => import("@/components/options-companion/OptionsCompanion"),
  { ssr: false },
);
const NO_PIN = () => {};
const OptionsResearchLab = dynamic(
  () => import("@/components/researchlab/AdmittedOptionsResearchLab").then((m) => m.AdmittedOptionsResearchLab),
  { ssr: false },
);
import {
  LENS_ALL,
  fmtMn,
  matrixDescribedSessionsMatch,
  matrixExpiryCoverage,
  matrixLensByStrike,
  matrixShareCells,
  matrixSourceSession,
  type ExpiryLens,
  type LensPopulation,
} from "@/lib/gexLadder";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Payload from /api/flow?f=gex:<ROOT> (matches gex_fixture.json schema) */
export interface GexPayload {
  schema: string;
  asof: string;
  root: string;
  spot_ref: number | null;
  net_gex_bn: number | null;
  gamma_flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
  by_strike: {
    strike: number;
    gamma_net: number;
    gamma_call: number;
    gamma_put: number;
    delta_net?: number;
    vanna_net?: number;
    charm_net?: number;
  }[];
  by_expiry?: {
    exp: string;
    gamma_net: number;
    delta_net?: number;
  }[];
  /**
   * The same book indexed by CALL-EQUIVALENT delta rather than by strike (Volland
   * parity W3). Bounds are 0..1; puts are folded onto the call axis upstream, so a
   * −0.30 put appears in the 0.70 bucket. Optional: older payloads predate it.
   */
  by_delta?: {
    lo: number;
    hi: number;
    gamma_net?: number | null;
    delta_net?: number | null;
    vanna_net?: number | null;
    charm_net?: number | null;
    n?: number | null;
  }[];
  /**
   * The §4.2 exposure PROFILE — net dealer gamma re-priced across a ±25% spot grid,
   * from the SAME evaluation that produces gamma_flip (macro engine
   * gex_engine.gamma_profile). Optional: payloads before 2026-08-02 predate it, and
   * an iv-sparse chain publishes null.
   */
  profile?: {
    method?: string;
    span_pct?: number;
    grid: number[];
    gamma_bn: number[];
    crossings?: number[];
  } | null;
  // Optional extended fields (may come from richer server payload)
  hvl?: number | null;
  magnet?: number | null;
  max_pain?: number | null;
  put_call_oi_ratio?: number | null;
  iv30?: number | null;
  convention?: string;
  coverage?: { n_days: number; since: string };
  history?: {
    date: string;
    net_gex_bn: number;
    gamma_flip: number | null;
    call_wall: number | null;
    put_wall: number | null;
    regime: string;
  }[];
}

/**
 * Greek exposure lens. The GEX payload's `by_strike` rows already carry
 * `delta_net`/`vanna_net`/`charm_net` alongside `gamma_net` (built upstream by the
 * Cboe gex_engine) — this switches which one the ladder renders. Walls/flip are a
 * gamma-only overlay, suppressed for the other lenses (see `ladderLevels` below).
 */
export type GreekLens = "gamma" | "delta" | "vanna" | "charm";

const GREEK_LENSES: { key: GreekLens; labelKey: GexDeskKey; fullKey: GexDeskKey }[] = [
  { key: "gamma", labelKey: "greekGamma", fullKey: "greekGammaFull" },
  { key: "delta", labelKey: "greekDelta", fullKey: "greekDeltaFull" },
  { key: "vanna", labelKey: "greekVanna", fullKey: "greekVannaFull" },
  { key: "charm", labelKey: "greekCharm", fullKey: "greekCharmFull" },
];

// ─── Index ETF list (same blacklist as gex_spec §13) ─────────────────────────

const INDEX_ETFS = new Set([
  "SPY", "QQQ", "IWM", "DIA",
  "SPX", "NDX", "RUT", "VIX",
  "XSP", "XND", "SPXW", "RUTW",
]);

function isIndexProduct(root: string): boolean {
  return INDEX_ETFS.has(root.toUpperCase());
}

// Quick picks + datalist universe now live in lib/optionsRoots.ts (shared with
// the Volatility tab's root picker) so the per-root surfaces can't drift apart.

// ─── Polling ──────────────────────────────────────────────────────────────────

const GEX_POLL_MS = 60_000;

// Every desk read keeps its outcome (failure-state truth law): only a 404/410 is a
// published absence; a 5xx, a refused fetch or an unparseable body is a read that did
// not land, and it renders as a load error with a Retry — never as a coverage gap.
async function readFlow(f: string): Promise<FlowOutcome> {
  try {
    return await flowGetResult(f);
  } catch {
    return { status: "unavailable", reason: "network" };
  }
}

/** Where one per-root read stands, tagged with the root it answers for. */
type ReadStatus = "loading" | "data" | "absent" | "unavailable";

// ─── Component ────────────────────────────────────────────────────────────────

export function GexDeskView({ onMapFirstChange }: { onMapFirstChange?: (active: boolean) => void } = {}) {
  const { lang } = useLang();
  const t = makeGexT(lang);

  // ── State ────────────────────────────────────────────────────────────────────
  const [ticker, setTicker]           = useState("SPY");
  const [researchOpen, setResearchOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    const q = new URLSearchParams(window.location.search);
    return q.get("research") === "1" || q.get("view") === "research";
  });
  const researchEntryRef = useRef<HTMLButtonElement>(null);
  const returnFromResearch = useRef(false);
  const [inputVal, setInputVal]       = useState("SPY");
  const [greek, setGreek]             = useState<GreekLens>("gamma");
  // Exposure axis. §5.3 added "matrix" — the strike × expiry grid merged in from the
  // retired PRISM tab. Ladder ("strike") stays the default; a /options?tab=prism deep
  // link is what opens on "matrix" (see the URL effect below).
  const [view, setView]               = useState<"strike" | "expiry" | "matrix">(() => {
    // Deep-link law: the TARGET side handles the alias. /options?tab=prism used to be
    // the PRISM tab; it now lands here, and it must land on the MATRIX view or the old
    // link dead-ends on a ladder the user did not ask for. Read synchronously (this
    // view is dynamic({ssr:false}), so there is no hydration pass to mismatch) — an
    // effect would flash the ladder first and could race the workspace's URL rewrite.
    if (typeof window === "undefined") return "strike";
    const q = new URLSearchParams(window.location.search);
    const axis = q.get("view");
    if (axis === "strike" || axis === "expiry" || axis === "matrix") return axis;
    return q.get("tab") === "prism" ? "matrix" : "strike";
  });
  const openResearch = (open: boolean) => {
    const url = new URL(window.location.href);
    if (open) {
      url.searchParams.set("view", view);
      url.searchParams.set("research", "1");
    } else {
      url.searchParams.delete("research");
      if (url.searchParams.get("view") === "research") url.searchParams.delete("view");
    }
    window.history.replaceState(window.history.state, "", url);
    setResearchOpen(open);
  };
  useEffect(() => {
    if (!researchOpen && returnFromResearch.current) {
      researchEntryRef.current?.focus();
      returnFromResearch.current = false;
    }
  }, [researchOpen]);
  // A name no store can hold (^VIX, $SPX, BRK/B) is never asked for: the route would
  // refuse it with a 400, and a refusal is not a read that can be retried. It renders the
  // coverage gap it really is.
  const rootOk = isValidRoot(ticker);
  const [statePayload, setStatePayload] = useState<GexStatePayload | null>(null);
  const [stateRead, setStateRead] = useState<{ root: string; status: StateReadStatus }>({ root: "", status: "loading" });
  // Selection changes render before passive effects clear state: do not let that
  // interim render put another root's state, OI or levels under this ticker.
  const visibleStatePayload = statePayload?.root === ticker ? statePayload : null;
  // Expiry lens — All / 0DTE / All−0DTE / one expiration. Owned here because BOTH the
  // ladder and the summary bar have to be scoped by it (it used to be ladder-local state
  // with no consumer at all: a dead control).
  const [lens, setLens] = useState<ExpiryLens>(LENS_ALL);
  // options_structure.matrix — the ONLY store carrying strike × expiry together, so it is
  // what makes the lens real. Best-effort: it exists only for some roots (and can run a
  // different session than the gex payload) — absent → the lens reports itself unavailable.
  const [matrix, setMatrix] = useState<MatrixDoc | null>(null);
  const [matrixRead, setMatrixRead] = useState<{ root: string; status: MatrixRead["status"] }>({ root: "", status: "data" });
  // Drops a slow old-root matrix response after the ticker has changed. Envelope root
  // validation stops substitution, but without request ordering an internally valid SPY
  // response can still arrive after a newer QQQ request and clobber QQQ's state.
  const matrixReqRef = useRef(0);
  const stateReqRef = useRef(0);
  // ── Dated session replay (R0.10) ──────────────────────────────────────────
  // sessionDates = the gex_history dates.json index (null = absent/invalid → no dropdown;
  // the scrubber's explicit per-date probe still works — the index is an enumeration aid,
  // not a gate). sessionDate = the archived session being replayed (null = live).
  // Tagged with the root it was read for: a late answer for the previous root is never
  // shown under the new one (datesReqRef drops it; the tag is the render-time fence).
  const [sessionDatesRead, setSessionDatesRead] = useState<{ root: string; dates: string[] | null }>(
    { root: "", dates: null },
  );
  const sessionDates = sessionDatesRead.root === ticker ? sessionDatesRead.dates : null;
  const datesReqRef = useRef(0);
  const [sessionDate, setSessionDate] = useState<string | null>(null);
  const [archivedPayload, setArchivedPayload] = useState<GexPayload | null>(null);
  const [archivedLoading, setArchivedLoading] = useState(false);
  // True when the picked session has no published snapshot (accrual hole / pre-plane
  // date): its own named empty state, never today's ladder wearing an archived label.
  const [archivedMissing, setArchivedMissing] = useState(false);
  // The picked session's read did not land: a load error with a Retry, never the
  // "never published" archive gap above.
  const [archivedError, setArchivedError] = useState(false);
  const sessionReqRef = useRef(0);
  // One retry of the dates-index fetch per ticker (see the payload-arrival effect below).
  const datesRetryRef = useRef(false);
  // PP1-D — the legacy dealer-hedge grid sits behind a closed disclosure inside the
  // Matrix view. Mounting it only when the user opens the disclosure keeps the desk
  // payload off the first paint. Page-local state, reset to closed on ticker change.
  const [hedgeDisclosureOpen, setHedgeDisclosureOpen] = useState(false);

  // GEX payload now arrives over the SSE live spine (push) instead of a 60s poll;
  // the hook falls back to flowGet polling if SSE is unavailable, so this is never
  // worse than before. NOTE: gex data is EOD-nightly — the live connection is a
  // transport upgrade, not live data, so there is deliberately NO "LIVE" badge here;
  // the asof staleness chip remains the honest source of truth on freshness.
  const stream = useFlowStream<Record<string, unknown>>(rootOk ? `gex:${ticker}` : null);
  const streamRaw = rootOk ? stream.data : null;

  // The stream says nothing about WHY it has no frame: an SSE error is a transport
  // fact, a silent stream may never send one, and its polling fallback drops every
  // failure. So the desk makes its own classified read of the same key. Declared after
  // the hook on purpose — the polling fallback's request is already in flight, and the
  // shared cache joins this read onto it instead of opening a second one.
  const [live, setLive] = useState<{ root: string; status: ReadStatus; data: Record<string, unknown> | null }>(
    { root: "", status: "loading", data: null },
  );
  const [liveAttempt, setLiveAttempt] = useState(0);
  useEffect(() => {
    if (!rootOk) return;
    let current = true;
    const root = ticker;
    void readFlow(`gex:${root}`).then((outcome) => {
      if (!current) return;
      setLive(
        outcome.status === "data"
          ? { root, status: "data", data: outcome.data as Record<string, unknown> }
          : { root, status: outcome.status, data: null },
      );
    });
    return () => { current = false; };
  }, [ticker, rootOk, liveAttempt]);

  const retryLive = useCallback(() => {
    flowInvalidate(`gex:${ticker}`);
    setLiveAttempt((n) => n + 1);
  }, [ticker]);

  // A pushed frame always wins: the stream is the fresher source once it speaks.
  const gexRaw = streamRaw ?? (live.root === ticker && live.status === "data" ? live.data : null);
  // Fixture returns the payload directly; prod may key it by root — unwrap either shape.
  const gexPayload: GexPayload | null = gexRaw
    ? (((gexRaw as Record<string, unknown>)[ticker] as GexPayload | undefined) ??
       (gexRaw as unknown as GexPayload))
    : null;
  // Four states, one per read: still reading, a payload, a published absence (404/410,
  // or a name no store can hold), and a read that did not land.
  const liveStatus: ReadStatus = !rootOk
    ? "absent"
    : gexRaw != null
    ? "data"
    : live.root === ticker
    ? live.status
    : "loading";

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch functions ───────────────────────────────────────────────────────────

  const fetchGexState = useCallback(async (root: string) => {
    const request = ++stateReqRef.current;
    const outcome = await readFlow(`gexstate:${root}`);
    // A later ticker/poll owns the result. An old completion, even an error,
    // cannot overwrite newer state; absent or wrong-root current data is null.
    if (request !== stateReqRef.current) return;
    if (outcome.status === "unavailable") {
      // A refresh that did not land keeps the card already on screen, labelled as the
      // last read; a first read that did not land has nothing to keep.
      setStatePayload((prev) => (prev?.root === root ? prev : null));
      setStateRead({ root, status: "unavailable" });
      return;
    }
    const payload = outcome.status === "data" ? readGexStateForRoot(outcome.data, root) : null;
    setStatePayload(payload);
    setStateRead({ root, status: payload ? "data" : "absent" });
  }, []);

  // ── GEX-state feed (market-state card) ─────────────────────────────────────────
  // The gex ladder payload rides the SSE hook above; this separate low-churn feed
  // (gexstate) stays on the light poll and resets on ticker change.

  // Matrix cells feed the expiry lens AND the ladder hover top-3 expiry breakdown.
  // Best-effort: the payload (options_structure.matrix) exists only for some roots —
  // absent → the lens goes dark with a reason and the breakdown is simply omitted.
  // Returns the doc as well as storing it: the matrix view's CONFLUENCE mode refetches
  // SPY/QQQ/IWM through this same reader, so there is one matrix fetch path on the desk.
  // Stable identity on purpose: CONFLUENCE re-reads whenever this function changes.
  const readMatrix = useCallback(async (root: string): Promise<MatrixRead> => {
    // `matrix:{ROOT}` is published FLAT — the desk's pre-§5.3 reader never unwrapped a
    // by-root envelope and its expiry lens works in prod, so no `data[root]` step here.
    const outcome = await readFlow(`matrix:${root}`);
    if (outcome.status !== "data") return { status: outcome.status };
    // A cells-less, wrong-schema, or wrong-root payload — the fixture's honest {} for
    // an unknown root, a malformed upstream doc, or a substituted cache object — resolves
    // to null. A matrix must never wear a different selected ticker's header.
    return { status: "data", doc: isMatrixDocForRoot(outcome.data, root) ? outcome.data : null };
  }, []);

  const fetchMatrix = useCallback(async (root: string) => {
    const req = ++matrixReqRef.current;
    const read = await readMatrix(root);
    if (matrixReqRef.current !== req) return;
    setMatrixRead({ root, status: read.status });
    if (read.status === "unavailable") {
      setMatrix((prev) => (isMatrixDocForRoot(prev, root) ? prev : null));
    } else {
      setMatrix(read.status === "data" ? read.doc : null);
    }
  }, [readMatrix]);

  const retryState = useCallback(() => {
    flowInvalidate(`gexstate:${ticker}`);
    void fetchGexState(ticker);
  }, [fetchGexState, ticker]);

  const retryMatrix = useCallback(() => {
    flowInvalidate(`matrix:${ticker}`);
    void fetchMatrix(ticker);
  }, [fetchMatrix, ticker]);

  // Sessions index for the dated-ladder plane. Validated (isGexDates) before it drives
  // the dropdown: a malformed index degrades to no-dropdown, never a coerced list.
  // The index is an enumeration aid, not a claim: an index that was not read and one
  // that is not published both mean "no dropdown", and the copy says nothing either way.
  const fetchSessionDates = useCallback(async (root: string) => {
    const request = ++datesReqRef.current;
    const outcome = await readFlow(`gex_dates:${root}`);
    if (request !== datesReqRef.current) return;
    const data = outcome.status === "data" ? outcome.data : null;
    setSessionDatesRead({ root, dates: isGexDates(data) && data.dates.length > 0 ? data.dates : null });
  }, []);

  // Load one archived session's FULL ladder — or return to live (date = null). The
  // request counter drops stale responses: a slow probe must not clobber a newer pick
  // (or a return-to-live) that resolved first.
  const loadSession = useCallback(
    (date: string | null) => {
      const req = ++sessionReqRef.current;
      if (!date) {
        setSessionDate(null);
        setArchivedPayload(null);
        setArchivedMissing(false);
        setArchivedError(false);
        setArchivedLoading(false);
        return;
      }
      setSessionDate(date);
      setArchivedLoading(true);
      setArchivedMissing(false);
      setArchivedError(false);
      setArchivedPayload(null);
      void (async () => {
        const outcome = await readFlow(`gex_at:${ticker}:${date}`);
        if (sessionReqRef.current !== req) return;
        const data = outcome.status === "data" ? (outcome.data as GexPayload) : null;
        const ok = !!data && Array.isArray(data.by_strike) && data.by_strike.length > 0;
        setArchivedPayload(ok ? data : null);
        // A session the store never published is a gap; a read that did not land is not.
        setArchivedError(outcome.status === "unavailable");
        setArchivedMissing(!ok && outcome.status !== "unavailable");
        setArchivedLoading(false);
      })();
    },
    [ticker]
  );

  useEffect(() => {
    setStatePayload(null);
    setLens(LENS_ALL);
    setMatrix(null);
    // PP1-D — reset the hedge-grid disclosure every ticker change so a new root never
    // inherits the previous root's "open" state.
    setHedgeDisclosureOpen(false);
    // Ticker change always lands on the LIVE session; invalidate in-flight probes.
    sessionReqRef.current++;
    datesRetryRef.current = false;
    datesReqRef.current++;
    setSessionDatesRead({ root: "", dates: null });
    setSessionDate(null);
    setArchivedPayload(null);
    setArchivedMissing(false);
    setArchivedError(false);
    setArchivedLoading(false);
    // Fence whatever the previous root still has in flight, then ask nothing at all
    // for a name the route would refuse.
    stateReqRef.current++;
    matrixReqRef.current++;
    if (!rootOk) return;
    void fetchGexState(ticker);
    void fetchMatrix(ticker);
    void fetchSessionDates(ticker);

    pollRef.current = setInterval(() => void fetchGexState(ticker), GEX_POLL_MS);

    // Hidden-tab deferral: refresh on becoming visible so the card isn't stale.
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchGexState(ticker);
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stateReqRef.current++;
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  // The dates-index fetch is one-shot on mount and a cold server can lose that race
  // (mount-fetch race — the same class the manifest/intel fetch documents). Once the
  // live payload proves the desk's data path is up, give the index exactly one more
  // chance per ticker; a root with no index still resolves to null and stays quiet.
  useEffect(() => {
    if (rootOk && gexPayload && sessionDates === null && !datesRetryRef.current) {
      datesRetryRef.current = true;
      void fetchSessionDates(ticker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gexPayload, sessionDates]);

  // ── Input handlers ────────────────────────────────────────────────────────────

  const commitTicker = useCallback(() => {
    const root = inputVal.trim().toUpperCase();
    if (root && root !== ticker) {
      trackSearch(root, "gex-desk", inputVal.trim() || undefined);
      setTicker(root);
    }
  }, [inputVal, ticker]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") commitTicker();
    },
    [commitTicker]
  );

  // ── Derived values ────────────────────────────────────────────────────────────

  // The payload every exposure surface below reads: the archived session's full ladder
  // while replaying, the live spine otherwise. The scrubber strip alone stays pinned to
  // the LIVE payload (it is the navigation, and an archived payload's history is cut to
  // that session's past by construction).
  const isArchived = sessionDate != null;
  const activePayload = isArchived ? archivedPayload : gexPayload;
  // The existing EOD belt remains the sole Exposure reader; its error-vs-404
  // retry semantics remain unchanged. Activate the shared-cache IV hook only
  // when the Lab replaces the belt, never as a parallel Exposure fetch owner.
  const researchEod = useEodContext(ticker, researchOpen && !isArchived && rootOk);
  // PP1-D — exactly the condition under which the :973 branch (the live Matrix view)
  // renders today. The matrix view paints a SHARED gamma map instead of the legacy
  // ExposureMatrix; the history strip and EOD belt move below the map; the legacy
  // dealer-hedge grid moves into a closed disclosure below the map. The branches above
  // (archived loading / error / missing; live loading / unavailable / absent; archived
  // matrix) all keep their own rendering and stay reachable, so the session picker is
  // always on the page.
  const mapFirst = !researchOpen && !isArchived && liveStatus === "data" && view === "matrix";
  useEffect(() => { onMapFirstChange?.(mapFirst); }, [mapFirst, onMapFirstChange]);

  const spot = activePayload?.spot_ref ?? null;
  const asof = activePayload?.asof ?? null;

  const isIndex = isIndexProduct(ticker);

  // Guard a nonsense gamma_flip. The threshold used to live inline here; it now sits in
  // lib/marketStructure.ts so this desk and the Positioning tab cannot disagree about
  // which flips are drawable, and so the whole workaround is deleted in one place when
  // MSC R1.1 repairs the builder. Root cause + measurements:
  // docs/audits/2026-08-01-market-structure-core/gamma-flip-defect-rca.md
  const gammaFlip = activePayload?.gamma_flip ?? null;
  const levels = {
    callWall: activePayload?.call_wall ?? null,
    putWall: activePayload?.put_wall ?? null,
    gammaFlip,
    hvl: activePayload?.hvl ?? null,
  };

  // ── Expiry lens plumbing ─────────────────────────────────────────────────────
  // The gex payload gives per-STRIKE (all expiries) and per-EXPIRY (all strikes); only
  // the matrix carries the two axes crossed. So: All reads by_strike; every narrower lens
  // is summed out of the matrix here, once, and handed to both consumers below.
  //
  // Both matrix reads are anchored to the matrix's own source session (`_build_meta.asof_date`),
  // never its build clock or the wall clock, and are used only when that session matches the
  // GEX payload's — an EOD snapshot's "0DTE" is a property of the snapshot's session, not today.
  // Render-time identity fence: React effects clear the prior ticker's matrix only after
  // the ticker-change commit. Gate every consumer synchronously so an already-resolved
  // SPY document can never flash under a newly selected QQQ header for even one render.
  const visibleMatrix = isMatrixDocForRoot(matrix, ticker) ? matrix : null;
  // The same render-time fence for each read's outcome: a status answers only for the
  // root it was read for, and until this root's read lands it is still being read.
  const matrixStatus: ReadStatus = !rootOk
    ? "absent"
    : matrixRead.root === ticker
    ? matrixRead.status
    : "loading";
  // Nothing on screen to keep, and the read did not land.
  const matrixUnread = matrixStatus === "unavailable" && !visibleMatrix;
  const stateStatus: StateReadStatus = !rootOk
    ? "absent"
    : stateRead.root === ticker
    ? stateRead.status
    : "loading";
  // The EOD belt prints its level cells from these two stores, so it is told how each
  // read stands. A payload on screen is an answer, even when its latest refresh failed.
  const beltLevelReads = {
    gexstate: visibleStatePayload ? "data" : stateStatus,
    gex: gexPayload ? "data" : liveStatus,
  } as const;
  const retryBeltLevels = useCallback(() => {
    if (beltLevelReads.gexstate === "unavailable") retryState();
    if (beltLevelReads.gex === "unavailable") retryLive();
  }, [beltLevelReads.gexstate, beltLevelReads.gex, retryState, retryLive]);

  const ladderStrikes = useMemo(
    () => (activePayload?.by_strike ?? []).map((s) => s.strike),
    [activePayload?.by_strike]
  );

  // The population every narrow lens is judged over: the strikes the ladder SHOWS × the
  // chain expirations the lens NAMES (gex `by_expiry`). The matrix is windowed differently
  // (±20% strikes uncapped, ≤90 DTE), so a required pair it lacks withholds the total, and a
  // matrix strike off the ladder never enters it — the headline, the WallChip and the rows
  // stay one population. No `by_expiry` → the chain is unknown and no narrow total is stated.
  const byExpiry = activePayload?.by_expiry;
  const lensPopulation = useMemo<LensPopulation>(
    () => ({ strikes: ladderStrikes, expiries: Array.isArray(byExpiry) ? byExpiry.map((e) => e.exp) : null }),
    [ladderStrikes, byExpiry]
  );

  // Honesty gate: the matrix's SOURCE session (`_build_meta.asof_date`, never its build
  // clock) must be the session the gex payload describes — the coupled view puts both on
  // one ladder. Otherwise the matrix covers nothing so every narrow-lens control goes dark
  // (existing honest-unavailable state) instead of letting the user select a lens that
  // would sum — or mislabel 0DTE — across two different sessions (see lib/gexLadder.ts).
  const matrixSourceDay = matrixSourceSession(visibleMatrix);
  const matrixSessionOk = matrixDescribedSessionsMatch(matrixSourceDay, asof);

  // Which expiries the matrix can actually answer for THIS ladder (see lib/gexLadder.ts —
  // it demands a real strike overlap, so two stores on different sessions read as "no
  // coverage" rather than producing a ladder of dashes).
  const lensCoverage = useMemo(
    () => (matrixSessionOk ? matrixExpiryCoverage(visibleMatrix, ladderStrikes) : new Set<string>()),
    [visibleMatrix, ladderStrikes, matrixSessionOk]
  );

  // The matrix is gamma-only: under DEX/VEX/CHEX no narrow lens exists, so the ladder and
  // summary read the all-expiry aggregate and a gamma expiry split is never shown under a
  // non-gamma label. (The greek chips also reset the lens; this guards every other path.)
  const effectiveLens = greek === "gamma" ? lens : LENS_ALL;

  const lensValues = useMemo(
    () => matrixLensByStrike(visibleMatrix, effectiveLens, asof, "coupled-view", lensPopulation),
    [visibleMatrix, effectiveLens, asof, lensPopulation]
  );
  // One unknown selected cell withholds the total; the known part is disclosed, labelled,
  // and so is any part of the population the per-expiration snapshot does not carry.
  const lensOutside = lensValues.missingStrikeCount + lensValues.missingExpiryCount > 0;
  const lensPartial =
    effectiveLens.kind !== "all" && lensValues.totalMn == null
    && (lensValues.knownTotalMn != null || lensOutside);

  // The strike tooltip's per-expiry shares renormalise over the cells handed in, so they are
  // offered only for a strike whose whole live gamma grid is known, on the gex session, and
  // never under a non-gamma greek (the matrix is gamma-only).
  const matrixCells = useMemo(
    () => (greek === "gamma" ? matrixShareCells(visibleMatrix, effectiveLens, asof, lensPopulation) : null),
    [greek, visibleMatrix, effectiveLens, asof, lensPopulation]
  );

  // Strike-window disclosure for the summary bar's scoped Net GEX (bug: the hero used to
  // swap strike universe under a narrow lens while naming only the expiry scope). N of the
  // ladder's own strikes the lens actually covers, out of the ladder's full strike count.
  const lensCoveredStrikeCount = useMemo(
    () => ladderStrikes.filter((k) => lensValues.covered.has(k)).length,
    [ladderStrikes, lensValues]
  );

  // Walls / flip are gamma-specific constructs. When a non-gamma lens is active,
  // suppress them so the ladder never draws a gamma "WALL"/"SUPPORT"/"FLIP" tag over a
  // DEX/VEX/CHEX view (that would be misleading — those levels aren't defined per-greek).
  const ladderLevels =
    greek === "gamma"
      ? levels
      : { callWall: null, putWall: null, gammaFlip: null, hvl: null };

  // Preserve state-first flip precedence using only the selected root. Current
  // Macro's matrix fallback also uses the raw-chain profile method; missing or
  // invalid price levels remain unavailable (see matrixDoc.mergeMatrixLevels).
  const matrixLevels = useMemo(
    () => mergeMatrixLevels(visibleMatrix, visibleStatePayload),
    [visibleMatrix, visibleStatePayload]
  );

  // Format spot for display
  const spotStr =
    spot != null
      ? spot < 10
        ? spot.toFixed(3)
        : spot < 100
        ? spot.toFixed(2)
        : spot.toFixed(2)
      : "—";

  // Format asof — show the DATE + a staleness chip, not just the time, so a stale
  // GEX snapshot (options-hub is EOD-nightly) reads honestly instead of looking live.
  let asofStr = "";
  let asofStale = false;
  let asofAgeStr = "";
  if (asof) {
    try {
      const d = new Date(asof);
      asofStr = d.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
        timeZone: "America/New_York",
      }) + " ET";
      const etDay = (dt: Date) => dt.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const ageDays = Math.round((Date.parse(etDay(new Date())) - Date.parse(etDay(d))) / 86_400_000);
      if (ageDays > 0) {
        asofStale = true;
        asofAgeStr = ageDays <= 1 ? t("lastSession") : t("daysOld").replace("{n}", String(ageDays));
      }
    } catch {
      asofStr = asof.slice(0, 16).replace("T", " ");
    }
  }

  const legacyControls = <>
<div style={GREEK_GROUP} role="group" aria-label={t("greekLensAria")}>
          <span className="obs-lbl" style={{ marginRight: 2 }}>{t("greekLensAria")}</span>
          {GREEK_LENSES.map((g) => (
            <button
              key={g.key}
              className={`chip${greek === g.key ? " on" : ""}`}
              style={GREEK_CHIP}
              aria-pressed={greek === g.key}
              aria-label={t(g.fullKey)}
              onClick={() => {
                setGreek(g.key);
                if (g.key !== "gamma") setLens(LENS_ALL);
              }}
            >
              {t(g.labelKey)}
            </button>
          ))}
        </div>

        <div style={CONTROLS_RIGHT}>
          {greek !== "gamma" && (
            <span style={LENS_NOTE}>{t("greekLensNote")}</span>
          )}
          {/* Archived-session chip (R0.10): the one label that says the whole desk below
              is replaying a settled session, with the way back beside it. */}
          {isArchived && (
            <span style={ARCHIVED_CHIP} data-testid="gex-archived-chip">
              {t("archivedChip").replace("{date}", sessionDate ?? "")}
              <button style={ARCHIVED_BACK} onClick={() => loadSession(null)}>
                {t("backToLive")}
              </button>
            </span>
          )}
          {asofStr && (
            <span style={asofStale ? { ...ASOF_BADGE, color: "var(--warn)" } : ASOF_BADGE}>
              {t("asOf")} {asofStr}
              {asofStale && <span style={{ marginLeft: 5, fontWeight: 600 }}>· {asofAgeStr}</span>}
            </span>
          )}
          {liveStatus === "loading" && !isArchived && (
            <span style={LOADING_BADGE}>{t("loading")}</span>
          )}
        </div>
  </>;
  const legacySummary = <>
{!(isArchived
        ? archivedMissing || archivedError
        : liveStatus === "absent" || liveStatus === "unavailable") && (
      <GexSummaryBar
        payload={activePayload}
        /* gexstate OI describes the CURRENT session — never dress an archived bar in it. */
        callOI={isArchived ? null : (visibleStatePayload as unknown as Record<string, number | null | undefined>)?.call_oi ?? null}
        putOI={isArchived ? null : (visibleStatePayload as unknown as Record<string, number | null | undefined>)?.put_oi ?? null}
        lens={effectiveLens}
        lensNetMn={lensValues.totalMn}
        lensCoveredStrikes={lensCoveredStrikeCount}
        lensTotalStrikes={ladderStrikes.length}
        lang={lang}
      />
      )}
      {!(isArchived && archivedMissing) && lensPartial && (
        <div style={LENS_PARTIAL} data-testid="gex-lens-partial" role="note">
          {lensValues.knownTotalMn != null && t("lensPartialNote")
            .replace("{k}", String(lensValues.unresolvedPairCount))
            .replace("{v}", fmtMn(lensValues.knownTotalMn))}
          {lensOutside && (
            <span>
              {lensValues.knownTotalMn != null ? " " : ""}
              {t("lensOutsideNote")
                .replace("{s}", String(lensValues.missingStrikeCount))
                .replace("{e}", String(lensValues.missingExpiryCount))}
            </span>
          )}
          {matrixSourceDay && <span style={{ opacity: 0.75 }}> · {matrixSourceDay}</span>}
        </div>
      )}
  </>;
  const legacyCards = <>
{/* HeatSeeker — the ONLY consumer of the matrix payload's published
                heat_seeker field. It rode in from the retired PRISM tab (§5.3) rather
                than dying with it. A current-session read like the state card below,
                so it is withdrawn during archived replay along with them. */}
            <div style={HEATSEEKER_SLOT}>
              <HeatSeekerCard
                pick={visibleMatrix?.heat_seeker ?? null}
                spot={visibleMatrix?.spot ?? spot ?? null}
                sessionAnchor={visibleMatrix?._build_meta?.asof_date ?? null}
                lang={lang}
                reading={matrixStatus === "loading"}
                readFailed={matrixUnread}
                onRetry={retryMatrix}
                absent={matrixStatus === "absent" && !visibleMatrix}
              />
            </div>
            <MarketStateCard
              statePayload={visibleStatePayload}
              gexPayload={gexPayload}
              isIndexProduct={isIndex}
              lang={lang}
              stateRead={stateStatus}
              onRetry={retryState}
            />
  </>;

  const quickRoots = <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {GEX_QUICK_ROOTS.map((r) => (
              <button
                key={r}
                className={`chip${ticker === r ? " on" : ""}`}
                style={{ height: 24, fontSize: 11, fontWeight: 700, letterSpacing: "0.03em" }}
                onClick={() => { if (r !== ticker) trackSearch(r, "gex-desk"); setInputVal(r); setTicker(r); }}
              >
                {r}
              </button>
            ))}
          </div>;

  const axisControls = <div style={VIEW_TOGGLE_ROW} role="group" aria-label={t("viewAria")}>
            <button
              className={`chip${view === "strike" ? " on" : ""}`}
              style={VIEW_CHIP}
              aria-pressed={view === "strike"}
              onClick={() => setView("strike")}
            >
              {t("viewByStrike")}
            </button>
            <button
              className={`chip${view === "expiry" ? " on" : ""}`}
              style={VIEW_CHIP}
              aria-pressed={view === "expiry"}
              onClick={() => setView("expiry")}
            >
              {t("viewByExpiry")}
            </button>
            <button
              className={`chip${view === "matrix" ? " on" : ""}`}
              style={VIEW_CHIP}
              aria-pressed={view === "matrix"}
              /* No aria-label here on purpose: an aria-label OUTRANKS the visible text in
                 accessible-name computation, so "Matrix" became unreachable by its own
                 label (getByRole("button", { name: "Matrix" }) could never match). The
                 visible text is a perfectly good accessible name. */
              onClick={() => setView("matrix")}
            >
              {t("viewMatrix")}
            </button>
          </div>;

  // ── Render ────────────────────────────────────────────────────────────────────

  if (researchOpen) return (
    <OptionsResearchLab key={ticker} root={ticker}
      matrix={isArchived ? null : visibleMatrix}
      matrixReadStatus={isArchived || !rootOk ? "data" : matrixStatus}
      onRetryMatrix={isArchived || !rootOk ? undefined : retryMatrix}
      volatility={researchEod.vol}
      volReadStatus={researchOpen && !isArchived && rootOk ? researchEod.volStatus : "data"}
      onRetryVol={researchOpen && !isArchived && rootOk ? researchEod.retryVol : undefined}
      lang={lang}
      onClose={() => { returnFromResearch.current = true; openResearch(false); }} />
  );

  return (
    <div style={DESK_OUTER} className={`obs obs-ambient${mapFirst ? " obs-gexdesk-map-first" : ""}`} data-gex-map-first={mapFirst ? "true" : undefined}>

      {/* ── Controls bar ──────────────────────────────────────────────────── */}
      <div style={mapFirst ? { ...CONTROLS_BAR, padding: "4px 8px", gap: 6, flexWrap: "nowrap" } : CONTROLS_BAR} className="obs-gexdesk-controls">
        <div style={mapFirst ? { ...TICKER_GROUP, gap: 6, flexWrap: "nowrap" } : TICKER_GROUP}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--muted)" strokeWidth="2"
              style={{ position: "absolute", left: 8, pointerEvents: "none" }}>
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" />
            </svg>
            <input
              style={mapFirst ? { ...TICKER_INPUT, width: 96, height: 44 } : TICKER_INPUT}
              list="gex-roots"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value.toUpperCase())}
              onBlur={commitTicker}
              onKeyDown={handleKeyDown}
              placeholder={t("tickerPlaceholder")}
              aria-label={t("tickerInputLabel")}
              spellCheck={false}
              maxLength={12}
            />
            <datalist id="gex-roots">
              {GEX_AUTOCOMPLETE_ROOTS.map((r) => <option key={r} value={r} />)}
            </datalist>
          </div>
          {!mapFirst && spot != null && (
            <span style={SPOT_DISPLAY}>
              {spotStr}
            </span>
          )}
          {mapFirst ? <details className="obs-gexdesk-root-chooser"><summary>{t("quickRoots")}</summary>{quickRoots}</details> : quickRoots}
        </div>

        {/* Greek exposure lens — GEX / DEX / VEX / CHEX. Switches which per-strike
            greek the ladder renders from the by_strike payload (data already present). */}
        {!mapFirst && legacyControls}
        {mapFirst && <details className="obs-gexdesk-view-chooser"><summary>{t("exposureMap")}</summary>{axisControls}</details>}
        {/* Keep this entry in the existing 44px toolbar. A separate row pushes
            the phone's map and selected Inspect below the viewport. */}
        <button ref={researchEntryRef} type="button" className="chip"
          style={mapFirst ? { flex: "none", padding: "0 6px", minWidth: 40 } : { flex: "none" }}
          aria-label={lang === "zh" ? "3D 期权研究室" : "3D Research Lab"}
          onClick={() => openResearch(true)}>
          {mapFirst ? "3D" : lang === "zh" ? "3D 期权研究室" : "3D Research Lab"}
        </button>
      </div>

      {/* The stream's latest read of this root did not land: the ladder below is the last
          one that did, and says so, with a Retry that re-reads now. */}
      {!isArchived && gexPayload && stream.stale && (
        <div style={LIVE_STALE_ROW} data-testid="gex-live-refresh-failed" role="alert">
          <span>{t("liveRefreshFailed")}</span>
          <button type="button" className="btn btn-ghost load-retry" onClick={stream.retry}>
            {t("errorRetry")}
          </button>
        </div>
      )}

      {/* ── Summary bar ──────────────────────────────────────────────────── */}
      {/* Withdrawn whenever nothing is being read: the bar's only null-payload render is
          a "Loading…" skeleton, so an absent, unread or missing-session payload would
          leave it claiming a read that is not happening — the ladder region names which
          of those it is. */}
      {!mapFirst && legacySummary}

      {/* ── GEX history strip — the session scrubber, now also the date picker for the
             dated-ladder plane (R0.10). Deliberately reads the LIVE payload's history in
             both modes: it is the navigation surface, not part of the replay. ──────
          PP1-D — in the Matrix view the strip sits BELOW the shared gamma map (the
          user reaches it by scrolling the wrapper). mapFirst gates the top-level
          render; the Matrix view renders the same component with the same props
          inside the wrapper. Picking an archived session turns mapFirst off and the
          strip remounts at the top — its internal `sel` resets by design (see DEVIATIONS). */}
      {!mapFirst && (
      <GexHistory
        history={gexPayload?.history}
        lang={lang}
        sessionDates={sessionDates}
        activeSession={sessionDate}
        liveDate={gexSessionOf(gexPayload?.asof)}
        onLoadSession={loadSession}
        historyState={
          liveStatus === "loading" ? "pending" : liveStatus === "unavailable" ? "unavailable" : undefined
        }
      />
      )}

      {/* ── EOD context belt (OEU T-E) ───────────────────────────────────────
          Settled-close structure + off-exchange positioning for the SAME root, sitting
          between the live-transport summary bar and the ladder. It reads different stores
          than the bar above it (gex_state, options_hub/moves, options_hub/vol) and stamps
          every value with that store's own session, so the cadence boundary between the
          desk's live spine and macro's nightly close is visible rather than assumed. */}
      {/* Hidden during replay: every belt store (gex_state, moves, vol) is a CURRENT-
          session read with no dated twin — an archived ladder wearing today's context
          would be the exact cross-session adjacency the belt exists to prevent. */}
      {/* PP1-D — in the Matrix view the belt sits BELOW the shared gamma map (under
          the session picker). It is rendered here for every non-Matrix state so the
          non-Matrix views keep their belt on the ladder's first paint. */}
      {!isArchived && !mapFirst && (
        <EodContextBelt
          root={ticker}
          gexState={visibleStatePayload}
          gex={gexPayload}
          lang={lang}
          levelReads={beltLevelReads}
          onRetryLevels={retryBeltLevels}
        />
      )}

      {/* ── Body (two-pane) ──────────────────────────────────────────────── */}
      <div style={BODY_ROW} className="obs-gexdesk-body">

        {/* ── Left pane: Guide + Ladder ─────────────────────────────────── */}
        <div style={LEFT_PANE} className="obs-gexdesk-left">
          {/* GexGuide documents the LADDER's colour ramp (greek exposure on the
              direction tokens). The matrix view paints a dealer HEDGE on the
              aggressor-side pair — a different, deliberately non-flipping law — so
              showing the ladder's legend beside it would teach the wrong key, and it
              costs ~70px the 40-row grid needs. The matrix ships its own legend. */}
          {view !== "matrix" && <GexGuide lang={lang} />}
          {/* Exposure axis: By Strike (ladder) / By Expiration (bars). The by_expiry
              series is already in the payload — previously used only as a filter. */}
          {!mapFirst && axisControls}
          {/* Ladder region — the ONLY part of the left column that flexes. It owns its own
              overflow, so the drawer below can expand without pushing anything out of the
              desk (and, crucially, without changing the RIGHT column's height at all).
              The class carries the ≤860px floor (observatory.css): in the phone/tablet
              page-scroll mode every ancestor height is auto, so flex:1 1 0px resolves to
              a 0px band and the whole ladder vanishes. PP1-D — when the Matrix view
              mounts inside, the additional class lets the ≤860px rule grow the region
              to fit the matrix content (the inner matrix view is page content too). */}
          <div
            style={LADDER_REGION}
            className={`obs-gexdesk-ladder-region${mapFirst ? " obs-gexdesk-matrix-region" : ""}`}
          >
            {isArchived && archivedLoading ? (
              <div style={LADDER_LOADING}>{t("archivedLoading")}</div>
            ) : isArchived && archivedError ? (
              /* The picked session's read did not land. Not the archive gap below: the
                 session may well be published, so the reader gets a way to ask again. */
              <div style={LADDER_EMPTY} data-testid="gex-archived-error" role="alert">
                <div style={LADDER_EMPTY_TITLE}>
                  {t("archivedErrorTitle").replace("{date}", sessionDate ?? "")}
                </div>
                <div style={LADDER_EMPTY_WHY}>{t("archivedErrorWhy")}</div>
                <button
                  type="button"
                  className="btn btn-ghost load-retry"
                  onClick={() => {
                    if (!sessionDate) return;
                    flowInvalidate(`gex_at:${ticker}:${sessionDate}`);
                    loadSession(sessionDate);
                  }}
                >
                  {t("errorRetry")}
                </button>
              </div>
            ) : isArchived && archivedMissing ? (
              /* Honest missing-session state: the picked date has no published snapshot
                 (accrual hole / pre-plane session). Named as an archive gap — never the
                 live ladder wearing an archived label, never a fabricated one. */
              <div style={LADDER_EMPTY} data-testid="gex-archived-missing">
                <div style={LADDER_EMPTY_TITLE}>
                  {t("archivedMissingTitle").replace("{date}", sessionDate ?? "")}
                </div>
                <div style={LADDER_EMPTY_WHY}>{t("archivedMissingWhy")}</div>
              </div>
            ) : !isArchived && liveStatus === "loading" ? (
              <div style={LADDER_LOADING}>{t("loadingGex")}</div>
            ) : !isArchived && liveStatus === "unavailable" ? (
              /* The snapshot read did not land (5xx, refused fetch, unparseable body). It
                 says nothing about coverage, so it is never dressed as the gap below. */
              <div style={LADDER_EMPTY} data-testid="gex-load-error" role="alert">
                <div style={LADDER_EMPTY_TITLE}>{t("errorGex")}</div>
                <div style={LADDER_EMPTY_WHY}>
                  {t("gexLoadErrorWhy").replace("{sym}", ticker)}
                </div>
                <button type="button" className="btn btn-ghost load-retry" onClick={retryLive}>
                  {t("errorRetry")}
                </button>
              </div>
            ) : !isArchived && liveStatus === "absent" ? (
              /* Honest empty: the nightly options build re-pulls index anchors first, so a
                 missing single name is a COVERAGE gap, not a broken desk. Only a proven
                 absence (404/410, or a name no store can hold) reaches this branch. */
              <div style={LADDER_EMPTY}>
                <div style={LADDER_EMPTY_TITLE}>{t("gexNoSnapshot")}</div>
                <div style={LADDER_EMPTY_WHY}>
                  {t("gexNoSnapshotWhy").replace("{sym}", ticker)}
                </div>
              </div>
            ) : isArchived && view === "matrix" ? (
              /* The matrix store is a CURRENT-session read with no dated twin (like the
                 EOD belt and the state card). Rendering it inside an archived frame would
                 caption today's grid with a settled past session — the exact cross-session
                 adjacency replay mode exists to prevent. The view is NOT switched out from
                 under the user; the gap is named instead. */
              <div style={LADDER_EMPTY} data-testid="gex-archived-matrix">
                <div style={LADDER_EMPTY_TITLE}>{t("archivedMatrixTitle")}</div>
                <div style={LADDER_EMPTY_WHY}>{t("archivedMatrixNote")}</div>
              </div>
            ) : view === "matrix" ? (
              /* PP1-D — Matrix view opens on the shared gamma map (OptionsCompanion with
                 host="page"). Map first; legacy dealer-hedge grid in a closed named
                 disclosure below the map; session picker and EOD belt below the map.
                 Companion reuses the rail's localStorage scope; its grid height is set by
                 the wrapper's --matrix-rail-max / --matrix-rail-max-touch custom
                 properties. Picking an archived session turns mapFirst off (liveStatus
                 becomes "data" still, but the wrapper is unmounted) and the session
                 picker is re-rendered at the top — it is the navigation surface. */
              <div
                data-testid="gex-matrix-view"
                className="obs-gexdesk-matrix-view"
                style={MATRIX_VIEW}
              >
                <div
                  data-testid="gex-matrix-map"
                  className="obs-gexdesk-matrix-map"
                  style={{
                    "--matrix-rail-max": "304px",
                    "--matrix-rail-max-touch": "311px",
                  } as React.CSSProperties}
                >
                  <OptionsCompanion
                    host="page"
                    symbol={ticker}
                    access="allowed"
                    pinned={null}
                    onPin={NO_PIN}
                    replayActive={false}
                  />
                </div>
                <details className="obs-gexdesk-legacy-context" data-testid="gex-legacy-context">
                  <summary>{t("legacyContext")}</summary>
                  <p>{t("legacyContextNote")}</p>
                  <div className="obs-gexdesk-legacy-controls">{legacyControls}<VolRegimeChip lang={lang} /></div>
                  {legacySummary}
                  <div className="obs-gexdesk-legacy-cards">{legacyCards}</div>
                </details>
                <details
                  data-testid="gex-legacy-hedge-matrix"
                  className="obs-gexdesk-hedge-disclosure"
                  open={hedgeDisclosureOpen}
                  onToggle={(e) => setHedgeDisclosureOpen((e.currentTarget as HTMLDetailsElement).open)}
                >
                  <summary>{t("matrixHedgeDisclosure")}</summary>
                  {hedgeDisclosureOpen && (
                    <ExposureMatrix
                      matrix={visibleMatrix}
                      levels={matrixLevels}
                      spot={spot}
                      fetchMatrix={readMatrix}
                      lang={lang}
                      matrixUnread={matrixUnread}
                      onRetry={retryMatrix}
                      sym={ticker}
                    />
                  )}
                </details>
                <GexHistory
                  history={gexPayload?.history}
                  lang={lang}
                  sessionDates={sessionDates}
                  activeSession={sessionDate}
                  liveDate={gexSessionOf(gexPayload?.asof)}
                  onLoadSession={loadSession}
                  historyState={undefined}
                />
                <EodContextBelt
                  root={ticker}
                  gexState={visibleStatePayload}
                  gex={gexPayload}
                  lang={lang}
                  levelReads={beltLevelReads}
                  onRetryLevels={retryBeltLevels}
                />
              </div>
            ) : view === "strike" ? (
              <StrikeLadder
                strikes={activePayload?.by_strike ?? []}
                spot={spot}
                levels={ladderLevels}
                greek={greek}
                byExpiry={activePayload?.by_expiry ?? null}
                lens={effectiveLens}
                onLens={setLens}
                lensValues={lensValues}
                lensCoverage={lensCoverage}
                asOf={asof}
                matrixAsOf={matrixSourceDay}
                lang={lang}
                netGexBn={activePayload?.net_gex_bn ?? null}
                matrixCells={matrixCells}
                matrixUnread={matrixUnread}
              />
            ) : (
              <ExpiryBars
                byExpiry={activePayload?.by_expiry ?? null}
                greek={greek}
                asOf={asof}
                lang={lang}
              />
            )}
          </div>

          {/* ── Exposure-by-Expiry term-structure drawer (RECON §4.5) ──────────
              CONTAINMENT: the drawer lives INSIDE the left column, below the ladder it
              annotates. It used to be a sibling of BODY_ROW in the desk's outer column,
              which meant opening it stole height from the whole two-pane row: the Market
              State card was squeezed until its own overflow:auto kicked in, the user
              scrolled inside it, and collapsing the drawer left that scrollTop parked —
              the card came back "pushed up" with its header off-screen and no obvious way
              to recover. Scoped here, expanding/collapsing can only ever re-flow the
              ladder (which has its own internal scroll and self-restores), and the right
              column's height never changes. */}
          {/* Withdrawn in matrix view: the drawer is a by-expiry term structure of the
              greek ladder, and the matrix IS the strike × expiry breakdown — keeping both
              would duplicate the expiry axis under two different colour conventions. */}
          {view !== "matrix" && (
          <div style={XDRAWER_SLOT}>
            <ExposureExpiryDrawer
              byExpiry={activePayload?.by_expiry ?? null}
              greek={greek}
              asOf={activePayload?.asof ?? null}
              lang={lang}
            />
          </div>
          )}
        </div>

        {/* ── Right pane: Market state ──────────────────────────────────────
            An independent min-height:0 / overflow-y:auto region (see CARD_OUTER in
            MarketStateCard) — it derives its scroll geometry from BODY_ROW's height alone,
            never from what the left column is doing. During replay the state card (a
            current-session read, like the belt) is withdrawn and REPLACED by a card that
            says so — an empty rail would read as breakage, not honesty. */}
        {isArchived ? (
          <div className="obs-card" style={ARCHIVED_PANE}>
            <div className="obs-card-hd" style={{ padding: "10px 14px 0" }}>
              <span className="obs-lbl">{t("archivedPaneTitle")}</span>
            </div>
            <div style={ARCHIVED_PANE_BODY}>
              <span style={ARCHIVED_PANE_DATE}>{sessionDate}</span>
              <span style={ARCHIVED_PANE_NOTE}>{t("archivedPaneNote")}</span>
              <button
                style={{ ...ARCHIVED_BACK, alignSelf: "flex-start", marginLeft: 0 }}
                onClick={() => loadSession(null)}
              >
                {t("backToLive")}
              </button>
            </div>
          </div>
        ) : !mapFirst ? (
          <div style={RIGHT_RAIL}>
            {legacyCards}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Layout styles ────────────────────────────────────────────────────────────

const DESK_OUTER: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  height: "100%",
  overflow: "hidden",
  background: "var(--bg)",
};

const CONTROLS_BAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-3)",
  padding: "var(--sp-2) var(--sp-4)",
  borderBottom: "1px solid var(--line)",
  background: "var(--panel)",
  flexShrink: 0,
  /* On a phone the ticker box + 7 quick picks + 4 greek chips overflowed the bar and the
     tail was simply unreachable (no scroll, no wrap). Wrapping keeps every control on the
     surface at 375px and is a no-op on desktop, where it all fits on one line. */
  flexWrap: "wrap",
};

const TICKER_GROUP: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const TICKER_INPUT: React.CSSProperties = {
  width: 118,
  height: 30,
  padding: "0 10px 0 26px",
  background: "var(--inset)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-md)",
  color: "var(--text)",
  fontSize: 13,
  fontWeight: 700,
  textAlign: "left",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  outline: "none",
  fontVariantNumeric: "tabular-nums",
};

const SPOT_DISPLAY: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "var(--text)",
  fontVariantNumeric: "tabular-nums",
};

const GREEK_GROUP: React.CSSProperties = {
  display: "flex",
  gap: 5,
  alignItems: "center",
  padding: "3px 5px 3px 9px",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-md)",
  background: "var(--inset)",
};

const GREEK_CHIP: React.CSSProperties = {
  height: 30,
  minWidth: 50,
  padding: "0 11px",
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: "0.04em",
};

const LENS_NOTE: React.CSSProperties = {
  fontSize: 10,
  color: "var(--muted)",
  fontStyle: "italic",
};

const LENS_PARTIAL: React.CSSProperties = {
  fontSize: 11,
  color: "var(--muted)",
  padding: "2px 2px 0",
};

const VIEW_TOGGLE_ROW: React.CSSProperties = {
  display: "flex",
  gap: 4,
  padding: "6px 8px",
  borderBottom: "1px solid var(--line)",
  flexShrink: 0,
};

const VIEW_CHIP: React.CSSProperties = {
  height: 24,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.02em",
};

const LIVE_STALE_ROW: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--sp-2)",
  padding: "var(--sp-1) var(--sp-4)",
  borderBottom: "1px solid var(--line)",
  fontSize: "var(--fs-label)",
  color: "var(--warn)",
  flexShrink: 0,
};

const CONTROLS_RIGHT: React.CSSProperties = {
  marginLeft: "auto",
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const ASOF_BADGE: React.CSSProperties = {
  fontSize: 10,
  color: "var(--muted)",
  fontVariantNumeric: "tabular-nums",
};

/* ── Dated session replay (R0.10) ─────────────────────────────────────────────
   The chip is warn-toned: replay is a mode the user must not forget they are in — the
   same register as the asof staleness chip, because it states the same fact (this desk
   describes a settled past session, not now). */
const ARCHIVED_CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  height: 24,
  padding: "0 4px 0 9px",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.04em",
  color: "var(--warn)",
  border: "1px solid var(--warn)",
  borderRadius: "var(--r-md)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const ARCHIVED_BACK: React.CSSProperties = {
  height: 18,
  padding: "0 7px",
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.03em",
  background: "var(--inset)",
  color: "var(--text-2)",
  border: "1px solid var(--line)",
  borderRadius: 5,
  cursor: "pointer",
};

/* Mirrors MarketStateCard's CARD_OUTER geometry so swapping the rail's content during
   replay never re-flows the two-pane row. */
const ARCHIVED_PANE: React.CSSProperties = {
  borderLeft: "1px solid var(--hairline)",
  borderRadius: 0,
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  width: 360,
  maxWidth: "100%",
  flexShrink: 0,
  minHeight: 0,
  overflowY: "auto",
};

const ARCHIVED_PANE_BODY: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "12px 14px",
};

const ARCHIVED_PANE_DATE: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: "var(--warn)",
  fontVariantNumeric: "tabular-nums",
};

const ARCHIVED_PANE_NOTE: React.CSSProperties = {
  fontSize: 11,
  color: "var(--muted)",
  lineHeight: 1.55,
};

/**
 * The desk's RIGHT RAIL. §5.3 made it a container: it now holds the HeatSeeker pick
 * (which rode in from the retired PRISM tab) above the Market State card. The rail —
 * not the card — is the bounded scroll region, carrying the containment invariant that
 * used to live on MarketStateCard's CARD_OUTER: sized only by BODY_ROW's height, so a
 * drawer opening in the LEFT column can never re-flow what is in here.
 */
/**
 * Fixed slot for the HeatSeeker card. The card mounts asynchronously (it waits on the
 * matrix fetch) and can swap between its pick and its empty state at any time. Without a
 * reserved height that swap changes RIGHT_RAIL's scrollHeight underneath MarketStateCard,
 * and a rail scrolled part-way jumps — the same class of defect the v7b containment fix
 * removed one level up.
 */
const HEATSEEKER_SLOT: React.CSSProperties = {
  flexShrink: 0,
  minHeight: 96,
};

const RIGHT_RAIL: React.CSSProperties = {
  borderLeft: "1px solid var(--hairline)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-2)",
  /* 360px rail on desktop; on a phone the row has already wrapped, so cap at the track
     width instead of demanding a minimum and pushing a horizontal scrollbar. */
  width: 360,
  minWidth: 0,
  maxWidth: "100%",
  flexShrink: 0,
  minHeight: 0,
  alignSelf: "stretch",
  maxHeight: "100%",
  overflowY: "auto",
  overscrollBehavior: "contain",
  scrollbarWidth: "thin" as const,
  scrollbarColor: "var(--line-3) transparent",
};

const LOADING_BADGE: React.CSSProperties = {
  fontSize: 10,
  color: "var(--brand-2)",
};

const BODY_ROW: React.CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  flexWrap: "wrap",   /* responsive: right rail wraps below at ~1100px */
  alignItems: "stretch",
};

const LEFT_PANE: React.CSSProperties = {
  flex: "1 1 0px",
  /* Ladder gets all remaining space above 480px, but never demands more room than the
     viewport has: a hard 480 forced a horizontal scrollbar (and ~117px of usable bar
     column) on a 375px phone. min() keeps the desktop floor and drops it on narrow ones —
     the ladder itself switches to its compact grid below 420px. */
  minWidth: "min(480px, 100%)",
  minHeight: 0,        /* allow flex shrink past content height */
  alignSelf: "stretch",/* fill BODY_ROW track height */
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  maxHeight: "100%",   /* cap at BODY_ROW cross-axis height in wrapping flex */
};

/**
 * The flexing part of the left column. Everything above it (guide, view toggle) and below it
 * (the expiry drawer) is flex-shrink:0, so this is the single region that gives up room when
 * the drawer opens — and it clips internally rather than pushing the desk taller.
 */
const LADDER_REGION: React.CSSProperties = {
  flex: "1 1 0px",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

/**
 * PP1-D — the Matrix view's stacked region. On desktop (>860px) it is an INNER
 * scroller: the companion's grid, the closed hedge-grid disclosure, the session
 * picker and the EOD belt sit in document order and the map is visible at scrollTop 0.
 * On ≤860px the observatory.css rule overrides this to content-sized — the matrix
 * view is page content, not an inner scroller, because the ≤860px page-scroll mode
 * collapses flex:1 1 0px ancestors to 0px.
 */
const MATRIX_VIEW: React.CSSProperties = {
  flex: "1 1 0px",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-3)",
  overflowY: "auto",
  overflowX: "hidden",
};

/**
 * Height budget for the expanded drawer INSIDE the left column. Without a cap a tall drawer
 * on a short viewport would drive the ladder region to 0 and then overflow the column itself
 * — the same failure this fix removes, one level down. 58% leaves the ladder a usable band at
 * every viewport height; the drawer body scrolls inside whatever it is given.
 */
const XDRAWER_SLOT: React.CSSProperties = {
  flexShrink: 0,
  minHeight: 0,
  maxHeight: "58%",
  display: "flex",
  flexDirection: "column",
};

const LADDER_LOADING: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "var(--fs-ui)",
  color: "var(--muted)",
};

const LADDER_EMPTY: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--sp-2)",
  padding: "var(--sp-6) var(--sp-5)",
  textAlign: "center",
};

const LADDER_EMPTY_TITLE: React.CSSProperties = {
  fontSize: "var(--fs-body)",
  fontWeight: 700,
  color: "var(--text-2)",
};

const LADDER_EMPTY_WHY: React.CSSProperties = {
  fontSize: "var(--fs-label)",
  color: "var(--muted)",
  lineHeight: 1.5,
  maxWidth: 380,
};
