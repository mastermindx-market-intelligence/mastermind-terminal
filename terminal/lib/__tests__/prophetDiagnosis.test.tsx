// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DiagnosisSection, DiagnosisUnavailable } from "@/components/prophet/evaluation/DiagnosisSection";
import { decodeBetaEvaluation } from "@/lib/prophetBetaEvaluation";
import { getEvaluationStr, humanizeEngineText } from "@/lib/prophetEvaluationStrings";

const raw = JSON.parse(readFileSync("public/data/prophet_beta_evaluation_fixture.json", "utf8"));
const data = decodeBetaEvaluation(raw)!;

describe("diagnosis disclosure and unavailable contract", () => {
  it("keeps the exact identity inside the audit only, preserving the engine reading", () => {
    const markup = renderToStaticMarkup(createElement(DiagnosisSection, { data, lang: "en" }));
    const doc = new DOMParser().parseFromString(markup, "text/html");
    const identity = humanizeEngineText(data.eventStudy.memberBenchmark!.decompositionIdentity!);
    expect(doc.querySelector('[data-testid="pev-audit"]')!.textContent).toContain(identity);
    expect(doc.querySelector('[data-testid="pev-decomposition-identity"]')!.closest("details")!.dataset.testid).toBe("pev-audit");
    expect(doc.querySelector('[data-testid="pev-diagnosis"]')!.textContent).toContain("The engine's own words");
    const withoutAudit = renderToStaticMarkup(createElement(DiagnosisSection, {
      data: { ...data, independentAudit: null }, lang: "en",
    }));
    expect(withoutAudit).not.toContain("pev-decomposition-identity");
    expect(new DOMParser().parseFromString(withoutAudit, "text/html").body.textContent).not.toContain(identity);
  });

  for (const lang of ["en", "zh"] as const) {
    it(`renders an honest ${lang} unavailable card for a valid v1 artifact`, () => {
      const v1 = structuredClone(raw);
      delete v1.event_study.member_benchmark;
      delete v1.sensitivity.off_index_picks;
      delete v1.independent_audit;
      const decoded = decodeBetaEvaluation(v1);
      expect(decoded).not.toBeNull();
      const markup = renderToStaticMarkup(createElement(DiagnosisSection, { data: decoded!, lang }));
      expect(markup).toContain(getEvaluationStr(lang, "diagnosisUnavailable"));
      expect(markup).not.toContain("<svg");
      expect(markup).toBe(renderToStaticMarkup(createElement(DiagnosisUnavailable, { lang })));
    });
  }
});
