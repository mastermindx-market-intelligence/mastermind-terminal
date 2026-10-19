import { describe, it, expect } from "vitest";
import { deriveFuturesNamedLevels } from "../futuresGexLevels";
import { deriveOptLevels } from "../optionsLevels";
import { buildFuturesGexFrame } from "../futuresGexFrame";
import { observedFuturesProfile } from "../futuresVolumeProfile";
import { buildFuturesLabFrames, type FuturesLabDataset } from "../futuresWorkspace";
import fixture from "@/fixtures/futures-microstructure.json";

const dataset = fixture as FuturesLabDataset;
const input = () => structuredClone(dataset.frameInputs[23]);
function frames(cutoff = fixture.baseMs + 24 * 60000) {
  return buildFuturesLabFrames(dataset, { cutoffMs: cutoff, intervalMinutes: 1, priceStepTicks: 1, lens: { kind: "all" }, method: "ratio", fault: "normal" });
}
describe("source-owned named futures levels", () => {
  it("reuses the incumbent level values rather than selecting new walls from the strike bars", () => {
    const i = input(), owned = deriveOptLevels(i.source, null, i.quotes.indexRoot).levels;
    const got = deriveFuturesNamedLevels(i.source, i.quotes, 2000, "ratio");
    expect(got).toHaveLength(3);
    for (const row of got) {
      expect(row.sourcePrice).toBe(owned.find(v => v.key === row.key)?.price);
      expect(row.futuresPrice).toBeCloseTo(row.sourcePrice * i.quotes.futuresPrice / i.quotes.indexPrice, 8);
      expect(row.expiryScope).toBe("all");
    }
  });
  it("retains two roles at the same source price without duplicate-strike projection failure", () => {
    const i = input(), source = { ...(i.source as object), call_wall: 7485, gamma_flip: 7485 };
    const got = deriveFuturesNamedLevels(source, i.quotes, 2000, "basis");
    expect(got.find(v => v.key === "call_wall")?.futuresPrice).toBe(got.find(v => v.key === "gamma_flip")?.futuresPrice);
    expect(got).toHaveLength(3);
  });
  it("does not manufacture walls or a flip from an otherwise populated gamma ladder", () => {
    const i = input(), source = { ...(i.source as object), call_wall: null, put_wall: null, gamma_flip: null };
    expect(deriveFuturesNamedLevels(source, i.quotes, 2000, "basis")).toEqual([]);
  });
  it("refuses another index root", () => {
    const i = input(); expect(deriveFuturesNamedLevels({ ...(i.source as object), root: "NDX" }, i.quotes, 2000, "ratio")).toEqual([]);
  });
  it("uses the existing repriced profile crossing preference", () => {
    const i = input(), source = { ...(i.source as object), gamma_flip: 7400, profile: { crossings: [7481, 7450] } };
    const expected = deriveOptLevels(source, null, "SPX").levels.find(v => v.key === "gamma_flip")!.price;
    expect(deriveFuturesNamedLevels(source, i.quotes, 2000, "ratio").find(v => v.key === "gamma_flip")?.sourcePrice).toBe(expected);
  });
  it("keeps all-expiry landmarks unchanged by the 0DTE bubble lens", () => {
    const i = input(), a = buildFuturesGexFrame(i), b = buildFuturesGexFrame({ ...i, expiryLens: { kind: "zero" } });
    expect(a.status).toBe("ok"); expect(b.status).toBe("ok");
    if (a.status === "ok" && b.status === "ok") {
      expect(a.landmarks).toEqual(b.landmarks);
      expect(a.projection.mapped.map(v => v.gammaNetMn)).not.toEqual(b.projection.mapped.map(v => v.gammaNetMn));
    }
  });
  it("never exposes landmarks from a future publication", () => {
    const i = input(); i.sourceReceipt.availableAtMs = i.policy.decisionTimeMs + 1;
    expect(buildFuturesGexFrame(i)).toEqual({ status: "unavailable", reason: "not_yet_available" });
  });
});
describe("observed captured-window POC", () => {
  it("uses only admitted frames and conserves total execution quantity", () => {
    const all = frames(), early = frames(fixture.baseMs + 60000);
    const p = observedFuturesProfile(all), first = observedFuturesProfile(early);
    expect(p.cells.reduce((n, c) => n + c.total, 0)).toBe(4203);
    expect(first.cells.reduce((n, c) => n + c.total, 0)).toBe(early[0].bar.total);
    expect(first.cells.reduce((n, c) => n + c.total, 0)).toBeLessThan(4203);
    expect(p.pointOfControl?.total).toBe(Math.max(...p.cells.map(c => c.total)));
    expect(p.scope).toBe("observed_capture_window");
  });
  it("includes unknown-side volume and resolves equal peaks at the lower price", () => {
    const f = structuredClone(frames()[0]);
    f.bar.cells = [{ priceTicks: 30002, buy: 10, sell: 0, unknown: 0, total: 10 },
      { priceTicks: 30000, buy: 0, sell: 0, unknown: 10, total: 10 }];
    const p = observedFuturesProfile([f]);
    expect(p.pointOfControl?.priceTicks).toBe(30000); expect(p.pointOfControl?.unknown).toBe(10);
    expect(p.tieBreak).toBe("lower_price");
  });
  it("has no point of control before any observed execution", () => {
    expect(observedFuturesProfile([]).pointOfControl).toBeNull();
  });
  it("does not mutate incoming bars or cells", () => {
    const data = frames(), before = JSON.stringify(data); observedFuturesProfile(data); expect(JSON.stringify(data)).toBe(before);
  });
});
