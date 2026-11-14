import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { researchFundamentalConditions, researchTechnicalConditions } from "../discoverResearchEvidence";
import { classifyTechnical, readTechnicalScanResponse } from "../technicalScan";
import { TECHNICAL_SCAN_LEX } from "../technicalScanLex";
import { readFundamentalScanResponse, FUNDAMENTAL_FIELD_IDS } from "../fundamentalScan";
import { fundText } from "../fundamentalScanLex";
import { projectFundamental } from "../fundamentalScanProducer";
import { SCREENER_SCAN_SCHEMA } from "../screenerScan";
import { fundDoc, SEPCO_ANNUAL } from "./fixtures/fundamentalScan/fundDoc";

const now = Date.parse("2026-10-11T12:00:00Z");
const tt = (key: string) => TECHNICAL_SCAN_LEX[key]?.[0] ?? key;
const ft = (key: string) => fundText("en", key);

describe("Research conditions retain evidence quality and clocks", () => {
  it("identifies a missing technical field even when its row was evaluated", () => {
    const doc = JSON.parse(readFileSync(path.join(__dirname, "fixtures/screenerScan/technical.producer.json"), "utf8"));
    const row = doc.rows.find((row: { sym: string }) => row.sym === "0700.HK");
    row.tf["3D"].state.last_signal = null;
    const source = readTechnicalScanResponse(200, doc);
    expect(classifyTechnical(source, "0700.HK", "3D", now).coverage.status).toBe("evaluated");
    const result = researchTechnicalConditions(source, "0700.HK", { tf: "3D", predicates: [{ field: "tech.lastSignal", op: "in", values: ["BUY"], includeUnknown: true }] }, now, "en", tt)[0];
    expect(result).toMatchObject({ match: "pass", admittedUnknown: true });
    expect(result.label).toContain("Last signal"); expect(result.value).toContain("value not published");
    expect(result.value).toContain("Included as not evaluated"); expect(result.value).toContain("2026-10-09");
  });

  it("does not pass off a stale violating fundamental value as a successful numeric comparison", () => {
    const doc = fundDoc("AAA", { pe: 25.5, annual: SEPCO_ANNUAL });
    const source = readFundamentalScanResponse(200, {
      schema: SCREENER_SCAN_SCHEMA, family: "fundamental", family_version: 1,
      generation: now / 1000, generated_at: new Date(now).toISOString(), complete: true,
      universe: { source: "manifest", as_of: "2026-10-09", count: 1 }, fields: [...FUNDAMENTAL_FIELD_IDS],
      rows: [{ sym: "AAA", ...projectFundamental("AAA", doc).observation }],
    });
    const result = researchFundamentalConditions(source, "AAA", [{ field: "fund.net_margin_fy", op: "range", gte: .5, includeUnknown: true }], now + 10 * 86400000, "en", ft, () => "Net margin ≥ 50% + unknown")[0];
    expect(result).toMatchObject({ match: "pass", admittedUnknown: true });
    expect(result.value).toContain("Historical value: 15%"); expect(result.value).toContain("Included as not evaluated");
    expect(result.value).toContain("2025-09-27"); expect(result.value).not.toContain("2026-10-09");
  });
});
