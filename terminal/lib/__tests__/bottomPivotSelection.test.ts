import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalBottomSymbol, parseBottomPivotSelection, selectBottomPivotFeed,
} from "@/lib/bottomPivotSelection";

const fixture = JSON.parse(readFileSync(
  join(__dirname, "fixtures", "nw_bottom_pivot_fixture.json"), "utf8",
)) as Record<string, unknown>;

describe("Bottom Pivot single-symbol evidence: no new market/trade authority", () => {
  it("normalizes only bounded ticker syntax", () => {
    expect(canonicalBottomSymbol("  brk.b ")).toBe("BRK.B");
    for (const value of ["", "../etc/passwd", "AAPL?x=1", "<script>", "😃", "A".repeat(17), null]) {
      expect(canonicalBottomSymbol(value)).toBeNull();
    }
  });

  it("selects only the named security and exposes producer-owned daily limits", () => {
    const selected = selectBottomPivotFeed(fixture, "aapl");
    expect(selected?.schema).toBe("bottom_pivot_selection.v1");
    expect(selected?.symbol).toBe("AAPL");
    expect(selected?.context).toMatchObject({
      schema: "bottom_pivot_context.v1", symbol: "AAPL", quality: "partial",
      is_display_only: true, probability: null, action_authority: "none",
      evidence_mode: "current_snapshot",
    });
    expect(selected?.context?.evidence.map((row) => row.state)).toEqual([
      "observed", "observed", "observed", "missing",
    ]);
    expect(selected?.context?.limitations).toContain("first_seen_unknown");
    expect(JSON.stringify(selected)).not.toContain("NEVER-SEND-OTHER-SYMBOL");
    expect(JSON.stringify(selected)).not.toContain("bottom_state");
  });

  it("represents absent names and absent context as unavailable, not bearish", () => {
    expect(selectBottomPivotFeed(fixture, "XYZ")).toMatchObject({
      context: null, reason: "symbol_absent",
    });
    expect(selectBottomPivotFeed(fixture, "MSFT")).toMatchObject({
      context: null, reason: "context_unavailable",
    });
  });

  it("rejects malformed producer structure instead of inferring evidence", () => {
    expect(selectBottomPivotFeed({}, "AAPL")).toBeNull();
    expect(selectBottomPivotFeed({ rows: [], is_display_only: false }, "AAPL")).toBeNull();
    expect(selectBottomPivotFeed(fixture, "AAPL?secret=1")).toBeNull();
  });

  it("rejects decision-capable, non-daily, mismatched or speculative contexts", () => {
    for (const mutation of [
      { action_authority: "trade" }, { probability: 0.88 },
      { cadence: "intraday" }, { scope: "market" }, { symbol: "MSFT" },
      { evidence_mode: "pretend" },
    ]) {
      const copy = structuredClone(fixture) as { rows: Array<{ pivot_context: Record<string, unknown> }> };
      Object.assign(copy.rows[0].pivot_context, mutation);
      const selected = selectBottomPivotFeed(copy, "AAPL");
      expect(selected?.context).toBeNull();
      expect(selected?.reason).toBe("context_unavailable");
    }
  });

  it("client revalidates source identity and refuses contaminated projections", () => {
    const selected = selectBottomPivotFeed(fixture, "AAPL");
    expect(parseBottomPivotSelection(selected, "AAPL")?.context?.quality).toBe("partial");
    expect(parseBottomPivotSelection(selected, "MSFT")).toBeNull();
    expect(parseBottomPivotSelection({ ...selected, schema: "wrong" }, "AAPL")).toBeNull();
    expect(parseBottomPivotSelection({ ...selected, reason: "made_up" }, "AAPL")).toBeNull();
    expect(parseBottomPivotSelection({
      ...selected, context: { ...selected?.context, probability: 0.5 },
    }, "AAPL")).toBeNull();
  });
});
