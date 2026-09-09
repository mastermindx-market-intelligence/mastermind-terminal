// @vitest-environment jsdom
//
// Rendered-UI coverage for the portfolio targets readout (packet B-F08-B5-1), added for the
// round-2 seat rulings on PR #552: R1 (the section must stay mounted when a closed holding still
// carries a target), R3 (an emptied input never saves; the debounce timer is cleared on unmount
// and after Clear), R6 (b) the orphaned band carries its unit, and R6 (d) "Saved" never shows
// after a Clear.
//
// Mounts the real component through react-dom/client — this repo has no @testing-library, and the
// ThesisWorkspaceLensRail / SectionAlertDelivery suites established the direct-mount idiom. No
// network: the save/clear callbacks are plain spies. This file does not shell out to git.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PortfolioTargetsReadout } from "@/components/PortfolioView";
import {
  computePortfolioTargets,
  type Lang,
  type PortfolioTarget,
  type PortfolioTargetsSummary,
} from "@/lib/portfolioTargets";
import type { RiskInputPosition } from "@/lib/portfolioRisk";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pos = (
  ticker: string,
  shares: number | null,
  entryPrice: number | null,
  status: "open" | "closed" = "open",
): RiskInputPosition => ({ ticker, shares, entryPrice, status });

const tgt = (ticker: string, targetWeightPct: number, bandPct = 5): PortfolioTarget => ({
  ticker, targetWeightPct, bandPct, updatedAt: null,
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(
  summary: PortfolioTargetsSummary,
  handlers: {
    onSetTarget?: (t: string, w: number, b?: number) => Promise<void>;
    onClearTarget?: (t: string) => Promise<void>;
  } = {},
  lang: Lang = "en",
  shapeReadoutVisible = true,
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <PortfolioTargetsReadout
        summary={summary}
        lang={lang}
        shapeReadoutVisible={shapeReadoutVisible}
        onSetTarget={handlers.onSetTarget ?? (async () => {})}
        onClearTarget={handlers.onClearTarget ?? (async () => {})}
      />,
    );
  });
  return container;
}

function unmount() {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
}

function text(): string {
  return container?.textContent ?? "";
}

function input(label: string): HTMLInputElement {
  const el = container?.querySelector(`input[aria-label="${label}"]`);
  if (!el) throw new Error(`no input labelled "${label}" (rendered: ${text().slice(0, 200)})`);
  return el as HTMLInputElement;
}

/** React tracks the DOM value node-side; setting `.value` directly is swallowed. */
async function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function clearButton(): HTMLButtonElement {
  const btn = [...(container?.querySelectorAll("button") ?? [])]
    .find((b) => b.textContent === "Clear target" || b.textContent === "清除目标");
  if (!btn) throw new Error(`no clear button (rendered: ${text().slice(0, 200)})`);
  return btn as HTMLButtonElement;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { unmount(); vi.useRealTimers(); vi.restoreAllMocks(); });

// ── R1 (BLOCKER) — a closed last holding must not silently lose its target ─────────────────────
describe("PortfolioTargetsReadout — orphaned targets with an empty open book (R1)", () => {
  const emptied = computePortfolioTargets([pos("NVDA", 100, 200, "closed")], [tgt("NVDA", 80, 5)]);

  it("renders the orphaned block and the empty-book lead sentence in EN", () => {
    mount(emptied, {}, "en", false);
    expect(text()).toContain("Targets on positions you no longer hold");
    expect(text()).toContain("NVDA");
    expect(text()).toContain("The target is kept, not deleted");
    expect(text()).toContain("Add a position with a share count and entry price to start setting targets.");
  });

  it("renders the same state in ZH", () => {
    mount(emptied, {}, "zh", false);
    expect(text()).toContain("你已不再持有，但仍设有目标的持仓");
    expect(text()).toContain("目标会被保留，不会删除");
    expect(text()).toContain("先为持仓添加股数和建仓价，才能开始设定目标。");
  });

  // R6 (b) — the band must carry its unit, not the bare number the round-1 crop showed.
  it("renders the orphaned band with its unit in both languages (R6 b)", () => {
    mount(emptied, {}, "en", false);
    expect(text()).toContain("±5 pts");
    expect(text()).not.toMatch(/Your band\s*±5(?!\s*pts)/);
    unmount();
    mount(emptied, {}, "zh", false);
    expect(text()).toContain("±5 个百分点");
  });

  // R6 (e) — with no shape readout on the page the basis note must not point at one.
  it("uses the short basis note when the shape readout is not rendered (R6 e)", () => {
    mount(emptied, {}, "en", false);
    expect(text()).toContain("Weighted by what you paid.");
    expect(text()).not.toContain("same as the shape readout above");
  });

  it("cross-references the shape readout when it is rendered (R6 e)", () => {
    mount(computePortfolioTargets([pos("AAA", 10, 100)], [tgt("AAA", 50)]), {}, "en", true);
    expect(text()).toContain("same as the shape readout above");
  });
});

// ── R3 (MAJOR) — an emptied input never saves; the timer is cleaned up ─────────────────────────
describe("PortfolioTargetsReadout — an emptied field never writes (R3)", () => {
  const populated = computePortfolioTargets([pos("AAA", 100, 200)], [tgt("AAA", 80, 5)]);

  it("schedules no save when the target field is emptied", async () => {
    const onSetTarget = vi.fn(async () => {});
    mount(populated, { onSetTarget });
    await typeInto(input("Target weight for AAA, percent"), "");
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onSetTarget).not.toHaveBeenCalled();
  });

  it("schedules no save when the band field is emptied", async () => {
    const onSetTarget = vi.fn(async () => {});
    mount(populated, { onSetTarget });
    await typeInto(input("Band for AAA, percentage points"), "");
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onSetTarget).not.toHaveBeenCalled();
  });

  it("cancels a pending save when the field is emptied inside the debounce window", async () => {
    const onSetTarget = vi.fn(async () => {});
    mount(populated, { onSetTarget });
    const field = input("Target weight for AAA, percent");
    await typeInto(field, "55");
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await typeInto(field, "");
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onSetTarget).not.toHaveBeenCalled();
  });

  it("still saves a non-empty value", async () => {
    const onSetTarget = vi.fn(async () => {});
    mount(populated, { onSetTarget });
    await typeInto(input("Target weight for AAA, percent"), "55");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(onSetTarget).toHaveBeenCalledWith("AAA", 55, 5);
  });

  it("ignores a pending save when Clear is pressed inside the debounce window", async () => {
    const onSetTarget = vi.fn(async () => {});
    const onClearTarget = vi.fn(async () => {});
    mount(populated, { onSetTarget, onClearTarget });
    await typeInto(input("Target weight for AAA, percent"), "55");
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await click(clearButton());
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onClearTarget).toHaveBeenCalledTimes(1);
    expect(onSetTarget).not.toHaveBeenCalled();
  });

  it("clears the debounce timer on unmount, so no save fires against an unmounted row", async () => {
    const onSetTarget = vi.fn(async () => {});
    mount(populated, { onSetTarget });
    await typeInto(input("Target weight for AAA, percent"), "55");
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onSetTarget).not.toHaveBeenCalled();
  });
});

// ── R6 (d) — "Saved" never shows after a Clear ────────────────────────────────────────────────
describe("PortfolioTargetsReadout — the Clear flash (R6 d)", () => {
  const populated = computePortfolioTargets([pos("AAA", 100, 200)], [tgt("AAA", 80, 5)]);

  it("shows the cleared sentence and never the save confirmation", async () => {
    mount(populated, { onClearTarget: async () => {} });
    await click(clearButton());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(text()).toContain("Target cleared.");
    expect(text()).not.toContain("Saved");
  });

  it("shows the cleared sentence in ZH", async () => {
    mount(populated, { onClearTarget: async () => {} }, "zh");
    await click(clearButton());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(text()).toContain("已清除目标。");
    expect(text()).not.toContain("已保存");
  });

  it("still shows the save confirmation after a real save", async () => {
    mount(populated, { onSetTarget: async () => {} });
    await typeInto(input("Target weight for AAA, percent"), "55");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(text()).toContain("Saved");
    expect(text()).not.toContain("Target cleared.");
  });
});

// ── R6 (c) — the unweighable untargeted hint reaches the DOM ───────────────────────────────────
describe("PortfolioTargetsReadout — the unweighable untargeted hint (R6 c)", () => {
  const book = computePortfolioTargets([pos("AAA", 100, 100), pos("SHORT", -50, 100)], []);

  it("renders the unweighable hint instead of an em dash beside a percent sign", () => {
    mount(book, {}, "en");
    expect(text()).toContain("SHORT — not weighable yet (size or price missing).");
    expect(text()).not.toContain("—%");
  });

  it("renders the ZH unweighable hint", () => {
    mount(book, {}, "zh");
    expect(text()).toContain("SHORT——暂时无法计算权重（缺少数量或价格）。");
    expect(text()).not.toContain("—%");
  });
});
