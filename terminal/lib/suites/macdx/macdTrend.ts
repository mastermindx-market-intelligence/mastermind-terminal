// MACD Phase Trend — MACD-Ultimate pane suite (hysteresis regime lanes).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"MACD Trend — visual spec".
//
// Two marker lanes frame the pane, outside the ±100 rails: an UP phase populates the bottom lane
// (y = −112), a DOWN phase the top lane (y = +112). Exactly one lane is ever populated, so the
// alternating runs read as a binary regime ribbon rather than a stream of events.
//
// PHASE LOCK (the whole point of the module). A phase is committed only on a two-part condition —
// macd on the right side of its signal AND macd moving that way for 3 consecutive bars — and once
// committed it can ONLY be ended by the mirrored condition. Neither a signal-line touch nor a
// single counter-trend bar flips it. That hysteresis is what stops the lane from strobing every
// other bar in chop, and it is why this module is the honest input for the "Trend" row of a future
// MTF dashboard: level, direction and persistence all ride together (regime-dynamics law).
//
// Non-repaint: the commit test reads bars i−3..i only and the lane is painted forward from the
// commit bar; no future bar can un-commit a phase or move its start. Values are in the suite's
// pane y-space. Pure and deterministic.

import type {
  MarkerPrim,
  ModuleCtx,
  ModuleResult,
  Prim,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  TooltipDef,
} from "@/lib/indicator-canvas/types";
import { sharedMacd, tape } from "./macdEngine";
import { MACD_TREND_META } from "./macdTrend.meta";

// ------------------------------------------------------------------------------------ constants

const LANE_UP = -112; // bottom lane (bull phase) — outside the ±100 OB/OS rails
const LANE_DOWN = 112; // top lane (bear phase)
const SQUARE_SIZE = 3;
const SQUARE_ALPHA = 0.55; // the ribbon is background state, not an event
const STRIDE = 2; // one square every other bar keeps the dotted texture
const WINDOW = 300; // squares are drawn for the last N bars only
const STREAK = 3; // consecutive bars of momentum required to commit a phase

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars?.length ?? 0;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 5) return empty;

  const zh = lang === "zh";
  const { macd, signal } = sharedMacd(bars, ctx.suite);

  // ---- phase state machine --------------------------------------------------------------
  const phase = new Int8Array(n); // +1 up, -1 down, 0 = not committed yet
  const commits: Array<{ i: number; bull: boolean; macd: number }> = [];
  const events: SuiteEvent[] = [];

  let cur = 0;
  let prevV = NaN;
  let up = 0; // consecutive rising bars
  let dn = 0; // consecutive falling bars

  for (let i = 0; i < n; i++) {
    const v = macd[i];
    const g = signal[i];
    if (!Number.isFinite(v) || !Number.isFinite(g)) {
      phase[i] = cur; // a missing print never breaks a phase
      continue;
    }
    if (Number.isFinite(prevV)) {
      if (v > prevV) {
        up++;
        dn = 0;
      } else if (v < prevV) {
        dn++;
        up = 0;
      } else {
        up = 0;
        dn = 0;
      }
    }
    prevV = v;

    const bullCond = v > g && up >= STREAK;
    const bearCond = v < g && dn >= STREAK;
    if (bullCond && cur !== 1) {
      cur = 1;
      commits.push({ i, bull: true, macd: v });
      events.push({
        type: "macdx_phase",
        dir: "bull",
        i,
        p: v,
        strength: Math.round(Math.min(100, Math.abs(v - g))),
        label: zh
          ? `MACD 进入多头阶段 · MACD ${v.toFixed(1)}`
          : `MACD locked into an up phase · MACD ${v.toFixed(1)}`,
      });
    } else if (bearCond && cur !== -1) {
      cur = -1;
      commits.push({ i, bull: false, macd: v });
      events.push({
        type: "macdx_phase",
        dir: "bear",
        i,
        p: v,
        strength: Math.round(Math.min(100, Math.abs(v - g))),
        label: zh
          ? `MACD 进入空头阶段 · MACD ${v.toFixed(1)}`
          : `MACD locked into a down phase · MACD ${v.toFixed(1)}`,
      });
    }
    phase[i] = cur;
  }

  if (!commits.length) return empty;

  // ---- lanes ------------------------------------------------------------------------------
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];
  const L = {
    title: zh ? "MACD 阶段" : "MACD phase",
    state: zh ? "状态" : "Phase",
    bull: zh ? "多头阶段" : "Up phase",
    bear: zh ? "空头阶段" : "Down phase",
    since: zh ? "已持续" : "Held",
    bars: zh ? "根" : "bars",
    rule: zh ? "翻转条件" : "Flips on",
    ruleV: zh ? "反向 3 根 + 穿越信号线" : "3 bars + signal cross",
  };

  const from = Math.max(0, n - WINDOW);
  let runSign = 0;
  let runStart = from;
  for (let i = from; i < n; i++) {
    const ph = phase[i];
    if (ph === 0) {
      runSign = 0;
      continue;
    }
    if (ph !== runSign) {
      runSign = ph;
      runStart = i;
    }
    if (i % STRIDE !== 0) continue;
    const bull = ph > 0;
    const first = i - runStart < STRIDE; // first square drawn for this run
    const tipId = first ? `mx-tr-${i}` : undefined;
    prims.push({
      kind: "marker",
      id: `mx-tr-sq-${i}`,
      z: 1,
      i,
      p: bull ? LANE_UP : LANE_DOWN,
      shape: "square",
      size: SQUARE_SIZE,
      fill: bull ? colors.up : colors.down,
      alpha: SQUARE_ALPHA,
      tooltipId: tipId,
    } as MarkerPrim);
    if (!tipId) continue;
    tooltips.push({
      id: tipId,
      title: L.title,
      accent: bull ? colors.up : colors.down,
      rows: [
        { k: L.state, v: bull ? L.bull : L.bear, color: bull ? colors.up : colors.down },
        { k: L.since, v: `${i - runStart + 1} ${L.bars}` },
        { k: L.rule, v: L.ruleV },
      ],
    });
  }

  if (!prims.length) return empty;
  return { prims, tooltips, events: tape(events) };
}

// ----------------------------------------------------------------------------------- module def

export const MACD_TREND_MODULE: SuiteModuleDef = { ...MACD_TREND_META, compute };

export default MACD_TREND_MODULE;
