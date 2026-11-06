// @vitest-environment jsdom
/*
 * panel_contract_repair.test.tsx — IM09 contract-repair rendering checks
 * (im08-im09-contract-repair-r2).
 *
 * Asserts the EXACT bilingual rendered status/reason strings for the three
 * un-collapsed failure statuses (denied / invalid / scope_changed), the two new
 * availability literals (not_qualified / not_applicable), the lossless
 * evidence-change rows (concurrent dimension chips, exact numeric
 * prior/current/delta with unit, exact non-comparable reasons, not-observed
 * disclaimers) and value/clock suppression.
 *
 * NOT executed in this capsule: react/react-dom/vitest/@testing-library are
 * absent here and installs are out of scope. The parent executes this file
 * with the repo's isolated deps (same runner the frozen IM09 panel tests use).
 */

import { cleanup, fireEvent, render as renderReact, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IntlInvestigationPanel,
  type IntlEvidenceChange,
  type IntlInvestigationPanelProps,
} from "@/components/research/IntlInvestigationPanel";

afterEach(cleanup);

// Parent harness repair: all original cases pass props, so mount the panel.
function render(props: IntlInvestigationPanelProps) {
  return renderReact(<IntlInvestigationPanel {...props} />);
}

/* ── fixtures ────────────────────────────────────────────────────────────── */

function baseProps(overrides: Partial<IntlInvestigationPanelProps> = {}): IntlInvestigationPanelProps {
  return {
    lang: "en",
    question: "Where is capex share heading?",
    marketLabel: "Global equities",
    toolLabel: "Intl bindings v1",
    periodLabel: "2024Q4",
    basisLabel: "USD constant · total return",
    selectedMeasures: [
      {
        stableId: "m1",
        label: "Capex share",
        availability: "qualified",
        value: 11,
        unit: "%",
        note: "",
        observedAt: "06 Oct 2026",
      },
      {
        stableId: "m2",
        label: "Payout ratio",
        availability: "not_qualified",
        value: null,
        unit: null,
        note: "Read succeeded, but this measure is not qualified evidence; no value is shown.",
        observedAt: null,
      },
      {
        stableId: "m3",
        label: "Net margin",
        availability: "denied",
        value: null,
        unit: null,
        note: "No rights were granted for this measure; no value is shown.",
        observedAt: null,
      },
    ],
    changedItems: [],
    comparisonStatus: "changed",
    savedAt: "2026-10-01 09:00 UTC",
    updatedAt: "2026-10-06 09:00 UTC",
    sourceGenerationAt: "2026-10-06 08:55 UTC",
    rightsAt: null,
    readiness: { state: "incomplete", unmet: [] },
    ...overrides,
  };
}

/** One concurrent-dimension row: revised + numeric + qualification changed. */
const CONCURRENT_ROW: IntlEvidenceChange = {
  stableId: "m1",
  label: "Capex share",
  membership: "present",
  version: "revised",
  qualification: "changed",
  availability: "available",
  correction: false,
  excluded: false,
  numeric: { prior: 10, current: 11, delta: 1, unit: "%" },
  nonComparableReason: null,
};

/* ── R3: exact failure statuses and reasons, EN and ZH ──────────────────── */

describe("contract repair R3 — failure statuses keep their exact visible reason", () => {
  it("renders the denied status and its fixed EN reason verbatim", () => {
    render(baseProps({ comparisonStatus: "denied", evidenceChanges: [] }));
    expect(screen.getByText("Comparison denied")).toBeTruthy();
    expect(
      screen.getByText(
        "The evidence read was denied, so no baseline comparison could be made. This is not a zero-change result and must not be read as one.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Not yet compared")).toBeNull();
    expect(screen.queryByText("No material changes")).toBeNull();
  });

  it("renders the denied status and its fixed ZH reason verbatim", () => {
    render(
      baseProps({
        lang: "zh",
        comparisonStatus: "denied",
        evidenceChanges: [],
      }),
    );
    expect(screen.getByText("对比被拒绝")).toBeTruthy();
    expect(
      screen.getByText(
        "证据读取被拒绝，因此无法进行基线对比。这不是零变化结果，也不应被当作零变化解读。",
      ),
    ).toBeTruthy();
  });

  it("renders the invalid status and its fixed EN reason verbatim", () => {
    render(baseProps({ comparisonStatus: "invalid", evidenceChanges: [] }));
    expect(screen.getByText("Comparison invalid")).toBeTruthy();
    expect(
      screen.getByText(
        "The comparison inputs were invalid, so nothing was compared. This is not a zero-change result and must not be read as one.",
      ),
    ).toBeTruthy();
  });

  it("renders the scope_changed status and its fixed EN reason verbatim", () => {
    render(baseProps({ comparisonStatus: "scope_changed", evidenceChanges: [] }));
    expect(screen.getByText("Comparison scope changed")).toBeTruthy();
    expect(
      screen.getByText(
        "The current evidence was read under a different scope than the saved baseline, so the two cannot be compared. This is not a zero-change result and must not be read as one.",
      ),
    ).toBeTruthy();
  });

  it("keeps unavailable and unchecked distinct from the three failure statuses", () => {
    const { unmount } = render(baseProps({ comparisonStatus: "unavailable", evidenceChanges: [] }));
    expect(screen.getByText("Comparison unavailable")).toBeTruthy();
    expect(
      screen.getByText(
        "No baseline comparison is available right now. This is not a zero-change result and must not be read as one.",
      ),
    ).toBeTruthy();
    unmount();

    render(baseProps({ comparisonStatus: "unchecked", evidenceChanges: [] }));
    expect(screen.getByText("Not yet compared")).toBeTruthy();
    expect(
      screen.getByText("Current evidence has not yet been compared with the saved baseline."),
    ).toBeTruthy();
  });
});

/* ── R3: new availability literals and finite zero ─────────────────────── */

describe("contract repair R3 — availability literals and finite zero", () => {
  it("renders not_qualified, not_applicable and denied as distinct labels (EN)", () => {
    render(
      baseProps({
        selectedMeasures: [
          { stableId: "m1", label: "Capex share", availability: "not_qualified", value: null, unit: null, note: "n", observedAt: null },
          { stableId: "m2", label: "Payout ratio", availability: "not_applicable", value: null, unit: null, note: "n", observedAt: null },
          { stableId: "m3", label: "Net margin", availability: "unknown", value: null, unit: null, note: "n", observedAt: null },
        ],
      }),
    );
    expect(screen.getAllByText("Not qualified").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not applicable").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  });

  it("renders the ZH availability literals", () => {
    render(
      baseProps({
        lang: "zh",
        selectedMeasures: [
          { stableId: "m1", label: "资本开支占比", availability: "not_qualified", value: null, unit: null, note: "n", observedAt: null },
          { stableId: "m2", label: "派息率", availability: "not_applicable", value: null, unit: null, note: "n", observedAt: null },
        ],
      }),
    );
    expect(screen.getAllByText("不合格").length).toBeGreaterThan(0);
    expect(screen.getAllByText("不适用").length).toBeGreaterThan(0);
  });

  it("keeps a finite qualified zero visible (EN chips and health state)", () => {
    render(
      baseProps({
        selectedMeasures: [
          { stableId: "m1", label: "Capex share", availability: "not_qualified", value: null, unit: null, note: "n", observedAt: null },
          { stableId: "m2", label: "Payout ratio", availability: "denied", value: null, unit: null, note: "n", observedAt: null },
          { stableId: "m3", label: "Net margin", availability: "unknown", value: null, unit: null, note: "n", observedAt: null },
        ],
      }),
    );
    expect(screen.getByText("3 selected")).toBeTruthy();
    expect(screen.getByText("0 qualified")).toBeTruthy();
    expect(screen.getByText("None qualified")).toBeTruthy();
  });

  it("keeps a finite qualified zero visible (ZH chips and health state)", () => {
    render(
      baseProps({
        lang: "zh",
        selectedMeasures: [
          { stableId: "m1", label: "资本开支占比", availability: "not_qualified", value: null, unit: null, note: "n", observedAt: null },
        ],
      }),
    );
    expect(screen.getByText("已选 1 项")).toBeTruthy();
    expect(screen.getByText("0 项合格")).toBeTruthy();
    expect(screen.getByText("暂无合格")).toBeTruthy();
  });
});

/* ── R4: lossless evidence rows ─────────────────────────────────────────── */

describe("contract repair R4 — one evidence row per measure with every dimension", () => {
  it("renders concurrent revision + numeric + qualification dimensions on one row (EN)", () => {
    render(
      baseProps({
        evidenceChanges: [CONCURRENT_ROW],
      }),
    );
    expect(screen.getByText("Revised")).toBeTruthy();
    expect(screen.getByText("Qualification changed")).toBeTruthy();
    expect(screen.getByText("Value changed")).toBeTruthy();
    expect(screen.getByText("10% → 11% (Δ +1%)")).toBeTruthy();
    // One evidence row for the measure (measure list + health rail + evidence
    // row), never one rendered row per dimension.
    expect(screen.getAllByText("Capex share").length).toBe(3);
  });

  it("renders the same concurrent row in ZH with full-width delta punctuation", () => {
    render(
      baseProps({
        lang: "zh",
        evidenceChanges: [CONCURRENT_ROW],
      }),
    );
    expect(screen.getByText("已修订")).toBeTruthy();
    expect(screen.getByText("资格变化")).toBeTruthy();
    expect(screen.getByText("数值变化")).toBeTruthy();
    expect(screen.getByText("10% → 11%（Δ +1%）")).toBeTruthy();
  });

  it("does not pretend a numeric-only change is revised (version renders 'unchanged')", () => {
    render(
      baseProps({
        evidenceChanges: [
          {
            ...CONCURRENT_ROW,
            version: "unchanged",
            qualification: "unchanged",
            numeric: { prior: 10, current: 12, delta: 2, unit: "%" },
          },
        ],
      }),
    );
    expect(screen.getByText("Content unchanged")).toBeTruthy();
    expect(screen.getByText("Qualification unchanged")).toBeTruthy();
    expect(screen.getByText("Value changed")).toBeTruthy();
    expect(screen.getByText("10% → 12% (Δ +2%)")).toBeTruthy();
    expect(screen.queryByText("Revised")).toBeNull();
  });

  it("renders not_observed with its never-a-removal disclaimer, never 'Removed'", () => {
    render(
      baseProps({
        comparisonStatus: "incomplete",
        evidenceChanges: [
          {
            ...CONCURRENT_ROW,
            membership: "not_observed",
            version: "unknown",
            qualification: "unknown",
            numeric: null,
            nonComparableReason: "unavailable",
          },
        ],
      }),
    );
    expect(screen.getByText("Not observed now")).toBeTruthy();
    expect(screen.getByText("Version unknown")).toBeTruthy();
    expect(screen.getByText("Qualification unknown")).toBeTruthy();
    expect(
      screen.getByText("Not observed in the current evidence read — this is not a removal."),
    ).toBeTruthy();
    expect(screen.queryByText("Removed")).toBeNull();
    // Incomplete keeps the limitation note alongside the rows.
    expect(
      screen.getByText(
        "These changes do not cover the full saved baseline — the comparison is still incomplete.",
      ),
    ).toBeTruthy();
  });

  it("renders not_previously_observed with its never-an-addition disclaimer", () => {
    render(
      baseProps({
        comparisonStatus: "incomplete",
        evidenceChanges: [
          {
            ...CONCURRENT_ROW,
            membership: "not_previously_observed",
            version: "initial",
            numeric: null,
            nonComparableReason: "unavailable",
          },
        ],
      }),
    );
    expect(screen.getByText("Not previously observed")).toBeTruthy();
    expect(screen.getByText("Initial")).toBeTruthy();
    expect(
      screen.getByText(
        "Not observed in the saved evidence read — prior coverage was incomplete, so this is not proof of absence and not an addition.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Added")).toBeNull();
  });

  it("renders the exact non-comparable reason for a present row", () => {
    render(
      baseProps({
        evidenceChanges: [
          {
            ...CONCURRENT_ROW,
            numeric: null,
            nonComparableReason: "incompatible",
          },
        ],
      }),
    );
    expect(
      screen.getByText("Numeric comparison incompatible — unit, basis or cohort differ"),
    ).toBeTruthy();
  });

  it("renders correction and exclusion dimension chips", () => {
    render(
      baseProps({
        evidenceChanges: [
          { ...CONCURRENT_ROW, correction: true, excluded: true },
        ],
      }),
    );
    expect(screen.getByText("Correction")).toBeTruthy();
    expect(screen.getAllByText("Excluded").length).toBeGreaterThan(0);
  });

  it("renders a comparable delta of exactly zero without a Value changed chip", () => {
    render(
      baseProps({
        evidenceChanges: [
          { ...CONCURRENT_ROW, numeric: { prior: 10, current: 10, delta: 0, unit: "%" } },
        ],
      }),
    );
    expect(screen.getByText("10% → 10% (Δ 0%)")).toBeTruthy();
    expect(screen.queryByText("Value changed")).toBeNull();
  });

  it("falls back to the legacy per-dimension changedItems list when evidenceChanges is absent", () => {
    render(
      baseProps({
        evidenceChanges: undefined,
        changedItems: [
          { id: "m1::version.revised", label: "Capex share", kind: "revised", note: "Saved-baseline content identity changed for this measure." },
        ],
      }),
    );
    expect(screen.getByText("Revised")).toBeTruthy();
    expect(
      screen.getByText("Saved-baseline content identity changed for this measure."),
    ).toBeTruthy();
  });
});

/* ── R5: suppression and clocks ─────────────────────────────────────────── */

describe("contract repair R5 — suppression and explicit clocks", () => {
  it("shows no value, unit or observation for a denied row even if one is supplied", () => {
    render(
      baseProps({
        selectedMeasures: [
          {
            stableId: "m3",
            label: "Net margin",
            availability: "denied",
            value: 42,
            unit: "%",
            note: "No rights were granted for this measure; no value is shown.",
            // The mapper suppresses clocks for denied rows; the panel's own
            // visibility gate must hide it even if a caller forgets.
            observedAt: "06 Oct 2026",
          },
        ],
      }),
    );
    expect(screen.queryByText("42%")).toBeNull();
    expect(screen.queryByText(/Observed /)).toBeNull();
    expect(screen.getAllByText("Denied").length).toBeGreaterThan(0);
  });

  it("renders the observation clock only on the qualified row that shows a value", () => {
    render(baseProps());
    expect(screen.getByText("Observed 06 Oct 2026")).toBeTruthy();
  });

  it("renders an explicit unavailable marker for a null record clock", () => {
    render(baseProps());
    const clocks = screen.getByText("Rights check").closest("dl")!;
    const rightsValue = within(clocks).getByText("Unavailable");
    expect(rightsValue).toBeTruthy();
    expect(within(clocks).getByText("2026-10-01 09:00 UTC")).toBeTruthy();
    expect(within(clocks).getByText("2026-10-06 09:00 UTC")).toBeTruthy();
  });
});

/* ── R6: callbacks only on deliberate interaction ───────────────────────── */

describe("contract repair R6 — deliberate callbacks only", () => {
  it("invokes nothing on render", () => {
    const onInspect = vi.fn();
    const onContinue = vi.fn();
    const onEdit = vi.fn();
    render(baseProps({ onInspect, onContinue, onEdit }));
    expect(onInspect).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("invokes onInspect with the stable id only on a deliberate row click", () => {
    const onInspect = vi.fn();
    render(baseProps({ onInspect }));
    const measureButton = screen
      .getAllByText("Capex share")
      .map((el) => el.closest("button"))
      .find((btn) => btn !== null)!;
    fireEvent.click(measureButton);
    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(onInspect).toHaveBeenCalledWith("m1");
  });

  it("invokes onContinue and onEdit only on their buttons", () => {
    const onContinue = vi.fn();
    const onEdit = vi.fn();
    render(baseProps({ onContinue, onEdit }));
    fireEvent.click(screen.getByText("Continue the research"));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Edit saved question"));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
