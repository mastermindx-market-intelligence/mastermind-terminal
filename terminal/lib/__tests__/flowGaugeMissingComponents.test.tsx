// @vitest-environment jsdom
/**
 * Unknown is not zero in the session flow gauge (audit of #1198 @48fea0bc, B8).
 *
 * A feed can be present while the gauge's components are not: the tape has no prints
 * yet, or prints arrive without a premium or without a call/put side. The gauge used
 * to sum those as zero and draw "$0", "$0 / $0" and an even 50 % / 50 % split with a
 * MIXED tone — readings the desk never made. A component the feed does not establish
 * is drawn as unavailable with the reason; a complete feed is drawn as before.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowGauge } from "@/components/flowdesk/FlowGauge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type GaugeFeed = React.ComponentProps<typeof FlowGauge>["feed"];
const feedOf = (events: unknown[], extra: Record<string, unknown> = {}) =>
  ({ events, ...extra }) as unknown as GaugeFeed;

const REASON = {
  noPrints: {
    en: "No prints in this feed yet, so there is no premium to total or split.",
    zh: "本数据暂无成交记录，无可合计或拆分的权利金。",
  },
  missing: (n: number, m: number) => ({
    en: `${n} of ${m} prints carry no premium or call/put side, so the session totals would be incomplete.`,
    zh: `${m} 笔成交中有 ${n} 笔缺少权利金或认购/认沽方向，时段合计将不完整。`,
  }),
  noSplit: { en: "No premium to split.", zh: "无可拆分的权利金。" },
};
const NA = { en: "N/A", zh: "不可用" };

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(feed: GaugeFeed, lang: "en" | "zh") {
  await act(async () => root.render(<FlowGauge feed={feed} lang={lang} />));
}

const gaugeEl = () => host.querySelector<HTMLElement>('[data-tut="flow-gauge"]')!;

function expectNoZeroOrEvenSplit() {
  const text = gaugeEl().textContent ?? "";
  expect(text, "a missing component was drawn as $0").not.toContain("$0");
  expect(text, "a missing split was drawn as 50/50").not.toContain("50%");
  expect(text).not.toContain("MIXED");
  expect(text).not.toContain("混合");
  // No bar widths are drawn for a split the feed did not establish.
  expect(gaugeEl().querySelector('[data-testid="flow-gauge-call-bar"]')).toBeNull();
  expect(gaugeEl().querySelector('[data-testid="flow-gauge-put-bar"]')).toBeNull();
}

describe.each(["en", "zh"] as const)("FlowGauge with missing components (B8, %s)", (lang) => {
  it("an empty tape: every component unavailable, the reason names it", async () => {
    await mount(feedOf([]), lang);
    expect(gaugeEl().getAttribute("data-gauge-state")).toBe("unavailable");
    expectNoZeroOrEvenSplit();
    expect(host.querySelector('[data-testid="flow-gauge-reason"]')?.textContent).toBe(REASON.noPrints[lang]);
    const cells = host.querySelectorAll('[data-testid="flow-gauge-stat-value"]');
    expect(cells.length).toBe(4);
    cells.forEach((c) => expect(c.textContent).toBe(NA[lang]));
  });

  it("prints without premium or side: unavailable with the count, never summed as zero", async () => {
    await mount(feedOf([
      { right: "C", premium: null },
      { right: "P" },
      { premium: 120000 },
      { right: "C", premium: Number.NaN },
    ]), lang);
    expect(gaugeEl().getAttribute("data-gauge-state")).toBe("unavailable");
    expectNoZeroOrEvenSplit();
    expect(host.querySelector('[data-testid="flow-gauge-reason"]')?.textContent).toBe(REASON.missing(4, 4)[lang]);
  });

  it("a partly attributable tape is not a total: unavailable, with how many prints are missing", async () => {
    await mount(feedOf([
      { right: "C", premium: 900000 },
      { right: "P", premium: 300000 },
      { right: "P", premium: undefined },
    ]), lang);
    expect(gaugeEl().getAttribute("data-gauge-state")).toBe("unavailable");
    const text = gaugeEl().textContent ?? "";
    expect(text, "a partial sum was shown as the session total").not.toContain("$1.2M");
    expect(text).not.toContain("75%");
    expect(host.querySelector('[data-testid="flow-gauge-reason"]')?.textContent).toBe(REASON.missing(1, 3)[lang]);
  });

  it("prints that all carry zero premium: totals are a real $0, but there is no split", async () => {
    await mount(feedOf([{ right: "C", premium: 0 }, { right: "P", premium: 0 }]), lang);
    expect(gaugeEl().getAttribute("data-gauge-state")).toBe("no-split");
    const text = gaugeEl().textContent ?? "";
    expect(text).toContain("$0");
    expect(text).not.toContain("50%");
    expect(text).not.toContain(lang === "zh" ? "混合" : "MIXED");
    expect(host.querySelector('[data-testid="flow-gauge-reason"]')?.textContent).toBe(REASON.noSplit[lang]);
    expect(gaugeEl().querySelector('[data-testid="flow-gauge-call-bar"]')).toBeNull();
  });

  it("a non-finite session_pct is not drawn as elapsed time", async () => {
    await mount(feedOf([], { session_pct: Number.NaN }), lang);
    expect(gaugeEl().textContent ?? "").not.toContain("NaN");
  });
});

describe("FlowGauge with a complete feed is unchanged", () => {
  it("draws the total, the split, the components and a tone", async () => {
    await mount(feedOf([{ right: "C", premium: 900000 }, { right: "P", premium: 300000 }], { session_pct: 0.5 }), "en");
    expect(gaugeEl().getAttribute("data-gauge-state")).toBe("ok");
    const text = gaugeEl().textContent ?? "";
    expect(text).toContain("$1.2M");
    expect(text).toContain("75% C");
    expect(text).toContain("25% P");
    expect(text).toContain("$900K");
    expect(text).toContain("$300K");
    expect(text).toContain("0.33");
    expect(text).toContain("CALL-HEAVY");
    expect(text).toContain("Session 50% elapsed");
    expect(host.querySelector('[data-testid="flow-gauge-reason"]')).toBeNull();
    expect(gaugeEl().querySelector<HTMLElement>('[data-testid="flow-gauge-call-bar"]')?.style.width).toBe("75%");
  });
});
