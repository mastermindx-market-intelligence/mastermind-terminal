import { describe, expect, it } from "vitest";
import { evalSuiteEvent, evalSuiteSequence, type SuiteAlertCondition, type SuiteSequenceCondition } from "../suiteAlerts";
import type { SuiteBar, SuiteColors, SuiteEvent, SuiteModuleDef } from "../indicator-canvas/types";
import { RSI_SIGNALS_MODULE } from "../suites/rsix/rsiSignals";
import { RSI_DIVERGENCE_MODULE } from "../suites/rsix/rsiDivergence";
import PULSE_DIVERGENCES_MODULE from "../suites/pulse/divergences";
import { MACD_DIVERGENCE_MODULE } from "../suites/macdx/macdDivergence";

// A source bar is a deterministic completed observation, not a live-candle or P&L fixture.
const DAY = 86400;
const T0 = Date.UTC(2026, 0, 1) / 1000;
const times = (n: number) => Array.from({ length: n }, (_, i) => T0 + i * DAY);
const colors = Object.fromEntries(["up", "down", "flowBuy", "flowSell", "warn", "brand", "text", "muted", "neutral"].map(k => [k, `var(--${k})`])) as unknown as SuiteColors;
const price = (i: number) => 100 - .06 * i + 8 * Math.sin(i / 5) + 2 * Math.sin(i / 1.7);
const BARS: SuiteBar[] = Array.from({ length: 240 }, (_, i) => {
  const c = price(i), o = i ? price(i - 1) : c;
  return { t: T0 + i * DAY, o, h: Math.max(o, c) + .3, l: Math.min(o, c) - .3, c, v: 1000 + (i % 7) * 80 };
});
function compute(mod: SuiteModuleDef, bars: SuiteBar[]) {
  return mod.compute({ bars, tf: "1D", symbol: "CLOCK_FIXTURE", isIntraday: false, s: { ...mod.defaults }, suite: {}, colors, lang: "en" }).events ?? [];
}
const ev = (i: number, confirmedAt: unknown, type = "rsix_div") => ({ type, dir: "bull", i, confirmedAt, p: 30, strength: 40 }) as unknown as SuiteEvent;
const one = (overrides: object = {}) => ({ type: "suite_event", suite: "rsix", event: "rsix_div", ...overrides }) as SuiteAlertCondition;
const sequence = (overrides: object = {}) => ({ type: "suite_sequence", suite: "rsix", steps: [{ event: "rsix_div" }, { event: "rsix_reversal" }], maxBarsBetween: 3, ...overrides }) as SuiteSequenceCondition;

describe("confirmation time is the event's usable time, not its chart anchor", () => {
  it("the real RSI divergence born at prefix 106 is fresh even though its pivot is 100", () => {
    const bars = BARS.slice(0, 106);
    const e = compute(RSI_DIVERGENCE_MODULE, bars).find(x => x.i === 100)!;
    expect(e, "fixture must produce the actual delayed divergence").toBeDefined();
    expect(evalSuiteEvent(one(), [e], bars.map(b => b.t), 0).fired).toBe(true);
  });

  it.each([
    ["RSI reversal", RSI_SIGNALS_MODULE, "rsix", "rsix_reversal"],
    ["RSI divergence", RSI_DIVERGENCE_MODULE, "rsix", "rsix_div"],
    ["Pulse divergence", PULSE_DIVERGENCES_MODULE, "pulse", "pulse_div"],
    ["MACD divergence", MACD_DIVERGENCE_MODULE, "macdx", "macdx_div"],
  ] as const)("%s records first availability on every prefix without moving its anchor", (_, mod, suite, type) => {
    const seen = new Set<string>();
    for (let n = 1; n <= BARS.length; n++) {
      const bars = BARS.slice(0, n);
      for (const e of compute(mod, bars).filter(x => x.type === type)) {
        const key = `${e.type}|${e.dir}|${e.i}|${e.label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        expect((e as SuiteEvent & { confirmedAt?: number }).confirmedAt, key).toBe(n - 1);
        expect(e.i, "anchor precedes the confirming bar").toBeLessThan(n - 1);
        expect(evalSuiteEvent(one({ suite, event: type }), [e], bars.map(b => b.t), 0).fired, key).toBe(true);
      }
    }
    expect(seen.size, "no vacuous prefix proof").toBeGreaterThan(0);
  });

  it("allows a newly confirmed event whose anchor preceded alert creation", () => {
    const t = times(10);
    expect(evalSuiteEvent(one(), [ev(4, 9)], t, t[7]).fired).toBe(true);
  });

  it("does not deliver an event confirmed before alert creation", () => {
    const t = times(10);
    expect(evalSuiteEvent(one(), [ev(4, 8)], t, t[8]).fired).toBe(false);
  });

  it.each([null, NaN, Infinity, -1, 6.5, 7, 10])("refuses malformed, pre-anchor or future confirmation %s", confirmation => {
    expect(evalSuiteEvent(one(), [ev(8, confirmation)], times(10), 0).fired).toBe(false);
  });

  it("preserves the implicit same-bar clock for an existing event without new metadata", () => {
    const event: SuiteEvent = { type: "rsix_div", dir: "bull", i: 9 };
    expect(evalSuiteEvent(one(), [event], times(10), 0).fired).toBe(true);
  });

  it("uses confirmation for freshness without extending the three-bar window", () => {
    expect(evalSuiteEvent(one(), [ev(1, 6)], times(10), 0).fired).toBe(false);
    expect(evalSuiteEvent(one(), [ev(1, 7)], times(10), 0).fired).toBe(true);
  });

  it("does not redeliver a legacy-fired pivot after its event clock is repaired", () => {
    const t = times(10);
    expect(evalSuiteEvent(one({ _se: { lastFiredT: t[4] } }), [ev(4, 9)], t, 0).fired).toBe(false);
  });

  it("migrates a successful fire to the confirmed clock and deduplicates its round trip", () => {
    const t = times(10), event = ev(4, 9);
    const first = evalSuiteEvent(one(), [event], t, 0);
    expect(first.state).toEqual({ lastFiredT: t[9], clockVersion: 2 });
    expect(evalSuiteEvent(one({ _se: first.state }), [event], t, 0).fired).toBe(false);
  });

  it("a v2 watermark does not discard a different event with an earlier anchor and later confirmation", () => {
    const t = times(10);
    expect(evalSuiteEvent(one({ _se: { lastFiredT: t[7], clockVersion: 2 } }), [ev(5, 9)], t, 0).fired).toBe(true);
  });

  it("refuses an unknown persisted clock version instead of guessing", () => {
    expect(evalSuiteEvent(one({ _se: { lastFiredT: T0, clockVersion: 3 } }), [ev(8, 9)], times(10), 0).fired).toBe(false);
  });
});

describe("sequences follow knowledge order rather than a retrospectively drawn pattern", () => {
  it("does not form A then B when B was known before A", () => {
    const result = evalSuiteSequence(sequence(), [ev(1, 6), ev(4, 5, "rsix_reversal")], times(7), 0);
    expect(result.fired).toBe(false);
  });

  it("does form A then B when the confirming bars are correctly ordered and fresh", () => {
    const t = times(10);
    const result = evalSuiteSequence(sequence(), [ev(1, 8), ev(6, 9, "rsix_reversal")], t, 0);
    expect(result.fired).toBe(true);
    expect(result.state).toEqual({ stepIdx: 0, lastFiredT: t[9], clockVersion: 2 });
  });

  it("measures expiry from confirmation rather than the old anchor", () => {
    const t = times(11);
    const result = evalSuiteSequence(sequence(), [ev(1, 9)], t, 0);
    expect(result.state).toEqual({ stepIdx: 1, armedT: t[9] });
  });

  it("keeps legacy fire watermark meaning when persisting a newly armed state", () => {
    const t = times(11);
    const result = evalSuiteSequence(sequence({ _sq: { stepIdx: 0, lastFiredT: t[2] } }), [ev(4, 9)], t, 0);
    expect(result.state).toEqual({ stepIdx: 1, armedT: t[9], lastFiredT: t[2] });
  });

  it("does not revive a legacy-fired completion after confirmation metadata is added", () => {
    const t = times(11);
    const events = [ev(1, 7), ev(4, 9, "rsix_reversal")];
    expect(evalSuiteSequence(sequence({ _sq: { stepIdx: 0, lastFiredT: t[4] } }), events, t, 0).fired).toBe(false);
  });
});
