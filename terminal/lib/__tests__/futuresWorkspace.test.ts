import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildFuturesLabFrames, type FuturesLabDataset } from "../futuresWorkspace";
import es from "../../fixtures/futures-microstructure.json";
import nq from "../../fixtures/futures-microstructure-nq.json";
const datasets = [es, nq] as FuturesLabDataset[];
const settings = { intervalMinutes: 1, priceStepTicks: 1, lens: { kind: "all" as const }, method: "ratio" as const, fault: "normal" };

describe("one source-time cursor for futures chart layers", () => {
  for (const dataset of datasets) {
    it(`${dataset.pair}: generated source adapters preserve identity, volume and layer timing`, () => {
      const expected = dataset.pair === "ES" ? 4203 : 4202;
      for (const intervalMinutes of [1, 5]) for (const priceStepTicks of [1, 4, 8]) {
        const frames = buildFuturesLabFrames(dataset, { ...settings, intervalMinutes, priceStepTicks,
          cutoffMs: dataset.baseMs + 24 * 60000 });
        expect(frames.reduce((s, f) => s + f.bar.total, 0)).toBe(expected);
        for (const frame of frames) {
          expect(frame.depth?.startNs).toBe(frame.bar.startNs);
          expect(frame.depth?.endNs).toBe(frame.bar.endNs);
          expect(frame.gex.status).toBe("ok");
          if (frame.gex.status !== "ok") throw Error("fixture");
          expect(frame.gex.projection.pair).toBe(dataset.pair);
          expect(frame.gex.projection.indexRoot).toBe(dataset.indexRoot);
          expect(frame.gex.projection.futuresContract).toBe(dataset.contract);
          expect(frame.gex.provenance.decisionTimeMs).toBe(frame.endMs);
          expect(frame.gex.provenance.artifactId).toContain(`synthetic:${dataset.pair}:`);
        }
      }
    });
    it(`${dataset.pair}: coarser intervals never move a historical cursor forward`, () => {
      for (let minute = 1; minute <= 24; minute++) {
        const cutoffMs = dataset.baseMs + minute * 60000;
        const frames = buildFuturesLabFrames(dataset, { ...settings, intervalMinutes: 5, cutoffMs });
        expect(frames.every(f => f.endMs <= cutoffMs)).toBe(true);
        if (minute < 5) expect(frames).toHaveLength(0);
      }
    });
    it(`${dataset.pair}: source-session expiry cuts sum to all at every frame`, () => {
      const cutoffMs = dataset.baseMs + 24 * 60000;
      const all = buildFuturesLabFrames(dataset, { ...settings, cutoffMs });
      const zero = buildFuturesLabFrames(dataset, { ...settings, cutoffMs, lens: { kind: "zero" } });
      const later = buildFuturesLabFrames(dataset, { ...settings, cutoffMs, lens: { kind: "ex-zero" } });
      for (let i = 0; i < all.length; i++) {
        const a = all[i].gex, z = zero[i].gex, l = later[i].gex;
        if (a.status !== "ok" || z.status !== "ok" || l.status !== "ok") throw Error("fixture");
        for (let j = 0; j < a.projection.mapped.length; j++) {
          expect(z.projection.mapped[j].gammaNetMn! + l.projection.mapped[j].gammaNetMn!).toBeCloseTo(a.projection.mapped[j].gammaNetMn!, 8);
          expect(z.projection.mapped[j].futuresPrice).toBe(a.projection.mapped[j].futuresPrice);
        }
      }
    });
  }
  it("a record one nanosecond past the cutoff cannot sneak in through millisecond rounding", () => {
    const d = structuredClone(datasets[0]); const cutoffMs = d.baseMs + 60000;
    d.footprints["1:1"].bars[0].availableAtNs = String(BigInt(cutoffMs) * BigInt(1000000) + BigInt(1));
    expect(buildFuturesLabFrames(d, { ...settings, cutoffMs })).toHaveLength(0);
  });
  it("late matrix publication refuses the narrow cut without removing actual trades", () => {
    const d = datasets[0]; const frames = buildFuturesLabFrames(d, { ...settings, cutoffMs: d.baseMs + 24 * 60000,
      lens: { kind: "zero" }, fault: "matrix-late" });
    expect(frames.at(-1)!.gex).toEqual({ status: "unavailable", reason: "matrix_clock" });
    expect(frames.reduce((s, f) => s + f.bar.total, 0)).toBe(4203);
  });
  it("mixed root frame inputs cannot wear the selected contract", () => {
    const d = structuredClone(datasets[0]); d.frameInputs[0].quotes.indexRoot = "NDX";
    const frames = buildFuturesLabFrames(d, { ...settings, cutoffMs: d.baseMs + 60000 });
    expect(frames[0].gex.status).toBe("unavailable");
  });
  it("reusable chart has no dependency on synthetic fixture generation or provider access", () => {
    const chart = fs.readFileSync(path.resolve(__dirname, "../../components/futures/FuturesMicrostructureChart.tsx"), "utf8");
    expect(chart).not.toMatch(/from ["'].*fixtures|buildFuturesGexFrame|fetch\(|API_KEY|synthetic:/);
  });
});
