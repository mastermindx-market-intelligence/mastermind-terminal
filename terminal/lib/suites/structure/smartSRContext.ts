// Presentation of the owning Smart S/R calculation, not a second level/signal engine.
// Only the levels actually selected for display enter this projection. No forecast,
// confidence, trade recommendation, or cross-timeframe inference is produced here.
import type { ModuleCtx, Prim, SuiteBar, SuiteEvent, TableSpec, TooltipDef } from "@/lib/indicator-canvas/types";

export interface DisplayedSrLevel {
  level: number;
  touches: number;
  brokenAt: number;
}
const corners = ["tl", "tr", "bl", "br"] as const;
const price = (p: number): string => p.toFixed(p >= 1 ? 2 : p >= 0.01 ? 4 : 6);
function validPriceBar(b: SuiteBar | undefined): b is SuiteBar {
  return !!b && [b.o, b.h, b.l, b.c].every(x => Number.isFinite(x) && x > 0)
    && b.l <= Math.min(b.o, b.c) && b.h >= Math.max(b.o, b.c);
}

/** Latest loaded bar only: never silently borrow an older price for a current readout. */
export function smartSrContextTables(ctx: ModuleCtx, displayed: readonly DisplayedSrLevel[], warmup = false): TableSpec[] {
  if (ctx.s.contextPanel === false) return [];
  const zh = ctx.lang === "zh";
  const latest = ctx.bars[ctx.bars.length - 1];
  const usable = validPriceBar(latest);
  const px = usable ? latest.c : NaN;
  const levels = usable ? displayed.filter(l => l.brokenAt < 0 && Number.isFinite(l.level) && l.level > 0) : [];
  let support: DisplayedSrLevel | undefined;
  let resistance: DisplayedSrLevel | undefined;
  let at: DisplayedSrLevel | undefined;
  for (const level of levels) {
    if (level.level < px && (!support || level.level > support.level)) support = level;
    else if (level.level > px && (!resistance || level.level < resistance.level)) resistance = level;
    else if (level.level === px) at = level;
  }
  const cells = (l: DisplayedSrLevel | undefined) => {
    if (!l) return [{ text: "—" }, { text: "—" }];
    const distance = (l.level - px) / px * 100;
    return [{ text: price(l.level) + " · ×" + l.touches,
      tip: zh ? "价位 " + price(l.level) + "；触及 " + l.touches + " 次" : "Level " + price(l.level) + "; " + l.touches + " clustered pivot touches" },
      { text: (distance < 0 ? "−" : distance > 0 ? "+" : "") + Math.abs(distance).toFixed(2) + "%" }];
  };
  const note = !usable && ctx.bars.length > 0
    ? (zh ? "最新K线不可用" : "Latest bar unavailable")
    : warmup ? (zh ? "需要更多K线" : "More bars needed")
    : !levels.length ? (zh ? "无已确认价位" : "No confirmed levels") : "";
  const caveat = zh ? "图表K线；最新一根可能未收盘。非交易信号。" : "Chart bars; Latest bar may be open. Not a trade signal.";
  const pos = corners.includes(ctx.s.contextPos) ? ctx.s.contextPos as TableSpec["pos"] : "bl";
  return [{
    id: "sr-context", pos, title: zh ? "支撑解读" : "Support context", compact: true,
    columns: [{ key: "level", label: zh ? "价位" : "Level", num: true },
      { key: "distance", label: zh ? "距离" : "Distance", num: true }],
    rows: [{ label: zh ? "支撑" : "Support", cells: cells(support) },
      ...(at ? [{ label: zh ? "现价处" : "At price", cells: cells(at) }] : []),
      { label: zh ? "阻力" : "Resistance", cells: cells(resistance) }],
    footnote: note ? note + " · " + caveat : caveat,
  }];
}

/** Mirrors source events only. A diamond means a level broke, NOT buy/sell advice. */
export function smartSrEventMarks(ctx: ModuleCtx, events: readonly SuiteEvent[], atr: readonly number[]): { prims: Prim[]; tooltips: TooltipDef[] } {
  const prims: Prim[] = [], tooltips: TooltipDef[] = [];
  if (ctx.s.eventMarks === false) return { prims, tooltips };
  const zh = ctx.lang === "zh";
  for (const e of events.slice(-8)) {
    const i = e.confirmedAt ?? e.i;
    const b = ctx.bars[i];
    if (!validPriceBar(b) || !Number.isFinite(e.p)) continue;
    const broke = e.type === "sr_break";
    const bullish = e.dir === "bull";
    const support = broke ? !bullish : bullish;
    const title = zh ? (broke ? (support ? "支撑失守" : "阻力突破") : (support ? "支撑" : "阻力") + "守住")
      : (support ? "Support" : "Resistance") + " " + (broke ? "broken" : "held");
    const id = "sr-event-" + i + "-" + e.type + "-" + e.p;
    const offset = Number.isFinite(atr[i]) && atr[i] > 0 ? atr[i] * 0.4 : b.c * 0.002;
    const color = bullish ? ctx.colors.up : ctx.colors.down;
    prims.push({ kind: "marker", id, z: 3, i,
      p: bullish ? Math.max(b.l - offset, b.l * 0.5) : b.h + offset,
      shape: broke ? "diamond" : "circle", size: broke ? 5 : 3,
      fill: color, tooltipId: id, minPxPerBar: 2.5 });
    tooltips.push({ id, title, accent: color, rows: [
      { k: zh ? "价位" : "Level", v: price(e.p!) },
      { k: zh ? "依据" : "Evidence", v: e.label ?? title },
      { k: zh ? "范围" : "Basis", v: zh ? "图表K线；最新一根可能未收盘。" : "Chart bars; latest may be open." },
    ] });
  }
  return { prims, tooltips };
}
