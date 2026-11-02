// @vitest-environment jsdom
/**
 * fundamentalScreenDraftSync.test.tsx — the fundamental editor's draft follows its committed source.
 *
 * Issue #916. ScreenerView replaces the fundamental predicates whole when a saved screen is opened
 * (`setFundPreds(o.fund)`) and empties them on "Clear filters" or a chip click — in every case
 * leaving the selected field alone. The bar used to reload its draft only on a FIELD change, so a
 * saved screen whose condition sat on the already-selected field left the previous threshold in
 * the inputs, and Update then wrote that stale threshold over the condition the table had just
 * received. Range ↔ unknown and "also include unknown" disagreed the same way. A draft typed on a
 * field with NO committed condition could not be blanked by value at all (the source read the same
 * before and after), so the parent now also bumps `sourceEpoch` whenever it replaces the table's
 * conditions whole.
 *
 * These mount the real bar with react-dom/client + act (the house component-test pattern) under
 * the real language provider; no source module is mocked. The scan prop is a genuinely parsed
 * "ready" generation, so the commit button is enabled exactly as it is in the product.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FundamentalScreenBar, type FundamentalScreenBarProps } from "@/components/screener/FundamentalScreen";
import { FUNDAMENTAL_FIELD_IDS, readFundamentalScanResponse, type FundamentalFieldId, type FundamentalPredicate } from "@/lib/fundamentalScan";
import { SCREENER_SCAN_SCHEMA } from "@/lib/screenerScan";
import { LangProvider, applyLang } from "@/lib/i18n";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// A real published-shape generation with no rows: the bar only needs `ready` to be true.
const READY = readFundamentalScanResponse(200, {
  schema: SCREENER_SCAN_SCHEMA,
  family: "fundamental",
  family_version: 1,
  generation: 1_760_140_800,
  generated_at: "2026-10-11T00:00:00Z",
  complete: true,
  universe: { source: "manifest", as_of: "2026-10-09", count: 0 },
  fields: [...FUNDAMENTAL_FIELD_IDS],
  rows: [],
});
if (READY.kind !== "ready") throw new Error(`fixture generation rejected: ${JSON.stringify(READY)}`);

const F: FundamentalFieldId = "fund.net_margin_fy";
const O: FundamentalFieldId = "fund.roe_fy";
type Range = Extract<FundamentalPredicate, { op: "range" }>;
const atLeast = (field: FundamentalFieldId, gte: number): Range => ({ field, op: "range", gte });

let host: HTMLDivElement;
let root: Root;
let props: FundamentalScreenBarProps;

async function flush() { await act(async () => { await Promise.resolve(); }); }
async function mount(over: Partial<FundamentalScreenBarProps> = {}) {
  props = {
    scan: { source: READY, nowMs: Date.parse("2026-10-11T12:00:00Z"), pending: false, retry: vi.fn() },
    field: F,
    onField: vi.fn(),
    predicates: [atLeast(F, 0.1)],
    onPredicates: vi.fn(),
    summary: null,
    ...over,
  };
  await act(async () => { root.render(<LangProvider><FundamentalScreenBar {...props} /></LangProvider>); });
  await flush();
}
/** The parent rerenders with new props — a saved screen opened, a chip removed, a scan answer. */
async function rerender(over: Partial<FundamentalScreenBarProps>) {
  props = { ...props, ...over };
  await act(async () => { root.render(<LangProvider><FundamentalScreenBar {...props} /></LangProvider>); });
  await flush();
}

const q = <T extends Element>(sel: string) => host.querySelector(sel) as T | null;
const minInput = () => q<HTMLInputElement>("[data-fund-min]");
const maxInput = () => q<HTMLInputElement>("[data-fund-max]");
const inclBox = () => q<HTMLInputElement>("[data-fund-incl]");
const commitBtn = () => q<HTMLButtonElement>("[data-fund-commit]")!;
const modeButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".fin-toggle button"));
const errorEl = () => q<HTMLElement>("[data-fund-error]");

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}
const lastCommitted = () => {
  const calls = (props.onPredicates as ReturnType<typeof vi.fn>).mock.calls;
  return calls.length ? (calls[calls.length - 1][0] as FundamentalPredicate[]) : undefined;
};

beforeEach(() => {
  applyLang("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.setAttribute("data-lang", "en");
});

describe("FundamentalScreenBar — the draft follows the committed source (#916)", () => {
  it("a saved screen opened on the selected field replaces the draft, and Update keeps the saved threshold", async () => {
    await mount();
    expect(minInput()!.value).toBe("10");
    // ScreenerView.openSmartScreen: predicates replaced whole, field untouched.
    await rerender({ predicates: [atLeast(F, 0.25)] });
    expect(minInput()!.value).toBe("25");
    await click(commitBtn());
    expect(lastCommitted()).toEqual([atLeast(F, 0.25)]);
  });

  it("the saved condition can be the same number typed differently — Update is then a no-op rewrite, not a revert", async () => {
    await mount();
    await type(minInput()!, "10.0");
    await rerender({ predicates: [atLeast(F, 0.3)] });
    await click(commitBtn());
    expect(lastCommitted()).toEqual([atLeast(F, 0.3)]);
  });

  it("range → unknown on the selected field switches the mode, and Update keeps unknown", async () => {
    await mount();
    await rerender({ predicates: [{ field: F, op: "unknown" }] });
    expect(minInput()).toBeNull();
    expect(modeButtons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    await click(commitBtn());
    expect(lastCommitted()).toEqual([{ field: F, op: "unknown" }]);
  });

  it("unknown → range on the selected field loads the saved bounds", async () => {
    await mount({ predicates: [{ field: F, op: "unknown" }] });
    expect(minInput()).toBeNull();
    await rerender({ predicates: [{ field: F, op: "range", lte: 0.4 }] });
    expect(modeButtons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(minInput()!.value).toBe("");
    expect(maxInput()!.value).toBe("40");
  });

  it("\"also include unknown\" follows the saved condition in both directions", async () => {
    await mount();
    expect(inclBox()!.checked).toBe(false);
    await rerender({ predicates: [{ ...atLeast(F, 0.1), includeUnknown: true }] });
    expect(inclBox()!.checked).toBe(true);
    await click(commitBtn());
    expect(lastCommitted()).toEqual([{ ...atLeast(F, 0.1), includeUnknown: true }]);
    await rerender({ predicates: [{ ...atLeast(F, 0.1), includeUnknown: false }] });
    expect(inclBox()!.checked).toBe(false);
  });

  it("removing the selected field's chip blanks the draft; Add cannot resurrect the removed condition", async () => {
    await mount({ predicates: [atLeast(F, 0.1), atLeast(O, 0.2)] });
    expect(commitBtn().textContent).toBe("Update filter");
    // FundamentalStatusItems.onRemove / Clear filters: the selected field's condition is gone.
    await rerender({ predicates: [atLeast(O, 0.2)] });
    expect(minInput()!.value).toBe("");
    expect(commitBtn().textContent).toBe("Add filter");
    await click(commitBtn());
    expect(props.onPredicates).not.toHaveBeenCalled();
    expect(errorEl()?.getAttribute("data-fund-error")).toBe("empty");
  });

  it("Clear filters with the selected field's condition on the table blanks the draft", async () => {
    await mount({ predicates: [atLeast(F, 0.1), atLeast(O, 0.2)] });
    await type(minInput()!, "12");
    await rerender({ predicates: [] });
    expect(minInput()!.value).toBe("");
    expect(maxInput()!.value).toBe("");
    expect(inclBox()!.checked).toBe(false);
  });

  it("Clear filters with NO condition on the selected field: the parent's reset signal blanks the draft", async () => {
    await mount({ predicates: [atLeast(O, 0.2)] });
    await type(minInput()!, "17");
    await click(inclBox()!);
    expect(inclBox()!.checked).toBe(true);
    // ScreenerView.clearAll: the predicates are emptied AND sourceEpoch is bumped in one transition.
    await rerender({ predicates: [], sourceEpoch: 1 });
    expect(minInput()!.value).toBe("");
    expect(inclBox()!.checked).toBe(false);
    expect(commitBtn().textContent).toBe("Add filter");
  });

  it("a saved screen opened with the SAME condition the table already had reloads the committed value over typing", async () => {
    await mount();
    await type(minInput()!, "17");
    await rerender({ predicates: [atLeast(F, 0.1)], sourceEpoch: 1 });
    expect(minInput()!.value).toBe("10");
    await click(commitBtn());
    expect(lastCommitted()).toEqual([atLeast(F, 0.1)]);
  });

  it("a saved screen with no condition on the selected field blanks a typed draft and clears a stale error", async () => {
    await mount({ predicates: [] });
    await type(minInput()!, "abc");
    await click(commitBtn());
    expect(errorEl()?.getAttribute("data-fund-error")).toBe("number");
    await rerender({ predicates: [atLeast(O, 0.2)], sourceEpoch: 1 });
    expect(minInput()!.value).toBe("");
    expect(errorEl()).toBeNull();
  });

  it("a condition arriving from the table clears a stale validation error", async () => {
    await mount();
    await type(minInput()!, "abc");
    await click(commitBtn());
    expect(errorEl()?.getAttribute("data-fund-error")).toBe("number");
    await rerender({ predicates: [atLeast(F, 0.25)] });
    expect(errorEl()).toBeNull();
    expect(minInput()!.value).toBe("25");
  });
});

describe("FundamentalScreenBar — an unchanged source never discards typing", () => {
  it("another field's chip removed, equal predicates in fresh objects, a scan refresh and a summary arrival all keep the draft", async () => {
    await mount({ predicates: [atLeast(F, 0.1), atLeast(O, 0.2)] });
    await type(minInput()!, "17");
    await rerender({ predicates: [atLeast(F, 0.1)] });
    expect(minInput()!.value).toBe("17");
    await rerender({ predicates: [{ ...atLeast(F, 0.1) }, atLeast(O, 0.35)] });
    expect(minInput()!.value).toBe("17");
    // An omitted and an explicit-false includeUnknown are the same committed condition.
    await rerender({ predicates: [{ ...atLeast(F, 0.1), includeUnknown: false }] });
    expect(minInput()!.value).toBe("17");
    await rerender({ scan: { ...props.scan, pending: true } });
    await rerender({ scan: { ...props.scan, pending: false, nowMs: props.scan.nowMs + 60_000 } });
    expect(minInput()!.value).toBe("17");
  });

  it("selecting another field still loads that field's own condition, and coming back reloads this one", async () => {
    await mount({ predicates: [atLeast(F, 0.1), atLeast(O, 0.2)] });
    await type(minInput()!, "17");
    await rerender({ field: O });
    expect(minInput()!.value).toBe("20");
    await rerender({ field: F });
    expect(minInput()!.value).toBe("10");
  });

  it("Update on the selected field rewrites only that field's condition", async () => {
    await mount({ predicates: [atLeast(F, 0.25), atLeast(O, 0.2)] });
    await type(minInput()!, "30");
    await click(commitBtn());
    expect(lastCommitted()).toEqual([atLeast(F, 0.3), atLeast(O, 0.2)]);
  });

  it("an identical empty table WITHOUT the reset signal (another chip removed, a scan answer) keeps typing on an uncommitted field", async () => {
    await mount({ predicates: [atLeast(O, 0.2)] });
    await type(minInput()!, "17");
    await rerender({ predicates: [] });
    await rerender({ scan: { ...props.scan, pending: true } });
    expect(minInput()!.value).toBe("17");
  });

  it("the same epoch re-sent is not a reset; only a new one is", async () => {
    await mount({ predicates: [], sourceEpoch: 3 });
    await type(minInput()!, "17");
    await rerender({ predicates: [], sourceEpoch: 3 });
    expect(minInput()!.value).toBe("17");
    await rerender({ predicates: [], sourceEpoch: 4 });
    expect(minInput()!.value).toBe("");
  });
});

describe("FundamentalScreenBar — the commit label follows the source in the active language", () => {
  it("EN: Update filter while the selected field has a condition, Add filter once it is removed", async () => {
    await mount();
    expect(commitBtn().textContent).toBe("Update filter");
    expect(host.textContent).not.toContain("更新筛选");
    await rerender({ predicates: [] });
    expect(commitBtn().textContent).toBe("Add filter");
  });

  it("ZH: 更新筛选 while the selected field has a condition, 添加筛选 once it is removed", async () => {
    applyLang("zh");
    await mount();
    expect(commitBtn().textContent).toBe("更新筛选");
    expect(host.textContent).not.toContain("Update filter");
    await rerender({ predicates: [] });
    expect(commitBtn().textContent).toBe("添加筛选");
    expect(host.textContent).not.toContain("Add filter");
  });
});
