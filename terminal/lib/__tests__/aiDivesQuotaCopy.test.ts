import { describe, expect, it } from "vitest";
import { DEEP_RESEARCH_MONTHLY } from "@/lib/chatQuotas";
import { LEX } from "@/lib/i18n";

// Pin Terminal quota copy to the same numbers brain_gateway._get_allowance
// enforces from macro config/brain.yml (`quotas.essential.pro.limit: 10`,
// `quotas.pro.pro.limit: 150`). This repo does not import that YAML.

describe("DEEP_RESEARCH_MONTHLY matches the enforced Brain pro-lane caps", () => {
  it("pins Essential=10 and Pro=150 calendar-month deep requests", () => {
    expect(DEEP_RESEARCH_MONTHLY).toEqual({ essential: 10, pro: 150 });
  });
});

describe("onboarding AI-dives copy interpolates the enforced caps", () => {
  it("Essential (obInsider2) EN+ZH", () => {
    const n = DEEP_RESEARCH_MONTHLY.essential;
    expect(LEX.obInsider2[0]).toBe(`${n} Pro AI dives a month`);
    expect(LEX.obInsider2[1]).toBe(`每月 ${n} 次 Pro AI`);
  });

  it("Pro (obPro1) EN+ZH", () => {
    const n = DEEP_RESEARCH_MONTHLY.pro;
    expect(LEX.obPro1[0]).toBe(`${n} Pro AI dives a month`);
    expect(LEX.obPro1[1]).toBe(`每月 ${n} 次 Pro AI`);
  });
});

describe("settings deep-research copy interpolates the same caps", () => {
  it("Essential (acsFeatInsider4) EN+ZH", () => {
    const n = DEEP_RESEARCH_MONTHLY.essential;
    expect(LEX.acsFeatInsider4[0]).toBe(`${n} deep research questions a month`);
    expect(LEX.acsFeatInsider4[1]).toBe(`每月 ${n} 次深度研究提问`);
  });

  it("Pro (acsFeatPro3) EN+ZH", () => {
    const n = DEEP_RESEARCH_MONTHLY.pro;
    expect(LEX.acsFeatPro3[0]).toBe(`${n} deep research questions a month`);
    expect(LEX.acsFeatPro3[1]).toBe(`每月 ${n} 次深度研究提问`);
  });
});
