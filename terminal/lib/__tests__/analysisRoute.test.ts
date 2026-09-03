import { describe, expect, it } from "vitest";
import { parseAnalysisRoute } from "@/lib/analysisRoute";

describe("the closed /analysis route vocabulary", () => {
  it("preserves the existing company route when view is absent or explicitly company", () => {
    expect(parseAnalysisRoute({ symbol: "NVDA", pane: "earnings" })).toEqual({
      kind: "company", symbol: "NVDA", page: "earnings",
    });
    expect(parseAnalysisRoute({ view: "company", symbol: "MSFT", page: "valuation" })).toEqual({
      kind: "company", symbol: "MSFT", page: "valuation",
    });
  });

  it("accepts a canonical thesis UUID only inside the thesis view", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(parseAnalysisRoute({ view: "theses", thesis: id, symbol: "nvda" })).toEqual({
      kind: "theses", thesisId: id, symbol: "nvda",
    });
    expect(parseAnalysisRoute({ view: "company", thesis: id })).toEqual({
      kind: "unsupported", reason: "thesis_requires_theses",
    });
    expect(parseAnalysisRoute({ thesis: id })).toEqual({
      kind: "unsupported", reason: "thesis_requires_theses",
    });
  });

  it("closes blank, repeated, conflicting, and unknown views instead of falling through", () => {
    expect(parseAnalysisRoute({ view: "" })).toEqual({ kind: "unsupported", reason: "invalid_view" });
    expect(parseAnalysisRoute({ view: ["theses", "theses"] })).toEqual({ kind: "unsupported", reason: "invalid_view" });
    expect(parseAnalysisRoute({ view: ["company", "theses"] })).toEqual({ kind: "unsupported", reason: "invalid_view" });
    expect(parseAnalysisRoute({ view: "portfolio" })).toEqual({ kind: "unsupported", reason: "unsupported_view" });
  });

  it("types malformed and repeated thesis identities before any store can be called", () => {
    expect(parseAnalysisRoute({ view: "theses", thesis: "not-a-uuid" })).toEqual({ kind: "invalid_thesis" });
    expect(parseAnalysisRoute({ view: "theses", thesis: "" })).toEqual({ kind: "invalid_thesis" });
    expect(parseAnalysisRoute({ view: "theses", thesis: [
      "123e4567-e89b-42d3-a456-426614174000",
      "123e4567-e89b-42d3-a456-426614174000",
    ] })).toEqual({ kind: "invalid_thesis" });
  });
});
