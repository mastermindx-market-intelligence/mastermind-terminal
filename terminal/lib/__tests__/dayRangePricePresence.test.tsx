// @vitest-environment jsdom
//
// Render-contract regression for the Terminal DayRange component
// (run_id day-range-price-20261106-dot-c3-01, component terminal/components/DayRange.tsx).
//
// DayRange declares its prices optional/nullable. With a valid low/high but a missing current
// price it printed an unavailable current value ("—") while still drawing a current-price marker
// at the day's LOW — the old `(last ?? low)` fallback — in a directional colour, so the surface
// claimed a current price it had just said it did not have. A non-finite current price (NaN,
// ±Infinity) additionally reached the percent geometry: NaN produced an invalid position the
// stylesheet layer drops (the marker lost its place), and ±Infinity was clamped to an endpoint
// (the marker claimed the day's high or low).
//
// Contract under test (the component's own, not a copied calculation):
// - a current price is PRESENT only when it is a finite numeric value;
// - absent / null / undefined / NaN / +Infinity / -Infinity produce NO current-price dot, NO
//   current-price fill, and NO directional current-price claim, and never invent a low or
//   midpoint price in their place;
// - the known low/high labels, the independently finite open marker, both variants and both
//   languages are untouched by that rule;
// - a finite current price keeps its existing geometry, rounding/precision, clamping and
//   directional rule exactly as before.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import DayRange from "@/components/DayRange";
import { applyLang, LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof DayRange>;

// The em dash the component prints for an unavailable value (U+2014).
const DASH = "—";

// Each entry also carries the low/high labels the component renders for that case. The label
// decimals come from the component's own existing `dec` rule, which reads `last` — so a
// -Infinity current price keeps the 4-decimal labels it has always shown. That label rule is
// deliberately NOT touched by this fix (the known low/high labels stay as they are).
const MISSING_CURRENTS: Array<[string, number | null | undefined, string, string]> = [
  ["null", null, "100.00", "200.00"],
  ["undefined", undefined, "100.00", "200.00"],
  ["NaN", NaN, "100.00", "200.00"],
  ["+Infinity", Number.POSITIVE_INFINITY, "100.00", "200.00"],
  ["-Infinity", Number.NEGATIVE_INFINITY, "100.0000", "200.0000"],
];

let container: HTMLDivElement;
let root: Root | null = null;

const one = (selector: string) => container.querySelector(selector) as HTMLElement | null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  document.documentElement.removeAttribute("data-lang");
  document.documentElement.removeAttribute("lang");
});

async function mount(props: Props, lang: "en" | "zh" = "en") {
  applyLang(lang);
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LangProvider>
        <DayRange {...props} />
      </LangProvider>,
    );
  });
}

async function rerender(props: Props) {
  await act(async () => {
    root!.render(
      <LangProvider>
        <DayRange {...props} />
      </LangProvider>,
    );
  });
}

describe("DayRange current-price presence", () => {
  it.each(MISSING_CURRENTS)(
    "withholds every current-price mark when the current price is %s",
    async (_label, last, lowLabel, highLabel) => {
      await mount({ low: 100, high: 200, last, open: 150 });

      // No current-price marker and no current-price fill: the component must not invent a
      // low/midpoint price for a current price it does not have.
      expect(one(".dr-dot")).toBeNull();
      expect(one(".dr-fill")).toBeNull();

      // No rendered style may carry a non-finite value into the percent geometry.
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);

      // The unavailable current value still reads as unavailable, and carries no direction.
      const cur = one(".dr-cur");
      expect(cur?.textContent).toBe(DASH);
      expect(cur?.getAttribute("style") ?? "").not.toMatch(/var\(--up\)|var\(--down\)/);

      // The known range and the independently finite open marker survive untouched.
      expect(one(".dr-end.lo b")?.textContent).toBe(lowLabel);
      expect(one(".dr-end.hi b")?.textContent).toBe(highLabel);
      expect(one(".dr-open")).not.toBeNull();
      expect(one(".dr-open")?.style.left).toBe("50%");
    },
  );

  it("keeps the current-price dot, fill and direction for a finite current price", async () => {
    await mount({ low: 100, high: 200, last: 160, open: 150 });

    const dot = one(".dr-dot");
    expect(dot).not.toBeNull();
    expect(dot?.style.left).toBe("60%");
    expect(dot?.style.borderColor).toBe("var(--up)");
    expect(dot?.style.boxShadow).toContain("var(--up)");

    const fill = one(".dr-fill");
    expect(fill).not.toBeNull();
    expect(fill?.style.width).toBe("60%");
    expect(fill?.style.background).toBe("var(--up)");

    const cur = one(".dr-cur");
    expect(cur?.textContent).toBe("160.00");
    expect(cur?.style.color).toBe("var(--up)");
  });

  it("keeps the existing down direction for a finite current price below the open", async () => {
    await mount({ low: 100, high: 200, last: 140, open: 150 });
    expect(one(".dr-dot")?.style.borderColor).toBe("var(--down)");
    expect(one(".dr-fill")?.style.background).toBe("var(--down)");
    expect(one(".dr-cur")?.style.color).toBe("var(--down)");
  });

  it.each([
    ["the low endpoint", 100, "0%"],
    ["the midpoint", 150, "50%"],
    ["the high endpoint", 200, "100%"],
    ["a value below the low", 50, "0%"],
    ["a value above the high", 250, "100%"],
  ])("places the current-price marker at %s", async (_label, last, left) => {
    await mount({ low: 100, high: 200, last, open: 150 });
    expect(one(".dr-dot")?.style.left).toBe(left);
    expect(one(".dr-fill")?.style.width).toBe(left);
  });

  it("keeps the existing decimals rule for small prices", async () => {
    await mount({ low: 1, high: 20, last: 5.5, open: 5 });
    expect(one(".dr-cur")?.textContent).toBe("5.5000");
    expect(one(".dr-end.lo b")?.textContent).toBe("1.0000");
    expect(one(".dr-end.hi b")?.textContent).toBe("20.0000");
  });

  it("keeps the positional direction rule when the open price is absent", async () => {
    await mount({ low: 100, high: 200, last: 190, open: null });
    expect(one(".dr-dot")?.style.borderColor).toBe("var(--up)");

    await rerender({ low: 100, high: 200, last: 110, open: null });
    expect(one(".dr-dot")?.style.borderColor).toBe("var(--down)");
  });

  it("renders the open marker independently of the current price", async () => {
    await mount({ low: 100, high: 200, last: null, open: 125 });
    const open = one(".dr-open");
    expect(open).not.toBeNull();
    expect(open?.style.left).toBe("25%");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["NaN", NaN],
    ["+Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("omits the open marker when the open price is %s", async (_label, open) => {
    await mount({ low: 100, high: 200, last: 150, open });
    expect(one(".dr-open")).toBeNull();
  });

  it.each(["bar", "panel"] as const)(
    "applies the contract to the %s variant without changing its markup",
    async (variant) => {
      await mount({ low: 100, high: 200, last: null, open: 150, variant });
      expect(container.querySelector(".dayrange")?.className).toContain(`dr-${variant}`);
      expect(one(".dr-dot")).toBeNull();
      expect(one(".dr-fill")).toBeNull();
      expect(one(".dr-open")).not.toBeNull();
      expect(one(".dr-lab")?.textContent).toBe("Day Range");
      expect(one(".dr-end.lo em")?.textContent).toBe("L");
      expect(one(".dr-end.hi em")?.textContent).toBe("H");
    },
  );

  it("keeps the zh presentation intact and neutral when the current price is missing", async () => {
    await mount({ low: 100, high: 200, last: null, open: 150 }, "zh");
    expect(container.querySelector(".dayrange")?.getAttribute("title")).toBe("当日区间");
    expect(one(".dr-lab")?.textContent).toBe("当日区间");
    expect(one(".dr-end.lo em")?.textContent).toBe("低");
    expect(one(".dr-end.hi em")?.textContent).toBe("高");
    expect(one(".dr-open")?.getAttribute("title")).toBe("开盘");
    expect(one(".dr-dot")).toBeNull();
    expect(one(".dr-fill")).toBeNull();
    expect(one(".dr-cur")?.textContent).toBe(DASH);
  });

  it("drops stale geometry when a current price becomes missing and comes back", async () => {
    await mount({ low: 100, high: 200, last: 160, open: 150 });
    expect(one(".dr-dot")?.style.left).toBe("60%");

    await rerender({ low: 100, high: 200, last: null, open: 150 });
    expect(one(".dr-dot")).toBeNull();
    expect(one(".dr-fill")).toBeNull();
    // No stale direction survives on the current value either.
    expect(one(".dr-cur")?.getAttribute("style") ?? "").not.toMatch(/var\(--up\)|var\(--down\)/);

    await rerender({ low: 100, high: 200, last: 140, open: 150 });
    expect(one(".dr-dot")?.style.left).toBe("40%");
    expect(one(".dr-dot")?.style.borderColor).toBe("var(--down)");
    expect(one(".dr-fill")?.style.width).toBe("40%");
    expect(one(".dr-cur")?.style.color).toBe("var(--down)");
  });

  it.each([
    ["unknown", { low: 100, high: null }],
    ["reversed", { low: 200, high: 100 }],
    ["equal", { low: 150, high: 150 }],
  ])("keeps the existing fallback marks for a %s range with a finite current price", async (_label, range) => {
    await mount({ ...range, last: 150, open: null });
    expect(container.querySelector(".dayrange")?.className).toContain("dr-empty");
    expect(one(".dr-fill")?.style.width).toBe("50%");
    expect(one(".dr-dot")?.style.left).toBe("50%");
  });

  it.each([
    ["unknown", { low: 100, high: null }],
    ["reversed", { low: 200, high: 100 }],
    ["equal", { low: 150, high: 150 }],
  ])("withholds the current-price marks for a %s range when the current price is missing", async (_label, range) => {
    await mount({ ...range, last: null, open: 150 });
    expect(one(".dr-dot")).toBeNull();
    expect(one(".dr-fill")).toBeNull();
  });
});
