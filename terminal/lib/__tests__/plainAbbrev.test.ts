import { describe, expect, it } from "vitest";
import { daysHeld, daysToExpiry, volAboveOi } from "@/lib/plainAbbrev";

function assertEnPlain(en: string) {
  expect(en).not.toMatch(/\b\d+d\b/);
  expect(en).not.toContain(">");
}

describe("daysToExpiry", () => {
  it("expands the abbreviation in both languages", () => {
    const en = daysToExpiry(7, "en");
    const zh = daysToExpiry(7, "zh");
    expect(en.trim().length).toBeGreaterThan(0);
    expect(zh.trim().length).toBeGreaterThan(0);
    expect(en).toContain("days to expiry");
    expect(en).toContain("7");
    expect(zh).toContain("7");
    expect(en.toLowerCase()).not.toContain("dte");
    assertEnPlain(en);
    expect(zh.toLowerCase()).not.toContain("dte");
  });

  it("uses EN singular/plural and ZH 天到期 for n=0,1,2", () => {
    expect(daysToExpiry(0, "en")).toBe("0 days to expiry");
    expect(daysToExpiry(1, "en")).toBe("1 day to expiry");
    expect(daysToExpiry(2, "en")).toBe("2 days to expiry");
    expect(daysToExpiry(0, "zh")).toBe("0 天到期");
    expect(daysToExpiry(1, "zh")).toBe("1 天到期");
    expect(daysToExpiry(2, "zh")).toBe("2 天到期");
    assertEnPlain(daysToExpiry(0, "en"));
    assertEnPlain(daysToExpiry(1, "en"));
    assertEnPlain(daysToExpiry(2, "en"));
  });
});

describe("daysHeld", () => {
  it("keeps the count and spells out days", () => {
    const en = daysHeld(3, "en");
    const zh = daysHeld(3, "zh");
    expect(en.trim().length).toBeGreaterThan(0);
    expect(zh.trim().length).toBeGreaterThan(0);
    expect(en).toContain("3");
    expect(en.toLowerCase()).toContain("days");
    expect(zh).toContain("3");
    expect(en.toLowerCase()).not.toContain("dte");
    assertEnPlain(en);
  });

  it("uses EN singular/plural and ZH 天 for n=0,1,2", () => {
    expect(daysHeld(0, "en")).toBe("0 days");
    expect(daysHeld(1, "en")).toBe("1 day");
    expect(daysHeld(2, "en")).toBe("2 days");
    expect(daysHeld(0, "zh")).toBe("0 天");
    expect(daysHeld(1, "zh")).toBe("1 天");
    expect(daysHeld(2, "zh")).toBe("2 天");
    assertEnPlain(daysHeld(0, "en"));
    assertEnPlain(daysHeld(1, "en"));
    assertEnPlain(daysHeld(2, "en"));
  });
});

describe("volAboveOi", () => {
  it("spells volume and open interest in both languages", () => {
    const en = volAboveOi("en");
    const zh = volAboveOi("zh");
    expect(en.trim().length).toBeGreaterThan(0);
    expect(zh.trim().length).toBeGreaterThan(0);
    expect(en.toLowerCase()).toContain("open interest");
    expect(en.toLowerCase()).not.toContain("dte");
    assertEnPlain(en);
    expect(zh.toLowerCase()).not.toContain("dte");
  });
});
