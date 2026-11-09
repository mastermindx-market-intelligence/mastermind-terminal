import { describe, expect, it } from "vitest";
import * as alertCatalog from "../suiteAlerts";
import { SMART_SR_MODULE } from "../suites/structure/smartSR";
import { suiteDefaults } from "../suites/registry";
import type { ModuleCtx, ModuleResult, SuiteBar, SuiteColors } from "../indicator-canvas/types";
import {
  evalSuiteEvent, evalSuiteSequence, suiteAlertEventDef, suiteAlertPreview,
  validateSuiteCondition, validateSuiteSequence,
} from "../suiteAlerts";

const colors: SuiteColors = {
  up: "up", down: "down", flowBuy: "flow-buy", flowSell: "flow-sell",
  warn: "warn", brand: "brand", text: "text", muted: "muted", neutral: "neutral",
};
function fixture(leg = 5): SuiteBar[] {
  const turns = [110, 100, 110, 100, 110, 100, 110];
  const closes = [turns[0]];
  for (let j = 1; j < turns.length; j++) {
    for (let k = 1; k <= leg; k++) closes.push(turns[j - 1] + (turns[j] - turns[j - 1]) * k / leg);
  }
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c + 10 / leg;
    return { t: 86400 * (i + 1), o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1000 };
  });
}
function append(bars: SuiteBar[], closes: number[]): SuiteBar[] {
  const out = bars.slice();
  for (const c of closes) {
    const o = out[out.length - 1].c;
    out.push({ t: 86400 * (out.length + 1), o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1000 });
  }
  return out;
}
function context(bars: SuiteBar[], s: Record<string, unknown> = {}, lang: "en" | "zh" = "en"): ModuleCtx {
  return { bars, tf: "1D", symbol: "TEST", isIntraday: false,
    s: { ...SMART_SR_MODULE.defaults, sensitivity: "high", showLast: 12, ...s },
    suite: suiteDefaults("structure"), colors, lang };
}
const compute = (bars: SuiteBar[], s: Record<string, unknown> = {}, lang: "en" | "zh" = "en") => SMART_SR_MODULE.compute(context(bars, s, lang));
const panel = (r: ModuleResult) => r.tables?.find(t => t.id === "sr-context");
const row = (r: ModuleResult, label: string) => panel(r)?.rows.find(x => x.label === label)?.cells.map(c => c.text);

describe("Smart S/R context — real producer, no second level algorithm", () => {
  it("shows the nearest displayed intact levels with exact price, touches and signed distance", () => {
    const r = compute(append(fixture(), [106]));
    expect(panel(r)?.title).toBe("Support context");
    expect(row(r, "Support")).toEqual(["100.00 · ×3", "−5.66%"]);
    expect(row(r, "Resistance")).toEqual(["110.00 · ×2", "+3.77%"]);
    expect(panel(r)?.footnote).toContain("Latest bar may be open");
  });
  it("does not rename an exact touch as resistance or a broken support as intact resistance", () => {
    expect(row(compute(fixture()), "At price")).toEqual(["110.00 · ×2", "0.00%"]);
    const broken = compute(append(fixture(), [108,106,104,102,100,98]));
    expect(row(broken, "Support")).toEqual(["—", "—"]);
    // The third high at bar 30 has now confirmed at bar 35.
    expect(row(broken, "Resistance")?.[0]).toBe("110.00 · ×3");
  });
  it("does not substitute an old quote when the latest bar is invalid", () => {
    const bars = append(fixture(), [106]);
    bars[bars.length - 1] = { ...bars[bars.length - 1], c: NaN };
    const r = compute(bars);
    expect(panel(r)?.footnote).toContain("Latest bar unavailable");
    expect(row(r, "Support")).toEqual(["—", "—"]);
  });
  it("distinguishes warmup from a valid chart with no confirmed levels", () => {
    expect(panel(compute(fixture().slice(0, 3)))?.footnote).toContain("More bars needed");
    const flat = fixture().map(b => ({ ...b, o: 100, h: 101, l: 99, c: 100 }));
    expect(panel(compute(flat))?.footnote).toContain("No confirmed levels");
  });
  it("follows real display filtering and keeps presentation controls out of event mathematics", () => {
    const bars = append(fixture(), [106]);
    const normal = compute(bars);
    const strict = compute(bars, { minTouches: 3 });
    expect(row(strict, "Resistance")).toEqual(["—", "—"]);
    const off = compute(bars, { contextPanel: false, eventMarks: false });
    expect(off.tables ?? []).toEqual([]);
    expect(off.events).toEqual(normal.events);
    expect(off.prims.filter(p => p.kind === "line")).toEqual(normal.prims.filter(p => p.kind === "line"));
  });
  it("projects bilingual evidence and respects the requested existing corner", () => {
    const r = compute(append(fixture(), [106]), { contextPos: "br" }, "zh");
    expect(panel(r)?.pos).toBe("br");
    expect(panel(r)?.title).toBe("支撑解读");
    expect(row(r, "支撑")?.[0]).toBe("100.00 · ×3");
    expect(panel(r)?.footnote).toContain("最新一根可能未收盘");
    expect(panel(r)?.footnote).not.toMatch(/Latest|trade signal|Chart bars/);
  });
  it("draws capped descriptive events exactly where the source emitted them, never a buy claim", () => {
    const r = compute(append(fixture(), [108,106,104,102,100,98]));
    const marker = r.prims.find(p => p.kind === "marker" && p.id === "sr-event-36-sr_break-100");
    expect(marker).toMatchObject({ kind: "marker", i: 36, shape: "diamond", fill: colors.down });
    const tip = r.tooltips?.find(t => t.id === (marker?.kind === "marker" ? marker.tooltipId : undefined));
    expect(tip?.title).toBe("Support broken");
    expect(JSON.stringify(tip)).not.toMatch(/BUY|SELL|confidence|win rate/i);
    expect(r.prims.filter(p => p.kind === "marker").length).toBeLessThanOrEqual(8);
  });
  it("recomputes same-length OHLC corrections and never mutates source bars", () => {
    const bars = append(fixture(), [108,106,104,102,100,98]);
    const saved = JSON.stringify(bars);
    expect(compute(bars).events?.some(e => e.type === "sr_break" && e.i === 36)).toBe(true);
    const corrected = bars.map(b => ({ ...b }));
    corrected[36] = { ...corrected[36], c: 101, h: 101 };
    const r = compute(corrected);
    expect(r.events?.some(e => e.type === "sr_break" && e.i === 36)).toBe(false);
    expect(row(r, "Support")?.[0]).toBe("100.00 · ×3");
    expect(JSON.stringify(bars)).toBe(saved);
  });
});

describe("Smart S/R → existing Alert Center and two-step sequence", () => {
  it.each(["sr_hold", "sr_break"])("registers %s under the real module and entitlement", event => {
    expect(suiteAlertEventDef(event)).toMatchObject({ suite: "structure", module: "sr", tier: "essential", dirs: true, strength: true });
    expect(validateSuiteCondition({ type: "suite_event", suite: "structure", event })).toBeNull();
    expect(suiteAlertPreview({ type: "suite_event", suite: "structure", event }, "en")).toContain("module defaults");
    expect(suiteAlertPreview({ type: "suite_event", suite: "structure", event }, "zh")).not.toContain("Unknown");
  });
  it("fires a fresh default-parameter producer break once, preserving its adverse direction", () => {
    const bars = append(fixture(10), [108,106,104,102,100,98]);
    const ctx = context(bars, { ...SMART_SR_MODULE.defaults });
    const events = SMART_SR_MODULE.compute(ctx).events ?? [];
    const event = events.find(e => e.type === "sr_break" && e.p === 100);
    expect(event).toMatchObject({ i: 66, dir: "bear", p: 100 });
    const cond = { type: "suite_event" as const, suite: "structure", event: "sr_break", dir: "bear" as const };
    expect(evalSuiteEvent(cond, events, bars.map(b => b.t), 0).fired).toBe(true);
    expect(evalSuiteEvent({ ...cond, dir: "bull" }, events, bars.map(b => b.t), 0).fired).toBe(false);
    expect(evalSuiteEvent({ ...cond, _se: { lastFiredT: bars[66].t, clockVersion: 2 } }, events, bars.map(b => b.t), 0).fired).toBe(false);
    expect(evalSuiteEvent(cond, events, append(bars, [97,96,95,94]).map(b => b.t), 0).fired).toBe(false);
  });
  it("allows support-hold then bullish BOS with the existing strict-later confirmation clock", () => {
    const cond = { type: "suite_sequence" as const, suite: "structure", steps: [{ event: "sr_hold", dir: "bull" as const }, { event: "bos", dir: "bull" as const }], maxBarsBetween: 5 };
    expect(validateSuiteSequence(cond)).toBeNull();
    const barsT = fixture().map(b => b.t);
    const events = [{ type: "sr_hold", dir: "bull" as const, i: 25, p: 100 }, { type: "bos", dir: "bull" as const, i: 28, p: 110 }];
    expect(evalSuiteSequence(cond, events, barsT, 0).fired).toBe(true);
    expect(evalSuiteSequence(cond, [events[0], { ...events[1], i: 25 }], barsT, 0).fired).toBe(false);
    expect(validateSuiteSequence({ ...cond, steps: [cond.steps[0], { event: "pulse_buy" }] })).toContain("must share one suite");
  });
});

it("provides one bilingual event-name source for picker and preview", () => {
  const name = (alertCatalog as unknown as { suiteEventName?: (event: string, lang: "en" | "zh") => string }).suiteEventName;
  expect(name).toBeTypeOf("function");
  expect(name?.("sr_hold", "en")).toBe("Support / resistance hold");
  expect(name?.("sr_break", "zh")).toBe("支撑 / 阻力突破");
  expect(name?.("bos", "en")).toBe("Break of structure (BOS)");
});

it("describes a support failure accurately in Chinese", () => {
  const r = compute(append(fixture(), [108,106,104,102,100,98]), {}, "zh");
  expect(r.tooltips?.find(t => t.id === "sr-event-36-sr_break-100")?.title).toBe("支撑失守");
});
