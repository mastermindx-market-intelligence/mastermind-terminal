// @vitest-environment jsdom
/* InvestigationIntlEvidence receiver tests (iw2-intl-native-receiver).
 *
 * The REAL trusted caller, evidence adapter, composition mapper and panel run
 * in every case — no mock replaces any of that logic. The only doubles are
 * the parent-supplied synchronous getter (a vi.fn fixture) and, in one
 * negative control, a read-only PASSTHROUGH spy on the caller seam used to
 * prove the receiver never composes for a wrong selection.
 *
 * Fixtures are ordinary synthetic unit fixtures labelled "synthetic"
 * throughout. They are NOT the producer's actual fixture data and carry no
 * real market values, clocks or owner identities.
 *
 * Coverage per the receiver contract:
 *   1  qualified current, prior null            → real panel, values visible
 *   2  no provider / null / throwing provider   → localized unavailable
 *   3  wrong id / wrong revision                → localized scope_changed,
 *                                                 caller never invoked (spy)
 *   4  all 7 explicit dispositions              → 7 distinct plain-word
 *                                                 screens, no raw enum token
 *   5  owner context mismatch                   → caller scope_changed words,
 *                                                 zero numeric leaks
 *   6  malformed current                        → composed invalid through the
 *                                                 real mapper/panel path
 *   7  changed selection                        → retained A is never shown
 *   8  null projection                          → panel retired
 *   9  A → B → A                                → third render re-reads;
 *                                                 nothing revived from cache
 *  10  missing owner clocks                     → clock rows stay Unavailable
 *  11  denied current read / stale row          → numerics stripped
 *  12  no callbacks / I/O / effects             → every button disabled,
 *                                                 read called once per render
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as intlCaller from "@/lib/intlInvestigationCaller";
import { INTL_CALLER_DISPOSITIONS } from "@/lib/intlInvestigationCaller";
import type { IntlCallerInput } from "@/lib/intlInvestigationCaller";
import type { IntlCompositionOwnerInput } from "@/lib/intlInvestigationComposition";
import type {
  IntlExactContext,
  IntlOwnerObservation,
  IntlOwnerResult,
} from "@/lib/intlInvestigationEvidence";
import {
  INVESTIGATION_INTL_RECEIVER_COPY,
  InvestigationIntlEvidence,
  type InvestigationIntlSelection,
} from "@/components/research/InvestigationIntlEvidence";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ── synthetic unit fixtures (clearly labelled; not producer fixtures) ────── */

const SEL_A: InvestigationIntlSelection = { id: "synthetic-selection-a", revision: 3 };
const SEL_B: InvestigationIntlSelection = { id: "synthetic-selection-b", revision: 3 };
const SEL_A_NEXT: InvestigationIntlSelection = { id: "synthetic-selection-a", revision: 4 };

const CTX: IntlExactContext = {
  researchMarket: "synthetic-market",
  toolBindingVersion: "synthetic-binding",
  periodIdentity: "synthetic-period",
  currencyBasis: "synthetic-currency",
  returnBasis: "synthetic-return",
  owner: "synthetic-owner",
  query: "synthetic-query",
  cohort: "synthetic-cohort",
  temporalPolicy: "synthetic-policy",
  selectedMeasureIds: ["mx", "my"],
};

const VALUE_MX = 41.5;
const VALUE_MY = 8.25;
const VALUE_MX_NEXT = 57.25;

function syntheticObservation(
  id: string,
  value: number,
  overrides: Partial<IntlOwnerObservation> = {},
): IntlOwnerObservation {
  return {
    id,
    availability: "available",
    qualified: true,
    excluded: false,
    correction: false,
    contentIdentity: `synthetic-content-${id}`,
    qualificationIdentity: `synthetic-qualification-${id}`,
    interpretation: { value, unit: "bps", basis: CTX.currencyBasis, cohort: CTX.cohort },
    ...overrides,
  };
}

function syntheticOwnerResult(
  overrides: Partial<IntlOwnerResult> = {},
  contextOverrides: Partial<IntlOwnerResult> = {},
): IntlOwnerResult {
  return {
    researchMarket: CTX.researchMarket,
    toolBindingVersion: CTX.toolBindingVersion,
    periodIdentity: CTX.periodIdentity,
    currencyBasis: CTX.currencyBasis,
    returnBasis: CTX.returnBasis,
    owner: CTX.owner,
    query: CTX.query,
    cohort: CTX.cohort,
    temporalPolicy: CTX.temporalPolicy,
    generation: "synthetic-generation-current",
    read: "ok",
    membership: "complete",
    observations: [syntheticObservation("mx", VALUE_MX), syntheticObservation("my", VALUE_MY)],
    tombstones: [],
    ...contextOverrides,
    ...overrides,
  };
}

function syntheticOwner(
  lang: "en" | "zh",
  overrides: Partial<IntlCompositionOwnerInput> = {},
): IntlCompositionOwnerInput {
  return {
    lang,
    question: "synthetic saved question",
    marketLabel: "Synthetic market",
    toolLabel: "Synthetic binding",
    periodLabel: "Synthetic period",
    basisLabel: "Synthetic basis",
    savedAt: "synthetic-saved-clock",
    updatedAt: "synthetic-updated-clock",
    sourceGenerationAt: "synthetic-source-generation-clock",
    rightsAt: "synthetic-rights-clock",
    measureLabels: { mx: "Measure ex", my: "Measure why" },
    unmetLabels: [],
    observedAtByMeasureId: { mx: "synthetic-observed-clock-mx", my: null },
    ...overrides,
  };
}

function syntheticPacket(
  lang: "en" | "zh",
  overrides: {
    prior?: IntlOwnerResult | null;
    current?: IntlOwnerResult;
    owner?: Partial<IntlCompositionOwnerInput>;
  } = {},
): IntlCallerInput {
  return {
    disposition: "resolved",
    exactContext: CTX,
    prior: overrides.prior ?? null,
    current: overrides.current ?? syntheticOwnerResult(),
    requirements: { requiredMeasureIds: ["mx"], unmetPrerequisites: [] },
    owner: syntheticOwner(lang, overrides.owner),
  };
}

/** Parent-style getter fixture bound to one selection (countable). */
function syntheticRead(
  selection: InvestigationIntlSelection,
  input: IntlCallerInput,
): ReturnType<typeof vi.fn> {
  return vi.fn(() => ({ selection, input }));
}

const PANEL_STATUS = {
  en: {
    unavailable: "Comparison unavailable",
    invalid: "Comparison invalid",
    denied: "Comparison denied",
    incomplete: "Comparison incomplete",
  },
  zh: {
    unavailable: "对比不可用",
    invalid: "对比无效",
    denied: "对比被拒绝",
    incomplete: "对比不完整",
  },
} as const;

const OBSERVED_LINE = {
  en: "Observed synthetic-observed-clock-mx",
  zh: "观察于 synthetic-observed-clock-mx",
} as const;

const UNAVAILABLE_WORD = { en: "Unavailable", zh: "不可用" } as const;

/* ── receiver contract cases ─────────────────────────────────────────────── */

describe("InvestigationIntlEvidence receiver", () => {
  for (const lang of ["en", "zh"] as const) {
    const copy = INVESTIGATION_INTL_RECEIVER_COPY[lang];

    it(`${lang} qualified current with prior null renders the real panel once per render`, () => {
      const read = syntheticRead(SEL_A, syntheticPacket(lang));
      render(<InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />);
      expect(read).toHaveBeenCalledTimes(1);
      expect(screen.getByText("synthetic saved question")).toBeTruthy();
      expect(screen.getByText(PANEL_STATUS[lang].unavailable)).toBeTruthy();
      // Prior null stays missing — the current is never converted to a baseline.
      expect(
        screen.getByText(
          lang === "en"
            ? "No baseline comparison is available right now. This is not a zero-change result and must not be read as one."
            : "当前没有可用的基线对比。这不是零变化结果，也不应被当作零变化解读。",
        ),
      ).toBeTruthy();
      // Qualified rows keep their owner-supplied values and explicit clock.
      expect(screen.getByText(`${VALUE_MX} bps`)).toBeTruthy();
      expect(screen.getByText(`${VALUE_MY} bps`)).toBeTruthy();
      expect(screen.getByText(OBSERVED_LINE[lang])).toBeTruthy();
    });

    it(`${lang} keeps the packet owner's genuine lang and never relabels the panel`, () => {
      const other = lang === "en" ? "zh" : "en";
      const read = syntheticRead(
        SEL_A,
        syntheticPacket(other, { owner: { question: `synthetic question in ${other}` } }),
      );
      const { container } = render(
        <InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />,
      );
      expect(container.querySelector(`section[data-lang="${other}"]`)).toBeTruthy();
      expect(screen.getByText(`synthetic question in ${other}`)).toBeTruthy();
      expect(screen.getByText(PANEL_STATUS[other].unavailable)).toBeTruthy();
      expect(screen.queryByText(PANEL_STATUS[lang].unavailable)).toBeNull();
    });

    it(`${lang} a null read projection shows localized unavailable, read exactly once`, () => {
      const read = vi.fn(() => null);
      render(<InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />);
      expect(read).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status").textContent).toBe(copy.unavailable);
      expect(screen.queryByText("synthetic saved question")).toBeNull();
      expect(/\d/.test(document.body.textContent ?? "")).toBe(false);
    });

    it(`${lang} a throwing read provider is unavailable, called once and never retried`, () => {
      const read = vi.fn(() => {
        throw new Error("synthetic fenced getter failure");
      });
      render(<InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />);
      expect(read).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status").textContent).toBe(copy.unavailable);
      expect(screen.queryByText("synthetic saved question")).toBeNull();
    });

    it(`${lang} a null read provider (nothing wired) shows unavailable without composing`, () => {
      render(<InvestigationIntlEvidence lang={lang} selection={SEL_A} read={null} />);
      expect(screen.getByRole("status").textContent).toBe(copy.unavailable);
      expect(screen.queryByText("synthetic saved question")).toBeNull();
    });

    it(`${lang} wrong revision refuses as scope_changed and never calls the caller seam`, () => {
      // Negative control: read-only passthrough spy proves no composition.
      const callerSpy = vi.spyOn(intlCaller, "resolveIntlInvestigation");
      const read = syntheticRead(SEL_A_NEXT, syntheticPacket(lang));
      render(<InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />);
      expect(read).toHaveBeenCalledTimes(1);
      expect(callerSpy).not.toHaveBeenCalled();
      expect(screen.getByRole("status").textContent).toBe(copy.selectionScopeChanged);
      expect(screen.queryByText("synthetic saved question")).toBeNull();
      expect(/\d/.test(document.body.textContent ?? "")).toBe(false);
    });

    it(`${lang} wrong selection id refuses as scope_changed without composing`, () => {
      const read = syntheticRead(SEL_B, syntheticPacket(lang));
      render(<InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />);
      expect(screen.getByRole("status").textContent).toBe(copy.selectionScopeChanged);
      expect(screen.queryByText("synthetic saved question")).toBeNull();
    });

    it(`${lang} renders all seven explicit caller dispositions as distinct plain words`, () => {
      const seen = new Set<string>();
      for (const disposition of INTL_CALLER_DISPOSITIONS) {
        const { unmount } = render(
          <InvestigationIntlEvidence
            lang={lang}
            selection={SEL_A}
            read={syntheticRead(SEL_A, { disposition })}
          />,
        );
        const text = screen.getByRole("status").textContent ?? "";
        expect(text).toBe(copy.disposition[disposition]);
        seen.add(text);
        // Never a raw enum token (no underscores anywhere on screen).
        expect(document.body.textContent).not.toMatch(/_/);
        expect(screen.queryByText("synthetic saved question")).toBeNull();
        unmount();
      }
      expect(seen.size).toBe(INTL_CALLER_DISPOSITIONS.length);
    });

    it(`${lang} owner context mismatch shows the caller scope_changed words with zero numeric leaks`, () => {
      const current = syntheticOwnerResult({}, { periodIdentity: "synthetic-period-other" });
      const read = syntheticRead(SEL_A, syntheticPacket(lang, { current }));
      render(<InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />);
      expect(screen.getByRole("status").textContent).toBe(copy.disposition.scope_changed);
      expect(document.body.textContent).not.toMatch(String(VALUE_MX));
      expect(document.body.textContent).not.toMatch(String(VALUE_MY));
      expect(screen.queryByText("synthetic saved question")).toBeNull();
    });

    it(`${lang} malformed current composes invalid through the real mapper and hides all numerics`, () => {
      const current = syntheticOwnerResult({
        observations: "synthetic-not-an-array" as unknown as IntlOwnerResult["observations"],
      });
      const read = syntheticRead(SEL_A, syntheticPacket(lang, { current }));
      render(<InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />);
      expect(screen.getByText(PANEL_STATUS[lang].invalid)).toBeTruthy();
      expect(screen.getAllByText(lang === "en" ? "Unknown" : "未知").length).toBeGreaterThanOrEqual(2);
      expect(document.body.textContent).not.toMatch(String(VALUE_MX));
      expect(document.body.textContent).not.toMatch(String(VALUE_MY));
    });

    it(`${lang} a changed selection never shows the retained previous projection`, () => {
      const read = syntheticRead(
        SEL_A,
        syntheticPacket(lang, { owner: { question: "synthetic alpha question" } }),
      );
      const { rerender } = render(
        <InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />,
      );
      expect(screen.getByText("synthetic alpha question")).toBeTruthy();
      rerender(<InvestigationIntlEvidence lang={lang} selection={SEL_B} read={read} />);
      expect(read).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("status").textContent).toBe(copy.selectionScopeChanged);
      expect(screen.queryByText("synthetic alpha question")).toBeNull();
    });

    it(`${lang} a null projection after a resolved render retires the panel`, () => {
      const packet = syntheticPacket(lang);
      let calls = 0;
      const read = vi.fn(() => (calls++ === 0 ? { selection: SEL_A, input: packet } : null));
      const { rerender } = render(
        <InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />,
      );
      expect(screen.getByText("synthetic saved question")).toBeTruthy();
      rerender(<InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />);
      expect(read).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("status").textContent).toBe(copy.unavailable);
      expect(screen.queryByText("synthetic saved question")).toBeNull();
    });

    it(`${lang} missing owner clocks stay explicitly unavailable and are never invented`, () => {
      const read = syntheticRead(
        SEL_A,
        syntheticPacket(lang, {
          owner: {
            savedAt: null,
            updatedAt: null,
            sourceGenerationAt: null,
            rightsAt: null,
            observedAtByMeasureId: { mx: null, my: null },
          },
        }),
      );
      render(<InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />);
      // Refresh header + the four record clock rows stay Unavailable.
      expect(screen.getAllByText(UNAVAILABLE_WORD[lang]).length).toBeGreaterThanOrEqual(5);
      expect(screen.queryByText("synthetic-saved-clock")).toBeNull();
      expect(screen.queryByText("synthetic-observed-clock-mx")).toBeNull();
      expect(screen.getByText(`${VALUE_MX} bps`)).toBeTruthy();
    });

    it(`${lang} a denied current read strips numerics and keeps the comparison denied`, () => {
      const prior = syntheticOwnerResult({ generation: "synthetic-generation-baseline" });
      const current = syntheticOwnerResult({ read: "denied" });
      const read = syntheticRead(SEL_A, syntheticPacket(lang, { prior, current }));
      render(<InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />);
      expect(screen.getByText(PANEL_STATUS[lang].denied)).toBeTruthy();
      expect(screen.getAllByText(lang === "en" ? "Denied" : "无权限").length).toBeGreaterThanOrEqual(2);
      expect(document.body.textContent).not.toMatch(String(VALUE_MX));
      expect(document.body.textContent).not.toMatch(String(VALUE_MY));
    });

    it(`${lang} a stale current row keeps its limitation words and hides the stale numeric`, () => {
      const prior = syntheticOwnerResult({ generation: "synthetic-generation-baseline" });
      const current = syntheticOwnerResult({
        observations: [
          syntheticObservation("mx", VALUE_MX, { availability: "stale" }),
          syntheticObservation("my", VALUE_MY),
        ],
      });
      const read = syntheticRead(SEL_A, syntheticPacket(lang, { prior, current }));
      render(<InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />);
      expect(screen.getByText(PANEL_STATUS[lang].incomplete)).toBeTruthy();
      expect(screen.getAllByText(lang === "en" ? "Stale" : "过期").length).toBeGreaterThanOrEqual(2);
      expect(
        screen.getByText(lang === "en" ? "Numeric comparison unavailable" : "数值对比不可用"),
      ).toBeTruthy();
      expect(screen.getByText(`${VALUE_MY} bps`)).toBeTruthy();
      expect(screen.queryByText(`${VALUE_MX} bps`)).toBeNull();
    });

    it(`${lang} attaches no callbacks and re-reads on every render`, () => {
      const read = syntheticRead(SEL_A, syntheticPacket(lang));
      const { container, rerender } = render(
        <InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />,
      );
      expect(read).toHaveBeenCalledTimes(1);
      const buttons = Array.from(container.querySelectorAll("button"));
      expect(buttons.length).toBeGreaterThanOrEqual(3);
      buttons.forEach((b) => expect(b.hasAttribute("disabled")).toBe(true));
      // No onInspect ⇒ no inspect hint; continue/edit stay present but disabled.
      expect(screen.queryByText(/Inspect/)).toBeNull();
      expect(
        screen.getByText(lang === "en" ? "Continue the research" : "继续该研究"),
      ).toBeTruthy();
      rerender(<InvestigationIntlEvidence lang={lang} selection={SEL_A} read={read} />);
      expect(read).toHaveBeenCalledTimes(2);
    });
  }

  it("A → B → A re-reads A instead of reviving a cached screen", () => {
    const packetA1 = syntheticPacket("en", { owner: { question: "synthetic alpha question" } });
    const packetB = syntheticPacket("en", {
      current: syntheticOwnerResult({ generation: "synthetic-generation-b" }),
      owner: { question: "synthetic beta question" },
    });
    const packetA2 = syntheticPacket("en", {
      current: syntheticOwnerResult({
        generation: "synthetic-generation-a2",
        observations: [syntheticObservation("mx", VALUE_MX_NEXT), syntheticObservation("my", VALUE_MY)],
      }),
      owner: { question: "synthetic alpha question" },
    });
    const projections = [
      { selection: SEL_A, input: packetA1 },
      { selection: SEL_B, input: packetB },
      { selection: SEL_A, input: packetA2 },
    ];
    let calls = 0;
    const read = vi.fn(() => projections[calls++] ?? null);
    const { rerender } = render(<InvestigationIntlEvidence lang="en" selection={SEL_A} read={read} />);
    expect(screen.getByText("synthetic alpha question")).toBeTruthy();
    expect(screen.getByText(`${VALUE_MX} bps`)).toBeTruthy();
    rerender(<InvestigationIntlEvidence lang="en" selection={SEL_B} read={read} />);
    expect(screen.getByText("synthetic beta question")).toBeTruthy();
    rerender(<InvestigationIntlEvidence lang="en" selection={SEL_A} read={read} />);
    expect(read).toHaveBeenCalledTimes(3);
    expect(screen.getByText("synthetic alpha question")).toBeTruthy();
    // The fresh read's new value is shown; the first A screen was not revived.
    expect(screen.getByText(`${VALUE_MX_NEXT} bps`)).toBeTruthy();
    expect(screen.queryByText(`${VALUE_MX} bps`)).toBeNull();
  });
});
