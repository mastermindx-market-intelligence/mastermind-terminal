import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOLDINGS_COVERAGE_SCHEMA, holdingsCoverageFor, holdingsCoverageLine, sectorHoldingsCoverage } from "../sectorHoldingsCoverage";
import fixture from "./fixtures/sector-holdings-coverage.v1.json";

type Mutable = Record<string, unknown>;
const clone = (): Mutable => JSON.parse(JSON.stringify(fixture)) as Mutable;
const funds = (root: Mutable): Mutable[] => root.funds as Mutable[];
const listed = (root: Mutable, index: number): Mutable[] => funds(root)[index].listed as Mutable[];
const coverage = (root: Mutable, index: number): Mutable => funds(root)[index].coverage as Mutable;
const parsed = sectorHoldingsCoverage(fixture);
if (!parsed) throw new Error("fixture must parse");
const xlk = holdingsCoverageFor(parsed, "XLK")!, xlu = holdingsCoverageFor(parsed, "XLU")!, xlre = holdingsCoverageFor(parsed, "XLRE")!, xle = holdingsCoverageFor(parsed, "XLE")!;

describe("sectorHoldingsCoverage", () => {
  it("parses the frozen fixture and keeps the unknown total as null", () => {
    expect(parsed.schema).toBe(HOLDINGS_COVERAGE_SCHEMA);
    expect(parsed.asOf).toBe("2026-10-16");
    expect(parsed.source).toBe("sector_holdings.parquet");
    expect(Object.keys(parsed.funds)).toEqual(["XLK", "XLF", "XLU", "XLRE", "XLE"]);
    expect(xlk.count).toEqual({ listed: 20, total: 68 });
    expect(xlk.weightPct).toBe(71.4);
    expect(xlk.listed[0]).toEqual({ ticker: "NVDA", weightPct: xlk.listed[0].weightPct, rank: 1 });
    expect(xlk.concentration.top3OfFundPct).toBeCloseTo(xlk.listed[0].weightPct + xlk.listed[1].weightPct + xlk.listed[2].weightPct, 2);
    expect(xlu.count).toEqual({ listed: 20, total: null });
    expect(xlu.asOf).toBe("2026-10-15");
    expect(xlre.count).toEqual({ listed: 2, total: 31 });
    expect(xlre.concentration).toEqual({ top3OfFundPct: null, top3OfSamplePct: null });
    expect(xle).toMatchObject({ count: { listed: 0, total: 23 }, weightPct: 0, listed: [], concentration: { top3OfFundPct: null, top3OfSamplePct: null } });
  });

  it("rejects a coverage block that disagrees with its listed rows", () => {
    const weight = clone();
    coverage(weight, 0).weight_pct = 71.43;
    expect(sectorHoldingsCoverage(weight)).toBeNull();
    const count = clone();
    (coverage(count, 0).count as Mutable).listed = 19;
    expect(sectorHoldingsCoverage(count)).toBeNull();
    const top3 = clone();
    (coverage(top3, 0).concentration as Mutable).top3_of_fund_pct = 1;
    expect(sectorHoldingsCoverage(top3)).toBeNull();
    const sample = clone();
    (coverage(sample, 0).concentration as Mutable).top3_of_sample_pct = 99;
    expect(sectorHoldingsCoverage(sample)).toBeNull();
    const thin = clone();
    (coverage(thin, 3).concentration as Mutable).top3_of_fund_pct = 12.3;
    expect(sectorHoldingsCoverage(thin)).toBeNull();
    const nearlyRight = clone();
    coverage(nearlyRight, 0).weight_pct = 71.41;
    expect(sectorHoldingsCoverage(nearlyRight)).not.toBeNull();
  });

  it("rejects a known total below the listed count, a non-integer total, a zero total and a contradictory unknown flag", () => {
    const below = clone();
    funds(below)[0].n_holdings_total = 19; (coverage(below, 0).count as Mutable).total = 19;
    expect(sectorHoldingsCoverage(below)).toBeNull();
    const fractional = clone();
    funds(fractional)[0].n_holdings_total = 68.5; (coverage(fractional, 0).count as Mutable).total = 68.5;
    expect(sectorHoldingsCoverage(fractional)).toBeNull();
    const zero = clone();
    funds(zero)[4].n_holdings_total = 0; (coverage(zero, 4).count as Mutable).total = 0;
    expect(sectorHoldingsCoverage(zero)).toBeNull();
    const mismatch = clone();
    (coverage(mismatch, 0).count as Mutable).total = 69;
    expect(sectorHoldingsCoverage(mismatch)).toBeNull();
    const unknownWithNumber = clone();
    funds(unknownWithNumber)[2].n_holdings_total = 30;
    expect(sectorHoldingsCoverage(unknownWithNumber)).toBeNull();
    const knownWithNull = clone();
    funds(knownWithNull)[0].total_unknown = true;
    expect(sectorHoldingsCoverage(knownWithNull)).toBeNull();
  });

  it("rejects disordered ranks, rising weights, duplicate tickers and out-of-range weights", () => {
    const ranks = clone();
    listed(ranks, 0)[3].rank = 5;
    expect(sectorHoldingsCoverage(ranks)).toBeNull();
    const rising = clone();
    const rows = listed(rising, 0);
    [rows[0].weight_pct, rows[1].weight_pct] = [rows[1].weight_pct, rows[0].weight_pct];
    expect(sectorHoldingsCoverage(rising)).toBeNull();
    const duplicate = clone();
    listed(duplicate, 0)[1].ticker = "NVDA";
    expect(sectorHoldingsCoverage(duplicate)).toBeNull();
    const negative = clone();
    listed(negative, 0)[19].weight_pct = -0.5; coverage(negative, 0).weight_pct = 70;
    expect(sectorHoldingsCoverage(negative)).toBeNull();
    const tooMany = clone();
    funds(tooMany)[0].listed = Array.from({ length: 61 }, (_, i) => ({ ticker: `T${i}`, weight_pct: 1, rank: i + 1 }));
    expect(sectorHoldingsCoverage(tooMany)).toBeNull();
  });

  it("rejects extra keys, a bad schema, a duplicate fund and a snapshot dated after the feed", () => {
    const extra = clone();
    funds(extra)[0].note = "hand edited";
    expect(sectorHoldingsCoverage(extra)).toBeNull();
    const extraRow = clone();
    listed(extraRow, 0)[0].name = "NVIDIA";
    expect(sectorHoldingsCoverage(extraRow)).toBeNull();
    const schema = clone();
    (schema.meta as Mutable).schema = "sector_holdings.v1";
    expect(sectorHoldingsCoverage(schema)).toBeNull();
    const duplicate = clone();
    funds(duplicate)[1].fund = "XLK";
    expect(sectorHoldingsCoverage(duplicate)).toBeNull();
    const future = clone();
    funds(future)[0].as_of = "2026-10-17";
    expect(sectorHoldingsCoverage(future)).toBeNull();
    const source = clone();
    (source.meta as Mutable).source = "";
    expect(sectorHoldingsCoverage(source)).toBeNull();
    expect(sectorHoldingsCoverage(null)).toBeNull();
    expect(sectorHoldingsCoverage("feed")).toBeNull();
  });

  it("the coverage line separates count coverage, weight coverage and concentration in both languages", () => {
    const top3 = Math.round(xlk.concentration.top3OfFundPct! * 10) / 10;
    expect(holdingsCoverageLine(xlk, "en")).toBe(`Covers 20 of 68 holdings · 71.4% of fund weight · top 3 = ${top3}% of fund`);
    expect(holdingsCoverageLine(xlk, "zh")).toBe(`覆盖 20/68 只持仓 · 占基金权重 71.4% · 前三大 = 基金的 ${top3}%`);
    expect(holdingsCoverageLine(xlk, "en")).not.toMatch(/target|implied|forecast/i);
    expect(holdingsCoverageLine({ ...xlk, weightPct: 100, concentration: { top3OfFundPct: 50, top3OfSamplePct: 50 } }, "en")).toContain("· 100% of fund weight ·");
  });

  it("the unknown total is never rendered as zero or one hundred", () => {
    const en = holdingsCoverageLine(xlu, "en"), zh = holdingsCoverageLine(xlu, "zh");
    expect(en).toMatch(/^Covers 20 holdings · total count unknown · 83\.2% of fund weight · top 3 = \d+(\.\d)?% of fund$/);
    expect(zh).toMatch(/^覆盖 20 只持仓 · 总数未知 · 占基金权重 83\.2% · 前三大 = 基金的 \d+(\.\d)?%$/);
    expect(en).not.toMatch(/of (0|100) holdings|20 of /);
    expect(zh).not.toMatch(/20\/(0|100)/);
  });

  it("fewer than three listed holdings drop the concentration clause and zero listed says so", () => {
    expect(holdingsCoverageLine(xlre, "en")).toBe("Covers 2 of 31 holdings · 12.3% of fund weight");
    expect(holdingsCoverageLine(xlre, "zh")).toBe("覆盖 2/31 只持仓 · 占基金权重 12.3%");
    expect(holdingsCoverageLine(xle, "en")).toBe("No holdings listed for XLE");
    expect(holdingsCoverageLine(xle, "zh")).toBe("XLE 暂无持仓列表");
  });

  it("lookup is exact-case and returns null for an unknown fund", () => {
    expect(holdingsCoverageFor(parsed, "XLK")?.fund).toBe("XLK");
    expect(holdingsCoverageFor(parsed, "xlk")).toBeNull();
    expect(holdingsCoverageFor(parsed, "XLB")).toBeNull();
    expect(holdingsCoverageFor(parsed, "__proto__")).toBeNull();
  });

  it("nothing in the parser reads options, strikes or Gamma", () => {
    const source = readFileSync(new URL("../sectorHoldingsCoverage.ts", import.meta.url), "utf8");
    for (const banned of ["gex", "gamma", "strike", "options"]) expect(source.toLowerCase()).not.toContain(banned);
  });
});
