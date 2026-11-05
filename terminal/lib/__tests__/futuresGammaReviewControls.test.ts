import { describe, it, expect } from "vitest";
import { selectFuturesGexLens } from "../futuresGexLens";
import { buildFuturesGexFrame } from "../futuresGexFrame";
import { observedFuturesProfile } from "../futuresVolumeProfile";
import { buildFuturesLabFrames, type FuturesLabDataset } from "../futuresWorkspace";
import fixture from "@/fixtures/futures-microstructure.json";
const dataset = fixture as FuturesLabDataset;
const now = Date.parse("2026-10-13T18:00:00Z");
function matrix() { return { payload: { schema: "options_structure.matrix/v1", root: "SPX", asof: "2026-10-13",
  session: "2026-10-13", _build_meta: { asof_date: "2026-10-13" },
  strikes: [5000], expiries: ["2026-10-13", "2026-10-16"], cells: [{ strike: 5000, expiry: "2026-10-13", gex: 100 as number | null }] },
  receipt: { artifactId: "review:sparse-matrix", sessionDate: "2026-10-13", sourceAsOfMs: now - 1000, availableAtMs: now - 900 } }; }
function select(m = matrix()) { return selectFuturesGexLens({ matrix: m, lens: { kind: "ex-zero" }, root: "SPX",
  sourceSession: "2026-10-13", strikes: [5000, 5005], decisionTimeMs: now, maxAgeMs: 2000 }); }
describe("independent gamma review falsifiers against the declared matrix contract", () => {
  it("sparse absence is UNKNOWN even at a covered strike; out-of-axis remains unknown", () => {
    // The incumbent matrix producer omits pairs it did not price; an absent
    // pair has no measurement behind it. Never use a false 0 to boost confidence.
    const r = select(); expect(r.status).toBe("ok"); if (r.status !== "ok") return;
    expect(r.byStrike.get(5000)).toBeNull(); expect(r.byStrike.get(5005)).toBeNull();
  });
  it("a measured zero is genuinely zero, not an absent cell or an unavailable frame", () => {
    const m = matrix(); m.payload.cells.push({ strike: 5000, expiry: "2026-10-16", gex: 0 });
    const r = select(m); expect(r.status).toBe("ok"); if (r.status !== "ok") return;
    expect(r.byStrike.get(5000)).toBe(0); expect(r.byStrike.get(5005)).toBeNull();
  });
  it("a selected explicitly null cell is not sparse absence and poisons that strike", () => {
    const m = matrix(); m.payload.cells.push({ strike: 5000, expiry: "2026-10-16", gex: null });
    const r = select(m); expect(r.status).toBe("ok"); if (r.status !== "ok") return;
    expect(r.byStrike.get(5000)).toBeNull();
  });
  it("a real all-zero exposure frame is valid rather than rejected as unavailable", () => {
    const input = structuredClone(dataset.frameInputs[23]);
    input.source = { schema: "options_hub.gex/v1", root: "SPX", asof: "2026-10-09", by_strike: [{ strike: 7480, gamma_net: 0 }] };
    const r = buildFuturesGexFrame(input); expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.projection.mapped[0].gammaNetMn).toBe(0);
  });
  it("POC derives solely from captured executions, not the gamma frame", () => {
    const frames = buildFuturesLabFrames(dataset, { cutoffMs: fixture.baseMs + 24 * 60000,
      intervalMinutes: 1, priceStepTicks: 1, lens: { kind: "all" }, method: "ratio", fault: "normal" });
    const original = observedFuturesProfile(frames);
    const missing = frames.map(f => ({ ...f, gex: { status: "unavailable" as const, reason: "source_unavailable" as const } }));
    expect(observedFuturesProfile(missing)).toEqual(original);
  });
});
