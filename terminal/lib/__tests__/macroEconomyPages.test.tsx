import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MacroEconomyMount from "@/components/mounts/MacroEconomyMount";
import SignupGate from "@/components/gates/SignupGate";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";
import * as page0 from "../../app/(shell)/macro_monetary.html/page";
import * as page1 from "../../app/(shell)/macro_liquidity_regime.html/page";
import * as page2 from "../../app/(shell)/macro_liquidity_central_banks.html/page";
import * as page3 from "../../app/(shell)/macro_monetary_policy.html/page";
import * as page4 from "../../app/(shell)/macro_rates_curves.html/page";
import * as page5 from "../../app/(shell)/macro_inflation_system.html/page";
import * as page6 from "../../app/(shell)/macro_growth_real_economy.html/page";
import * as page7 from "../../app/(shell)/macro_business_activity.html/page";
import * as page8 from "../../app/(shell)/macro_labor_markets.html/page";
import * as page9 from "../../app/(shell)/macro_housing_real_estate.html/page";
import * as page10 from "../../app/(shell)/macro_consumer_payments.html/page";
import * as page11 from "../../app/(shell)/macro_financial_conditions.html/page";
import * as page12 from "../../app/(shell)/macro_capital_structure.html/page";
import * as page13 from "../../app/(shell)/macro_national_debt_liabilities.html/page";
import * as page14 from "../../app/(shell)/macro_trade_flows.html/page";

const auth = vi.hoisted(() => ({ read: vi.fn(), notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }) }));
vi.mock("next/navigation", () => ({ notFound: auth.notFound }));
vi.mock("@/lib/shared-shell/memberIdentity", () => ({ readShellMember: auth.read }));
vi.mock("@/components/mounts/MacroEconomyMount", () => ({ default: () => null }));
vi.mock("@/components/gates/SignupGate", () => ({ default: () => null }));
vi.mock("@/components/gates/MemberVerificationUnavailable", () => ({ default: () => null }));
const pages = [
  { route: "macro_monetary.html", workspaceId: null, page: page0 },
  { route: "macro_liquidity_regime.html", workspaceId: "liquidity_regime", page: page1 },
  { route: "macro_liquidity_central_banks.html", workspaceId: "liquidity_central_banks", page: page2 },
  { route: "macro_monetary_policy.html", workspaceId: "monetary_policy", page: page3 },
  { route: "macro_rates_curves.html", workspaceId: "rates_curves", page: page4 },
  { route: "macro_inflation_system.html", workspaceId: "inflation_system", page: page5 },
  { route: "macro_growth_real_economy.html", workspaceId: "growth_real_economy", page: page6 },
  { route: "macro_business_activity.html", workspaceId: "business_activity", page: page7 },
  { route: "macro_labor_markets.html", workspaceId: "labor_markets", page: page8 },
  { route: "macro_housing_real_estate.html", workspaceId: "housing_real_estate", page: page9 },
  { route: "macro_consumer_payments.html", workspaceId: "consumer_payments", page: page10 },
  { route: "macro_financial_conditions.html", workspaceId: "financial_conditions", page: page11 },
  { route: "macro_capital_structure.html", workspaceId: "capital_structure", page: page12 },
  { route: "macro_national_debt_liabilities.html", workspaceId: "national_debt_liabilities", page: page13 },
  { route: "macro_trade_flows.html", workspaceId: "trade_flows", page: page14 },
];
const subject = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { vi.stubEnv("MMX_SHARED_SHELL", "1"); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe.each(pages)("native page $route", ({ page, workspaceId }) => {
  it("stays request-scoped and checks the shell opt-in before identity", async () => {
    expect(page.dynamic).toBe("force-dynamic"); expect(page.revalidate).toBe(0);
    vi.stubEnv("MMX_SHARED_SHELL", "0");
    await expect(page.default()).rejects.toThrow("NOT_FOUND");
    expect(auth.read).not.toHaveBeenCalled();
  });
  it("keeps guests at the incumbent signup gate", async () => {
    auth.read.mockResolvedValue({ state: "guest" });
    const result = await page.default();
    expect(result.type).toBe(SignupGate); expect(result.props).toMatchObject({ surface: "today" });
    expect(auth.read).toHaveBeenCalledOnce();
  });
  it("does not treat an unavailable identity verifier as a guest or member", async () => {
    auth.read.mockResolvedValue({ state: "unavailable" });
    const result = await page.default();
    expect(result.type).toBe(MemberVerificationUnavailable); expect(auth.read).toHaveBeenCalledOnce();
  });
  it("passes only the verified subject and exact route identity to the native mount", async () => {
    auth.read.mockResolvedValue({ state: "ready", subjectId: subject });
    const result = await page.default();
    expect(React.isValidElement(result)).toBe(true); expect(result.type).toBe(MacroEconomyMount);
    expect(result.key).toBe(subject); expect(result.props).toEqual({ ownerKey: subject, workspaceId });
    expect(auth.read).toHaveBeenCalledOnce();
  });
});
