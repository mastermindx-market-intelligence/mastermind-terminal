// @vitest-environment jsdom
/*
 * IntlInvestigationPanel.test.tsx — IM09-T2 presentational selected detail.
 * Contract-directed cases: escaping/whitespace, denied data absent, qualified
 * zero present, missing clocks, unavailable comparison, EN/ZH actions, no ID
 * duplication, callbacks only on explicit click.
 *
 * Requires vitest + @testing-library/react in the parent repo (NOT installed
 * here; package installs are out of scope for this PATCH_ONLY route).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IntlInvestigationPanel,
  type IntlInvestigationPanelProps,
} from "@/components/research/IntlInvestigationPanel";

afterEach(cleanup);

const base: IntlInvestigationPanelProps = {
  lang: "en",
  question: "Is policy divergence widening?",
  marketLabel: "Japan",
  toolLabel: "Central banks & liquidity",
  periodLabel: "1 month",
  basisLabel: "USD",
  selectedMeasures: [
    {
      stableId: "m-policy",
      label: "Policy rate",
      availability: "qualified",
      value: 0.5,
      unit: "%",
      note: "Decision released 09:00 UTC",
      observedAt: "today 09:00 UTC",
    },
    {
      stableId: "m-curve",
      label: "10Y-2Y curve",
      availability: "qualified",
      value: 42,
      unit: "bp",
      note: "Market close",
      observedAt: "25 Sep 2026",
    },
    {
      stableId: "m-liquidity",
      label: "Liquidity proxy",
      availability: "excluded",
      value: 128,
      unit: "bn",
      note: "Observation outside freshness window",
      observedAt: "1 Sep 2026",
    },
  ],
  changedItems: [
    {
      id: "c-1",
      label: "Policy decision",
      kind: "revised",
      note: "A newer qualified decision replaced the saved release.",
    },
    {
      id: "c-2",
      label: "Liquidity proxy",
      kind: "qualification_changed",
      note: "The saved observation is outside the accepted freshness window.",
    },
  ],
  comparisonStatus: "changed",
  savedAt: "2 hours ago",
  updatedAt: "09:10 UTC",
  sourceGenerationAt: "09:05 UTC",
  rightsAt: "07:00 UTC",
  readiness: { state: "incomplete", unmet: ["Comparable policy history", "Expected policy path"] },
  onInspect: vi.fn(),
  onContinue: vi.fn(),
  onEdit: vi.fn(),
};

function renderPanel(overrides: Partial<IntlInvestigationPanelProps> = {}) {
  const props = { ...base, ...overrides };
  // fresh spies per render unless explicitly overridden
  if (!("onInspect" in overrides)) props.onInspect = vi.fn();
  if (!("onContinue" in overrides)) props.onContinue = vi.fn();
  if (!("onEdit" in overrides)) props.onEdit = vi.fn();
  return render(<IntlInvestigationPanel {...props} />);
}

describe("IntlInvestigationPanel", () => {
  it("renders the exact question React-escaped with whitespace intact in the markup", () => {
    const hostile = '  <script>alert("x")</script>\n  line two  ';
    const { container } = renderPanel({ question: hostile });
    const q = container.querySelector("h2");
    expect(q).toBeTruthy();
    expect(q?.textContent).toBe(hostile); // no trimming, no normalization
    expect(container.innerHTML).toContain("&lt;script&gt;"); // escaped, never raw HTML
    expect(container.innerHTML).not.toContain("<script>");
  });

  it("keeps denied values and observation details absent, but the denial itself visible", () => {
    renderPanel({
      selectedMeasures: [
        {
          stableId: "m-denied",
          label: "Restricted series",
          availability: "denied",
          value: 7,
          unit: "%",
          note: "Access to this source is restricted",
          observedAt: "03:00 UTC",
        },
      ],
    });
    expect(screen.getAllByText("Restricted series")).toHaveLength(2);
    expect(screen.getAllByText("Denied")).toHaveLength(2);
    expect(screen.queryByText("7%")).toBeNull(); // no value
    expect(screen.queryByText(/03:00 UTC/)).toBeNull(); // no observation detail
  });

  it("shows selected count independently when zero of the measures qualify (zero is valid)", () => {
    renderPanel({
      selectedMeasures: base.selectedMeasures.map((m) => ({
        ...m,
        availability: "stale" as const,
      })),
    });
    expect(screen.getByText("3 selected")).toBeTruthy();
    expect(screen.getByText("0 qualified")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy(); // rail: qualified big number
    expect(screen.queryByText("0.5%")).toBeNull(); // stale: no numeric value
    expect(screen.queryByText("42 bp")).toBeNull();
  });

  it("shows a qualified value of exactly zero", () => {
    renderPanel({
      selectedMeasures: [
        {
          stableId: "m-zero",
          label: "Policy rate",
          availability: "qualified",
          value: 0,
          unit: "%",
          note: "Decision released",
          observedAt: "09:00 UTC",
        },
      ],
    });
    expect(screen.getByText("0%")).toBeTruthy();
  });

  it("marks absent clocks explicitly unavailable and shows supplied clock strings exactly", () => {
    renderPanel({ savedAt: null, rightsAt: null });
    // two unavailable markers: saved + rights clock rows
    expect(screen.getAllByText("Unavailable").length).toBe(2);
    expect(screen.getByText("09:10 UTC")).toBeTruthy(); // updated (refresh) clock
    expect(screen.getByText("09:05 UTC")).toBeTruthy(); // source generation
    expect(screen.queryByText("2 hours ago")).toBeNull(); // no invented baseline date
  });

  it("renders an explicit unavailable comparison instead of the changed items or a zero-change claim", () => {
    renderPanel({ comparisonStatus: "unavailable" });
    expect(
      screen.getByText(
        "No baseline comparison is available right now. This is not a zero-change result and must not be read as one.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Policy decision")).toBeNull(); // items withheld
    expect(screen.queryByText("2 material evidence changes")).toBeNull();
  });

  it("shows both the changes and the limitation when incomplete with actual changed items", () => {
    renderPanel({ comparisonStatus: "incomplete" });
    expect(screen.getByText("Policy decision")).toBeTruthy();
    expect(screen.getByText(/comparison is still incomplete/i)).toBeTruthy();
    expect(screen.getByText("Comparable policy history")).toBeTruthy(); // unmet requirement
    expect(screen.getByText(/The comparison remains open\./)).toBeTruthy();
  });

  it("renders an unchanged comparison as an explicit no-material-change state", () => {
    renderPanel({ comparisonStatus: "unchanged" });
    expect(screen.getByText("No material changes")).toBeTruthy();
    expect(screen.getByText(/No material evidence changes against the saved baseline\./)).toBeTruthy();
    expect(screen.queryByText("Policy decision")).toBeNull();
  });

  it("keeps the neutral ready headline and never investment confidence", () => {
    renderPanel({ readiness: { state: "ready", unmet: [] } });
    expect(screen.getByText("Declared evidence requirements are satisfied.")).toBeTruthy();
    expect(screen.queryByText(/The comparison remains open\./)).toBeNull();
    expect(screen.getByText(/Coverage is not investment confidence\./)).toBeTruthy();
  });

  it("labels actions in EN and ZH, and disables them when callbacks are absent", () => {
    const { rerender } = renderPanel();
    const enContinue = screen.getByRole("button", { name: /Continue the research/ });
    const enEdit = screen.getByRole("button", { name: /Edit saved question/ });
    expect((enContinue as HTMLButtonElement).disabled).toBe(false);
    expect((enEdit as HTMLButtonElement).disabled).toBe(false);

    rerender(
      <IntlInvestigationPanel
        {...base}
        lang="zh"
        onInspect={undefined}
        onContinue={undefined}
        onEdit={undefined}
      />,
    );
    const zhContinue = screen.getByRole("button", { name: "继续该研究" });
    const zhEdit = screen.getByRole("button", { name: "编辑已保存问题" });
    expect((zhContinue as HTMLButtonElement).disabled).toBe(true);
    expect((zhEdit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("证据时钟")).toBeTruthy();
    expect(screen.getByText("当前研究判读")).toBeTruthy();
  });

  it("emits no id attributes at all (no duplicate-ID risk)", () => {
    const { container } = renderPanel();
    expect(container.querySelectorAll("[id]").length).toBe(0);
  });

  it("fires callbacks only on explicit click, with the measure stable id", () => {
    const onInspect = vi.fn();
    const onContinue = vi.fn();
    const onEdit = vi.fn();
    const { container } = renderPanel({ onInspect, onContinue, onEdit });

    // clicking the panel itself triggers nothing
    fireEvent.click(container.querySelector("section") as HTMLElement);
    expect(onInspect).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {name: /Policy rate/}));
    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(onInspect).toHaveBeenCalledWith("m-policy");

    fireEvent.click(screen.getByRole("button", { name: /Continue the research/ }));
    expect(onContinue).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Edit saved question/ }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
