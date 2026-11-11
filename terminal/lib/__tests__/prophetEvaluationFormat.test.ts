import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  comparatorShortName, evaluationLevelLabel, exclusionReasonLabel, criterionLabel, fillTemplate,
  getEvaluationStr, makeEvaluationT,
} from "@/lib/prophetEvaluationStrings";
import {
  fmtCi95, fmtCount, fmtCriterionObserved, fmtP, fmtPercent, fmtRatio, fmtSignedPercent, fmtSignedPp,
} from "@/lib/prophetBetaEvaluationFormat";
import { decodeBetaEvaluation, findComparator, INCUMBENT_COMPARATOR_ID } from "@/lib/prophetBetaEvaluation";

describe("display formatters (formatting only — no recomputation)", () => {
  // Synthetic inputs throughout: these tests pin the FORMATTING CONTRACT, not
  // any artifact's numbers — the committed fixture is covered wire-driven in
  // the block at the bottom.
  it("renders fractions as signed/unsigned percents and points with ASCII hyphens", () => {
    expect(fmtSignedPercent(0.01034)).toBe("+1.0%");
    expect(fmtSignedPercent(-0.04621)).toBe("-4.6%");
    expect(fmtPercent(0.34123)).toBe("34.1%");
    expect(fmtSignedPp(0.0563)).toBe("+5.6 pp");
    expect(fmtSignedPp(-0.02711)).toBe("-2.7 pp");
    expect(fmtRatio(0.80912)).toBe("0.81");
    expect(fmtRatio(1.1344)).toBe("1.13");
    expect(fmtCount(512)).toBe("512");
  });

  it("collapses negative zero and keeps intervals ordered as published", () => {
    expect(fmtSignedPp(-0)).toBe("0.0 pp");
    expect(fmtSignedPercent(-0)).toBe("0.0%");
    expect(fmtCi95(-0.104, 0.231, "pp")).toBe("[-10.4, +23.1] pp");
    expect(fmtCi95(0.58, 1.09, "x", 2)).toBe("[0.58, 1.09]");
    expect(fmtCi95(0.3142, 0.5704, "%")).toBe("[+31.4%, +57.0%]");
    expect(fmtP(0.5847)).toBe("0.585");
    expect(fmtP(1)).toBe("1.00");
  });

  it("never emits a unicode minus sign (Playwright text-match safety)", () => {
    for (const out of [fmtSignedPercent(-0.0462), fmtSignedPp(-0.0062), fmtCi95(-0.052, -0.0001, "pp")]) {
      expect(out).not.toMatch(/[−–—]/);
      expect(out).toContain("-");
    }
  });

  it("classifies criterion observed values by the criterion's own id", () => {
    // Criterion ids are the contract's closed set; the values are synthetic.
    expect(fmtCriterionObserved("beta_point_in", 0.6214)).toBe("0.62");
    expect(fmtCriterionObserved("noninferior_at_2x_costs_point", 0.2047)).toBe("0.20");
    expect(fmtCriterionObserved("K3_ann_diff_point", -0.0413)).toBe("-0.04");
    expect(fmtCriterionObserved("K7_ann_diff_point", 0.4216)).toBe("0.42");
    // p-values keep decimals; counts and drawdowns keep their own units.
    expect(fmtCriterionObserved("K3_holm_p", 1)).toBe("1.00");
    expect(fmtCriterionObserved("resolved_positions", 318)).toBe("318");
    expect(fmtCriterionObserved("window_sessions", 58)).toBe("58");
    expect(fmtCriterionObserved("spy_drawdown_present", -0.0613)).toBe("-6.1%");
    // Null stays unobserved, never 0; verbatim strings ride through.
    expect(fmtCriterionObserved("future_check", null)).toBe("—");
    expect(fmtCriterionObserved("future_check", "band")).toBe("band");
  });
});

describe("the committed fixture formats end-to-end (wire-driven, no value pins)", () => {
  const decoded = decodeBetaEvaluation(
    JSON.parse(readFileSync(path.join(process.cwd(), "public/data/prophet_beta_evaluation_fixture.json"), "utf8")),
  );

  it("decodes, and every criterion observed value renders as text", () => {
    expect(decoded).not.toBeNull();
    const everyCriterion = [
      ...decoded!.release.jobs.flatMap(job => job.criteria),
      ...decoded!.release.globalMinimumForL1,
      ...decoded!.release.l0SourceChecks,
    ];
    expect(everyCriterion.length).toBeGreaterThan(0);
    for (const c of everyCriterion) {
      const out = fmtCriterionObserved(c.criterion, c.observed);
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it("keeps the incumbent row's published figures renderable in every unit", () => {
    const c6 = findComparator(decoded!.comparators, INCUMBENT_COMPARATOR_ID)!;
    expect(c6.status).toBe("evaluated");
    if (c6.totalNetReturn !== null) expect(fmtSignedPercent(c6.totalNetReturn)).toMatch(/^[+-]?\d/);
    if (c6.vsSpy && c6.vsSpy.totalDiff !== null && c6.vsSpy.totalDiffCi95) {
      const ci = fmtCi95(c6.vsSpy.totalDiffCi95[0], c6.vsSpy.totalDiffCi95[1], "pp");
      expect(ci).toMatch(/^\[-?\d/);
    }
    expect(decoded!.headline.every(s => typeof s === "string" && s.length > 0)).toBe(true);
    expect(decoded!.limitations.every(s => typeof s === "string" && s.length > 0)).toBe(true);
  });
});

describe("the evaluation lexicon", () => {
  it("gives every key both EN and ZH", () => {
    const probe: Array<Parameters<typeof getEvaluationStr>[1]> = [
      "pageTitle", "verdictTitle", "unavailableTitle", "disclosureCoverage", "levelL0", "cmpC6", "reason_recorded_no_entry",
      "notDistinguishableSentence", "intervalExcludesZeroNote",
    ];
    for (const key of probe) {
      const en = getEvaluationStr("en", key), zh = getEvaluationStr("zh", key);
      expect(en.length).toBeGreaterThan(0);
      expect(zh.length).toBeGreaterThan(0);
      expect(en).not.toEqual(zh);
    }
  });

  it("interpolates placeholders and leaves unknown placeholders intact", () => {
    expect(fillTemplate("{a} of {b}", { a: "269", b: "510" })).toBe("269 of 510");
    expect(fillTemplate("{a} {unknown}", { a: "x" })).toBe("x {unknown}");
  });

  it("labels known comparators and falls back to the artifact's own label for future ids", () => {
    expect(comparatorShortName("en", "C6_exact_incumbent_prophet", "wire label")).toBe("Prophet book (as built)");
    expect(comparatorShortName("zh", "C6_exact_incumbent_prophet", "wire label")).toContain("Prophet");
    expect(comparatorShortName("en", "X6_exposure_matched_reference", "wire label")).toContain("Exposure-weight reference");
    expect(comparatorShortName("zh", "X6_exposure_matched_reference", "wire label")).toContain("敞口加权参考");
    expect(comparatorShortName("en", "C9_future_book", "Wire Label")).toBe("Wire Label");
  });

  it("labels release levels, with unknown future levels rendered as their own id", () => {
    expect(evaluationLevelLabel("en", "L0_descriptive")).toContain("not validated");
    expect(evaluationLevelLabel("zh", "L0_descriptive")).toContain("未经验证");
    expect(evaluationLevelLabel("en", "L4_unknown")).toBe("L4_unknown");
  });

  it("labels the contract's closed exclusion-reason set; unknown slugs render verbatim", () => {
    expect(exclusionReasonLabel("en", "resolved_at_or_before_follower_fill")).toContain("Closed before");
    expect(exclusionReasonLabel("zh", "not_entered_zone_live")).toContain("入场区间");
    expect(exclusionReasonLabel("en", "new_future_reason")).toBe("new_future_reason");
  });

  it("labels release criteria; unknown criterion ids render as the wire id", () => {
    expect(criterionLabel("en", "beta_point_in")).toBe("Beta point estimate in band");
    expect(criterionLabel("zh", "mean_invested")).toContain("投入");
    expect(criterionLabel("en", "future_check")).toBe("future_check");
  });

  it("the honesty tag rides at headline size in both languages", () => {
    expect(makeEvaluationT("en")("notValidatedTag")).toBe("Descriptive · not validated");
    expect(makeEvaluationT("zh")("notValidatedTag")).toBe("描述性 · 未经验证");
  });

  it("never claims member selection lacks value — only that value is not shown", () => {
    // CEO ruling on the exposure-matched reference: "has not been shown", never "no value".
    for (const key of ["cmpX6", "verdictClaimSentence"] as const) {
      for (const lang of ["en", "zh"] as const) {
        const text = getEvaluationStr(lang, key);
        expect(text).not.toMatch(/no value|没有价值|无价值/);
      }
      expect(getEvaluationStr("en", "verdictClaimSentence")).toContain("not established");
    }
  });
});
