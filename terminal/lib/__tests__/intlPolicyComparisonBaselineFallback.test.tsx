// @vitest-environment jsdom
/* Receiver repair regression for the adopted IM10 controlled renderer: when the
 * owner supplies no baselineComparison projection, the renderer knows only that
 * a saved-baseline comparison is unavailable. It must not assert that no saved
 * context / no matching saved baseline exists, in either locale or step, and it
 * keeps the selected-dates vs since-saving distinction. Owner-supplied baseline
 * text still renders exactly as given. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntlPolicyComparison, type BaselineComparison, type IntlPolicyComparisonProps } from "@/components/research/IntlPolicyComparison";
import { createPolicyPreviewSession, reviewPolicyDraft, updatePolicyDraft, type PolicySettings } from "@/lib/intlPolicyPreviewSession";

afterEach(cleanup);

const binding = { principal_partition: "p", auth_epoch: "a", saved_id: "s", saved_revision: 1, source_generation: "g", instrument_mapping_identity: "m", qualification_identity: "q" };
const settings: PolicySettings = { economy_a: "JP", economy_b: "US", lens: "nominal_policy_point_gap", definition: "absolute_gap_change_bp", method_version: "test", period: { mode: "fixed_dates", start: "2026-08-31", end: "2026-09-30" }, instrument_a_ref: null, instrument_b_ref: null, revision_policy: "latest_vintage" };
const valid = () => updatePolicyDraft(createPolicyPreviewSession(binding), { ok: true, settings });

const FALLBACK = {
  en: {
    setup: "Saved-baseline comparison is unavailable. Any change shown is across the selected dates, not since saving.",
    review: "Saved-baseline comparison is unavailable; no conclusion about changes since saving is shown.",
  },
  zh: {
    setup: "与已保存基准的对比不可用。所示变化基于所选日期，并非自保存以来。",
    review: "与已保存基准的对比不可用；不显示关于自保存以来变化的结论。",
  },
} as const;
// Affirmative absence claims the missing projection cannot support.
const ABSENCE_CLAIM = /No saved context|No matching saved baseline|无此组合与窗口的已保存情境|无匹配的已保存基准/;

function show(locale: "en" | "zh", step: "setup" | "review", extra: Partial<IntlPolicyComparisonProps> = {}) {
  const state = step === "review" ? reviewPolicyDraft(valid()) : valid();
  return render(<IntlPolicyComparison state={state} step={step} locale={locale} question="q"
    focusEconomyLabel="Japan" draft={{ comparator: "US", mode: "fixed_dates", horizonKey: "", startDate: "2026-08-31", endDate: "2026-09-30" }}
    comparatorOptions={[{ value: "US", label: "United States" }]} horizonOptions={[]} fieldErrors={[]}
    onDraftChange={vi.fn()} onBack={vi.fn()} {...extra} />);
}

describe("IntlPolicyComparison omitted baseline projection", () => {
  for (const locale of ["en", "zh"] as const) {
    it(`${locale} setup states unavailable comparison, not absent saved data`, () => {
      show(locale, "setup");
      expect(screen.getByText(FALLBACK[locale].setup)).toBeTruthy();
      expect(screen.queryAllByText(ABSENCE_CLAIM)).toHaveLength(0);
      expect(screen.queryByText(FALLBACK[locale].review)).toBeNull(); // selected-dates wording stays setup-only
    });

    it(`${locale} review draws no since-saving conclusion and claims no absent baseline`, () => {
      show(locale, "review");
      expect(screen.getByText(FALLBACK[locale].review)).toBeTruthy();
      expect(screen.queryAllByText(ABSENCE_CLAIM)).toHaveLength(0);
      expect(screen.queryByText(FALLBACK[locale].setup)).toBeNull();
    });

    it(`${locale} owner-supplied baseline text renders as supplied in setup and review`, () => {
      const owner: BaselineComparison = { status: "unavailable", statusLabel: `owner status ${locale}`, description: `owner description ${locale}` };
      for (const step of ["setup", "review"] as const) {
        show(locale, step, { baselineComparison: owner });
        expect(screen.getByText(owner.statusLabel)).toBeTruthy();
        expect(screen.getByText(owner.description)).toBeTruthy();
        expect(screen.queryByText(FALLBACK[locale].setup)).toBeNull();
        expect(screen.queryByText(FALLBACK[locale].review)).toBeNull();
        cleanup();
      }
    });
  }
});
