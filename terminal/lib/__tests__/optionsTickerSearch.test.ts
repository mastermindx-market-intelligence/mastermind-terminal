import { describe, expect, it } from "vitest";
import {
  buildOptionsTickerCandidates,
  isOptionsTickerQuery,
  normalizeOptionsTickerQuery,
} from "@/lib/optionsTickerSearch";

describe("Options Hub ticker lookup", () => {
  it("keeps an exact typed ticker selectable even when it is not a session leader", () => {
    expect(buildOptionsTickerCandidates(["AAPL", "AMD", "NVDA"], "intc")).toEqual(["INTC"]);
  });

  it("dedupes an exact ticker that is already in the session-leader set", () => {
    expect(buildOptionsTickerCandidates(["AAPL", "AMD", "NVDA"], "amd")).toEqual(["AMD"]);
  });

  it("preserves matching session leaders behind a direct exact query", () => {
    expect(buildOptionsTickerCandidates(["AMD", "AMZN", "META"], "am")).toEqual(["AM", "AMD", "AMZN"]);
  });

  it("does not fabricate a candidate for invalid ticker syntax", () => {
    expect(buildOptionsTickerCandidates(["AAPL", "AMD"], "@@")).toEqual([]);
    expect(isOptionsTickerQuery("@@")).toBe(false);
  });

  it("normalizes exact lookup input and bounds the idle discovery rail", () => {
    const roots = Array.from({ length: 25 }, (_, i) => `T${i}`);
    expect(normalizeOptionsTickerQuery("  intc ")).toBe("INTC");
    expect(isOptionsTickerQuery(" brk.b ")).toBe(true);
    expect(buildOptionsTickerCandidates(roots, "")).toHaveLength(20);
  });
});
