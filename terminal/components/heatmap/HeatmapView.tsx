"use client";
/**
 * HeatmapView.tsx — dual-layer market heatmap orchestrator.
 *
 * Data sources:
 *   - Manifest (price): /api/flow?f=manifest → manifest.json (34 names, nightly)
 *   - Flow index:        /api/flow?f=flow_idx → flow_idx.json (EOD, ΔOI-based)
 *
 * HONESTY DOCTRINE:
 *   - 1D timeframe is REAL (nightly Polygon manifest.chg).
 *   - 1W/1M/YTD are DISABLED ("accruing") — no OHLC on broader universe yet.
 *   - Flow direction is SOFT — magnitude headlines, dead-zone classifiers.
 *   - Breadth strip: advancers/decliners real; call-share dead-zone ±0.08 → "MIXED".
 *   - GEX regime: regime passport caveat shown visibly (display-only, ~Sept 2026 gate).
 *   - Single-name GEX regime note surfaced in the regime caveat banner.
 *   - No "validated" or predictive copy anywhere.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { trackSearch } from "@/lib/searchTrack";
import { makeHeatmapT, sectorChipLabel } from "@/lib/heatmapStrings";
import { Tip } from "@/components/ui/Tip";
import { Treemap, heatSwatches } from "./Treemap";
import { HeatmapTable } from "./HeatmapTable";
import { DetailPanel } from "./DetailPanel";
import { getSector } from "./sectorMap";
import type {
  HeatmapTile,
  Layer,
  View,
  SizingMode,
  Timeframe,
  ManifestPayload,
  FlowIdxPayload,
  FlowIdxRow,
  GicsSector,
} from "./types";
import { SECTOR_LABEL, SECTOR_ORDER } from "./sectorMap";

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_MS = 60_000; // 1-minute poll; data is nightly but keeps cache fresh
const INTRADAY_POLL_MS = 5 * 60_000; // 5-minute re-anchor for live quote overlay
const INTRADAY_TOP_N = 200;          // top tiles by dollar-vol to refresh
const QUOTE_CHUNK = 100;             // /api/quote batch cap

// Call-share dead-zone: |doiPc - 0.5| < 0.08 → "MIXED"
const CALL_SHARE_DEAD = 0.08;

// ─── Data fetching ────────────────────────────────────────────────────────────

async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Fetch live quotes for up to INTRADAY_TOP_N US tiles via /api/quote.
 * Returns a map of ticker → live chg% (null entries are skipped so manifest values are kept).
 * Chunks the request into batches of QUOTE_CHUNK to respect the route's MAX_BATCH cap.
 */
async function fetchLiveChg(tickers: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (let i = 0; i < tickers.length; i += QUOTE_CHUNK) {
    const chunk = tickers.slice(i, i + QUOTE_CHUNK);
    const symsParam = chunk.join(",");
    const data = await safeFetch<{ quotes: Record<string, { chg: number | null } | null> }>(
      `/api/quote?syms=${encodeURIComponent(symsParam)}`
    );
    if (!data?.quotes) continue;
    for (const [sym, q] of Object.entries(data.quotes)) {
      if (q != null && typeof q.chg === "number" && isFinite(q.chg)) {
        result[sym] = q.chg;
      }
    }
  }
  return result;
}

// ─── Data join: manifest + flow_idx → HeatmapTile[] ──────────────────────────

function buildTiles(
  manifest: ManifestPayload | null,
  flowIdx: FlowIdxPayload | null
): HeatmapTile[] {
  if (!manifest) return [];

  // Index flow by ticker
  const flowMap: Record<string, FlowIdxRow> = {};
  if (flowIdx) {
    // The flow_idx payload may be { rows: [...] } or flat object
    const rows: FlowIdxRow[] = Array.isArray((flowIdx as Record<string, unknown>).rows)
      ? ((flowIdx as Record<string, unknown>).rows as FlowIdxRow[])
      : [];
    for (const row of rows) {
      if (row.key) flowMap[row.key.toUpperCase()] = row;
    }
  }

  const tiles: HeatmapTile[] = [];
  for (const [ticker, sym] of Object.entries(manifest.symbols)) {
    // The prod manifest carries ~8.7k names, dozens with missing/null price
    // fields (halted/new listings) — those crash number formatting downstream.
    if (sym == null || typeof sym.last !== "number" || typeof sym.chg !== "number") continue;
    const flow = flowMap[ticker.toUpperCase()];
    const sector: GicsSector = getSector(ticker);

    const tile: HeatmapTile = {
      ticker,
      name: sym.name,
      sector,
      price: sym.last,
      chg1d: sym.chg,
      vol: sym.vol,
      hi52: sym.hi52,
      lo52: sym.lo52,
      hasFlow: false,
    };

    if (flow) {
      tile.hasFlow = true;
      tile.flowAsof = flow.asof;
      tile.netPremiumMn = flow.net_premium_mn;
      tile.tone = flow.tone;
      tile.netDoi = flow.net_doi;
      tile.doiPc = flow.doi_pc;
      tile.zerodte = flow.zerodte_share;
      tile.freshContracts = flow.fresh_contracts;
      tile.posLean = flow.positioning_lean;
      tile.signedPc = flow.signed_pc;
      tile.verdict = flow.verdict;
    }

    tiles.push(tile);
  }

  // Cap the render set: the full universe (~8.7k) makes the treemap unreadable
  // and slow. Keep every name with flow data (the 368-name flow universe) plus
  // the most liquid names by dollar volume, up to ~500 tiles total.
  const MAX_TILES = 500;
  if (tiles.length > MAX_TILES) {
    const dollarVol = (t: HeatmapTile) => (t.price ?? 0) * (t.vol ?? 0);
    // US-listed only for the map: the manifest carries international listings
    // (7203.T, 0700.HK, TRENT.NS …) whose local-currency volumes distort a
    // dollar-volume ranking. Allow plain tickers and A/B share classes.
    const isUS = (t: HeatmapTile) => /^[A-Z]+(\.[AB])?$/.test(t.ticker) && !/^\d/.test(t.ticker);
    const flowTiles = tiles.filter(t => t.hasFlow);
    const rest = tiles
      .filter(t => !t.hasFlow && isUS(t))
      .sort((a, b) => dollarVol(b) - dollarVol(a));
    return [...flowTiles, ...rest.slice(0, Math.max(0, MAX_TILES - flowTiles.length))];
  }

  return tiles;
}

// ─── Breadth strip computations ───────────────────────────────────────────────

interface BreadthStats {
  advancers: number;
  decliners: number;
  total: number;
  totalPremiumMn: number;
  callShareClass: "CALL-HEAVY" | "PUT-HEAVY" | "MIXED";
  callSharePct: number | null;  // null if no flow data
  priceMode: "BULLISH" | "BEARISH" | "MIXED";
}

function computeBreadth(tiles: HeatmapTile[]): BreadthStats {
  const advancers = tiles.filter(t => t.chg1d > 0).length;
  const decliners = tiles.filter(t => t.chg1d < 0).length;
  const total = tiles.length;

  const flowTiles = tiles.filter(t => t.hasFlow);
  const totalPremiumMn = flowTiles.reduce((s, t) => s + (t.netPremiumMn ?? 0), 0);

  // Call share: use doiPc (P/C ratio; call share = 1 / (1 + doiPc) approximation)
  // doiPc is put/call ΔOI ratio — call-heavy = low doiPc
  // We compute the fraction of tiles with positive tone as a proxy
  const flowWithTone = flowTiles.filter(t => t.tone && t.tone !== "neutral");
  const posCount = flowWithTone.filter(t => t.tone === "pos").length;
  const callSharePct = flowWithTone.length > 0 ? posCount / flowWithTone.length : null;

  let callShareClass: BreadthStats["callShareClass"] = "MIXED";
  if (callSharePct != null) {
    const dev = callSharePct - 0.5;
    if (dev > CALL_SHARE_DEAD) callShareClass = "CALL-HEAVY";
    else if (dev < -CALL_SHARE_DEAD) callShareClass = "PUT-HEAVY";
    else callShareClass = "MIXED";
  }

  const breadthPct = total > 0 ? advancers / total : 0;
  const avgChg = tiles.length > 0 ? tiles.reduce((s, t) => s + t.chg1d, 0) / tiles.length : 0;
  let priceMode: BreadthStats["priceMode"] = "MIXED";
  if (breadthPct >= 0.60 && avgChg > 0.2) priceMode = "BULLISH";
  else if (breadthPct <= 0.40 && avgChg < -0.2) priceMode = "BEARISH";

  return { advancers, decliners, total, totalPremiumMn, callShareClass, callSharePct, priceMode };
}

// ─── Sector chip data ─────────────────────────────────────────────────────────

interface SectorChipData {
  sector: GicsSector;
  label: string;
  avgChg: number;           // price layer: avg %chg
  avgTone: number;          // flow layer: avg tone score (−1..+1)
  flowSentPct: number | null; // flow layer: (bullish_tiles / active_tiles) * 100, null if no flow
  count: number;
}

/**
 * Compute sector chip values.
 *
 * PRICE mode: avgChg = mean 1D %chg across all tiles in sector.
 *
 * FLOW mode (formula extracted from MomoEdge heatmap-widget.js calcFlow):
 *   - MomoEdge computes per-sector avg sentiment = avg(sent) for active (tp>0) stocks,
 *     where sent = (bullish_premium - bearish_premium) / total_premium ∈ [−1, +1].
 *   - The displayed chip "ENERGY +100%" means sector avg sentiment × 100.
 *   - Our data: we have `tone` (pos/neg/neutral) on 368 flow-universe names.
 *   - We compute: avgTone = mean(tone_score) for tiles with hasFlow, where
 *     tone_score = +1 (pos) / 0 (neutral) / −1 (neg).
 *   - flowSentPct = (bullish_count / active_count) * 100, shown as breadth reading.
 *   - Both are honest equivalents on our data; labeled explicitly in UI.
 */
function computeSectorChips(tiles: HeatmapTile[]): SectorChipData[] {
  const bySector: Partial<Record<GicsSector, HeatmapTile[]>> = {};
  for (const t of tiles) {
    if (!bySector[t.sector]) bySector[t.sector] = [];
    bySector[t.sector]!.push(t);
  }
  return SECTOR_ORDER.flatMap(s => {
    const ts = bySector[s];
    if (!ts || ts.length === 0) return [];
    const avgChg = ts.reduce((a, t) => a + t.chg1d, 0) / ts.length;

    // Flow sentiment: use tone field (ΔOI-based, reliable)
    const flowTiles = ts.filter(t => t.hasFlow && t.tone && t.tone !== "neutral");
    const posTiles = flowTiles.filter(t => t.tone === "pos").length;
    const flowSentPct = flowTiles.length > 0
      ? Math.round(posTiles / flowTiles.length * 100)
      : null;

    // avgTone for flow layer chip value
    const activeTiles = ts.filter(t => t.hasFlow);
    const avgTone = activeTiles.length > 0
      ? activeTiles.reduce((sum, t) => sum + (t.tone === "pos" ? 1 : t.tone === "neg" ? -1 : 0), 0) / activeTiles.length
      : 0;

    return [{ sector: s, label: SECTOR_LABEL[s] ?? s, avgChg, avgTone, flowSentPct, count: ts.length }];
  });
}

// ─── HeatmapView ─────────────────────────────────────────────────────────────

export function HeatmapView() {
  const { lang } = useLang();
  const t = makeHeatmapT(lang);
  const zh = lang === "zh";

  // ── Data state ──────────────────────────────────────────────────────────────
  const [manifest, setManifest] = useState<ManifestPayload | null>(null);
  const [flowIdx, setFlowIdx]   = useState<FlowIdxPayload | null>(null);
  const [loadingManifest, setLoadingManifest] = useState(true);
  const [loadingFlow,     setLoadingFlow]     = useState(true);
  const [flowError,       setFlowError]       = useState(false);
  /** Live chg% values for top-N tiles; keyed by ticker. Null map = not yet loaded. */
  const [liveChg, setLiveChg] = useState<Record<string, number> | null>(null);
  const intradayPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [layer,     setLayer]     = useState<Layer>("price");
  const [view,      setView]      = useState<View>("map");
  const [sizing,    setSizing]    = useState<SizingMode>("cap");  // default CAP (dollar-vol proxy)
  const [timeframe] = useState<Timeframe>("1D");  // only 1D enabled in v1
  const [sectorFilt, setSectorFilt] = useState<GicsSector | null>(null);
  const [search,    setSearch]    = useState("");
  const [selected,  setSelected]  = useState<HeatmapTile | null>(null);

  // Shared selection commit for tile + table-row clicks; a select while the
  // search filter is active counts as a committed ticker search.
  const selectTile = useCallback((tile: HeatmapTile) => {
    if (search.trim()) trackSearch(tile.ticker, "heatmap", search.trim());
    setSelected(tile);
  }, [search]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch manifest ────────────────────────────────────────────────────────────
  // Primary: /api/flow?f=manifest (integrator wires this in route.ts)
  // Fallback: /data/manifest.json (static public file, always present)
  const fetchManifest = useCallback(async () => {
    let data = await safeFetch<ManifestPayload>("/api/flow?f=manifest");
    if (!data) {
      data = await safeFetch<ManifestPayload>("/data/manifest.json");
    }
    if (data) {
      setManifest(data);
    }
    setLoadingManifest(false);
  }, []);

  // ── Fetch flow index ──────────────────────────────────────────────────────────
  // Primary: /api/flow?f=flow_idx (integrator wires this in route.ts)
  // Fallback: /data/flow_idx.json (VPS-mirrored from GitHub Pages via pull_macro_intel)
  // Tertiary: direct GitHub Pages URL (may hit CORS in some environments)
  const fetchFlow = useCallback(async () => {
    let data = await safeFetch<FlowIdxPayload>("/api/flow?f=flow_idx");
    if (!data) {
      data = await safeFetch<FlowIdxPayload>("/data/flow_idx.json");
    }
    if (data) {
      setFlowIdx(data);
      setFlowError(false);
    } else {
      // Flow index unavailable — heatmap degrades gracefully to price-only
      setFlowError(true);
    }
    setLoadingFlow(false);
  }, []);

  // ── Mount ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    void fetchManifest();
    void fetchFlow();

    pollRef.current = setInterval(() => {
      void fetchManifest();
      void fetchFlow();
    }, POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (intradayPollRef.current) clearInterval(intradayPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Intraday overlay: re-anchor top-N tiles via /api/quote every 5 min ──────
  // Only US plain-ticker names (no suffix) are passed to the quote hub. The top-N
  // is ranked by dollar-vol (price × vol) from the manifest — a reasonable mcap proxy.
  // On null quote → manifest value kept (guard: never blank a tile).
  const refreshIntraday = useCallback(async (tiles: HeatmapTile[]) => {
    const isUS = (t: HeatmapTile) => /^[A-Z]+(\.[AB])?$/.test(t.ticker) && !/^\d/.test(t.ticker);
    const dollarVol = (t: HeatmapTile) => (t.price ?? 0) * (t.vol ?? 0);
    const topTickers = tiles
      .filter(isUS)
      .sort((a, b) => dollarVol(b) - dollarVol(a))
      .slice(0, INTRADAY_TOP_N)
      .map((t) => t.ticker);
    if (topTickers.length === 0) return;
    const fresh = await fetchLiveChg(topTickers);
    setLiveChg((prev) => ({ ...(prev ?? {}), ...fresh }));
  }, []);

  // Kick off intraday refresh once the manifest is loaded (gives us dollar-vol ranks).
  useEffect(() => {
    if (!manifest) return;
    const tiles = buildTiles(manifest, flowIdx);
    void refreshIntraday(tiles);
    if (intradayPollRef.current) clearInterval(intradayPollRef.current);
    intradayPollRef.current = setInterval(() => {
      void refreshIntraday(buildTiles(manifest, flowIdx));
    }, INTRADAY_POLL_MS);
    return () => {
      if (intradayPollRef.current) { clearInterval(intradayPollRef.current); intradayPollRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest]);

  // ── Layer change: auto-select sizing ─────────────────────────────────────────
  const handleLayerChange = useCallback((l: Layer) => {
    setLayer(l);
    setSizing(l === "flow" ? "premium" : "cap");  // CAP (dollar-vol) for price; PREMIUM for flow
    setSelected(null);
  }, []);

  // ── Build tiles ───────────────────────────────────────────────────────────────
  const rawTiles = buildTiles(manifest, flowIdx);

  // Apply live chg% overlay for top-N tickers (guard: null → keep manifest value).
  const liveSet = liveChg ? new Set(Object.keys(liveChg)) : new Set<string>();
  const allTiles: HeatmapTile[] = liveChg
    ? rawTiles.map((t) =>
        liveSet.has(t.ticker) ? { ...t, chg1d: liveChg[t.ticker] } : t
      )
    : rawTiles;

  // Filter by sector + search
  const tiles = allTiles.filter(tile => {
    if (sectorFilt && tile.sector !== sectorFilt) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!tile.ticker.toLowerCase().includes(q) && !tile.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const breadth = computeBreadth(allTiles);
  const sectorChips = computeSectorChips(allTiles);

  const isLoading = loadingManifest;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="obs obs-ambient" style={OUTER}>

      {/* ═══ GEX REGIME CAVEAT BANNER (HONESTY DOCTRINE) ═════════════════════ */}
      <div className="obs-note" style={REGIME_BANNER}>
        <span style={{ color: "var(--warn)", fontWeight: 600, marginRight: 6 }}>
          {zh ? "注意" : "Note"}
        </span>
        {t("regimeCaveat")}
      </div>

      {/* ═══ BREADTH STRIP — glass header card ════════════════════════════════ */}
      <div className="obs-card" style={BREADTH_STRIP}>
        {/* Mode label */}
        <div style={BREADTH_MODE}>
          <span style={{
            fontWeight: 700,
            color: layer === "price"
              ? (breadth.priceMode === "BULLISH" ? "var(--up)" : breadth.priceMode === "BEARISH" ? "var(--down)" : "var(--warn)")
              : (breadth.callShareClass === "CALL-HEAVY" ? "var(--up)" : breadth.callShareClass === "PUT-HEAVY" ? "var(--down)" : "var(--warn)"),
          }}>
            {layer === "price"
              ? (breadth.priceMode === "BULLISH" ? t("bullish") : breadth.priceMode === "BEARISH" ? t("bearish") : t("mixed"))
              : (breadth.callShareClass === "CALL-HEAVY" ? t("bullish") : breadth.callShareClass === "PUT-HEAVY" ? t("bearish") : t("mixed"))
            }
          </span>
        </div>

        <div style={BREADTH_SEP} />

        {/* Advancers / decliners */}
        <div style={BREADTH_ITEM}>
          <span className="obs-lbl" style={{ textTransform: "none", letterSpacing: 0, fontSize: 10 }}>{t("advancers")}</span>
          <span className="num" style={{ color: "var(--up)", marginLeft: 4 }}>
            {breadth.advancers}
          </span>
          <span style={{ color: "var(--muted)", margin: "0 3px" }}>/</span>
          <span className="num" style={{ color: "var(--down)" }}>
            {breadth.decliners}
          </span>
          <span style={{ color: "var(--muted)", marginLeft: 3 }}>
            ({breadth.total > 0 ? Math.round(breadth.advancers / breadth.total * 100) : 0}%)
          </span>
        </div>

        {/* Total flow premium */}
        {breadth.totalPremiumMn > 0 && (
          <>
            <div style={BREADTH_SEP} />
            <div style={BREADTH_ITEM}>
              <span className="obs-lbl" style={{ textTransform: "none", letterSpacing: 0, fontSize: 10 }}>{t("totalPremium")}</span>
              <span className="num" style={{ marginLeft: 4 }}>
                ${breadth.totalPremiumMn.toFixed(1)}M
              </span>
              <span style={{ fontSize: 9, color: "var(--muted)", fontStyle: "italic", marginLeft: 4 }}>
                {t("magnitudeOnly")}
              </span>
            </div>
          </>
        )}

        {/* Call-share with dead-zone label */}
        {breadth.callSharePct != null && (
          <>
            <div style={BREADTH_SEP} />
            <div style={BREADTH_ITEM}>
              <Tip label={t("bullFlowTip")} side="top" size="card">
                <span className="obs-lbl" style={{ textTransform: "none", letterSpacing: 0, fontSize: 10, cursor: "help" }}>{t("bullFlow")}</span>
              </Tip>
              <span className="num" style={{ marginLeft: 4 }}>
                {Math.round(breadth.callSharePct * 100)}%
              </span>
              {breadth.callShareClass === "MIXED" && (
                <span style={{ fontSize: 9, color: "var(--muted)", fontStyle: "italic", marginLeft: 4 }}>
                  ({t("mixedZone")})
                </span>
              )}
            </div>
          </>
        )}

        <div style={{ flex: 1 }} />

        {/* Data note */}
        <div style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic", alignSelf: "center" }}>
          {t("dataNote")}
        </div>

        {/* Intraday overlay note — shown once live data has been loaded */}
        {liveChg && liveSet.size > 0 && (
          <>
            <div style={BREADTH_SEP} />
            <div style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic", alignSelf: "center" }}>
              {zh
                ? `实时（延迟15分钟）前${liveSet.size}支 · 其余为昨收`
                : `live (15m delayed) top ${liveSet.size} · rest EOD`}
            </div>
          </>
        )}
      </div>

      {/* ═══ CONTROLS ROW ════════════════════════════════════════════════════ */}
      <div style={CONTROLS_ROW} data-tut="heatmap-controls">
        {/* Layer toggle */}
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className={`obs-chip${layer === "price" ? " on" : ""}`}
            style={CHIP_COMPACT}
            onClick={() => handleLayerChange("price")}
          >{t("layerPrice")}</button>
          <button
            className={`obs-chip${layer === "flow" ? " on" : ""}`}
            style={CHIP_COMPACT}
            onClick={() => handleLayerChange("flow")}
          >{t("layerFlow")}</button>
        </div>

        <div style={CTRL_SEP} />

        {/* View toggle */}
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className={`obs-chip${view === "map" ? " on" : ""}`}
            style={CHIP_COMPACT}
            onClick={() => setView("map")}
          >{t("viewMap")}</button>
          <button
            className={`obs-chip${view === "table" ? " on" : ""}`}
            style={CHIP_COMPACT}
            onClick={() => setView("table")}
          >{t("viewTable")}</button>
        </div>

        <div style={CTRL_SEP} />

        {/* Sizing (map view only) */}
        {view === "map" && (
          <>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                className={`obs-chip${sizing === "cap" ? " on" : ""}`}
                style={CHIP_COMPACT}
                onClick={() => setSizing("cap")}
              >{t("sizeCap")}</button>
              <button
                className={`obs-chip${sizing === "equal" ? " on" : ""}`}
                style={CHIP_COMPACT}
                onClick={() => setSizing("equal")}
              >{t("sizeEqual")}</button>
              {layer === "flow" && (
                <button
                  className={`obs-chip${sizing === "premium" ? " on" : ""}`}
                  style={CHIP_COMPACT}
                  onClick={() => setSizing("premium")}
                >{t("sizePremium")}</button>
              )}
            </div>
            <div style={CTRL_SEP} />
          </>
        )}

        {/* Timeframe (1D only; others disabled with accruing note) */}
        <div style={{ display: "flex", gap: 4 }}>
          <button className="obs-chip on" style={CHIP_COMPACT} onClick={() => {}}>
            {t("tf1D")}
          </button>
          {(["tf1W", "tf1M", "tfYTD"] as const).map(k => (
            <button
              key={k}
              className="obs-chip"
              style={{ ...CHIP_COMPACT, opacity: 0.4, cursor: "not-allowed" }}
              disabled
              aria-label={t("tfAccruingTip")}
            >{t(k)}</button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Search */}
        <input
          type="text"
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={SEARCH_INPUT}
          aria-label={t("searchPlaceholder")}
        />
      </div>

      {/* ═══ SECTOR CHIPS ════════════════════════════════════════════════════ */}
      <div style={SECTOR_CHIPS_ROW}>
        <SectorChip
          label={t("sectorAll")}
          active={sectorFilt === null}
          value={null}
          isFlow={false}
          onClick={() => setSectorFilt(null)}
        />
        {sectorChips.map(sc => (
          <SectorChip
            key={sc.sector}
            label={sectorChipLabel(lang, sc.sector, sc.label)}
            active={sectorFilt === sc.sector}
            value={layer === "flow" ? sc.avgTone : sc.avgChg}
            isFlow={layer === "flow"}
            onClick={() => setSectorFilt(prev => prev === sc.sector ? null : sc.sector)}
          />
        ))}
      </div>

      {/* ═══ FLOW SOFT DISCLAIMER (flow layer only) ══════════════════════════ */}
      {layer === "flow" && !flowError && !loadingFlow && (
        <div className="obs-note" style={FLOW_NOTE_BAR}>
          {t("toneSoftNote")}
        </div>
      )}

      {flowError && (
        <div style={FLOW_ERR_BAR}>
          {t("noFlowData")}
        </div>
      )}

      {/* ═══ MAIN CANVAS ═════════════════════════════════════════════════════ */}
      <div style={CANVAS_AREA} data-tut="heatmap-canvas">
        {isLoading ? (
          <LoadingState t={t} />
        ) : tiles.length === 0 ? (
          <EmptyState t={t} />
        ) : view === "map" ? (
          <Treemap
            tiles={tiles}
            layer={layer}
            sizing={sizing}
            selectedTicker={selected?.ticker ?? null}
            onSelect={selectTile}
            lang={lang}
          />
        ) : (
          <HeatmapTable
            tiles={tiles}
            layer={layer}
            selectedTicker={selected?.ticker ?? null}
            onSelect={selectTile}
            lang={lang}
          />
        )}

        {/* Color legend */}
        {!isLoading && tiles.length > 0 && (
          <div style={{
            position: "absolute", right: 12, bottom: 12, zIndex: 5, pointerEvents: "none",
            display: "flex", flexDirection: "column", gap: 4, padding: "7px 10px",
            background: "rgba(10,12,16,0.72)", backdropFilter: "blur(8px)",
            border: "1px solid var(--line)", borderRadius: 9,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, fontSize: 9, letterSpacing: ".02em", color: "var(--muted)", textTransform: "none" }}>
              <span style={{ color: "var(--down)" }}>{layer === "flow" ? t("netPut") : (lang === "zh" ? "下跌" : "down")}</span>
              <span style={{ color: "var(--text-2)" }}>{layer === "flow" ? t("premiumSize") : (lang === "zh" ? "1日涨跌" : "1D %chg")}</span>
              <span style={{ color: "var(--up)" }}>{layer === "flow" ? t("netCall") : (lang === "zh" ? "上涨" : "up")}</span>
            </div>
            {(() => {
              const sw = heatSwatches();
              // PRICE tiles are binned → discrete swatches (−3…−½, neutral, +½…+3, matching the tiles).
              // FLOW tiles use a continuous log-magnitude ramp → a continuous gradient bar.
              if (layer === "flow") {
                return (
                  <div style={{
                    width: 168, height: 8, borderRadius: 4,
                    background: `linear-gradient(90deg, ${sw.flowDown} 0%, ${sw.neutral} 50%, ${sw.flowUp} 100%)`,
                  }} />
                );
              }
              const cells = [...[...sw.down].reverse(), sw.neutral, ...sw.up];
              return (
                <div style={{ display: "flex", width: 168, height: 8, borderRadius: 4, overflow: "hidden" }}>
                  {cells.map((c, i) => (
                    <div key={i} style={{ flex: 1, background: c }} />
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* ═══ DETAIL PANEL ════════════════════════════════════════════════════ */}
      {selected && (
        <DetailPanel
          tile={selected}
          layer={layer}
          lang={lang}
          onClose={() => setSelected(null)}
        />
      )}

    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectorChip({
  label, active, value, isFlow, onClick,
}: {
  label: string;
  active: boolean;
  value: number | null;  // price: avg%chg; flow: avg tone (−1..+1)
  isFlow?: boolean;
  onClick: () => void;
}) {
  const valColor = value == null ? undefined
    : value > 0 ? "var(--up)" : value < 0 ? "var(--down)" : "var(--muted)";

  // Display: price = "+1.2%"; flow = avg tone × 100 → "+53%" means avg tone = 0.53
  const valStr = value == null ? null
    : isFlow
      ? `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`
      : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

  return (
    <button
      onClick={onClick}
      className={`obs-chip${active ? " on" : ""}`}
      style={CHIP_COMPACT}
    >
      {label}
      {valStr != null && (
        <span className="num" style={{
          color: active ? "rgba(255,255,255,0.8)" : valColor,
          marginLeft: 3,
        }}>
          {valStr}
        </span>
      )}
    </button>
  );
}

function LoadingState({ t }: { t: (k: Parameters<ReturnType<typeof makeHeatmapT>>[0]) => string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted)", fontSize: 13 }}>
      {t("loadingHeatmap")}
    </div>
  );
}

function EmptyState({ t }: { t: (k: Parameters<ReturnType<typeof makeHeatmapT>>[0]) => string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted)", fontSize: 13 }}>
      {t("noData")}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const OUTER: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  overflow: "hidden",
  background: "var(--bg)",
  fontFamily: "var(--font-ui)",
};

// obs-note class handles background, border, padding — just add layout overrides
const REGIME_BANNER: React.CSSProperties = {
  margin: 0,
  borderRadius: 0,
  borderTop: "none",
  borderLeft: "none",
  borderRight: "none",
  fontSize: 10,
  fontStyle: "italic",
  lineHeight: 1.5,
  flexShrink: 0,
};

// obs-card handles background/border — add layout specifics
const BREADTH_STRIP: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 0,
  padding: "6px 14px",
  flexShrink: 0,
  flexWrap: "wrap",
  rowGap: 4,
  borderRadius: 0,
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
};

const BREADTH_MODE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.04em",
};

const BREADTH_SEP: React.CSSProperties = {
  width: 1,
  height: 16,
  background: "rgba(255,255,255,0.1)",
  margin: "0 10px",
  flexShrink: 0,
};

const BREADTH_ITEM: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  fontSize: 11,
  color: "var(--text)",
};

const CONTROLS_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  flexShrink: 0,
  flexWrap: "wrap",
  rowGap: 4,
};

// compact override for obs-chip — smaller padding than default
const CHIP_COMPACT: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  borderRadius: 8,
};

const CTRL_SEP: React.CSSProperties = {
  width: 1,
  height: 20,
  background: "rgba(255,255,255,0.08)",
  flexShrink: 0,
};

const SECTOR_CHIPS_ROW: React.CSSProperties = {
  display: "flex",
  gap: 4,
  padding: "5px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  overflowX: "auto",
  flexShrink: 0,
};

// obs-note class handles styling; just add layout overrides
const FLOW_NOTE_BAR: React.CSSProperties = {
  margin: 0,
  borderRadius: 0,
  borderLeft: "none",
  borderRight: "none",
  borderTop: "none",
  fontSize: 9,
  flexShrink: 0,
};

const FLOW_ERR_BAR: React.CSSProperties = {
  padding: "4px 14px",
  fontSize: 10,
  color: "var(--warn)",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  flexShrink: 0,
};

const CANVAS_AREA: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  position: "relative",
};

const SEARCH_INPUT: React.CSSProperties = {
  height: 28,
  padding: "0 10px",
  borderRadius: 8,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.09)",
  color: "var(--text)",
  fontSize: 11,
  outline: "none",
  width: 140,
  fontFamily: "var(--font-ui)",
};
