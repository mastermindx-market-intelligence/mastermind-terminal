import { describe, expect, it } from "vitest";
import { FIN_PAGES, type FinPage } from "../../components/fin/finPages";
import {
  defaultPageForFamily,
  familyForPage,
  FIN_FAMILY_ORDER,
  FIN_FAMILY_PAGES,
} from "../../components/fin/finPageFamilies";

describe("Research Workspace page families", () => {
  it("assigns every existing FinPage to exactly one family", () => {
    const assigned = FIN_FAMILY_ORDER.flatMap((family) => FIN_FAMILY_PAGES[family]);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect([...assigned].sort()).toEqual([...FIN_PAGES].sort());

    for (const page of FIN_PAGES) {
      expect(FIN_FAMILY_PAGES[familyForPage(page)]).toContain(page);
    }
  });

  it("keeps every family default inside that family", () => {
    for (const family of FIN_FAMILY_ORDER) {
      expect(FIN_FAMILY_PAGES[family]).toContain(defaultPageForFamily(family));
    }
  });

  it("preserves the intended migration groups for existing deep links", () => {
    const cases: Array<[FinPage, string]> = [
      ["overview", "overview"],
      ["intelligence", "intelligence"],
      ["statements", "financials"],
      ["statistics", "financials"],
      ["revenue", "financials"],
      ["dividends", "financials"],
      ["earnings", "earnings"],
      ["forecast", "earnings"],
      ["transcripts", "earnings"],
      ["technicals", "market"],
      ["seasonals", "market"],
      ["ownership", "ownership"],
      ["insider", "ownership"],
      ["lab", "lab"],
    ];
    for (const [page, family] of cases) expect(familyForPage(page)).toBe(family);
  });
});
