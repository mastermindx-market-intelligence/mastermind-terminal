import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrecisionEntryStrip from "@/components/PrecisionEntryStrip";
import { buildPrecisionPlan } from "@/lib/precisionEntry";
import { TF_CANONICAL_ORDER } from "@/lib/startTf";

const ALL = new Set(TF_CANONICAL_ORDER);

function swingPlan() {
  return buildPrecisionPlan({ horizon: "swing", functional: ALL });
}

describe("PrecisionEntryStrip", () => {
  it("renders the four semantic roles from canonical intel without inventing a composite score", () => {
    const html = renderToStaticMarkup(createElement(PrecisionEntryStrip, {
      plan: swingPlan(),
      lang: "en",
      intel: {
        schema: "intel/v1",
        asof: "2026-09-23",
        analysis: {
          entry: {
            headline: "Awaiting confluence",
            confidence: 72.4,
            next_trigger: "2D MACD cross with 3D confirmation",
            buy_zone: [181.2, 185.4],
            chase_above: 189.0,
            stop: 176.8,
          },
          confluence: {
            tier: "T3",
            bars_to_cross: 1.4,
            provisional: true,
            htf_s1: true,
          },
          sniper: {
            w2_washout: true,
            w2_stoch_d: 22.4,
            days_since_63d_low: 5,
            coiled: true,
          },
        },
      },
    }));

    expect(html).toContain('data-testid="precision-entry-strip"');
    expect(html).toContain('data-horizon="swing"');
    expect(html).toContain('data-source="horizon_default"');
    for (const role of ["execution", "trigger", "durability", "structure"]) {
      expect(html).toContain(`data-role="${role}"`);
    }
    for (const tf of ["4h", "2D", "3D", "2W"]) {
      expect(html).toContain(`>${tf}<`);
    }

    expect(html).toContain("Awaiting confluence");
    expect(html).toContain("T3 · ≈ 1.4 bars · Provisional");
    expect(html).toContain("72/100");
    expect(html).toContain("Bottom confidence · durability, not return");
    expect(html).toContain("Higher-TF confirm");
    expect(html).toContain("2W washout");
    expect(html).toContain("Coiled");
    expect(html).not.toContain("Precision score");
  });

  it("renders unknown markers when intel is missing instead of asserting no setup", () => {
    const html = renderToStaticMarkup(createElement(PrecisionEntryStrip, {
      plan: swingPlan(),
      lang: "en",
      intel: null,
    }));

    expect(html).toContain("PRECISION MTF");
    expect(html).toContain("Swing · Preset");
    expect(html.match(/>—</g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain("No signal");
    expect(html).not.toContain("No setup");
    expect(html).not.toContain("0/100");
  });
});
