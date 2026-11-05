import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execTool } from "../copilotTools";

// Actual Python producer -> its JSON -> actual model-facing executor.
// Only filesystem transport is substituted; no collector, model, network or browser runs.
const NOW = Date.parse("2026-10-08T16:00:00Z");
const ROOT = path.resolve(process.cwd(), "..");
const PYTHON = [
  "import json,sys",
  "from datetime import date",
  "from ingest.pull_macro_risk import build_market_risk",
  "src=json.load(sys.stdin)",
  "print(json.dumps(build_market_risk(src,today=date(2026,10,8)),allow_nan=False))",
].join("\n");

type Obj = Record<string, unknown>;
type Schema = "risk_state.v1" | "market_state.v1";

function source(schema: Schema, changes: Obj = {}): Obj {
  const state = { verdict: "MIXED", score: 51, label_en: "Mixed", label_zh: "混合" };
  const radar = { state: "caution", top_score: 84.8, label_en: "Rates pressure", label_zh: "利率压力" };
  return schema === "risk_state.v1"
    ? { schema, nightly_asof: "2026-10-08", stale: false, realtime: true, live_active: true,
        display: state, live: { radar }, nightly: {}, ...changes }
    : { schema, asof: "2026-10-08", ...state, radar, ...changes };
}

function produce(input: Obj): Obj {
  return JSON.parse(execFileSync("python3", ["-c", PYTHON], {
    cwd: ROOT, input: JSON.stringify(input), encoding: "utf8", timeout: 5000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    maxBuffer: 65536,
  })) as Obj;
}

async function consume(report: Obj): Promise<Obj> {
  vi.stubEnv("NW_FIXTURE", "1");
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const network = vi.fn(() => { throw new Error("Unexpected network in risk pipeline proof"); });
  vi.stubGlobal("fetch", network);
  const read = vi.spyOn(fs, "readFile").mockImplementation(async (file) => {
    const name = path.basename(String(file));
    if (name === "market_risk.json") return JSON.stringify(report);
    if (name === "nw_plane_fixture.json") return JSON.stringify({
      asof: "2026-10-08", verdict: { verdict: "MIXED", score: 0.51, label_en: "Mixed" },
    });
    throw new Error(`Unexpected fixture read: ${name}`);
  });
  const out = await execTool("get_market_state", {});
  expect(network).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(out).length).toBeLessThanOrEqual(2000);
  return out.market_risk as Obj;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

for (const schema of ["risk_state.v1", "market_state.v1"] as const) {
  describe(`real ${schema} -> bridge -> copilot`, () => {
    it("preserves mixed conditions beside high risk pressure, with honest clock uncertainty", async () => {
      const report = produce(source(schema));
      expect(report.schema).toBe("market_risk/v1");
      expect(report).not.toHaveProperty("display");
      const out = await consume(report);
      expect(out.no_data).not.toBe(true);
      expect(out).toMatchObject({ verdict: "MIXED", score: 51, asof: "2026-10-08",
        stale: null, built: null, age_hours: null, is_display_only: true,
        freshness_basis: "producer_report_only" });
      expect(out.radar).toMatchObject({ state: "caution", top_score: 84.8, label_zh: "利率压力" });
    });
    it("preserves producer-stale evidence instead of turning it fresh or calm", async () => {
      const report = produce(source(schema, { stale: true }));
      expect(report.realtime).toBe(false);
      const out = await consume(report);
      expect(out).toMatchObject({ verdict: "MIXED", stale: true,
        source_reported_stale: true, source_reported_realtime: false });
    });
    it.each(["2026-10-09", "2026-10-01", "2026-10-08junk"])(
      "does not restamp future, old or malformed session %s", async (session) => {
        const field = schema === "risk_state.v1" ? "nightly_asof" : "asof";
        const report = produce(source(schema, { [field]: session }));
        expect(report.stale).toBe(true);
        const out = await consume(report);
        expect(out.stale).toBe(true);
        expect(out.verdict).toBe("MIXED");
      });
    it("does not carry injected capital permissions or convert a pressure score to odds", async () => {
      const input = source(schema, { may_execute: true, may_size: true, may_gate: true,
        may_rank: true, may_exit_modulate: true, drawdown_prob: { h21: 0.85 } });
      const report = produce(input);
      const out = await consume(report);
      expect(out.is_display_only).toBe(true);
      for (const key of ["may_execute", "may_size", "may_gate", "may_rank", "may_exit_modulate", "drawdown_prob"]) {
        expect(report).not.toHaveProperty(key);
        expect(out).not.toHaveProperty(key);
      }
      expect((out.radar as Obj).top_score).toBe(84.8);
    });
    it("retains legitimate zero through the real JSON boundary", async () => {
      const changes = schema === "risk_state.v1"
        ? { display: { verdict: "RISK_OFF", score: 0, label_en: "Risk-off" } }
        : { verdict: "RISK_OFF", score: 0, label_en: "Risk-off" };
      expect(await consume(produce(source(schema, changes)))).toMatchObject({ verdict: "RISK_OFF", score: 0 });
    });
  });
}
