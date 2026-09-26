"use client";
/**
 * StrikeLadder — per-strike horizontal signed exposure bar chart.
 *
 *   - EXPIRY LENS (OEU T-A): All / 0DTE / All−0DTE / one expiration. The selection now
 *     RECOMPUTES the ladder instead of setting state nobody read. All reads `by_strike`
 *     (the all-expiry aggregate, all four greeks); narrower lenses read the per
 *     strike×expiry matrix. A strike the matrix doesn't cover renders an em dash — never
 *     the aggregate wearing the lens's label. Maths + coverage rules: lib/gexLadder.ts.
 *   - NET | CALL/PUT: the payload's `gamma_call`/`gamma_put` columns, drawn as opposing
 *     bars. All-expiry gamma only — that is the only cut the feed splits by side.
 *   - AUTO-CENTER: on load and ticker change, spot row scrolls to mid-viewport.
 *   - BAR: power-curve (^0.7) length, max 46% per side, --up/--down tokens (so the East
 *     Asian 红涨绿跌 convention flips with the theme), center axis hairline.
 *   - LEVEL BADGES: right-edge tags (WALL / SUPPORT / MAGNET / FLIP) only on keyed rows.
 *   - SPOT ROW: amber highlight + distinct marker line treatment.
 *   - FLIP LINE: inserted between straddling strikes (purple divider).
 *   - NOW | LADDER MAX: two bar normalizers, both the same quantity as the bars (B1).
 *
 * Layout: [strike label + %dist] [center-axis bars] [level-tag] [value]
 * Strikes rendered descending (highest at top). Under ~420px the grid drops to its
 * compact track set so the bar column survives on a phone.
 *
 * HONESTY DOCTRINE: bar direction (positive/negative) is the dealer-sign convention
 * — an assumption. Magnitude is the reliable read. Passport caveat is in MarketStateCard.
 * Values are $mn (engine/options_hub.py divides those columns by 1e6); only `net_gex_bn`
 * is billions — hence two formatters, `fmtMn` and `fmtBn`, never one.
 *
 * REPLAY (T-B): `by_strike` is a single END-OF-DAY snapshot with no intraday history, so the
 * ladder cannot time-travel with the workspace scrubber and does not try. When the scrubber is
 * off the live head it keeps showing the close it genuinely describes and wears EodReplayTag
 * to say so. Truncating or interpolating this store to a scrubbed minute would be fabrication.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { makeGexT } from "./gexStrings";
import { EodReplayTag } from "@/components/surface/EodReplayTag";
import type { Lang } from "@/lib/i18n";
import type { GexPayload, GreekLens } from "./GexDeskView";
import { topExpiriesForStrike, type MatrixCell, type ExpiryShare } from "@/lib/surfaceContract";
import { dteFrom, dteLabelFor, expLabel, isZeroDte } from "@/lib/dte";
import {
  fmtBn,
  fmtMn,
  fmtMnMag,
  lensValueForStrike,
  normExp,
  scaleBases,
  type ExpiryLens,
  type LensStrikeValues,
} from "@/lib/gexLadder";

// ─── Types ────────────────────────────────────────────────────────────────────

type StrikeRow = GexPayload["by_strike"][number];

interface Levels {
  callWall: number | null;
  putWall: number | null;
  gammaFlip: number | null;
  hvl: number | null;
}

/** Which side(s) of the chain the bars draw. */
type LadderSide = "net" | "split";

interface TooltipData {
  strike: number;
  /** Signed exposure under the active lens, $mn. null = strike outside the lens snapshot. */
  net: number | null;
  gamma_call: number;
  gamma_put: number;
  showBreakdown: boolean;     // call/put split only shown for all-expiry gamma
  netLabel: string;           // "Net GEX" / "Net DEX" / …
  lensTag: string | null;     // "0DTE" / "07-17" / null when the All lens is active
  badge?: string;
  topExpiries: ExpiryShare[]; // top-3 per-expiry breakdown (from matrix; [] if absent)
  x: number;                  // viewport coords — the popover lives on the fixed layer
  y: number;
}

interface StrikeLadderProps {
  strikes: StrikeRow[];
  spot: number | null;
  levels: Levels;
  greek?: GreekLens;
  byExpiry?: GexPayload["by_expiry"] | null;
  /** Active expiry lens (owned by GexDeskView so the summary bar can scope with it). */
  lens: ExpiryLens;
  onLens: (lens: ExpiryLens) => void;
  /** Per-strike values for the active lens + the matrix's strike coverage. */
  lensValues: LensStrikeValues;
  /** Expiries (date-part keys) the matrix can answer for THIS ladder's strikes. */
  lensCoverage: Set<string>;
  /** as-of of the GEX snapshot — anchors every DTE on the desk (never the wall clock). */
  asOf?: string | null;
  /** as-of of the per strike×expiry snapshot; shown when a narrower lens is active. */
  matrixAsOf?: string | null;
  lang: Lang;
  /** Net GEX (bn) for the walls chip row — the ladder's own "so what" strip. */
  netGexBn?: number | null;
  /** Per-strike-per-expiry cells for the hover top-3 expiry breakdown (optional). */
  matrixCells?: MatrixCell[] | null;
}

/**
 * Stable DOM hook for the current-price ("spot") row, used by the auto-center effect
 * below. Kept as a data-attribute rather than the rendered ▶ marker glyph so a future
 * restyle of the marker (a different glyph, an icon, moving it out of the row) cannot
 * silently disable auto-centering with nothing anywhere signaling this query depends on
 * it — the failure mode is a ladder that opens at the top, the exact bug this effect was
 * written to fix in the first place.
 */
export const SPOT_ROW_ATTR = "data-spot-row";
const SPOT_ROW_VAL = "1";

/**
 * Locate the spot row's index among a scroll container's children via the stable
 * data-hook above — never via the marker glyph's rendered text. Accepts anything
 * duck-typed like a DOM Element (`getAttribute`) so the lookup stays unit-testable
 * without a DOM. Returns -1 when no child carries the hook.
 */
export function findSpotRowIndex(
  children: ArrayLike<{ getAttribute(name: string): string | null }>
): number {
  for (let i = 0; i < children.length; i++) {
    if (children[i].getAttribute(SPOT_ROW_ATTR) === SPOT_ROW_VAL) return i;
  }
  return -1;
}

/** Signed net exposure for a strike row under the active greek lens (all-expiry, $mn). */
function rowNet(s: StrikeRow, greek: GreekLens): number {
  switch (greek) {
    case "delta": return s.delta_net ?? 0;
    case "vanna": return s.vanna_net ?? 0;
    case "charm": return s.charm_net ?? 0;
    default:      return s.gamma_net;
  }
}

/** "Net GEX" / "Net DEX" / "Net VEX" / "Net CHEX" for the active lens. */
function netLensLabel(greek: GreekLens, t: ReturnType<typeof makeGexT>): string {
  const acr =
    greek === "delta" ? t("greekDelta")
    : greek === "vanna" ? t("greekVanna")
    : greek === "charm" ? t("greekCharm")
    : t("greekGamma");
  return `${t("ladderNetPrefix")} ${acr}`;
}

type BadgeTone = "cyan" | "red" | "amber" | "purple";
type BadgeKind = "flip" | "wall" | "support" | "magnet";

interface BadgeInfo {
  kind: BadgeKind;
  tone: BadgeTone;
}

/**
 * Level-tag label. The tags were hardcoded English on a bilingual desk, even though the
 * LEX has carried the pairs since the desk shipped. `short` is the compact-grid form
 * (the tag column is 34px on a phone).
 */
function badgeLabel(kind: BadgeKind, t: ReturnType<typeof makeGexT>, short: boolean): string {
  switch (kind) {
    case "flip":    return short ? t("ladderFlipShort") : t("ladderFlip");
    case "wall":    return short ? t("ladderCallWallShort") : t("ladderCallWall");
    case "support": return short ? t("ladderPutSupportShort") : t("ladderPutSupport");
    case "magnet":  return short ? t("ladderMagnetShort") : t("ladderMagnet");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtStrike(s: number): string {
  return s % 1 === 0 ? String(s) : s.toFixed(1);
}

function fmtPctFromSpot(strike: number, spot: number): string {
  const pct = ((strike - spot) / spot) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** Classify a strike row to a badge type — priority: flip > wall > support > magnet */
function classifyBadge(
  s: StrikeRow,
  levels: Levels,
  step: number
): BadgeInfo | null {
  const { callWall, putWall, gammaFlip, hvl } = levels;
  const prox = step * 1.2;

  if (gammaFlip != null && Math.abs(s.strike - gammaFlip) < prox) {
    return { kind: "flip", tone: "purple" };
  }
  if (callWall != null && Math.abs(s.strike - callWall) < prox) {
    return { kind: "wall", tone: "cyan" };
  }
  if (putWall != null && Math.abs(s.strike - putWall) < prox) {
    return { kind: "support", tone: "red" };
  }
  if (hvl != null && Math.abs(s.strike - hvl) < prox) {
    return { kind: "magnet", tone: "amber" };
  }
  return null;
}

/** Estimate median step from sorted strikes */
function estimateStep(strikes: StrikeRow[]): number {
  if (strikes.length < 2) return 5;
  const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
  const diffs = sorted
    .slice(1)
    .map((s, i) => s.strike - sorted[i].strike)
    .filter((d) => d > 0);
  if (diffs.length === 0) return 5;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

/**
 * Flip violet. `--cat-2` is referenced across this desk but defined nowhere in the token
 * set, so `color:var(--cat-2)` was silently dropped and every flip surface rendered in the
 * inherited text colour. `--ai` IS defined and is the identical hue (#9d86ff) — the same
 * one this file hardcodes as rgba(157,134,255,…) two hundred lines down. Kept behind
 * --cat-2 so a real definition would still win.
 */
const FLIP_VIOLET = "var(--cat-2, var(--ai))";

/**
 * Badge hue by tone. This single value now drives the whole level tag — text, fill and
 * ring — through the `.obs-tag` tint formula (`--c`). The old pairing carried a second,
 * hardcoded rgba border table, and the fill was derived from it by string-replacing
 * "0.35" with "0.08": the put-support tone was a literal red that stayed red under
 * html[data-updown="east"] while its text token flipped to green.
 */
function toneColor(tone: BadgeTone): string {
  switch (tone) {
    case "cyan":   return "var(--brand-2)";
    case "red":    return "var(--down)";
    case "amber":  return "var(--signal)";
    case "purple": return FLIP_VIOLET;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

// ±% range presets for the ladder (0 = All). Mirrors quanted's ±2/±5/±10/All.
const RANGE_PRESETS: { pct: number; label: string }[] = [
  { pct: 0.02, label: "±2%" },
  { pct: 0.05, label: "±5%" },
  { pct: 0.10, label: "±10%" },
  { pct: 0, label: "" }, // All (label filled from i18n at render)
];

/** Below this container width the ladder switches to its compact track set. */
const NARROW_PX = 420;

/** Grid tracks: [strike, bar(1fr), tag, value]. */
const TRACKS = {
  wide:      { strike: 100, tag: 52, val: 72 },
  wideSplit: { strike: 100, tag: 52, val: 88 },
  narrow:    { strike: 52,  tag: 34, val: 52 },
} as const;

/** One rendered ladder row: the payload row plus its value(s) under the active lens. */
interface LadderRow {
  s: StrikeRow;
  /** Signed exposure under the lens, $mn. null = the lens snapshot doesn't cover it. */
  value: number | null;
  /** Call/put legs — only populated in split mode (all-expiry gamma). */
  call: number | null;
  put: number | null;
}

export function StrikeLadder({
  strikes,
  spot,
  levels,
  greek = "gamma",
  byExpiry,
  lens,
  onLens,
  lensValues,
  lensCoverage,
  asOf = null,
  matrixAsOf = null,
  lang,
  netGexBn = null,
  matrixCells = null,
}: StrikeLadderProps) {
  const t = makeGexT(lang);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [rangePct, setRangePct] = useState<number>(0); // 0 = All
  const [scaleMode, setScaleMode] = useState<"now" | "ladder">("now");
  const [side, setSide] = useState<LadderSide>("net");
  const [narrow, setNarrow] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const spotRowRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // The call/put split exists ONLY on the all-expiry gamma columns (gamma_call/gamma_put).
  // The per strike×expiry store carries a net per cell and no side breakdown, so a scoped
  // lens cannot be split — the toggle disables rather than inventing legs.
  //
  // `effSide` (not `side`) drives every read, so a greek/lens change can never strand the
  // ladder on a split it has no data for. The preference itself is kept, and comes back
  // the moment the user returns to all-expiry gamma.
  const splitAvailable = greek === "gamma" && lens.kind === "all";
  const effSide: LadderSide = splitAvailable ? side : "net";

  // ── Rows under the active lens ────────────────────────────────────────────────
  const sortedAll = useMemo(
    () => [...strikes].sort((a, b) => b.strike - a.strike),
    [strikes]
  );
  const step = useMemo(() => estimateStep(strikes), [strikes]);

  const rowsAll: LadderRow[] = useMemo(
    () =>
      sortedAll.map((s) => ({
        s,
        value: lensValueForStrike(s.strike, rowNet(s, greek), lens, lensValues),
        call: splitAvailable ? s.gamma_call : null,
        put: splitAvailable ? s.gamma_put : null,
      })),
    [sortedAll, greek, lens, lensValues, splitAvailable]
  );

  // Range filter: keep strikes within spot ± pct (falls back to all if too sparse).
  const rows = useMemo(() => {
    if (rangePct <= 0 || spot == null || spot <= 0) return rowsAll;
    const lo = spot * (1 - rangePct), hi = spot * (1 + rangePct);
    const w = rowsAll.filter((r) => r.s.strike >= lo && r.s.strike <= hi);
    return w.length >= 3 ? w : rowsAll;
  }, [rowsAll, rangePct, spot]);

  // ── Bar normalization (B1) ────────────────────────────────────────────────────
  // Both bases measure the SAME quantity as the bars: per-strike exposure under the
  // active greek + expiry lens. NOW follows the range filter; LADDER MAX pins to the
  // whole snapshot so switching ±2%/±5%/All doesn't silently rescale every bar.
  const { nowMax, ladderMax } = useMemo(() => {
    const vals = (r: LadderRow): (number | null)[] =>
      effSide === "split" ? [r.call, r.put] : [r.value];
    return scaleBases(rows.flatMap(vals), rowsAll.flatMap(vals));
  }, [rows, rowsAll, effSide]);
  const maxAbs = scaleMode === "ladder" ? ladderMax : nowMax;

  // Current-price row: nearest strike to spot
  const currentStrikeVal: number | null = useMemo(() => {
    if (spot == null || rows.length === 0) return null;
    const nearest = rows.reduce((best, r) =>
      Math.abs(r.s.strike - spot) < Math.abs(best.s.strike - spot) ? r : best
    );
    return Math.abs(nearest.s.strike - spot) <= step * 0.8 ? nearest.s.strike : null;
  }, [rows, spot, step]);

  // Gamma flip insertion index
  const flipStrike = levels.gammaFlip;
  let flipInsertAfter: number | null = null;
  if (flipStrike != null) {
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].s.strike >= flipStrike && flipStrike > rows[i + 1].s.strike) {
        flipInsertAfter = i;
        break;
      }
    }
  }

  // AUTO-CENTER: scroll spot row to mid-viewport on load and ticker change.
  //
  // Root-cause history:
  //   A. HIDDEN MOUNT: parent tab starts display:none → flex when active. The effect
  //      fires before the scroll container has non-zero height.
  //   B. UNCONSTRAINED LAYOUT (fixed): flex ancestor lacked minHeight:0, so the scroll
  //      container was clientHeight=scrollHeight (not scrollable). Fixed in GexDeskView.tsx
  //      (LEFT_PANE: maxHeight:"100%"). Guard retained: isScrollable() still rejects this.
  //   C. VISIBILITY FLIP: harness iframe sets visibilityState='hidden'. A visibilitychange
  //      event unblocks the data fetch. We re-attempt centering on that event.
  //   D. PRESENTATION-COUPLED QUERY: the DOM-query below used to find the spot row by
  //      scanning rendered text for the ▶ marker glyph — any change to the marker (a
  //      different glyph, an icon, moving it out of the row) would silently disable
  //      centering with no signal anywhere that this query depended on it, reintroducing
  //      bug A/B's symptom with none of its cause. Now keyed on SPOT_ROW_ATTR, a stable
  //      data-hook on the row itself (see findSpotRowIndex).
  //
  // Implementation: DOM-query approach avoids the early-return ref problem.
  // spotRowRef/scrollRef are only valid after the FULL render path (rows.length>0).
  // Instead, we query containerRef (always rendered) to find the scroll container
  // and the spot row directly from the DOM — no ref dependency on rows.length.
  useEffect(() => {
    if (!containerRef.current) return;

    let rafId: number | null = null;
    let observer: ResizeObserver | null = null;
    // Retry cap: prevent infinite loops if spot row is genuinely absent
    let retries = 0;
    const MAX_RETRIES = 30;

    function isScrollable(container: Element): boolean {
      return container.clientHeight > 0 && container.scrollHeight > container.clientHeight;
    }

    // Returns true if centering succeeded (scrollTop moved or spot already in view).
    function doCenter(): boolean {
      // Re-query from DOM every time — works even after early-return renders
      const container = containerRef.current?.querySelector<HTMLDivElement>(".obs-scroll") ?? null;
      if (!container || !isScrollable(container)) return false;

      // Find the spot row by its stable data-hook (never the marker glyph's text).
      const rows = container.children;
      const spotIdx = findSpotRowIndex(rows);
      const spotRow: Element | null = spotIdx >= 0 ? rows[spotIdx] : null;
      if (!spotRow) return false;

      const elTop = (spotRow as HTMLElement).offsetTop;
      const elHeight = (spotRow as HTMLElement).offsetHeight;
      const containerHeight = container.clientHeight;
      const target = elTop - containerHeight / 2 + elHeight / 2;
      const before = container.scrollTop;
      container.scrollTop = target;
      // Success: scrollTop moved toward target, or spot is already in view
      const moved = Math.abs(container.scrollTop - before) > 0.5;
      const inView =
        (spotRow as HTMLElement).offsetTop >= container.scrollTop &&
        (spotRow as HTMLElement).offsetTop + elHeight <=
          container.scrollTop + containerHeight;
      return moved || inView;
    }

    // FALLBACK — the root cause of the "opens at the top of the table" bug:
    // on some layouts the ladder's inner .obs-scroll never overflows (the
    // content stretches the hub column instead, and an ANCESTOR — tab column
    // or page — is the real scroller), so isScrollable() rejects the inner
    // container forever and centering never runs. When the inner scroller
    // isn't the one that scrolls, let the browser center the spot row within
    // whichever ancestor actually does.
    function centerViaAncestor(): boolean {
      const container = containerRef.current?.querySelector<HTMLDivElement>(".obs-scroll") ?? null;
      if (!container) return false;
      const rows = container.children;
      const spotIdx = findSpotRowIndex(rows);
      const spotRow: Element | null = spotIdx >= 0 ? rows[spotIdx] : null;
      if (!spotRow) return false;
      (spotRow as HTMLElement).scrollIntoView({ block: "center", inline: "nearest" });
      const r = (spotRow as HTMLElement).getBoundingClientRect();
      // Success = the spot row is actually on screen (non-degenerate rect).
      return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
    }

    function tryCenter() {
      if (retries >= MAX_RETRIES) {
        // Exhausted while hidden / zero layout — watch for the pane to get
        // real dimensions (display:none → flex on tab switch fires this).
        if (!observer && containerRef.current) {
          observer = new ResizeObserver(() => {
            observer?.disconnect();
            observer = null;
            retries = 0;
            rafId = requestAnimationFrame(tryCenter);
          });
          observer.observe(containerRef.current);
        }
        return;
      }
      retries++;
      const container = containerRef.current?.querySelector<HTMLDivElement>(".obs-scroll") ?? null;
      const success =
        container && isScrollable(container) ? doCenter() : centerViaAncestor();
      if (success) {
        // Keep a ResizeObserver armed so layout changes re-center
        if (!observer && containerRef.current) {
          observer = new ResizeObserver(() => {
            retries = 0;
            requestAnimationFrame(tryCenter);
          });
          observer.observe(container ?? containerRef.current);
        }
      } else {
        // Layout not final (clamped scroll / zero rects / spot row absent) —
        // retry next frame
        rafId = requestAnimationFrame(tryCenter);
      }
    }

    rafId = requestAnimationFrame(tryCenter);

    // Visibility-change fallback (harness preview late-load path)
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        retries = 0;
        requestAnimationFrame(tryCenter);
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  // Re-center when strike data changes (proxy: rows.length and spot)
  }, [rows.length, spot, currentStrikeVal]);

  // Compact track set below NARROW_PX — measured on the ladder itself, not the viewport,
  // so the desk stays usable when the pane is narrow for any reason (phone, split view).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setNarrow(w < NARROW_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function handler(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const netLabel = netLensLabel(greek, t);

  // ── Expiry lens options ───────────────────────────────────────────────────────
  // Driven by `by_expiry` (the payload's own term structure, with its net-γ per expiry
  // as a badge); each option is only selectable when the per strike×expiry snapshot can
  // actually answer for it at strikes this ladder renders.
  const expiryOptions = useMemo(
    () =>
      (byExpiry ?? []).map((e) => ({
        exp: normExp(e.exp),
        raw: e.exp,
        label: expLabel(e.exp),
        dte: dteFrom(e.exp, asOf),
        dteLabel: dteLabelFor(e.exp, asOf),
        netMn: e.gamma_net,
        isZero: isZeroDte(e.exp, asOf),
        covered: lensCoverage.has(normExp(e.exp)),
      })),
    [byExpiry, asOf, lensCoverage]
  );

  // B8: order-independent — the 0DTE expiry is whichever row lands on the snapshot's
  // session day, not `expiryOptions[0]`. (The old check also used the wall clock, so any
  // already-expired first row read as 0DTE.)
  const zeroOpt = expiryOptions.find((o) => o.isZero) ?? null;
  const has0Dte = zeroOpt != null;
  const zeroSelectable = has0Dte && zeroOpt.covered;
  const exZeroSelectable = expiryOptions.some((o) => o.covered && !o.isZero);
  const anyCovered = expiryOptions.some((o) => o.covered);

  const lensLabel =
    lens.kind === "all" ? t("expiryDropdownLabel")
    : lens.kind === "zero" ? t("expiryLensZero")
    : lens.kind === "ex-zero" ? t("expiryLensExZero")
    : expLabel(lens.exp ?? "");
  const lensTag =
    lens.kind === "all" ? null
    : lens.kind === "zero" ? t("expiry0Dte")
    : lens.kind === "ex-zero" ? t("expiryLensExZero")
    : expLabel(lens.exp ?? "");

  const coveredRows = rowsAll.filter((r) => r.value != null).length;
  const showBreakdown = greek === "gamma" && lens.kind === "all";

  function handleMouseEnter(r: LadderRow, badge: string | undefined, e: React.MouseEvent) {
    setTooltip({
      strike: r.s.strike,
      net: r.value,
      gamma_call: r.s.gamma_call,
      gamma_put: r.s.gamma_put,
      showBreakdown,
      netLabel,
      lensTag,
      badge,
      topExpiries: topExpiriesForStrike(matrixCells, r.s.strike),
      // Viewport coordinates: the popover renders on the fixed layer (.obs-surf-pop),
      // so it is never clipped by the ladder's own overflow:hidden shell.
      x: e.clientX,
      y: e.clientY,
    });
  }

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const tracks = narrow
    ? TRACKS.narrow
    : effSide === "split"
    ? TRACKS.wideSplit
    : TRACKS.wide;
  const gridTemplate = `${tracks.strike}px 1fr ${tracks.tag}px ${tracks.val}px`;
  const centerLeft = `calc(${tracks.strike}px + (100% - ${
    tracks.strike + tracks.tag + tracks.val
  }px) / 2)`;

  if (rows.length === 0) {
    return (
      <div style={LADDER_OUTER} data-tut="gex-ladder">
        <div style={LADDER_EMPTY}>{t("ladderNoData")}</div>
      </div>
    );
  }

  return (
    <div style={LADDER_OUTER} ref={containerRef} data-tut="gex-ladder">
      {/* ── Expiry lens ───────────────────────────────────────────────────────── */}
      {byExpiry && byExpiry.length > 0 && (
        <div style={EXPIRY_BAR}>
          {/* Dropdown */}
          <div style={{ position: "relative" }} ref={dropdownRef}>
            <button
              style={{ ...DD_TRIGGER, minWidth: narrow ? 108 : 150 }}
              onClick={() => setDropdownOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
              aria-label={t("expiryLensAria")}
            >
              <span>{lensLabel}</span>
              <span
                style={{
                  ...DD_CARET,
                  transform: dropdownOpen ? "rotate(180deg)" : undefined,
                }}
              >
                ▾
              </span>
            </button>
            {dropdownOpen && (
              <div style={DD_MENU} role="listbox">
                {/* All — always available: it is the by_strike aggregate itself */}
                <button
                  style={{ ...DD_OPT, ...(lens.kind === "all" ? DD_OPT_ACTIVE : {}) }}
                  role="option"
                  aria-selected={lens.kind === "all"}
                  onClick={() => { onLens({ kind: "all" }); setDropdownOpen(false); }}
                >
                  <span>{t("expiryDropdownLabel")}</span>
                  <span style={DD_OPT_DTE}>{fmtBn(netGexBn)}</span>
                </button>

                {/* Session cuts */}
                {has0Dte && (
                  <button
                    style={{
                      ...DD_OPT,
                      ...(lens.kind === "zero" ? DD_OPT_ACTIVE : {}),
                      ...(zeroSelectable ? {} : DD_OPT_OFF),
                    }}
                    role="option"
                    aria-selected={lens.kind === "zero"}
                    aria-disabled={!zeroSelectable}
                    onClick={() => {
                      if (!zeroSelectable) return;
                      onLens({ kind: "zero" });
                      setDropdownOpen(false);
                    }}
                  >
                    <span>{t("expiryLensZero")}</span>
                    <span style={DD_OPT_DTE}>
                      {zeroSelectable ? fmtMn(zeroOpt.netMn) : t("expiryLensNoRows")}
                    </span>
                  </button>
                )}
                {has0Dte && (
                  <button
                    style={{
                      ...DD_OPT,
                      ...(lens.kind === "ex-zero" ? DD_OPT_ACTIVE : {}),
                      ...(exZeroSelectable ? {} : DD_OPT_OFF),
                    }}
                    role="option"
                    aria-selected={lens.kind === "ex-zero"}
                    aria-disabled={!exZeroSelectable}
                    onClick={() => {
                      if (!exZeroSelectable) return;
                      onLens({ kind: "ex-zero" });
                      setDropdownOpen(false);
                    }}
                  >
                    <span>{t("expiryLensExZero")}</span>
                    <span style={DD_OPT_DTE}>
                      {exZeroSelectable ? "" : t("expiryLensNoRows")}
                    </span>
                  </button>
                )}

                <div style={DD_GROUP_LBL}>{t("expiryLensGroupOne")}</div>
                {expiryOptions.map((o) => (
                  <button
                    key={o.exp}
                    style={{
                      ...DD_OPT,
                      ...(lens.kind === "one" && lens.exp === o.exp ? DD_OPT_ACTIVE : {}),
                      ...(o.covered ? {} : DD_OPT_OFF),
                    }}
                    role="option"
                    aria-selected={lens.kind === "one" && lens.exp === o.exp}
                    aria-disabled={!o.covered}
                    onClick={() => {
                      if (!o.covered) return;
                      onLens({ kind: "one", exp: o.exp });
                      setDropdownOpen(false);
                    }}
                  >
                    <span>
                      {o.exp}
                      <span style={DD_OPT_DTE}> · {o.dteLabel}</span>
                    </span>
                    <span style={DD_OPT_DTE}>
                      {o.covered ? fmtMn(o.netMn) : t("expiryLensNoRows")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 0DTE quick chip — shown whenever the snapshot HAS a same-day expiry */}
          {has0Dte && (
            <button
              className={`obs-chip obs-gex-mobile-target${lens.kind === "zero" ? " on" : ""}`}
              style={{ ...QUICK_CHIP, opacity: zeroSelectable ? 1 : 0.45 }}
              aria-pressed={lens.kind === "zero"}
              aria-disabled={!zeroSelectable}
              onClick={() => {
                if (!zeroSelectable) return;
                onLens(lens.kind === "zero" ? { kind: "all" } : { kind: "zero" });
              }}
            >
              {t("expiry0Dte")}
            </button>
          )}

          {/* Net | Call/Put — only where the feed actually carries both legs */}
          <div style={SIDE_GROUP} role="group" aria-label={t("sideAria")}>
            {(["net", "split"] as LadderSide[]).map((k) => (
              <button
                key={k}
                className={`obs-chip${effSide === k ? " on" : ""}`}
                style={{ ...SIDE_CHIP, opacity: splitAvailable || k === "net" ? 1 : 0.45 }}
                aria-pressed={effSide === k}
                aria-disabled={k === "split" && !splitAvailable}
                onClick={() => { if (k === "net" || splitAvailable) setSide(k); }}
              >
                {k === "net" ? t("sideNet") : t("sideSplit")}
              </button>
            ))}
          </div>

          {/* Honest state line — one per situation, never a silent fallback */}
          <span style={LENS_NOTE}>
            {greek !== "gamma" && lens.kind === "all"
              ? t("expiryGammaOnlyNote")
              : !anyCovered && lens.kind === "all"
              ? t("expiryNoMatrixNote")
              : lens.kind === "all"
              ? t("expiryAggregateNote")
              : t("expiryScopedNote")
                  .replace("{n}", String(coveredRows))
                  .replace("{m}", String(rowsAll.length))}
            {lens.kind !== "all" && matrixAsOf && (
              <span style={{ opacity: 0.75 }}> · {matrixAsOf.slice(0, 10)}</span>
            )}
          </span>
        </div>
      )}

      {/* ── Walls chip row + range presets (the ladder's own "so what" strip) ── */}
      <div style={WALLS_ROW}>
        {greek === "gamma" && !narrow && (
          <div style={WALLS_CHIPS}>
            {/* Net GEX follows the lens: the all-expiry headline ($bn) under All, the
                lens's own sum ($mn) when scoped — with the lens named on the label so the
                two can never be mistaken for each other. */}
            <WallChip
              label={lens.kind === "all" ? t("ladderWallsNet") : `${t("ladderWallsNet")} · ${lensTag}`}
              value={lens.kind === "all" ? fmtBn(netGexBn) : fmtMn(lensValues.totalMn)}
              color={(lens.kind === "all" ? (netGexBn ?? 0) : lensValues.totalMn) >= 0 ? "var(--up)" : "var(--down)"}
              show={lens.kind === "all" ? netGexBn != null : lensValues.cellCount > 0} />
            <WallChip label={t("ladderWallsFlip")} value={levels.gammaFlip != null ? fmtStrike(levels.gammaFlip) : "—"}
              color={FLIP_VIOLET} show={levels.gammaFlip != null} />
            <WallChip label={t("ladderWallsCall")} value={levels.callWall != null ? fmtStrike(levels.callWall) : "—"}
              color="var(--brand-2)" show={levels.callWall != null} />
            <WallChip label={t("ladderWallsPut")} value={levels.putWall != null ? fmtStrike(levels.putWall) : "—"}
              color="var(--down)" show={levels.putWall != null} />
          </div>
        )}
        {/* Range presets ±2 / ±5 / ±10 / All */}
        <div style={RANGE_PRESET_GROUP} role="group" aria-label={t("rangePresetAria")}>
          {RANGE_PRESETS.map((r) => (
            <button key={r.pct} className={`obs-chip${rangePct === r.pct ? " on" : ""}`} style={RANGE_CHIP}
              aria-pressed={rangePct === r.pct} onClick={() => setRangePct(r.pct)}>
              {r.pct === 0 ? t("rangeAll") : r.label}
            </button>
          ))}
        </div>
        {/* Off-head scrubber → this EOD ladder did not travel with it. Renders nothing while
            the workspace is live, so an un-replayed desk looks exactly as it always did. */}
        <EodReplayTag lang={lang} />
      </div>

      {/* ── Column headers ──────────────────────────────────────────────────── */}
      <div style={{ ...COL_HEADER_ROW, gridTemplateColumns: gridTemplate }}>
        <span className="obs-lbl">{t("ladderStrike")}</span>
        <span className="obs-lbl" style={COL_BAR_HDR}>
          {effSide === "split" ? `${t("ladderPutGex")} · ${t("ladderCallGex")}` : netLabel}
        </span>
        <span style={COL_TAG_HDR}>{/* level tag column — no header */}</span>
        <span className="obs-lbl" style={COL_VAL_HDR}>
          {effSide === "split" ? t("sideSplit") : netLabel}
        </span>
      </div>

      {/* ── Scrollable chart body ─────────────────────────────────────────────── */}
      <div style={CHART_SCROLL} ref={scrollRef} className="obs-scroll">
        {/* Center axis hairline (positioned over bar area) */}
        <div style={{ ...CENTER_LINE, left: centerLeft }} />

        {rows.map((r, i) => {
          const s = r.s;
          const badge = classifyBadge(s, levels, step);
          const isCurrent = s.strike === currentStrikeVal;
          const hasValue = r.value != null;
          const net = r.value ?? 0;
          const isPos = net >= 0;

          // Bar geometry: power curve, max 46% per half. A null (uncovered) strike draws
          // no bar at all — the dash in the value column is the whole story.
          const barOf = (v: number | null) => {
            if (v == null || !Number.isFinite(v)) return { w: 0, big: false };
            const pct = Math.abs(v) / maxAbs;
            return { w: Math.max(Math.pow(pct, 0.7) * 46, pct > 0 ? 2 : 0), big: pct > 0.35 };
          };
          const netBar = barOf(hasValue ? net : null);
          const callBar = barOf(r.call);
          const putBar = barOf(r.put);

          const strikeColor = isCurrent
            ? "var(--signal)"
            : badge?.tone === "cyan"
            ? "var(--brand-2)"
            : badge?.tone === "red"
            ? "var(--down)"
            : badge?.tone === "amber"
            ? "var(--signal)"
            : badge?.tone === "purple"
            ? FLIP_VIOLET
            : "var(--text-2)";

          return (
            <React.Fragment key={s.strike}>
              {/* Gamma flip divider line */}
              {flipInsertAfter === i - 1 && flipStrike != null && (
                <div style={FLIP_LINE} data-tut="gex-flip">
                  <span style={FLIP_LABEL}>{t("ladderFlipLine")}</span>
                  <div style={FLIP_GRADIENT} />
                  <span style={FLIP_PRICE}>{fmtStrike(flipStrike)}</span>
                </div>
              )}

              <div
                ref={isCurrent ? spotRowRef : undefined}
                {...(isCurrent ? { [SPOT_ROW_ATTR]: SPOT_ROW_VAL } : {})}
                style={{
                  ...STRIKE_ROW,
                  gridTemplateColumns: gridTemplate,
                  ...(isCurrent ? CURRENT_ROW : {}),
                  ...(badge?.tone === "cyan" ? ZONE_CW : {}),
                  ...(badge?.tone === "amber" ? ZONE_HVL : {}),
                  ...(badge?.tone === "red" ? ZONE_PS : {}),
                }}
                onMouseEnter={(e) =>
                  handleMouseEnter(r, badge ? badgeLabel(badge.kind, t, false) : undefined, e)
                }
                onMouseLeave={handleMouseLeave}
              >
                {/* Strike price label + %-from-spot */}
                <div style={STRIKE_COL}>
                  <span
                    style={{
                      ...STRIKE_PRICE,
                      color: strikeColor,
                      fontWeight: isCurrent || badge ? 700 : 400,
                    }}
                  >
                    {fmtStrike(s.strike)}
                  </span>
                  {spot != null && !isCurrent && !narrow && (
                    <span style={PCT_DIST}>
                      {fmtPctFromSpot(s.strike, spot)}
                    </span>
                  )}
                  {isCurrent && (
                    <span style={SPOT_MARKER}>▶</span>
                  )}
                </div>

                {/* Bar area (symmetric around center axis) */}
                <div style={BAR_AREA}>
                  {effSide === "split" ? (
                    <>
                      {putBar.w > 0 && (
                        <div style={{ ...BAR_NEG, width: `${putBar.w}%`, opacity: putBar.big ? 1 : 0.75 }} />
                      )}
                      {callBar.w > 0 && (
                        <div style={{ ...BAR_POS, width: `${callBar.w}%`, opacity: callBar.big ? 1 : 0.75 }} />
                      )}
                    </>
                  ) : (
                    <>
                      {!isPos && netBar.w > 0 && (
                        <div style={{ ...BAR_NEG, width: `${netBar.w}%`, opacity: netBar.big ? 1 : 0.75 }} />
                      )}
                      {isPos && netBar.w > 0 && (
                        <div style={{ ...BAR_POS, width: `${netBar.w}%`, opacity: netBar.big ? 1 : 0.75 }} />
                      )}
                    </>
                  )}
                </div>

                {/* Right-edge level tag — tint formula, one hue in via --c */}
                <div style={TAG_COL}>
                  {badge && (
                    <span
                      className="obs-tag sm"
                      style={{ "--c": toneColor(badge.tone) } as React.CSSProperties}
                    >
                      {badgeLabel(badge.kind, t, narrow)}
                    </span>
                  )}
                </div>

                {/* Value column */}
                {effSide === "split" ? (
                  <div style={SPLIT_VAL_COL}>
                    <span className="num" style={{ ...SPLIT_VAL, color: "var(--up)" }}>
                      {fmtMn(r.call)}
                    </span>
                    <span className="num" style={{ ...SPLIT_VAL, color: "var(--down)" }}>
                      {fmtMn(r.put)}
                    </span>
                  </div>
                ) : (
                  <span
                    className="num"
                    style={{
                      ...GEX_VAL,
                      fontSize: narrow ? 9 : 10,
                      color: !hasValue
                        ? "var(--text-dim)"
                        : isPos
                        ? "var(--up)"
                        : "var(--down)",
                    }}
                  >
                    {hasValue ? fmtMn(net) : "—"}
                  </span>
                )}
              </div>
            </React.Fragment>
          );
        })}

        {/* Gamma flip at the very bottom (if below all strikes) */}
        {flipInsertAfter === null &&
          flipStrike != null &&
          flipStrike < (rows[rows.length - 1]?.s.strike ?? Infinity) && (
            <div style={FLIP_LINE}>
              <span style={FLIP_LABEL}>{t("ladderFlipLine")}</span>
              <div style={FLIP_GRADIENT} />
              <span style={FLIP_PRICE}>{fmtStrike(flipStrike)}</span>
            </div>
          )}
      </div>

      {/* ── Hover popover ───────────────────────────────────────────────────────
          Fixed layer (.obs-surf-pop, the same one SurfacePane uses) — the ladder's
          shell is overflow:hidden, so an absolutely-positioned tooltip got sliced off
          at the pane edges on the outermost rows. */}
      {tooltip && (
        <div
          className="obs-surf-pop"
          role="tooltip"
          style={{
            left: Math.max(
              8,
              Math.min(
                tooltip.x + 16,
                (typeof window !== "undefined" ? window.innerWidth : 1200) - 248
              )
            ),
            top: Math.max(
              8,
              Math.min(
                tooltip.y - 24,
                (typeof window !== "undefined" ? window.innerHeight : 800) - 220
              )
            ),
          }}
        >
          <div className="obs-surf-pop-hd">
            <span className="obs-surf-pop-strike">${fmtStrike(tooltip.strike)}</span>
            {spot != null && (
              <span className="obs-surf-pop-pct">
                {fmtPctFromSpot(tooltip.strike, spot)}
              </span>
            )}
            {tooltip.badge && (
              <span className="obs-surf-pop-pct">· {tooltip.badge}</span>
            )}
          </div>
          <div className="obs-surf-pop-row">
            <span className="k">
              {tooltip.netLabel}
              {tooltip.lensTag && (
                <span style={{ color: "var(--muted)" }}> · {tooltip.lensTag}</span>
              )}
            </span>
            <span
              className="v"
              style={{
                color:
                  tooltip.net == null
                    ? "var(--text-dim)"
                    : tooltip.net >= 0
                    ? "var(--up)"
                    : "var(--down)",
              }}
            >
              {tooltip.net == null ? "—" : fmtMn(tooltip.net)}
            </span>
          </div>
          {/* An uncovered strike says so, rather than borrowing the aggregate's number. */}
          {tooltip.net == null && (
            <div className="obs-surf-pop-hint">{t("expiryDashNote")}</div>
          )}
          {/* Call/put split is an all-expiry gamma breakdown — the by_strike payload carries
              gamma_call/gamma_put, but no per-side split for delta/vanna/charm or per expiry. */}
          {tooltip.showBreakdown && (
            <>
              <div className="obs-surf-pop-sep" />
              <div className="obs-surf-pop-row">
                <span className="k">{t("tooltipCallGex")}</span>
                <span className="v" style={{ color: "var(--up)" }}>
                  {fmtMn(tooltip.gamma_call)}
                </span>
              </div>
              <div className="obs-surf-pop-row">
                <span className="k">{t("tooltipPutGex")}</span>
                <span className="v" style={{ color: "var(--down)" }}>
                  {fmtMn(tooltip.gamma_put)}
                </span>
              </div>
            </>
          )}
          {/* Top-3 per-expiry breakdown — only when the matrix payload carries per-expiry
              cells for this strike. Absent → omitted (never fabricated). */}
          {tooltip.topExpiries.length > 0 && (
            <>
              <div className="obs-surf-pop-sep" />
              <div className="obs-surf-pop-hint" style={{ marginTop: 0, marginBottom: 3 }}>
                {t("expiryBreakdownTitle")}
              </div>
              {tooltip.topExpiries.map((e) => (
                <div key={e.exp} className="obs-surf-pop-row">
                  <span className="k">{expLabel(e.exp)}</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span className="v" style={{ color: e.gex >= 0 ? "var(--up)" : "var(--down)" }}>
                      {fmtMn(e.gex / 1e6)}
                    </span>
                    <span
                      className="v"
                      style={{ color: "var(--muted)", fontSize: "var(--fs-micro)", minWidth: 28, textAlign: "right" }}
                    >
                      {(e.share * 100).toFixed(0)}%
                    </span>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── NOW | LADDER MAX bar scale (B1) ──────────────────────────────────── */}
      <div style={SCALE_FOOTER}>
        <div style={SCALE_TOGGLE} role="group" aria-label={t("scaleAria")}>
          <button className={`obs-chip${scaleMode === "now" ? " on" : ""}`} style={SCALE_CHIP}
            aria-pressed={scaleMode === "now"} onClick={() => setScaleMode("now")}>
            {t("scaleNow")} ±{fmtMnMag(nowMax)}
          </button>
          <button className={`obs-chip${scaleMode === "ladder" ? " on" : ""}`} style={SCALE_CHIP}
            aria-pressed={scaleMode === "ladder"} onClick={() => setScaleMode("ladder")}>
            {t("scalePeak")} ±{fmtMnMag(ladderMax)}
          </button>
        </div>
        {!narrow && (
          <span style={{ fontSize: "var(--fs-micro)", color: "var(--muted)" }}>{t("scalePeakNote")}</span>
        )}
      </div>
    </div>
  );
}

// ─── Walls chip (compact KV cell in the walls row) ─────────────────────────────

function WallChip({ label, value, color, show }: { label: string; value: string; color: string; show: boolean }) {
  return (
    <div style={{ ...WALL_CHIP, opacity: show ? 1 : 0.5 }}>
      <span style={WALL_CHIP_LBL}>{label}</span>
      <span className="num" style={{ ...WALL_CHIP_VAL, color: show ? color : "var(--muted)" }}>{value}</span>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const LADDER_OUTER: React.CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: "var(--bg)",
};

const WALLS_ROW: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap",
  padding: "var(--sp-1) var(--sp-3)", borderBottom: "1px solid var(--line-2)",
  background: "var(--panel)", flexShrink: 0,
};

const WALLS_CHIPS: React.CSSProperties = { display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" };

const WALL_CHIP: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 1,
  padding: "var(--sp-1) var(--sp-2)", borderRadius: "var(--r-tile)",
  border: "1px solid var(--line-2)", background: "var(--inset)", minWidth: 56,
};

const WALL_CHIP_LBL: React.CSSProperties = {
  fontSize: "var(--fs-micro)", color: "var(--muted)", textTransform: "uppercase",
  letterSpacing: "0.08em", fontWeight: 700, lineHeight: 1.3,
};

const WALL_CHIP_VAL: React.CSSProperties = {
  fontSize: "var(--fs-ui)", fontWeight: 700,
  fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums",
};

const RANGE_PRESET_GROUP: React.CSSProperties = { display: "flex", gap: "var(--sp-1)", marginLeft: "auto" };

const RANGE_CHIP: React.CSSProperties = { height: 28, minWidth: 44, fontSize: "var(--fs-micro)", padding: "0 var(--sp-2)" };

const SCALE_FOOTER: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap",
  padding: "var(--sp-1) var(--sp-3)", borderTop: "1px solid var(--line-2)",
  background: "var(--panel)", flexShrink: 0,
};

const SCALE_TOGGLE: React.CSSProperties = { display: "flex", gap: "var(--sp-1)" };

const SCALE_CHIP: React.CSSProperties = {
  height: 24, fontSize: "var(--fs-micro)", padding: "0 var(--sp-2)",
  fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums",
};

const LADDER_EMPTY: React.CSSProperties = {
  padding: "var(--sp-6)",
  color: "var(--muted)",
  fontSize: "var(--fs-ui)",
  lineHeight: 1.5,
  textAlign: "center",
};

// Expiry lens bar
const EXPIRY_BAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  padding: "var(--sp-1) var(--sp-3)",
  borderBottom: "1px solid var(--line-2)",
  background: "var(--panel)",
  flexShrink: 0,
  flexWrap: "wrap",
};

const LENS_NOTE: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  color: "var(--muted)",
  marginLeft: 2,
  flex: "1 1 160px",
  minWidth: 0,
  lineHeight: 1.35,
};

const SIDE_GROUP: React.CSSProperties = { display: "flex", gap: "var(--sp-1)" };

const SIDE_CHIP: React.CSSProperties = { height: 28, fontSize: "var(--fs-micro)", padding: "0 var(--sp-3)" };

// Dropdown trigger
const DD_TRIGGER: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--sp-1)",
  padding: "var(--sp-1) var(--sp-2)",
  fontSize: "var(--fs-label)",
  fontWeight: 600,
  color: "var(--text)",
  background: "var(--inset)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-tile)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const DD_CARET: React.CSSProperties = {
  marginLeft: "auto",
  fontSize: "var(--fs-micro)",
  color: "var(--muted)",
  transition: "transform var(--t-fast) var(--ease-out)",
  display: "inline-block",
};

// Glass menu — the house popover tokens rather than a one-off blur + panel fill.
const DD_MENU: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + var(--sp-1))",
  left: 0,
  zIndex: 50,
  background: "var(--pop-bg)",
  border: "1px solid var(--pop-edge)",
  borderRadius: "var(--r-tile)",
  maxHeight: 300,
  overflowY: "auto",
  minWidth: 208,
  boxShadow: "var(--pop-shadow), var(--pop-sheen)",
  backdropFilter: "var(--pop-blur)",
  WebkitBackdropFilter: "var(--pop-blur)",
};

const DD_OPT: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  padding: "var(--sp-2) var(--sp-3)",
  fontSize: "var(--fs-label)",
  fontWeight: 500,
  color: "var(--text-2)",
  background: "none",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
  gap: "var(--sp-2)",
};

const DD_OPT_ACTIVE: React.CSSProperties = {
  color: "var(--signal)",
  background: "color-mix(in srgb, var(--signal) 9%, transparent)",
};

/** An expiry the per-strike snapshot cannot answer for — visible, but not selectable. */
const DD_OPT_OFF: React.CSSProperties = {
  color: "var(--text-dim)",
  cursor: "not-allowed",
};

const DD_OPT_DTE: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  color: "var(--muted)",
  fontFamily: "var(--font-num)",
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
};

const DD_GROUP_LBL: React.CSSProperties = {
  padding: "var(--sp-2) var(--sp-3) var(--sp-1)",
  fontSize: "var(--fs-micro)",
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--muted)",
  borderTop: "1px solid var(--line-2)",
  marginTop: "var(--sp-1)",
};

const QUICK_CHIP: React.CSSProperties = {
  padding: "var(--sp-1) var(--sp-2)",
  fontSize: "var(--fs-micro)",
  borderRadius: "var(--r-tile)",
};

// Column headers — labels ride .obs-lbl; these carry alignment only.
const COL_HEADER_ROW: React.CSSProperties = {
  display: "grid",
  alignItems: "center",
  padding: "var(--sp-2)",
  borderBottom: "1px solid var(--line-2)",
  background: "var(--panel)",
  position: "sticky",
  top: 0,
  zIndex: 2,
  flexShrink: 0,
};

const COL_BAR_HDR: React.CSSProperties = {
  textAlign: "center",
};

const COL_TAG_HDR: React.CSSProperties = {};

const COL_VAL_HDR: React.CSSProperties = {
  textAlign: "right",
};

// Scroll container (fills remaining space) — obs-scroll class handles scrollbar styling
const CHART_SCROLL: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  position: "relative",
};

// Center-axis hairline — spans full scroll height, pinned at the middle of the bar column.
// `left` is computed from the live grid tracks (they change with the split toggle and the
// narrow breakpoint), so the hairline can't drift off the bars' zero point.
const CENTER_LINE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  width: 1,
  background: "var(--hairline-strong)",
  pointerEvents: "none",
  zIndex: 1,
};

const STRIKE_ROW: React.CSSProperties = {
  display: "grid",
  alignItems: "center",
  height: 28,
  borderBottom: "1px solid var(--grid)",
  cursor: "default",
  position: "relative",
  transition: "background var(--t-fast) var(--ease-out)",
};

const CURRENT_ROW: React.CSSProperties = {
  background: "color-mix(in srgb, var(--signal) 7%, transparent)",
  borderTop: "1px solid color-mix(in srgb, var(--signal) 22%, transparent)",
  borderBottom: "1px solid color-mix(in srgb, var(--signal) 22%, transparent)",
};

// Zone tints (only on relevant rows). The put-support tint was a hardcoded red that did
// not flip with html[data-updown="east"] — its row's text and bar did.
const ZONE_CW: React.CSSProperties = {
  background: "color-mix(in srgb, var(--brand-2) 4%, transparent)",
};

const ZONE_HVL: React.CSSProperties = {
  background: "color-mix(in srgb, var(--signal) 4%, transparent)",
};

const ZONE_PS: React.CSSProperties = {
  background: "color-mix(in srgb, var(--down) 4%, transparent)",
};

const STRIKE_COL: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-1)",
  padding: "0 var(--sp-2)",
  overflow: "hidden",
};

const STRIKE_PRICE: React.CSSProperties = {
  fontSize: "var(--fs-ui)",
  fontFamily: "var(--font-num)",
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
};

const PCT_DIST: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  color: "var(--muted)",
  fontFamily: "var(--font-num)",
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
};

const SPOT_MARKER: React.CSSProperties = {
  fontSize: 8,
  color: "var(--signal)",
  flexShrink: 0,
};

const BAR_AREA: React.CSSProperties = {
  position: "relative",
  height: "100%",
  display: "flex",
  alignItems: "center",
};

// Bars ride the --up/--down TOKENS (via their RGB triplets), so a positive bar and the
// positive number beside it are one hue, and the East-Asian 红涨绿跌 theme flips both.
// The old hardcoded rgba(77,130,255)/rgba(240,86,107) could do neither.
const BAR_POS: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  height: 14,
  borderRadius: "0 2px 2px 0",
  background:
    "linear-gradient(90deg, rgba(var(--up-rgb),0.45), rgba(var(--up-rgb),0.85))",
  transition: "width 0.35s cubic-bezier(.22,1,.36,1)",
};

const BAR_NEG: React.CSSProperties = {
  position: "absolute",
  right: "50%",
  height: 14,
  borderRadius: "2px 0 0 2px",
  background:
    "linear-gradient(270deg, rgba(var(--down-rgb),0.45), rgba(var(--down-rgb),0.85))",
  transition: "width 0.35s cubic-bezier(.22,1,.36,1)",
};

const TAG_COL: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  paddingRight: 4,
  overflow: "hidden",
};

const GEX_VAL: React.CSSProperties = {
  fontSize: "var(--fs-label)",
  fontFamily: "var(--font-num)",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 600,
  textAlign: "right",
  paddingRight: "var(--sp-2)",
  letterSpacing: "0.01em",
};

const SPLIT_VAL_COL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  justifyContent: "center",
  paddingRight: "var(--sp-2)",
  overflow: "hidden",
};

/* 8.5px: two stacked legs inside a 28px row — the only sub-ramp size on the ladder, and
   the split column is measured to it (TRACKS.wideSplit.val). */
const SPLIT_VAL: React.CSSProperties = {
  fontSize: 8.5,
  lineHeight: 1.25,
  fontWeight: 600,
  fontFamily: "var(--font-num)",
  fontVariantNumeric: "tabular-nums",
};

const FLIP_LINE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  padding: "var(--sp-1) var(--sp-2)",
  height: 24,
  background: "color-mix(in srgb, var(--ai) 8%, transparent)",
  borderTop: "1px solid color-mix(in srgb, var(--ai) 32%, transparent)",
  borderBottom: "1px solid color-mix(in srgb, var(--ai) 32%, transparent)",
  zIndex: 2,
};

const FLIP_LABEL: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  fontWeight: 900,
  color: FLIP_VIOLET,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  flexShrink: 0,
};

const FLIP_GRADIENT: React.CSSProperties = {
  flex: 1,
  height: 1,
  background:
    "linear-gradient(90deg, rgba(var(--ai-rgb),0.6) 0%, rgba(var(--ai-rgb),0.05) 100%)",
};

const FLIP_PRICE: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  color: FLIP_VIOLET,
  fontFamily: "var(--font-num)",
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
};
