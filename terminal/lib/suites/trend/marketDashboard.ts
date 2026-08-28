// Market Dashboard — Trend Waves module (on-chart state table, no prims).
//
// Contract: lib/indicator-canvas/types.ts (frozen — TableSpec + ModuleResult.tables, W3).
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.2 "Market Dashboard".
//
// One positioned table (id "trend-dash"), six toggleable rows, every number hand-computable:
//
//   Volatility   ATR(14)/close percentile-ranked vs the trailing 252 bars → "72%".
//   Compression  Bollinger(20,2) bandwidth percentile INVERTED to 0..10 (10 = tightest).
//   Trend Score  −10..+10 = 5·(Trend Engine regime) + 3·(EMA20 vs EMA50) + 2·(close vs EMA200).
//   Pressure     −10..+10 = trailing-20-bar Σ volume·bodyPosition, percentile vs 252 → (pct−50)/5.
//   Rating       STRONG BUY … STRONG SELL — documented vote of {Trend, Pressure, Compression}.
//   MTF          the Trend Engine regime on the chart bars and on 2×/4× RESAMPLES of those bars.
//
// SATELLITE LAW (W2): the Trend Engine regime is recomputed with the ENGINE'S live sensitivity read
// from ctx.suite["te.sensitivity"] — never this module's own assumption. trendEngine.ts does not
// export its mapSens helper, so the (period, mult) mapping — period = round(7 + s·1.5),
// mult = 1.2 + s·0.28 — and its ATR warm-up are REPLICATED here verbatim (deviation noted in the
// build report; if the mapping ever changes in trendEngine.ts this copy must move with it). The
// engine's autoOpt (default OFF, documented repaint hazard) is deliberately ignored: the dashboard
// always reflects the STATIC sensitivity so its history never rewrites itself.
//
// MTF honesty: "2×" and "4×" are the LOADED chart bars aggregated 2/4-per-group via resampleOhlcv —
// complete groups only, nothing fetched from another timeframe. The footnote says so on the table.
//
// Non-repaint: every series is a forward recurrence or a trailing-window statistic over bars ≤ i;
// resampling emits complete groups only; the rating-change event tape is a forward pass with a
// fixed cooldown. Pure — no wall clock, randomness or module state.

import type {
  ModuleCtx,
  ModuleResult,
  SuiteBar,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  TableSpec,
} from "@/lib/indicator-canvas/types";
import { emaArr, resampleOhlcv, rollingPercentile, wilderRma } from "@/lib/suites/shared/oscUtils";
import { MARKET_DASHBOARD_META } from "./marketDashboard.meta";

// ------------------------------------------------------------------------------------ constants

const ATR_LEN = 14; // Volatility row ATR
const RANK_WIN = 252; // trailing percentile window (≈ one trading year of daily bars)
const BB_LEN = 20; // Compression: Bollinger length
const BB_MULT = 2; // Compression: Bollinger multiplier
const PRESS_WIN = 20; // Pressure: rolling delta window
const EMA_FAST = 20;
const EMA_SLOW = 50;
const EMA_LONG = 200;
const W_TE = 5; // Trend Score weight: Trend Engine regime
const W_CROSS = 3; // Trend Score weight: EMA20 vs EMA50
const W_POS = 2; // Trend Score weight: close vs EMA200
const TS_MIN = 3; // |Trend| < 3 ⇒ NEUTRAL
const TS_STRONG = 7; // |Trend| ≥ 7 (+ confirmations) ⇒ STRONG
const SQUEEZE_HI = 8; // Compression ≥ 8 ⇒ squeeze watch (blocks STRONG, highlights the cell)
const VOL_WARN = 80; // Volatility > 80% ⇒ warn color
const RATING_COOLDOWN = 10; // min bars between rating-change events
const MAX_EVENTS = 60;

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- helpers

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function numOpt(v: any, d: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? clamp(n, lo, hi) : d;
}

function boolOpt(v: any, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}

function selOpt<T extends string>(v: any, d: T, allowed: readonly T[]): T {
  return allowed.includes(v) ? (v as T) : d;
}

/** A bar with a zero/NaN price is MISSING, not a print (CN/HK premarket pushes OHLC=0). */
function validBar(b: SuiteBar | undefined): b is SuiteBar {
  if (!b) return false;
  return (
    Number.isFinite(b.o) &&
    Number.isFinite(b.h) &&
    Number.isFinite(b.l) &&
    Number.isFinite(b.c) &&
    b.h > 0 &&
    b.l > 0 &&
    b.h >= b.l
  );
}

// ------------------------------------------------------- Trend Engine regime (replicated minimal)

/**
 * sensitivity 1..10 → engine params. VERBATIM copy of trendEngine.ts mapSens (not exported there):
 * s=1 ≈ (9, 1.5) fast, s=10 ≈ (22, 4.0) slow. Keep in lockstep with the engine.
 */
function mapSens(s: number): { period: number; mult: number } {
  return { period: Math.round(7 + s * 1.5), mult: 1.2 + s * 0.28 };
}

/**
 * Wilder ATR with running-mean warm-up — VERBATIM copy of trendEngine.ts atrSeries so the regime
 * recomputed here can never drift from the band the engine actually draws.
 */
function teAtrSeries(bars: SuiteBar[], len: number): Float64Array {
  const n = bars.length;
  const out = new Float64Array(n);
  let seedSum = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const pc = i > 0 && Number.isFinite(bars[i - 1].c) && bars[i - 1].c > 0 ? bars[i - 1].c : b.o;
    const hl = b.h - b.l;
    const tr = Math.max(
      Number.isFinite(hl) ? hl : 0,
      Number.isFinite(pc) ? Math.abs(b.h - pc) : 0,
      Number.isFinite(pc) ? Math.abs(b.l - pc) : 0,
    );
    const t = Number.isFinite(tr) && tr > 0 ? tr : 0;
    if (i < len) {
      seedSum += t;
      prev = seedSum / (i + 1);
    } else {
      prev = (prev * (len - 1) + t) / len;
    }
    out[i] = prev;
  }
  return out;
}

/**
 * The Trend Engine's ATR-trailing-stop flip regime, direction series only (no flips/retests/TP
 * chrome). Identical state machine to trendEngine.ts compute(): seed on the first valid bar, ratchet
 * the stop, flip on a close through it, carry state over invalid bars. 0 = pre-seed.
 */
function teDirs(bars: SuiteBar[], period: number, mult: number): Int8Array {
  const n = bars.length;
  const out = new Int8Array(n);
  const atr = teAtrSeries(bars, period);
  let dir: 1 | -1 | 0 = 0;
  let stop = NaN;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b)) {
      out[i] = dir;
      continue;
    }
    const a = atr[i];
    const hl2 = (b.h + b.l) / 2;
    if (dir === 0) {
      dir = b.c >= hl2 ? 1 : -1;
      stop = hl2 - dir * mult * a;
    } else if (dir === 1) {
      stop = Math.max(stop, hl2 - mult * a);
      if (b.c < stop) {
        dir = -1;
        stop = hl2 + mult * a;
      }
    } else {
      stop = Math.min(stop, hl2 + mult * a);
      if (b.c > stop) {
        dir = 1;
        stop = hl2 - mult * a;
      }
    }
    out[i] = dir;
  }
  return out;
}

// ------------------------------------------------------------------------------------- compute

type Band = -2 | -1 | 0 | 1 | 2; // SS, S, N, B, SB

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], events: [], tables: [] };
  if (n < BB_LEN + 5) return empty;

  const s = ctx.s || {};
  const pos = selOpt(s.pos, "tr" as const, ["tl", "tr", "bl", "br"] as const);
  const compact = boolOpt(s.compact, false);
  const wantVol = boolOpt(s.volatility, true);
  const wantComp = boolOpt(s.compression, true);
  const wantTs = boolOpt(s.trendScore, true);
  const wantPress = boolOpt(s.pressure, true);
  const wantRating = boolOpt(s.rating, true);
  const wantMtf = boolOpt(s.mtf, true);
  const zh = lang === "zh";

  // Producer settings (W2 law): the ENGINE's live sensitivity, prefixed key, engine default 5.
  const sens = Math.round(numOpt(ctx.suite?.["te.sensitivity"], 5, 1, 10));
  const { period, mult } = mapSens(sens);

  // ---- shared sanitized series ---------------------------------------------------------
  const closeA = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) if (validBar(bars[i])) closeA[i] = bars[i].c;

  // ---- Volatility: ATR(14)/close, percentile vs trailing 252 (last bar only) -----------
  const trA = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b)) continue;
    const pc = i > 0 && Number.isFinite(closeA[i - 1]) ? closeA[i - 1] : b.o;
    trA[i] = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  }
  const atrA = wilderRma(trA, ATR_LEN);
  const volRatio = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(atrA[i]) && Number.isFinite(closeA[i]) && closeA[i] > 0)
      volRatio[i] = atrA[i] / closeA[i];
  }
  const volPct = Number.isFinite(volRatio[n - 1])
    ? rollingPercentile(volRatio, n - 1, RANK_WIN, volRatio[n - 1])
    : NaN;

  // ---- Compression: BB(20,2) bandwidth percentile inverted to 0..10 (per bar) ----------
  // bandwidth = (upper − lower) / mid = (2·BB_MULT·σ) / SMA. A window with ANY hole yields NaN
  // (holes are rare; fabricating a partial stdev is worse than an honest dash).
  const bwA = new Float64Array(n).fill(NaN);
  for (let i = BB_LEN - 1; i < n; i++) {
    let sum = 0;
    let ok = true;
    for (let k = i - BB_LEN + 1; k <= i; k++) {
      const c = closeA[k];
      if (!Number.isFinite(c)) {
        ok = false;
        break;
      }
      sum += c;
    }
    if (!ok) continue;
    const mean = sum / BB_LEN;
    let ss = 0;
    for (let k = i - BB_LEN + 1; k <= i; k++) {
      const d = closeA[k] - mean;
      ss += d * d;
    }
    const sd = Math.sqrt(ss / BB_LEN); // population σ, like ta.stdev
    if (mean > 0) bwA[i] = (2 * BB_MULT * sd) / mean;
  }
  // comp10[i] = (100 − percentile) / 10 → 10 = tightest bandwidth in the trailing year.
  const comp10 = new Float64Array(n).fill(NaN);
  for (let i = BB_LEN - 1; i < n; i++) {
    if (!Number.isFinite(bwA[i])) continue;
    comp10[i] = (100 - rollingPercentile(bwA, i, RANK_WIN, bwA[i])) / 10;
  }

  // ---- Trend Score: 5·teRegime + 3·(EMA20 vs 50) + 2·(close vs EMA200), per bar --------
  const dirs = teDirs(bars, period, mult);
  const eF = emaArr(closeA, EMA_FAST);
  const eS = emaArr(closeA, EMA_SLOW);
  const eL = emaArr(closeA, EMA_LONG);
  const tsA = new Int8Array(n); // −10..+10
  for (let i = 0; i < n; i++) {
    const cross =
      Number.isFinite(eF[i]) && Number.isFinite(eS[i]) ? (eF[i] > eS[i] ? 1 : eF[i] < eS[i] ? -1 : 0) : 0;
    const posL =
      Number.isFinite(eL[i]) && Number.isFinite(closeA[i])
        ? closeA[i] > eL[i]
          ? 1
          : closeA[i] < eL[i]
            ? -1
            : 0
        : 0;
    tsA[i] = W_TE * dirs[i] + W_CROSS * cross + W_POS * posL;
  }

  // ---- Pressure: 20-bar Σ volume·bodyPosition, percentile vs 252 → −10..+10 ------------
  // bodyPosition = (close − open) / (high − low) ∈ −1..+1 (0 when the bar has no range).
  // Invalid bars contribute 0 to the window sum (skipped, not fabricated).
  const deltaA = new Float64Array(n); // per-bar contribution
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b)) continue;
    const range = b.h - b.l;
    const v = Number.isFinite(b.v) && b.v > 0 ? b.v : 0;
    if (range > 0 && v > 0) deltaA[i] = (v * (b.c - b.o)) / range;
  }
  const d20 = new Float64Array(n).fill(NaN);
  let dSum = 0;
  for (let i = 0; i < n; i++) {
    dSum += deltaA[i];
    if (i >= PRESS_WIN) dSum -= deltaA[i - PRESS_WIN];
    if (i >= PRESS_WIN - 1) d20[i] = dSum;
  }
  const pressA = new Float64Array(n).fill(NaN);
  for (let i = PRESS_WIN - 1; i < n; i++) {
    if (!Number.isFinite(d20[i])) continue;
    pressA[i] = clamp((rollingPercentile(d20, i, RANK_WIN, d20[i]) - 50) / 5, -10, 10);
  }

  // ---- Rating: documented vote, per bar (drives the event tape) ------------------------
  //   |Trend| < 3                                       → NEUTRAL
  //   |Trend| ≥ 3                                       → BUY / SELL by sign
  //   |Trend| ≥ 7 AND sign(Pressure) agrees AND Compression < 8 (no squeeze) → STRONG
  // A NaN pressure/compression never confirms a STRONG (honest downgrade, not a guess).
  const bandAt = (i: number): Band => {
    const ts = tsA[i];
    if (Math.abs(ts) < TS_MIN) return 0;
    const dir: 1 | -1 = ts > 0 ? 1 : -1;
    const pressOk = Number.isFinite(pressA[i]) && Math.sign(pressA[i]) === dir;
    const noSqueeze = Number.isFinite(comp10[i]) && comp10[i] < SQUEEZE_HI;
    if (Math.abs(ts) >= TS_STRONG && pressOk && noSqueeze) return (2 * dir) as Band;
    return dir as Band;
  };

  const ratingText = (b: Band): string =>
    zh
      ? b === 2
        ? "强烈买入"
        : b === 1
          ? "买入"
          : b === -1
            ? "卖出"
            : b === -2
              ? "强烈卖出"
              : "中性"
      : b === 2
        ? "STRONG BUY"
        : b === 1
          ? "BUY"
          : b === -1
            ? "SELL"
            : b === -2
              ? "STRONG SELL"
              : "NEUTRAL";

  // Event tape: independent of the rating row's visual toggle (voltixBands/fvg precedent), so the
  // alert bridge keeps firing when the row is hidden. Fixed 10-bar cooldown, forward pass.
  const events: SuiteEvent[] = [];
  let prevBand: Band = bandAt(0);
  let lastEvI = -RATING_COOLDOWN;
  for (let i = 1; i < n; i++) {
    const b = bandAt(i);
    if (b !== prevBand && i - lastEvI >= RATING_COOLDOWN) {
      events.push({
        type: "dash_rating_change",
        dir: b > 0 ? "bull" : b < 0 ? "bear" : "neutral",
        i,
        p: Number.isFinite(closeA[i]) ? closeA[i] : undefined,
        strength: clamp(Math.abs(tsA[i]) * 10, 0, 100),
        label: zh ? `评级 → ${ratingText(b)}` : `Rating → ${ratingText(b)}`,
      });
      lastEvI = i;
      prevBand = b;
    } else if (b !== prevBand && i - lastEvI < RATING_COOLDOWN) {
      // inside cooldown: band still advances (state is honest), only the tape is throttled
      prevBand = b;
    }
  }

  // ---- MTF regimes: chart / 2× / 4× resamples of the loaded bars -----------------------
  const mtfDir = (factor: number): 1 | -1 | 0 => {
    const { groups } = resampleOhlcv(bars, factor);
    if (groups.length < period) return 0; // not enough complete groups to seed honestly
    const d = teDirs(groups, period, mult);
    return d[d.length - 1] as 1 | -1 | 0;
  };

  // ------------------------------------------------------------------------------ table
  const last = n - 1;
  const L = {
    title: zh ? "市场仪表盘" : "Market Dashboard",
    vol: zh ? "波动率" : "Volatility",
    comp: zh ? "压缩度" : "Compression",
    trend: zh ? "趋势分" : "Trend",
    press: zh ? "买卖压力" : "Pressure",
    rating: zh ? "综合评级" : "Rating",
    mtf: zh ? "多周期" : "MTF",
    volTip: zh
      ? "ATR(14)÷收盘价，对过去252根K线做百分位。>80% 为高波动。"
      : "ATR(14) ÷ close, percentile-ranked vs the last 252 bars. >80% = elevated volatility.",
    compTip: zh
      ? "布林(20,2)带宽百分位反转为0–10；10=最紧。≥8 提示挤压待爆发。"
      : "Bollinger(20,2) bandwidth percentile inverted to 0–10; 10 = tightest. ≥8 = squeeze watch.",
    trendTip: zh
      ? "−10..+10 = 5×趋势引擎方向(其灵敏度设置) + 3×EMA20/50 + 2×收盘价对EMA200。"
      : "−10..+10 = 5×Trend Engine regime (its live sensitivity) + 3×EMA20/50 + 2×close vs EMA200.",
    pressTip: zh
      ? "20根K线的 成交量×实体位置 之和，对252根做百分位后映射到−10..+10。"
      : "20-bar Σ volume × body-position, percentile vs 252 bars, mapped to −10..+10.",
    ratingTip: zh
      ? "|趋势分|<3 中性；≥3 买入/卖出；≥7 且压力同向且无挤压(<8) 为强烈。"
      : "|Trend|<3 NEUTRAL; ≥3 BUY/SELL; STRONG needs |Trend|≥7 + pressure agreement + no squeeze (<8).",
    foot: zh
      ? "2×/4× 为当前已载入K线的重采样，并非另取更高周期数据。"
      : "2× / 4× = the loaded chart bars resampled — not fetched higher timeframes.",
    chart: zh ? "本图" : "chart",
  };

  const rows: TableSpec["rows"] = [];

  if (wantVol) {
    const has = Number.isFinite(volPct);
    rows.push({
      label: L.vol,
      cells: [
        {
          text: has ? `${Math.round(volPct)}%` : "—",
          color: has && volPct > VOL_WARN ? colors.warn : colors.muted,
          bold: has && volPct > VOL_WARN,
          tip: L.volTip,
        },
      ],
    });
  }

  if (wantComp) {
    const c = comp10[last];
    const has = Number.isFinite(c);
    const squeeze = has && c >= SQUEEZE_HI;
    rows.push({
      label: L.comp,
      cells: [
        {
          text: has ? `${c.toFixed(1)}/10` : "—",
          color: squeeze ? colors.brand : colors.muted,
          bold: squeeze,
          tip: L.compTip,
        },
      ],
    });
  }

  if (wantTs) {
    const ts = tsA[last];
    rows.push({
      label: L.trend,
      cells: [
        {
          text: ts > 0 ? `+${ts}` : `${ts}`,
          color: ts > 0 ? colors.up : ts < 0 ? colors.down : colors.muted,
          bold: Math.abs(ts) >= TS_STRONG,
          tip: L.trendTip,
        },
      ],
    });
  }

  if (wantPress) {
    const p = pressA[last];
    const has = Number.isFinite(p);
    rows.push({
      label: L.press,
      cells: [
        {
          text: has ? (p > 0 ? `+${p.toFixed(1)}` : p.toFixed(1)) : "—",
          // aggressor family — non-flipping by doctrine
          color: !has || p === 0 ? colors.muted : p > 0 ? colors.flowBuy : colors.flowSell,
          tip: L.pressTip,
        },
      ],
    });
  }

  if (wantRating) {
    const band = bandAt(last);
    rows.push({
      label: L.rating,
      cells: [
        {
          text: ratingText(band),
          color: band > 0 ? colors.up : band < 0 ? colors.down : colors.muted,
          bg: band > 0 ? colors.up : band < 0 ? colors.down : undefined,
          bold: Math.abs(band) === 2,
          tip: L.ratingTip,
        },
      ],
    });
  }

  if (wantMtf) {
    const dirCell = (label: string, d: 1 | -1 | 0) => ({
      text: `${label} ${d > 0 ? "▲" : d < 0 ? "▼" : "—"}`,
      color: d > 0 ? colors.up : d < 0 ? colors.down : colors.muted,
      tip: L.foot,
    });
    rows.push({
      label: L.mtf,
      cells: [dirCell(L.chart, mtfDir(1)), dirCell("2×", mtfDir(2)), dirCell("4×", mtfDir(4))],
    });
  }

  const tables: TableSpec[] =
    rows.length > 0
      ? [
          {
            id: "trend-dash",
            pos,
            title: L.title,
            compact,
            // three unlabeled columns: MTF fills all three; single-value rows emit one cell
            // (renderer left-aligns / spans short rows — no fabricated empty cells here).
            columns: [{ key: "a" }, { key: "b" }, { key: "c" }],
            rows,
            footnote: wantMtf ? L.foot : undefined,
          },
        ]
      : [];

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims: [], events: tape, tables };
}

// --------------------------------------------------------------------------------- module def

export const MARKET_DASHBOARD_MODULE: SuiteModuleDef = { ...MARKET_DASHBOARD_META, compute };

export default MARKET_DASHBOARD_MODULE;
