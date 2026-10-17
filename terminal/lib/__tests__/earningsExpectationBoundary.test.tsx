import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  composeEarningsExpectationEvidence,
  type RepricingEvidenceSource,
} from "../earningsExpectationBoundary";
import type { EventWorkspacePresentedItem } from "../eventWorkspacePresent";
import EarningsRepricingEvidence from "../../components/fin/EarningsRepricingEvidence";

function item(id: string, value: string, receipt: "byte_replayed" | "address_only" | "typed_absence" = "byte_replayed"): EventWorkspacePresentedItem {
  return {
    id, label: id, value, detail: null,
    evidence: { receipt_state: receipt } as EventWorkspacePresentedItem["evidence"],
  };
}

function source(options: Partial<RepricingEvidenceSource> = {}): RepricingEvidenceSource {
  return {
    event_id: "evt_cik0000320193_2026q3_results",
    period_label: "FY2026 Q3",
    reported: [item("revenue", "$94.0B")],
    facts: [],
    guidance: [item("guidance:revenue", "4–7%")],
    honest: {
      questions_count_unavailable: true,
      consensus_unlicensed: true,
      slides_absent: true,
      reaction_not_joined: true,
      no_beat_miss: true,
    },
    ...options,
  };
}

describe("Earnings repricing evidence: owner-preserving view", () => {
  it("shows source-backed actual/guidance beside explicitly missing expectation and price channels", () => {
    const context = composeEarningsExpectationEvidence(source());
    expect(context.lanes.map((r) => [r.id, r.status])).toEqual([
      ["reported", "SOURCE_BACKED"],
      ["guidance", "SOURCE_BACKED"],
      ["consensus", "NOT_ADMITTED"],
      ["reaction", "NOT_ADMITTED"],
    ]);
    expect(context.lanes[0].value[0]).toBe("$94.0B");
    expect(context.lanes[1].value[0]).toBe("4–7%");
    expect(context.lanes[0].evidence?.id).toBe("revenue");
    expect(context.lanes[1].evidence?.id).toBe("guidance:revenue");
    expect(context.lanes[2].evidence).toBeNull();
    expect(context.lanes[3].evidence).toBeNull();
    expect(context.repricingInference).toBe("NOT_ESTABLISHED");
    expect(context.authority).toBe("CONTEXT_ONLY_NO_TRADING");
    expect(context.historicalConsensusAdmitted).toBe(false);
    expect(context.eventPriceReactionJoined).toBe(false);
    expect(Object.keys(context)).not.toEqual(expect.arrayContaining(["score", "price_target", "signal", "buy", "size"]));
  });

  it("fails closed when source data is address-only or typed absence", () => {
    const c = composeEarningsExpectationEvidence(source({
      reported: [item("revenue", "$200B", "address_only")],
      facts: [item("capital_expenditure", "50", "typed_absence")],
      guidance: [item("future", "10–20%", "address_only")],
    }));
    expect(c.lanes.slice(0, 2).map((row) => row.status)).toEqual(["SOURCE_NOT_BOUND", "SOURCE_NOT_BOUND"]);
    expect(c.lanes.slice(0, 2).every((row) => row.evidence === null)).toBe(true);
    expect(c.lanes[2].status).toBe("NOT_ADMITTED");
    expect(c.lanes[3].status).toBe("NOT_ADMITTED");
  });

  it("does not turn unstructured company outlook into a numerical guidance estimate", () => {
    const c = composeEarningsExpectationEvidence(source({
      guidance: [item("outlook", "No structured range"), item("fiscal_horizon", "FY2026")],
    }));
    expect(c.lanes[1].status).toBe("SOURCE_NOT_BOUND");
    expect(c.lanes[1].value[0]).toContain("No verified numerical range");
    expect(c.lanes[2].value[0]).toContain("No comparable PIT");
  });

  it("fallback operating facts need byte replay; questions count is not revenue evidence", () => {
    const c = composeEarningsExpectationEvidence(source({
      reported: [],
      facts: [
        item("fact_questions_count", "12"),
        item("gross_margin", "40%"),
      ],
    }));
    expect(c.lanes[0].evidence?.id).toBe("gross_margin");
    const none = composeEarningsExpectationEvidence(source({
      reported: [], facts: [item("fact_questions_count", "12")],
    }));
    expect(none.lanes[0].status).toBe("SOURCE_NOT_BOUND");
  });

  it("always refuses to promote a consensus/reaction completeness claim into a PIT source", () => {
    const c = composeEarningsExpectationEvidence(source({
      honest: {
        questions_count_unavailable: false,
        consensus_unlicensed: false,
        slides_absent: false,
        reaction_not_joined: false,
        no_beat_miss: false,
      },
      guidance: [item("guidance", "12%")],
    }));
    expect(c.lanes[2].status).toBe("NOT_ADMITTED");
    expect(c.lanes[3].status).toBe("NOT_ADMITTED");
  });

  it("renders all four channels on the real read-only presentation component in English and Chinese", () => {
    const english = renderToStaticMarkup(
      <EarningsRepricingEvidence presented={source()} zh={false} />,
    );
    expect(english).toContain('data-ci-repricing-evidence=""');
    expect(english).toContain('data-ci-repricing-lane="consensus"');
    expect(english).toContain('data-ci-repricing-lane="reaction"');
    expect(english).toContain('data-ci-repricing-conclusion="not-established"');
    expect(english).toContain("The evidence does not establish what was priced in");
    expect(english).not.toContain("BUY");
    const chinese = renderToStaticMarkup(
      <EarningsRepricingEvidence presented={source()} zh />,
    );
    expect(chinese).toContain("事前分析师预期");
    expect(chinese).toContain("尚未关联");
  });

  it("never makes unsupported sources into clickable evidence entries", () => {
    const html = renderToStaticMarkup(
      <EarningsRepricingEvidence presented={source({
        reported: [], guidance: [item("narrative", "No structured range")],
      })} zh={false} onChooseEvidence={() => {}} />,
    );
    expect(html).not.toContain("<button");
    expect(html).toContain('data-ci-repricing-status="SOURCE_NOT_BOUND"');
  });

  it.each([
    ["positive range", "3–5%"],
    ["positive point", "3%"],
    ["zero point", "0%"],
    ["negative range", "-3–-1%"],
    ["negative point", "-1%"],
    ["zero-crossing range", "-2–2%"],
    ["negative-to-zero range", "-2–0%"],
    ["signed decimal range", "-0.5–0.5%"],
    ["existing ASCII separator", "3-5%"],
    ["negative ASCII separator", "-3--1%"],
  ])("preserves source-backed %s guidance and its bilingual receipt button", (_name, value) => {
    const guidance = item("guidance:revenue_yoy_pct:0", value);
    const presented = source({ guidance: [guidance] });
    const context = composeEarningsExpectationEvidence(presented);
    const lane = context.lanes.find((row) => row.id === "guidance");
    expect(lane?.status).toBe("SOURCE_BACKED");
    expect(lane?.value).toEqual([value, value]);
    expect(lane?.evidence).toBe(guidance);
    expect(context.repricingInference).toBe("NOT_ESTABLISHED");
    expect(context.historicalConsensusAdmitted).toBe(false);
    expect(context.eventPriceReactionJoined).toBe(false);
    expect(context.authority).toBe("CONTEXT_ONLY_NO_TRADING");
    for (const zh of [false, true]) {
      const html = renderToStaticMarkup(
        <EarningsRepricingEvidence presented={presented} zh={zh}
          onChooseEvidence={() => {}} />,
      );
      expect(html).toContain(value);
      expect(html).toMatch(/<button\b[^>]*data-ci-repricing-lane="guidance"[^>]*>/);
      expect(html).not.toContain(zh ? "暂无核验的数值区间" : "No verified numerical range");
      expect(html).not.toMatch(/<button\b[^>]*data-ci-repricing-lane="(?:consensus|reaction)"[^>]*>/);
    }
  });

  it("does not displace earlier negative guidance with a later positive item", () => {
    const negative = item("guidance:revenue_yoy_pct:0", "-3–-1%");
    const positive = item("guidance:gross_margin_pct:1", "40–42%");
    const context = composeEarningsExpectationEvidence(source({
      guidance: [negative, positive],
    }));
    const lane = context.lanes.find((row) => row.id === "guidance");
    expect(lane?.evidence).toBe(negative);
    expect(lane?.value).toEqual(["-3–-1%", "-3–-1%"]);
  });

  it.each([
    "--3–-1%", "-3–%", "-3–-1%%", "-3–-1% commentary",
    "decline -3–-1%", "-3..5–-1%", "NaN%", "Infinity%",
    "FY2027", "No structured range", "$3–5", "+3–+5%", "−3–−1%",
  ])("keeps malformed or non-producer guidance %s unbound", (value) => {
    const presented = source({
      guidance: [item("guidance:revenue_yoy_pct:0", value)],
    });
    const context = composeEarningsExpectationEvidence(presented);
    const lane = context.lanes.find((row) => row.id === "guidance");
    const html = renderToStaticMarkup(
      <EarningsRepricingEvidence presented={presented} zh={false}
        onChooseEvidence={() => {}} />,
    );
    expect(lane?.status).toBe("SOURCE_NOT_BOUND");
    expect(lane?.evidence).toBeNull();
    expect(lane?.value[0]).toBe("No verified numerical range");
    expect(html).not.toMatch(/<button\b[^>]*data-ci-repricing-lane="guidance"[^>]*>/);
  });

  it.each(["address_only", "typed_absence"] as const)(
    "does not admit signed guidance with a %s receipt", (receipt) => {
      const presented = source({
        guidance: [item("guidance:revenue_yoy_pct:0", "-3–-1%", receipt)],
      });
      const context = composeEarningsExpectationEvidence(presented);
      const lane = context.lanes.find((row) => row.id === "guidance");
      expect(lane?.status).toBe("SOURCE_NOT_BOUND");
      expect(lane?.evidence).toBeNull();
      const html = renderToStaticMarkup(
        <EarningsRepricingEvidence presented={presented} zh={false}
          onChooseEvidence={() => {}} />,
      );
      expect(html).not.toMatch(/<button\b[^>]*data-ci-repricing-lane="guidance"[^>]*>/);
    },
  );
});
