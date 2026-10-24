import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import SignalButton from "../../components/SignalButton";
import OracleDash from "../../components/fin/OracleDash";
import { oracleVerdict, oraclePresentation, deskVerdict, ORACLE_STALE_DAYS } from "../signalVerdict";

const NOW = Date.parse("2026-10-23T23:00:00Z");
const signal = { ts: "2026-10-16", known_ts: "2026-10-19", type: "BUY", quality: "take", price: 98.5 };
const fixture = (event = signal) => ({ indicator: { signals: [event] } });
const source = vi.hoisted(() => ({ slice: {} as unknown, status: "ready" }));
vi.mock("../useWorkspaceSource", () => ({
  useWorkspaceSource: (_sym: string, kind: string) => ({
    status: kind === "slice" ? source.status : "ready", refresh: "settled", data: kind === "slice" ? source.slice : null, retry: () => {},
  }),
}));
// Layout measures the browser and portals after mount; this test exercises the real
// OracleDash content, leaving responsive geometry/browser acceptance to its existing gate.
vi.mock("../../components/fin/IntelligenceWorkspaceShell", () => ({
  IntelligenceWorkspaceShell: ({ children }: { children: ReactNode }) => children,
}));
afterEach(() => { vi.useRealTimers(); source.status = "ready"; });

describe("Oracle historical signal and current entry truth", () => {
  it("preserves the source event and known clock as recency crosses the 21-day boundary", () => {
    const slice = fixture(Object.freeze({ ...signal }));
    Object.freeze(slice.indicator.signals); Object.freeze(slice.indicator); Object.freeze(slice);
    const before = JSON.stringify(slice);
    const fresh = oracleVerdict("BUY", slice, false, NOW);
    const old = oracleVerdict("BUY", slice, false, NOW + 30 * 86400000);
    expect(ORACLE_STALE_DAYS).toBe(21);
    expect(fresh.dim).toBe(false); expect(old.dim).toBe(true);
    expect(fresh.historicalSignal).toEqual(old.historicalSignal);
    expect(fresh.historicalSignal).toMatchObject({ type: "BUY", chartTs: "2026-10-16", knownTs: "2026-10-19", label: "Confirmed Buy", date: "Oct 19, 2026", confirmed: true });
    expect(fresh.entryAvailability).toEqual(old.entryAvailability);
    expect(fresh.entryAvailability?.status).toBe("UNAVAILABLE_DATA");
    expect(JSON.stringify(slice)).toBe(before);
  });

  it.each([undefined, "not-a-date"])("does not substitute bar-open time for missing or invalid known_ts %s", known_ts => {
    const read = oracleVerdict("BUY", fixture({ ...signal, known_ts: known_ts as string }), false, NOW);
    expect(read.historicalSignal).toMatchObject({ chartTs: signal.ts, knownTs: null, date: "Signal date unverified", confirmed: false });
    expect(oraclePresentation(read).sub).toBe("Signal date unverified");
    expect(oraclePresentation(read).label).not.toContain("Confirmed");
  });

  it("never promotes a future known time to confirmed", () => {
    expect(oracleVerdict("BUY", fixture({ ...signal, known_ts: "2026-10-26" }), false, NOW).historicalSignal?.confirmed).toBe(false);
  });

  it.each(["pending", "block"])("keeps keeper %s events as starters", quality => {
    const read = oracleVerdict("BUY", fixture({ ...signal, quality }), false, NOW);
    expect(oraclePresentation(read).label).toBe("Starter");
    expect(read.historicalSignal?.confirmed).toBe(false);
  });

  it("does not create confirmed history from a refused-only event or manifest fallback", () => {
    const read = oracleVerdict("BUY", fixture({ ...signal, quality: "regime_blocked" }), false, NOW);
    expect(read.historicalSignal).toBeNull();
    expect(read.entryAvailability?.status).toBe("UNAVAILABLE_DATA");
    expect(oracleVerdict("BUY", null, false, NOW).historicalSignal).toBeNull();
  });

  it.each(["RECLAIM", "BOTTOM_WATCH"])("keeps %s separate from confirmed buys", type => {
    const read = oracleVerdict("BUY", fixture({ ...signal, type }), false, NOW);
    expect(read.soft).toBe(true);
    expect(read.historicalSignal?.confirmed).toBe(false);
    expect(oraclePresentation(read).label).not.toContain("Confirmed");
  });

  it("keeps old history visible beside a current regime without granting entry", () => {
    const read = oracleVerdict("BUY", { indicator: { signals: [signal], state: { position_hint: "long", above200: true } } }, false, NOW + 30 * 86400000);
    expect(read.stance).toBe(true);
    expect(oraclePresentation(read).heading).toBe("Current regime");
    expect(read.historicalSignal?.label).toBe("Confirmed Buy");
    expect(read.entryAvailability?.status).toBe("UNAVAILABLE_DATA");
  });

  it.each([100.91, 110, 90, null])("does not infer entry permission from current price %s or an unqualified owner blob", price => {
    const slice = { ...fixture(), quote: { price, stale: price === null, corporate_action_ambiguous: true }, entry_availability: { status: "ENTRY_OPEN", strategy: "B4" } };
    const read = oracleVerdict("BUY", slice, false, NOW);
    expect(read.entryAvailability).toMatchObject({ status: "UNAVAILABLE_DATA", reason: "No qualified current Oracle entry source" });
  });

  it("shows entry unavailable when the workspace signal source itself is unavailable", () => {
    source.status = "unavailable"; source.slice = null;
    const html = renderToStaticMarkup(createElement(OracleDash, { sym: "USFD" }));
    expect(html).toContain("Entry availability not verified");
    expect(html).toContain("No qualified current Oracle entry source");
  });

  it("never uses a refused event's bar-open date as its knowledge date", () => {
    const read = oracleVerdict("BUY", fixture({ ...signal, known_ts: undefined as unknown as string, quality: "regime_blocked" }), false, NOW);
    expect(read.raw).toBe("BLOCKED_ENTRY");
    expect(read.refusedSignalKnownTs).toBeNull();
    expect(oraclePresentation(read).sub).toBe("Signal date unverified");
    const withAnchor = oracleVerdict("BUY", { indicator: { signals: [signal, { ...signal, ts: "2026-10-22", known_ts: undefined, quality: "regime_blocked" }] } }, false, NOW);
    expect(oraclePresentation(withAnchor).sub).toBe("Oct 19, 2026 · entry blocked Signal date unverified");
  });

  it("preserves a newer refusal beside the historical confirmation", () => {
    const read = oracleVerdict("BUY", { indicator: { signals: [signal, { ...signal, ts: "2026-10-22", known_ts: "2026-10-22", quality: "regime_blocked" }] } }, false, NOW);
    expect(read.blocked).toBe(true);
    expect(oraclePresentation(read).label).toBe("Confirmed Buy");
    expect(oraclePresentation(read).sub).toContain("entry blocked");
    expect(read.entryAvailability?.status).toBe("UNAVAILABLE_DATA");
  });

  it("keeps the three producer reads before the full-width mobile availability row", () => {
    const oracle = oracleVerdict("BUY", fixture(), false, NOW);
    const html = renderToStaticMarkup(createElement(SignalButton, {
      oracle, desk: deskVerdict(null), oracleLabel: "Oracle", deskLabel: "Research", viewLabel: "View", onView: () => {},
      prophet: { symbol: "USFD", account: "reader", status: "unavailable", data: null },
    }));
    expect(html.indexOf('data-testid="prophet-observation-launcher"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="oracle-entry-availability"')).toBeGreaterThan(html.indexOf('data-testid="prophet-observation-launcher"'));
    expect(html).toContain("Source unavailable");
    expect(html).toContain("Entry availability not verified");
  });

  it.each([false, true])("renders both real consumers with separate history and unavailable reason (zh=%s)", zh => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    source.slice = fixture();
    const oracle = oracleVerdict("BUY", fixture(), zh, NOW);
    const desk = deskVerdict(null, zh);
    const launcher = renderToStaticMarkup(createElement(SignalButton, { oracle, desk, oracleLabel: "Oracle", deskLabel: "Research", viewLabel: "View", onView: () => {}, zh }));
    const workspace = renderToStaticMarkup(createElement(OracleDash, { sym: "USFD", row: { verdict: "BUY" }, zh }));
    for (const html of [launcher, workspace]) {
      expect(html).toContain(zh ? "已确认买入" : "Confirmed Buy");
      expect(html).toContain(zh ? "入场机会尚未核实" : "Entry availability not verified");
      if (html === launcher) expect(html).toContain(zh ? "神谕入场尚未核实 · 缺少当前数据" : "Oracle entry unverified · No current data");
      expect(html).toContain(zh ? "缺少适用于神谕的当前入场数据源" : "No qualified current Oracle entry source");
      expect(html).toContain('data-status="UNAVAILABLE_DATA"');
      expect(html).not.toContain('data-status="ENTRY_OPEN"');
    }
    expect(workspace).toContain(zh ? "历史信号" : "Historical signal");
    if (zh) expect(workspace).not.toContain("Entry availability not verified");
    else expect(workspace).not.toContain("入场机会尚未核实");
  });
});
