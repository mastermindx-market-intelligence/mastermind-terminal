import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
vi.mock("server-only", () => ({}));
import { joinFuturesSource } from "../futuresSourceJoin";
import { parseFuturesPublishedView } from "../futuresTransport";
import { DEFAULT_FUTURES_REQUEST as request } from "../futuresRequest";
const load = createRequire(import.meta.url);
const { fixture } = load("../../../hub/tests/fixtures/futuresCapture.js");
const { buildFuturesWorkspacePublication } = load("../../../hub/lib/futuresWorkspaceProjection.js");
function publication() {
  const { capture, selection } = fixture(); capture.trades = []; capture.tradeCoverage = "complete";
  capture.distribution = { audience: "subscriber_display", evidenceRef: "fixture:test-decision-not-a-license" };
  const p = buildFuturesWorkspacePublication(capture, selection); expect(p.status).toBe("ok");
  const r = joinFuturesSource(p.source, request, capture.publication.publishedAtMs);
  expect(r.status).toBe("data"); if (r.status !== "data") throw Error("fixture");
  return { view: r.data, now: capture.publication.publishedAtMs };
}
describe("book-only intervals cross the publication/API boundary without invented candles", () => {
  it("preserves two depth periods, null prices and zero observed trades", () => {
    const { view } = publication(); expect(view.frames).toHaveLength(2);
    expect(view.frames.every(f => f.bar.kind === "no_captured_trades" && f.bar.openTicks === null && f.bar.total === 0)).toBe(true);
    expect(view.frames.every(f => f.depth?.coverage === "full" && f.depth.levels.some(l => (l.bidMean ?? 0) > 0))).toBe(true);
    expect(view.frames.every(f => f.gex.status === "unavailable")).toBe(true);
  });
  it("rejects an invented carry-forward price on a no-trade interval", () => {
    const { view, now } = publication(); Object.assign(view.frames[0].bar, { openTicks: 30000 });
    expect(parseFuturesPublishedView(view, request, now)).toBeNull();
  });
  it("rejects hiding actual volume inside an empty marker", () => {
    const { view, now } = publication(); Object.assign(view.frames[0].bar, { total: 1, buy: 1, deltaKnown: 1,
      cvdKnown: 1, cvd: 1, cells: [{ priceTicks: 30000, buy: 1, sell: 0, unknown: 0, total: 1 }] });
    expect(parseFuturesPublishedView(view, request, now)).toBeNull();
  });
  it("rejects unknown marker kinds and an unmarked zero-volume candle", () => {
    const a = publication(); Object.assign(a.view.frames[0].bar, { kind: "invented_carry" });
    expect(parseFuturesPublishedView(a.view, request, a.now)).toBeNull();
    const b = publication(); Object.assign(b.view.frames[0].bar, { kind: "executed", openTicks: 30000, highTicks: 30000, lowTicks: 30000, closeTicks: 30000 });
    expect(parseFuturesPublishedView(b.view, request, b.now)).toBeNull();
  });
});
