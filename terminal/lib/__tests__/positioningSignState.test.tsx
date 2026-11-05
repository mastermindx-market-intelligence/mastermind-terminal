// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketStructureBody } from "@/components/msc/MarketStructureBody";
import { aggregate, signSensitivity } from "@/lib/marketStructure";
import type { GexPayload } from "@/components/gexdesk/GexDeskView";

type Lang = "en" | "zh";
const LABELS = {
  en: {
    tilt: "Gamma tilt", critical: "Flips at call weight", verdict: "Verdict",
    unknown: "Unknown", undetermined: "Not determined", robust: "Robust", fragile: "Fragile",
    noFlip: "No plausible weight flips it", oldUnknown: "No gamma",
    unknownNote: "These inputs do not establish the sign-sensitivity estimate; robustness and a flip weight are not determined.",
    robustNote: "Absolute Gamma tilt is at least 12.0%. Inspect the curve and flip weight to see whether another call-side weight reverses the estimated sign.",
    fragileNote: "Call and put gamma are close to balanced",
  },
  zh: {
    tilt: "伽马倾斜", critical: "翻转于看涨权重", verdict: "结论",
    unknown: "未知", undetermined: "未确定", robust: "稳健", fragile: "脆弱",
    noFlip: "任何合理权重都无法翻转", oldUnknown: "无伽马",
    unknownNote: "这些输入无法确定符号敏感性估计；稳健性与翻转权重均未确定。",
    robustNote: "Gamma 倾斜的绝对值不低于 12.0%。曲线与翻转权重显示其他看涨方权重是否会改变估计符号。",
    fragileNote: "看涨与看跌伽马接近平衡",
  },
} as const;

// Missing side fields deliberately exercise the model's runtime source admission;
// GexPayload's nominal row type is narrower than these observed missing-input states.
const payload = (row: Record<string, unknown>, convention = "source-convention-A"): GexPayload => ({
  schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-30",
  spot_ref: 100, net_gex_bn: 1, gamma_flip: null, call_wall: null, put_wall: null,
  by_strike: [{ strike: 100, ...row }] as unknown as GexPayload["by_strike"],
  convention,
});
const netOnly = () => payload({ gamma_net: 7 });
const zeroSides = () => payload({ gamma_net: 0, gamma_call: 0, gamma_put: 0 });
const robust = () => payload({ gamma_net: 20, gamma_call: 30, gamma_put: -10 });
const fragile = () => payload({ gamma_net: 1, gamma_call: 10, gamma_put: -9 });

let host: HTMLDivElement, root: Root, observed: Element[];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observed = [];
  vi.stubGlobal("ResizeObserver", class {
    observe(element: Element) { observed.push(element); }
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(480);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(gex: GexPayload | null, lang: Lang) {
  // Actual body and unchanged calculations, shared card chrome and all child cards.
  await act(async () => root.render(<MarketStructureBody gex={gex} moves={null} root="SPY" lang={lang} />));
}
const values = () => host.querySelector<HTMLElement>("[data-testid=sign-sensitivity-values]");
function card(): HTMLElement {
  const section = values()?.closest("section");
  if (!section) throw new Error("Sign robustness card not rendered");
  return section;
}
function stat(label: string): string | null {
  const item = [...(values()?.children ?? [])].find(element => element.firstElementChild?.textContent === label);
  return item?.lastElementChild?.textContent ?? null;
}
const note = () => card().querySelector("[data-testid=sign-sensitivity-note]")?.textContent;
const measure = () => card().querySelector("[data-testid=sign-sensitivity-measure]");
function assertUnknown(lang: Lang) {
  const copy = LABELS[lang];
  expect(values()?.getAttribute("data-verdict")).toBe("unknown");
  expect(stat(copy.verdict)).toBe(copy.unknown);
  expect(stat(copy.critical)).toBe(copy.undetermined);
  expect(stat(copy.tilt)).toBe("—");
  expect(note()).toBe(copy.unknownNote);
  expect(card().textContent).not.toContain(copy.oldUnknown);
  expect(card().textContent).not.toContain(copy.noFlip);
  expect(card().textContent).not.toContain(copy.robustNote);
  expect(card().querySelector("svg")).toBeNull();
  expect(card().querySelector("[data-testid=sign-sensitivity-axis]")).toBeNull();
  expect(measure()).not.toBeNull();
}
function geometry() {
  const svg = card().querySelector("svg");
  return {
    width: svg?.getAttribute("width"),
    height: svg?.getAttribute("height"),
    viewBox: svg?.getAttribute("viewBox"),
    points: svg?.querySelector("polyline")?.getAttribute("points"),
    stroke: svg?.querySelector("polyline")?.getAttribute("stroke"),
    markers: [...(svg?.querySelectorAll("circle") ?? [])].map(circle =>
      ["cx", "cy", "r", "fill"].map(name => circle.getAttribute(name))),
  };
}

describe.each(["en", "zh"] as const)("Positioning sign state (%s)", lang => {
  it("does not call known net Gamma absent or infer robustness from unavailable side sensitivity", async () => {
    const gex = netOnly();
    const source = aggregate(gex.by_strike);
    expect(source.gammaMn).toBe(7);
    expect(source.gammaKnown).toBe(1);
    expect(signSensitivity(source).verdict).toBe("unknown");
    await render(gex, lang);
    assertUnknown(lang);
    expect(card().textContent).toContain("source-convention-A");
  });

  it("treats supplied zero side magnitude as the same undetermined model estimate without inventing a missing-data cause", async () => {
    await render(netOnly(), lang);
    const unavailableExplanation = note();
    const gex = zeroSides();
    expect(aggregate(gex.by_strike).gammaKnown).toBe(1);
    expect(signSensitivity(aggregate(gex.by_strike)).verdict).toBe("unknown");
    await render(gex, lang);
    assertUnknown(lang);
    expect(note()).toBe(unavailableExplanation);
    expect(card().textContent).toContain("source-convention-A");
  });

  it("retains known robust and fragile readouts, sampled curves, thresholds and source convention", async () => {
    const copy = LABELS[lang];
    await render(robust(), lang);
    expect(values()?.getAttribute("data-verdict")).toBe("robust");
    expect(stat(copy.verdict)).toBe(copy.robust);
    expect(stat(copy.tilt)).toBe("50.0%");
    expect(stat(copy.critical)).toBe("0.33");
    expect(note()).toBe(copy.robustNote);
    expect(geometry()).toMatchObject({ width: "480", height: "56", viewBox: "0 0 480 56", stroke: "var(--brand-2)" });
    expect(geometry().points?.split(" ")).toHaveLength(5);
    expect(card().querySelector("[data-testid=sign-sensitivity-axis]")?.children).toHaveLength(3);
    expect(card().textContent).toContain("source-convention-A");

    await render(fragile(), lang);
    expect(values()?.getAttribute("data-verdict")).toBe("fragile");
    expect(stat(copy.verdict)).toBe(copy.fragile);
    expect(stat(copy.tilt)).toBe("5.3%");
    expect(stat(copy.critical)).toBe("0.90");
    expect(note()).toContain(copy.fragileNote);
    expect(geometry().stroke).toBe("var(--sign-warning, var(--warn))");
    expect(card().querySelector("[data-testid=sign-sensitivity-axis]")?.children).toHaveLength(3);
    expect(card().textContent).toContain("source-convention-A");
    expect(card().textContent).not.toContain(copy.unknownNote);
  });

  it("discloses the unchanged robustness threshold without guaranteeing one sign across the weight range", async () => {
    const gex = payload({ gamma_net: 12, gamma_call: 56, gamma_put: -44 });
    const modeled = signSensitivity(aggregate(gex.by_strike));
    expect(modeled.tilt).toBe(0.12);
    expect(modeled.verdict).toBe("robust");
    expect(modeled.curve[0].netMn).toBeLessThan(0);
    expect(modeled.curve[modeled.curve.length - 1].netMn).toBeGreaterThan(0);
    await render(gex, lang);
    expect(stat(LABELS[lang].verdict)).toBe(LABELS[lang].robust);
    expect(note()).toBe(LABELS[lang].robustNote);
    expect(note()).not.toContain("full range");
    expect(note()).not.toContain("全部约定范围内均成立");
  });

  it("keeps a valid put-only null crossing and an out-of-range crossing as known no-flip estimates", async () => {
    const copy = LABELS[lang];
    for (const gex of [
      payload({ gamma_net: -10, gamma_call: 0, gamma_put: -10 }),
      payload({ gamma_net: -10, gamma_call: 10, gamma_put: -20 }),
    ]) {
      expect(signSensitivity(aggregate(gex.by_strike)).verdict).toBe("robust");
      await render(gex, lang);
      expect(stat(copy.verdict)).toBe(copy.robust);
      expect(stat(copy.critical)).toBe(copy.noFlip);
      expect(note()).toBe(copy.robustNote);
      expect(card().querySelector("svg polyline")).not.toBeNull();
      expect(card().querySelector("[data-testid=sign-sensitivity-axis]")).not.toBeNull();
      expect(card().textContent).not.toContain(copy.undetermined);
    }
  });

  it("measures an initially unknown card and recovers known geometry without retaining a prior estimate", async () => {
    await render(netOnly(), lang);
    assertUnknown(lang);
    const wrapper = measure()!;
    expect(observed).toContain(wrapper);
    await render(robust(), lang);
    expect(measure()).toBe(wrapper);
    const knownGeometry = geometry();
    expect(knownGeometry.width).toBe("480");

    await render(payload({ gamma_net: 7 }, "source-convention-B"), lang);
    assertUnknown(lang);
    expect(measure()).toBe(wrapper);
    expect(card().textContent).toContain("source-convention-B");
    expect(card().textContent).not.toContain("source-convention-A");

    await render(robust(), lang);
    expect(measure()).toBe(wrapper);
    expect(geometry()).toEqual(knownGeometry);
    // jsdom establishes lifecycle and observed width, not actual rendered reflow.
  });

  it("removes the entire prior card on source loss and returns to an honest unknown state", async () => {
    await render(robust(), lang);
    expect(card().querySelector("svg")).not.toBeNull();
    await render(null, lang);
    expect(values()).toBeNull();
    expect(host.querySelector("[data-testid=sign-sensitivity-note]")).toBeNull();
    await render(netOnly(), lang);
    assertUnknown(lang);
  });
});
