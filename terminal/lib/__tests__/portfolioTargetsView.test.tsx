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

// Mathematical controls declare a fictional shared USD entry unit.
const pos = (
  ticker: string,
  shares: number | null,
  entryPrice: number | null,
  status: "open" | "closed" = "open",
): RiskInputPosition => ({ ticker, shares, entryPrice, entryCurrency: "USD", status });

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
  weightsPending = false,
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
        weightsPending={weightsPending}
        onSetTarget={handlers.onSetTarget ?? (async () => {})}
        onClearTarget={handlers.onClearTarget ?? (async () => {})}
      />,
    );
  });
  return container;
}

/** Publish a later canonical summary without replacing the mounted draft. */
function rerenderSummary(summary: PortfolioTargetsSummary) {
  act(() => {
    root!.render(
      <PortfolioTargetsReadout summary={summary} lang="en" shapeReadoutVisible
        onSetTarget={async () => {}} onClearTarget={async () => {}} />,
    );
  });
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

  it("does not print the sum note above the empty-book sentence (heal h3 REQUIRED 5)", () => {
    mount(emptied, {}, "en", false);
    expect(text()).toContain("Add a position with a share count and entry price to start setting targets.");
    expect(text()).not.toContain("add up to");
    expect(text()).not.toContain("not 100%");
    unmount();
    mount(emptied, {}, "zh", false);
    expect(text()).not.toContain("合计为");
    expect(text()).not.toContain("并非 100%");
  });

  it("cross-references the shape readout when it is rendered (R6 e)", () => {
    mount(computePortfolioTargets([pos("AAA", 10, 100)], [tgt("AAA", 50)]), {}, "en", true);
    expect(text()).toContain("same as the shape readout above");
  });
});

// Explicitly removing a retained target must work after its last holding closes or disappears.
describe("PortfolioTargetsReadout — orphaned target removal", () => {
  const closedBook = [pos("NVDA", 100, 200, "closed")];
  const retained = computePortfolioTargets(closedBook, [tgt("NVDA", 80, 5), tgt("MSFT", 20, 4)]);

  it.each(["en", "zh"] as const)("clears only the chosen retained target in %s without offering an edit", async lang => {
    const onSetTarget = vi.fn(async () => {});
    const onClearTarget = vi.fn(async () => {});
    mount(retained, { onSetTarget, onClearTarget }, lang, false);
    const row = container!.querySelector('[data-ticker="NVDA"][data-status="orphaned"]')!;
    const button = row.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe(lang === "en" ? "Clear target" : "清除目标");
    expect(row.querySelector("input")).toBeNull();

    await click(button!);
    expect(onClearTarget).toHaveBeenCalledTimes(1);
    expect(onClearTarget).toHaveBeenCalledWith("NVDA");
    expect(onSetTarget).not.toHaveBeenCalled();
    expect(container!.querySelector('[data-ticker="MSFT"][data-status="orphaned"]')).not.toBeNull();
    expect(text()).not.toContain(lang === "en" ? "Saved" : "已保存");
  });

  it("keeps the row and disables duplicate clearing until the write settles, then acknowledges canonical removal", async () => {
    let finish!: () => void;
    const onClearTarget = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    mount(computePortfolioTargets([], [tgt("NVDA", 80, 5)]), { onClearTarget }, "en", false);
    const button = clearButton();
    await click(button);
    expect(button.disabled).toBe(true);
    expect(container!.querySelector('[data-ticker="NVDA"][data-status="orphaned"]')).not.toBeNull();
    expect(container!.querySelector('[role="status"]')?.textContent).toBeTruthy();
    expect(text()).not.toContain("Target cleared.");

    await click(button);
    expect(onClearTarget).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await Promise.resolve(); });
    expect(text()).not.toContain("Target cleared.");
    rerenderSummary(computePortfolioTargets([], []));
    expect(container!.querySelector('[data-status="orphaned"]')).toBeNull();
    expect(container!.querySelector('[role="status"]')?.textContent).toContain("NVDA");
    expect(text()).toContain("Target cleared.");
    expect(text()).not.toContain("Saved");
  });

  it.each(["en", "zh"] as const)("retains a target and shows a safe failure in %s without automatically retrying", async lang => {
    const onClearTarget = vi.fn(async () => { throw new Error("private transport detail"); });
    const onSetTarget = vi.fn(async () => {});
    mount(retained, { onSetTarget, onClearTarget }, lang, false);
    await click(clearButton());
    expect(onClearTarget).toHaveBeenCalledTimes(1);
    expect(onSetTarget).not.toHaveBeenCalled();
    expect(clearButton().disabled).toBe(false);
    expect(container!.querySelector('[data-ticker="NVDA"][data-status="orphaned"]')).not.toBeNull();
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe(lang === "en"
      ? "We couldn't confirm this change. Refresh to check your saved target."
      : "无法确认此次更改。请刷新以核对已保存的目标。");
    expect(text()).not.toContain("private transport detail");
    expect(text()).not.toContain(lang === "en" ? "Target cleared." : "已清除目标。");
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onClearTarget).toHaveBeenCalledTimes(1);
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


// Explicit invalid input must not be silently omitted from the user's save intent.
describe("PortfolioTargetsReadout — invalid explicit bands", () => {
  const cases = (["en", "zh"] as const).flatMap(lang =>
    (["existing", "first"] as const).flatMap(kind =>
      ["abc", "Infinity"].map(value => ({ lang, kind, value }))));

  it.each(cases)("refuses $value for a $kind target in $lang and permits a corrected band", async ({ lang, kind, value }) => {
    const onSetTarget = vi.fn(async () => {});
    const summary = computePortfolioTargets([pos("AAA", 100, 200)], kind === "existing" ? [tgt("AAA", 80, 5)] : []);
    mount(summary, { onSetTarget }, lang);
    const bandLabel = lang === "en" ? "Band for AAA, percentage points" : "AAA 的容忍区间，百分点";
    const targetLabel = lang === "en" ? "Target weight for AAA, percent" : "AAA 的目标权重，百分比";
    input(bandLabel).focus();
    await typeInto(input(bandLabel), value);
    if (kind === "first") await typeInto(input(targetLabel), "55");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(onSetTarget).not.toHaveBeenCalled();
    expect(input(bandLabel).value).toBe(value);
    expect(input(bandLabel).disabled).toBe(false);
    const alert = container!.querySelector('[role="alert"]')!;
    expect(alert).not.toBeNull();
    expect(alert.id).not.toBe("");
    expect(input(bandLabel).getAttribute("aria-describedby")).toBe(alert.id);
    expect(input(bandLabel).getAttribute("aria-invalid")).toBe("true");
    expect(input(targetLabel).getAttribute("aria-invalid")).not.toBe("true");
    expect(input(targetLabel).hasAttribute("aria-describedby")).toBe(false);
    expect(document.activeElement).toBe(input(bandLabel));
    expect(text()).toContain(lang === "en"
      ? "Your band has to be a number from 0 to 50 points."
      : "容忍区间必须是 0 到 50 个百分点之间的数字。");
    expect(text()).not.toContain("Saved");
    expect(text()).not.toContain("已保存");
    await typeInto(input(bandLabel), "7");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(onSetTarget).toHaveBeenCalledTimes(1);
    expect(onSetTarget).toHaveBeenCalledWith("AAA", kind === "existing" ? 80 : 55, 7);
    expect(container!.querySelector('[role="alert"]')).toBeNull();
    expect(input(bandLabel).hasAttribute("aria-describedby")).toBe(false);
    expect(input(bandLabel).getAttribute("aria-invalid")).not.toBe("true");
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
    // A fulfilled callback alone does not update the canonical summary prop.
    expect(text()).not.toContain("Saved");
    rerenderSummary(computePortfolioTargets([pos("AAA", 100, 200)], [tgt("AAA", 55, 5)]));
    expect(text()).toContain("Saved");
    expect(text()).not.toContain("Target cleared.");
  });

  it("requires both target and band in the visible draft to match the canonical summary before Saved", async () => {
    mount(populated, { onSetTarget: async () => {} });
    await typeInto(input("Target weight for AAA, percent"), "55");
    await typeInto(input("Band for AAA, percentage points"), "7");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(text()).not.toContain("Saved");
    // The target value alone agrees. The visible band must remain 7 and unsaved.
    rerenderSummary(computePortfolioTargets([pos("AAA", 100, 200)], [tgt("AAA", 55, 5)]));
    expect(input("Target weight for AAA, percent").value).toBe("55");
    expect(input("Band for AAA, percentage points").value).toBe("7");
    expect(text()).not.toContain("Saved");
    rerenderSummary(computePortfolioTargets([pos("AAA", 100, 200)], [tgt("AAA", 55, 7)]));
    expect(text()).toContain("Saved");
  });
});

// ── R6 (c) — the unweighable untargeted hint reaches the DOM ───────────────────────────────────
describe("PortfolioTargetsReadout — the unweighable untargeted hint (R6 c)", () => {
  const book = computePortfolioTargets([pos("AAA", 100, 100), pos("SHORT", -50, 100)], []);

  it("renders the unweighable hint instead of an em dash beside a percent sign", () => {
    mount(book, {}, "en");
    expect(text()).toContain("SHORT — current weight unavailable.");
    expect(text()).not.toContain("—%");
  });

  it("renders the ZH unweighable hint", () => {
    mount(book, {}, "zh");
    expect(text()).toContain("SHORT · 暂无法计算当前权重。");
    expect(text()).not.toContain("—%");
  });
});

// The unweighable state produced no fixture and no crop in round 1, so nobody saw that the card
// printed the same sentence twice: spec 2.6 names T_UNWEIGHABLE as the STATUS of an unweighable
// row, and the row also rendered it again as a separate note.
describe("PortfolioTargetsReadout — the unweighable card says it once", () => {
  const unweighable = computePortfolioTargets(
    [pos("AAA", 100, 200), pos("ZERO", 0, 200)],
    [tgt("AAA", 80, 5), tgt("ZERO", 10, 5)],
  );
  const sentence = "Current weight unavailable.";

  it("renders the unweighable sentence exactly once on the card", () => {
    mount(unweighable, {}, "en");
    expect(text()).toContain(sentence);
    expect(text().split(sentence).length - 1).toBe(1);
  });

  it("renders the ZH unweighable sentence exactly once", () => {
    mount(unweighable, {}, "zh");
    const zh = "暂无法计算当前权重。";
    expect(text()).toContain(zh);
    expect(text().split(zh).length - 1).toBe(1);
  });

  it("still shows a band verdict on the weighable row beside it", () => {
    mount(unweighable, {}, "en");
    expect(text()).toContain("Outside your band");
  });
});

// Exercise the actual producer and both rendered target/untargeted consumers.
describe("PortfolioTargetsReadout — unavailable common cost basis", () => {
  const costCases = [
  {
    gap: "currency_unknown",
    positions: [pos("AAA", 10, 100), { ...pos("BBB", 10, 100), entryCurrency: null }],
    notice: {
      en: "Current weights are unavailable because some entry currencies are not recorded.",
      zh: "部分入场价格未记录币种，暂无法计算当前权重。",
    },
  },
  {
    gap: "currency_mismatch",
    positions: [pos("AAA", 10, 100), { ...pos("BBB", 10, 100), entryCurrency: "HKD" }],
    notice: {
      en: "Current weights are unavailable because entry costs use different currencies. No currency conversion is applied.",
      zh: "入场成本使用不同币种，暂无法计算当前权重。未进行货币换算。",
    },
  },
  {
    gap: "amount_overflow",
    positions: [pos("AAA", 10, 100), pos("BBB", 2, Number.MAX_VALUE)],
    notice: {
      en: "Current weights are unavailable because recorded entry costs exceed the supported numeric range.",
      zh: "记录的入场成本超出支持的数值范围，暂无法计算当前权重。",
    },
  },
] as const;

  it.each(costCases.flatMap(test => (["en", "zh"] as const).map(lang => ({ ...test, lang }))))(
    "explains $gap once in $lang without diagnosing missing quantities or an empty book", ({ positions, gap, notice, lang }) => {
      const summary = computePortfolioTargets(positions, [tgt("AAA", 70, 6)]);
      expect(summary.costGap).toBe(gap);
      expect(summary.drifts[0].currentWeightPct).toBeNull();
      expect(summary.drifts[0].driftPct).toBeNull();
      expect(summary.untargeted[0].currentWeightPct).toBeNull();
      mount(summary, {}, lang, false);
      const message = notice[lang];
      expect(container?.querySelector('[data-testid="targets-cost-unavailable"]')?.textContent).toBe(message);
      expect(text().split(message).length - 1).toBe(1);
      const savedFields = container?.querySelector('[data-ticker="AAA"]')?.querySelectorAll("input");
      expect(Array.from(savedFields ?? []).map(field => field.value)).toEqual(["70", "6"]);
      expect(text()).toContain("BBB");
      expect(container?.querySelector('[data-testid="targets-empty"]')).toBeNull();
      expect(text()).not.toContain("Add a position with a share count");
      expect(text()).not.toContain("先为持仓添加股数");
      expect(text()).not.toContain("No share count or entry price yet");
      expect(text()).not.toContain("size or price missing");
      expect(text()).not.toContain("缺少数量或价格");
      expect(text()).not.toContain("还没有记录股数或建仓价");
      expect(text()).not.toContain("—%");
    },
  );

  it.each(["en", "zh"] as const)("does not carry the old cost-gap cause into a pending book in %s", lang => {
    const test = costCases[1];
    const summary = computePortfolioTargets(test.positions, [tgt("AAA", 70, 6)]);
    mount(summary, {}, lang, false, true);
    expect(container?.querySelector('[data-testid="targets-cost-unavailable"]')).toBeNull();
    expect(text()).not.toContain(test.notice[lang]);
    expect(text()).toContain(lang === "en" ? "Current weights are awaiting refresh." : "当前权重等待刷新。");
    expect(container?.querySelector('[data-testid="targets-empty"]')).toBeNull();
  });
});

describe("PortfolioTargetsReadout — accessible save feedback", () => {
  const holdings = [pos("AAA", 100, 200)];
  const targeted = computePortfolioTargets(holdings, [tgt("AAA", 80, 5)]);

  it.each(["existing", "first"] as const)("associates invalid target text with the target field for a %s target", async kind => {
    const onSetTarget = vi.fn(async () => {});
    mount(kind === "existing" ? targeted : computePortfolioTargets(holdings, []), { onSetTarget });
    const target = input("Target weight for AAA, percent");
    const band = input("Band for AAA, percentage points");
    target.focus();
    await typeInto(target, "abc");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    const alert = container!.querySelector('[role="alert"]')!;
    expect(alert?.textContent).toBe("A target has to be a number from 0 to 100.");
    expect(target.getAttribute("aria-describedby")).toBe(alert.id);
    expect(target.getAttribute("aria-invalid")).toBe("true");
    expect(band.hasAttribute("aria-describedby")).toBe(false);
    expect(band.getAttribute("aria-invalid")).not.toBe("true");
    expect(document.activeElement).toBe(target);
    expect(onSetTarget).not.toHaveBeenCalled();
    await typeInto(target, "55");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(onSetTarget).toHaveBeenCalledOnce();
    expect(container!.querySelector('[role="alert"]')).toBeNull();
    expect(target.hasAttribute("aria-describedby")).toBe(false);
    expect(target.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("keeps a refused first target editable and marks its preserved out-of-range draft", async () => {
    mount(computePortfolioTargets(holdings, []), {
      onSetTarget: async () => { throw Object.assign(new Error("invalid target"), { code: "invalid target" }); },
    });
    const target = input("Target weight for AAA, percent");
    await typeInto(target, "101");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(target.value).toBe("101");
    expect(target.disabled).toBe(false);
    const alert = container!.querySelector('[role="alert"]')!;
    expect(alert?.textContent).toBe("A target has to be a number from 0 to 100.");
    expect(target.getAttribute("aria-describedby")).toBe(alert.id);
    expect(target.getAttribute("aria-invalid")).toBe("true");
  });

  it("announces a network failure without labelling valid fields invalid", async () => {
    mount(targeted, { onSetTarget: async () => { throw new TypeError("network down"); } });
    await typeInto(input("Target weight for AAA, percent"), "55");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe(
      "We couldn't confirm this change. Refresh to check your saved target.");
    expect(input("Target weight for AAA, percent").value).toBe("80");
    for (const field of container!.querySelectorAll("input")) {
      expect(field.getAttribute("aria-invalid")).not.toBe("true");
      expect(field.hasAttribute("aria-describedby")).toBe(false);
    }
  });

  it("does not reuse a validation message when a later clear fails", async () => {
    mount(targeted, { onClearTarget: async () => { throw new TypeError("network down"); } });
    await typeInto(input("Band for AAA, percentage points"), "abc");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(text()).toContain("Your band has to be a number from 0 to 50 points.");
    await click(clearButton());
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe(
      "We couldn't confirm this change. Refresh to check your saved target.");
    expect(text()).not.toContain("Your band has to be a number from 0 to 50 points.");
    expect(input("Band for AAA, percentage points").hasAttribute("aria-describedby")).toBe(false);
  });

  it("keeps error IDs distinct when the same ticker is mounted on two surfaces", async () => {
    mount(targeted);
    act(() => {
      root!.render(<>
        <PortfolioTargetsReadout summary={targeted} lang="en" shapeReadoutVisible
          onSetTarget={async () => {}} onClearTarget={async () => {}} />
        <PortfolioTargetsReadout summary={targeted} lang="en" shapeReadoutVisible={false}
          onSetTarget={async () => {}} onClearTarget={async () => {}} />
      </>);
    });
    const bands = [...container!.querySelectorAll<HTMLInputElement>('input[aria-label="Band for AAA, percentage points"]')];
    for (const band of bands) await typeInto(band, "abc");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    const alerts = [...container!.querySelectorAll('[role="alert"]')];
    expect(alerts).toHaveLength(2);
    expect(new Set(alerts.map(alert => alert.id)).size).toBe(2);
    bands.forEach((band, index) => {
      expect(band.getAttribute("aria-describedby")).toBe(alerts[index].id);
      expect(band.closest("article")!.contains(alerts[index])).toBe(true);
    });
  });
});
