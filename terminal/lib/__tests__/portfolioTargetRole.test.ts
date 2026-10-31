import { describe, expect, it } from "vitest";
import { parsePortfolioRoleEdit } from "../portfolioTargetRole";

describe("explicit portfolio role edits", () => {
  it("keeps omitted edits distinct from deliberate clearing", () => {
    expect(parsePortfolioRoleEdit(undefined)).toEqual({ kind: "unchanged" });
    for (const value of [null, "", "  ", "　"]) {
      expect(parsePortfolioRoleEdit(value)).toEqual({ kind: "value", value: null });
    }
  });
  it("preserves the user's vocabulary without inferring a category", () => {
    for (const value of ["Long-term research", "观察仓位", "My <core> & ideas"]) {
      expect(parsePortfolioRoleEdit(`  ${value}  `)).toEqual({ kind: "value", value });
    }
  });
  it("counts Unicode code points consistently with the database character limit", () => {
    expect(parsePortfolioRoleEdit("𠮷".repeat(48))).toEqual({ kind: "value", value: "𠮷".repeat(48) });
    expect(parsePortfolioRoleEdit("𠮷".repeat(49))).toEqual({ kind: "invalid" });
    expect(parsePortfolioRoleEdit("a".repeat(49))).toEqual({ kind: "invalid" });
  });
  it("refuses coercion and control characters instead of changing the requested role", () => {
    for (const value of [1, false, [], {}, "core\nhedge", "\tcore", "core\u0000", "core\u0085"]) {
      expect(parsePortfolioRoleEdit(value)).toEqual({ kind: "invalid" });
    }
  });
});
