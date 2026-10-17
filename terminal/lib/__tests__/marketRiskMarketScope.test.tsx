// @vitest-environment jsdom
// Synthetic market identity through the actual bridge, normalizer, copilot and chip.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/components/fin/FinCharts", () => ({ LineSeries: () => null }));
import { MarketRiskChip } from "@/components/fin/OracleDash";
import { normalizeMarketRisk, qualifyRiskEnvelope, riskEnvelopeCopy } from "../marketRisk";
import { curateMarketRisk, execTool } from "../copilotTools";
import { MARKET_RISK_NOW as NOW, marketRiskSourceFixture, riskEnvelopeFixture } from "./marketRiskFixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each(["CN", "HK", "UK", "JP", "us", " US ", "", null, undefined, false, 1, [], {}])(
  "does not qualify a foreign or unspecified market: %j", market => {
    const envelope = { ...riskEnvelopeFixture(), market };
    const before = JSON.stringify(envelope);
    expect(qualifyRiskEnvelope(envelope, "2026-10-07", NOW)).toMatchObject({
      envelope: null, qualified: false, reasons: expect.arrayContaining(["market_mismatch"]),
    });
    const input = { ...marketRiskSourceFixture(), risk_envelope: envelope };
    const read = normalizeMarketRisk(input, NOW)!;
    expect(read).toMatchObject({ verdict: "MIXED", score: 51, stale: false, risk_envelope: null });
    expect(curateMarketRisk(input, NOW).risk_envelope).toBeNull();
    expect(riskEnvelopeCopy(read.risk_envelope, false).attention).toContain("Hazard unavailable");
    expect(JSON.stringify(envelope)).toBe(before);
  },
);

it("preserves qualified same-market evidence and false action authority", () => {
  const envelope = riskEnvelopeFixture();
  const read = normalizeMarketRisk({ ...marketRiskSourceFixture(), risk_envelope: envelope }, NOW)!;
  expect(read.risk_envelope_freshness.qualified).toBe(true);
  expect(read.risk_envelope).toEqual(envelope);
  expect(curateMarketRisk({ ...marketRiskSourceFixture(), risk_envelope: envelope }, NOW).risk_envelope)
    .toMatchObject({ hazard_summary: { stage: "FRAGILE" }, authority: {
      envelope_may_execute: false, envelope_may_gate: false, envelope_may_rank: false, envelope_may_size: false,
    } });
});

it("rejects foreign evidence in the actual Python producer before JSON reaches either consumer", () => {
  const envelope = { ...riskEnvelopeFixture(), market: "CN" };
  const code = "import json,sys\nfrom datetime import datetime\nfrom ingest.pull_macro_risk import build_market_risk\nd=json.load(sys.stdin)\nprint(json.dumps(build_market_risk(d['source'],now=datetime.fromisoformat(d['now']),risk_envelope=d['envelope'])))";
  const raw = JSON.parse(execFileSync("python3", ["-c", code], {
    cwd: path.resolve(process.cwd(), ".."), encoding: "utf8",
    input: JSON.stringify({ source: marketRiskSourceFixture(), envelope, now: "2026-10-08T12:00:00+00:00" }),
  }));
  expect(raw.risk_envelope_freshness).toEqual({ qualified: false, reasons: ["market_mismatch"] });
  expect(raw.risk_envelope).toBeNull();
  expect(normalizeMarketRisk(raw, NOW)).toMatchObject({ verdict: "MIXED", score: 51, stale: false, risk_envelope: null });
  expect(curateMarketRisk(raw, NOW).risk_envelope).toBeNull();
});

it("the real get_market_state executor cannot deliver a foreign hazard to the model", async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.stubEnv("NW_FIXTURE", "1");
  const network = vi.fn().mockRejectedValue(new Error("No network allowed"));
  vi.stubGlobal("fetch", network);
  vi.spyOn(fs, "readFile").mockImplementation(async file => {
    if (String(file).endsWith("market_risk.json")) return JSON.stringify({
      ...marketRiskSourceFixture(), risk_envelope: { ...riskEnvelopeFixture(), market: "HK" },
    });
    if (String(file).endsWith("nw_plane_fixture.json")) return JSON.stringify({ asof: "2026-10-07" });
    throw new Error("Unexpected fixture read");
  });
  const out = await execTool("get_market_state", {});
  expect(out.market_risk).toMatchObject({ verdict: "MIXED", score: 51, stale: false, risk_envelope: null });
  expect(JSON.stringify(out)).not.toContain("FRAGILE");
  expect(JSON.stringify(out).length).toBeLessThanOrEqual(2000);
  expect(network).not.toHaveBeenCalled();
});

it.each([false, true])("the existing chip preserves the valid US score without a foreign warning (zh=%s)", async zh => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let market = "US";
  const fetchMock = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({
    ...marketRiskSourceFixture(), schema: "market_risk/v1", risk_envelope: { ...riskEnvelopeFixture(), market },
  }) }));
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<MarketRiskChip zh={zh} />));
    expect(host.querySelector("summary")?.textContent).toContain(zh ? "脆弱" : "Fragile");
    market = "CN";
    await act(async () => window.dispatchEvent(new Event("focus")));
    const summary = host.querySelector("summary")?.textContent ?? "";
    expect(summary).toContain("51/100");
    expect(summary).toContain(zh ? "风险阶段不可用" : "Hazard unavailable");
    expect(summary).not.toContain(zh ? "脆弱" : "Fragile");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
