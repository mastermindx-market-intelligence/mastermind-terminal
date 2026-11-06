// @vitest-environment jsdom
/* Receiver copy-repair regressions for the adopted IM08/09 panel, rendered from
 * real adapter → mapper results (no hand-built props):
 *  1. The kernel emits not_previously_observed only when prior membership was
 *     NOT complete, so the panel may say the measure was not previously
 *     observed — never that the saved baseline lacks it — and it is never an
 *     addition.
 *  2. The incomplete readiness headline makes no successful-refresh claim;
 *     a denied/unavailable current read with an explicit null updatedAt must
 *     not read as "Evidence updated". The owner updatedAt header label is
 *     unchanged. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IntlInvestigationPanel } from "@/components/research/IntlInvestigationPanel";
import {
  composeIntlInvestigationPanel,
  type IntlCompositionOwnerInput,
} from "@/lib/intlInvestigationComposition";
import {
  reviewIntlEvidence,
  type IntlExactContext,
  type IntlOwnerObservation,
  type IntlOwnerResult,
} from "@/lib/intlInvestigationEvidence";

afterEach(cleanup);

const ctx: IntlExactContext = {
  researchMarket: "global-equities",
  toolBindingVersion: "v1",
  periodIdentity: "2024Q4",
  currencyBasis: "USD-constant",
  returnBasis: "total-return",
  owner: "intl.evidence",
  query: "q-capex-share",
  cohort: "pilot-banks",
  temporalPolicy: "point-in-time",
  selectedMeasureIds: ["m1", "m2", "m3"],
};

const obs = (id: string): IntlOwnerObservation => ({
  id,
  availability: "available",
  qualified: true,
  excluded: false,
  correction: false,
  contentIdentity: `cid-${id}`,
  qualificationIdentity: `qid-${id}`,
  interpretation: { value: 10, unit: "%", basis: "USD-constant", cohort: "pilot-banks" },
});

const result = (
  o: Pick<IntlOwnerResult, "generation"> & Partial<Pick<IntlOwnerResult, "read" | "membership">>,
  ids: string[],
): IntlOwnerResult => {
  const { selectedMeasureIds: _selected, ...scope } = ctx;
  return { ...scope, read: "ok", membership: "complete", ...o, observations: ids.map(obs), tombstones: [] };
};

const owner = (lang: "en" | "zh", updatedAt: string | null): IntlCompositionOwnerInput => ({
  lang,
  question: "Where is capex share heading?",
  marketLabel: "Global equities",
  toolLabel: "Intl bindings v1",
  periodLabel: "2024Q4",
  basisLabel: "USD constant · total return",
  savedAt: "2026-10-01T09:00:00Z",
  updatedAt,
  sourceGenerationAt: null,
  rightsAt: null,
  measureLabels: { m1: "Capex share", m2: "Payout ratio", m3: "Net margin" },
  unmetLabels: [],
});

function composed(prior: IntlOwnerResult | null, current: IntlOwnerResult, lang: "en" | "zh", updatedAt: string | null) {
  const r = composeIntlInvestigationPanel({ review: reviewIntlEvidence(prior, current, ctx), owner: owner(lang, updatedAt) });
  if (!r.ok) throw new Error(`composition refused: ${r.reason}`);
  return r.props;
}

const COPY = {
  en: {
    badge: "Not previously observed",
    note: "Not observed in the saved evidence read — prior coverage was incomplete, so this is not proof of absence and not an addition.",
    added: "Added",
    removed: "Removed",
    headline: "The comparison remains open.",
    headerUpdated: "Evidence updated",
  },
  zh: {
    badge: "此前未观察到",
    note: "已保存的证据读取中未观察到该指标——此前覆盖不完整，这既不证明不存在，也不表示新增。",
    added: "新增",
    removed: "已移除",
    headline: "对比仍待完成。",
    headerUpdated: "证据已更新",
  },
} as const;
// Affirmative absence claims a partial prior census cannot support.
const ABSENCE_CLAIM = /Not in saved baseline|Not present in the saved baseline|基线中不存在/;
// Successful-refresh claims. The EN clock-row label "Evidence updated (refresh)"
// is the unchanged owner-clock term (its value renders Unavailable), not a claim.
const REFRESH_CLAIM = { en: /Evidence updated(?! \(refresh\))/, zh: /证据已更新/ } as const;
const OLD_HEADLINE = /Evidence updated\. The comparison is still open\.|证据已更新；对比仍待完成。/;

describe("IntlInvestigationPanel truthful membership and readiness copy", () => {
  for (const lang of ["en", "zh"] as const) {
    it(`${lang} partial prior census renders not-previously-observed, never baseline absence or addition`, () => {
      const priorPage = result({ generation: "g1", membership: "page" }, ["m1"]);
      const current = result({ generation: "g2" }, ["m1", "m2", "m3"]);
      const props = composed(priorPage, current, lang, "2026-10-06T09:00:00Z");
      const rows = (props.evidenceChanges ?? []).filter((c) => c.membership === "not_previously_observed");
      expect(rows.map((c) => c.stableId)).toEqual(["m2", "m3"]);
      expect((props.evidenceChanges ?? []).some((c) => c.membership === "added" || c.membership === "removed")).toBe(false);

      render(<IntlInvestigationPanel {...props} />);
      expect(screen.getAllByText(COPY[lang].badge)).toHaveLength(rows.length);
      expect(screen.getAllByText(COPY[lang].note)).toHaveLength(rows.length);
      expect(screen.queryAllByText(ABSENCE_CLAIM)).toHaveLength(0);
      expect(screen.queryByText(COPY[lang].added)).toBeNull();
      expect(screen.queryByText(COPY[lang].removed)).toBeNull();
    });

    for (const read of ["denied", "unavailable"] as const) {
      it(`${lang} ${read} current read with null updatedAt makes no successful-refresh claim`, () => {
        const prior = result({ generation: "g1" }, ["m1", "m2", "m3"]);
        const props = composed(prior, result({ generation: "g2", read }, []), lang, null);
        expect(props.comparisonStatus).toBe(read);
        expect(props.readiness.state).toBe("incomplete");
        expect(props.updatedAt).toBeNull();

        render(<IntlInvestigationPanel {...props} />);
        expect(screen.getByText(COPY[lang].headline)).toBeTruthy();
        expect(screen.queryAllByText(REFRESH_CLAIM[lang])).toHaveLength(0);
        expect(screen.queryAllByText(OLD_HEADLINE)).toHaveLength(0);
      });
    }

    it(`${lang} explicit owner updatedAt keeps its header label; the incomplete headline stays neutral`, () => {
      const prior = result({ generation: "g1", membership: "page" }, ["m1"]);
      const props = composed(prior, result({ generation: "g2" }, ["m1", "m2", "m3"]), lang, "2026-10-06T09:00:00Z");
      expect(props.readiness.state).toBe("incomplete");

      render(<IntlInvestigationPanel {...props} />);
      expect(screen.getByText(COPY[lang].headerUpdated)).toBeTruthy();
      expect(screen.getByText("2026-10-06T09:00:00Z")).toBeTruthy();
      expect(screen.getByText(COPY[lang].headline)).toBeTruthy();
      expect(screen.queryAllByText(OLD_HEADLINE)).toHaveLength(0);
    });
  }
});
