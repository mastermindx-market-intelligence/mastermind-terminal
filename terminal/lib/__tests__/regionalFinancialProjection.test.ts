import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/regional_financial_projection.json";
import { canonicalFinancialProjection, financialProjection, materializeRegionalFund, materializeRegionalFundSync } from "../regionalFinancialProjection";
import { projectFundamental } from "../fundamentalScanProducer";
import { selectRegionalCompanySnapshot } from "../regionalCompanySnapshot";
import type { Fund } from "../fund";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const raw = () => structuredClone(fixture);
describe("regional financial projection compatibility", () => {
  it("keeps the exact old financial view while new readers select qualified additions", async () => {
    const envelope = raw(), untouched = JSON.stringify(envelope);
    expect(envelope.statements.quarterly.period_end).not.toContain("2026-06-30");
    const fund = await materializeRegionalFund(envelope, "600519.SS");
    expect(fund?.statements.quarterly?.period_end.at(-1)).toBe("2026-06-30");
    expect(fund?.statements.quarterly?.income.eps_basic.at(-1)).toBeNull();
    expect(fund?.statements.quarterly?.cashflow.cfo.at(-1)).toBeNull();
    expect(fund && "regional_financials" in fund).toBe(false);
    expect(JSON.stringify(envelope)).toBe(untouched);
  });
  it("agrees with the Python base digest and native Node materializer", async () => {
    const envelope = raw();
    expect(sha(canonicalFinancialProjection(financialProjection(envelope)))).toBe(envelope.regional_financials.base_sha256);
    expect(materializeRegionalFundSync(envelope, "600519.SS", sha)).toEqual(await materializeRegionalFund(envelope, "600519.SS"));
  });
  it.each(["base", "payload", "version", "ticker", "currency"])("refuses a changed %s without adopting any overlay", async (change) => {
    const envelope = raw();
    if (change === "base") envelope.statements.annual.income.revenue[0] += 1;
    if (change === "payload") envelope.regional_financials.payload_json += " ";
    if (change === "version") envelope.regional_financials.schema = "mastermind.regional-financials/v999";
    if (change === "ticker") envelope.regional_financials.ticker = "000858.SZ";
    if (change === "currency") envelope.stmt_currency = "USD";
    expect(await materializeRegionalFund(envelope, "600519.SS")).toBeNull();
    expect(materializeRegionalFundSync(envelope, "600519.SS", sha)).toBeNull();
  });
  it("rejects misaligned period metadata even with a matching content digest", async () => {
    const envelope = raw();
    const selected = JSON.parse(envelope.regional_financials.payload_json);
    selected.statements.quarterly.comparison_basis.pop();
    envelope.regional_financials.payload_json = JSON.stringify(selected);
    envelope.regional_financials.payload_sha256 = sha(envelope.regional_financials.payload_json);
    expect(await materializeRegionalFund(envelope, "600519.SS")).toBeNull();
  });
  it("keeps direct pure readers from interpreting an unselected envelope", async () => {
    const envelope = raw();
    expect(projectFundamental("600519.SS", envelope).observation.status).toBe("unavailable");
    expect(selectRegionalCompanySnapshot({ sym: "600519.SS", fund: envelope as unknown as Fund })).toBeNull();
    const selected = await materializeRegionalFund(envelope, "600519.SS");
    expect(projectFundamental("600519.SS", selected).observation.status).toBe("observed");
    expect(selectRegionalCompanySnapshot({ sym: "600519.SS", fund: selected })?.interim?.periodEnd).toBe("2026-06-30");
  });
  it("leaves ordinary existing funds on their current path", async () => {
    const plain = { schema: "mastermind.fund/v1", ticker: "RY.TO" };
    expect(await materializeRegionalFund(plain, "RY.TO")).toBe(plain);
  });

  it("adopts the same identity snapshot that it verified during asynchronous hashing", async () => {
    const envelope = raw();
    const original = structuredClone(envelope);
    const pending = materializeRegionalFund(envelope, "600519.SS");
    envelope.ticker = "000858.SZ";
    envelope.stmt_currency = "USD";
    (envelope as unknown as Record<string, unknown>).profile = { name: "Different issuer" };
    const result = await pending;
    expect(result?.ticker).toBe(original.ticker);
    expect(result?.stmt_currency).toBe(original.stmt_currency);
    expect(result?.profile).toEqual((original as unknown as Record<string, unknown>).profile);
  });
});
