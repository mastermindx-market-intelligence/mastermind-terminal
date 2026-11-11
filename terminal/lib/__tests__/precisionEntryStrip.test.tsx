// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import PrecisionEntryStrip from "@/components/PrecisionEntryStrip";
import { buildPrecisionEntryReadout } from "../precisionEntryReadout";

vi.mock("@/components/PrecisionEntryStrip.module.css", () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(
  intel: unknown,
  options: { horizon?: "day" | "swing" | "position" | "deep"; lang?: "en" | "zh" } = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const readout = buildPrecisionEntryReadout(intel);
  act(() => {
    root!.render(
      <PrecisionEntryStrip
        readout={readout}
        horizon={options.horizon ?? "swing"}
        lang={options.lang ?? "en"}
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

const READY_INTEL = {
  schema: "intel/v1",
  asof: "2026-09-23",
  tape: { stale: false },
  analysis: {
    entry: {
      status: "await_confluence",
      urgency: "watch",
      headline: "Wait for confluence",
      headline_zh: "等待共振",
      confidence: 72.4,
      next_trigger: "2D MACD × 3D StochRSI",
      spot: 118.5,
      buy_zone: { low: 116, high: 120 },
      chase_above: 123,
      stop: 111,
    },
    confluence: {
      tier: "T3",
      bars_to_cross: 1.4,
      provisional: true,
      not_topped: true,
      htf_s1: false,
      asof: "2026-09-23",
    },
    sniper: {
      w2_washout: true,
      w2_stoch_d: 22.4,
      coiled: true,
      asof: "2026-09-22",
    },
  },
};

describe("PrecisionEntryStrip", () => {
  beforeEach(() => unmount());
  afterEach(() => unmount());

  it("renders one compact English scan line from canonical Precision facts", () => {
    const el = mount(READY_INTEL);
    const strip = el.querySelector("[data-testid='precision-entry-strip']");

    expect(strip).not.toBeNull();
    expect(strip?.getAttribute("data-precision-horizon")).toBe("swing");
    expect(strip?.getAttribute("data-precision-availability")).toBe("ready");
    expect(strip?.getAttribute("data-precision-freshness")).toBe("current");

    const text = strip?.textContent ?? "";
    expect(text).toContain("Precision");
    expect(text).toContain("Swing");
    expect(text).toContain("Wait for confluence");
    expect(text).toContain("Bottom durability");
    expect(text).toContain("72");
    expect(text).toContain("2D MACD × 3D StochRSI");
    expect(text).toContain("~1.4 bars");
    expect(text).toContain("Not confirmed");
    expect(text).toContain("Washout");
    expect(text).toContain("Stoch D 22.4");
    expect(text).toContain("Coiled");
    expect(text).toContain("In buy zone");
    expect(el.querySelector("[data-testid='precision-data-state']")).toBeNull();
  });

  it("uses the canonical Chinese headline and local plain-language chrome", () => {
    const el = mount(READY_INTEL, { lang: "zh", horizon: "position" });
    const text = el.textContent ?? "";

    expect(text).toContain("精准");
    expect(text).toContain("持仓");
    expect(text).toContain("等待共振");
    expect(text).toContain("底部耐久度");
    expect(text).toContain("高周期");
    expect(text).toContain("未确认");
    expect(text).toContain("2周背景");
    expect(text).toContain("买入区内");
    expect(text).not.toContain("Wait for confluence");
  });

  it("makes stale data visible with the source as-of date", () => {
    const intel = structuredClone(READY_INTEL);
    intel.tape.stale = true;
    const el = mount(intel);
    const state = el.querySelector("[data-testid='precision-data-state']");

    expect(state?.getAttribute("data-precision-data")).toBe("stale");
    expect(state?.textContent).toContain("Stale");
    expect(state?.textContent).toContain("2026-09-23");
    expect(el.querySelector("[data-testid='precision-entry-strip']")?.getAttribute("data-precision-freshness")).toBe("stale");
  });

  it("labels incomplete coverage instead of filling absent blocks with reassuring defaults", () => {
    const el = mount({
      tape: { stale: false },
      analysis: {
        entry: {
          headline: "Wait for a cleaner setup",
          confidence: 41,
          spot: 88,
        },
      },
    });
    const state = el.querySelector("[data-testid='precision-data-state']");
    const text = el.textContent ?? "";

    expect(state?.getAttribute("data-precision-data")).toBe("partial");
    expect(state?.textContent).toContain("Partial data");
    expect(text).toContain("41");
    expect(text).not.toContain("Confirmed");
    expect(text).not.toContain("Washout");
    expect(el.querySelector("[data-testid='precision-trigger']")).toBeNull();
    expect(el.querySelector("[data-testid='precision-location']")).toBeNull();
  });

  it("preserves explicit false HTF and 2W evidence as descriptive negative states", () => {
    const el = mount({
      tape: { stale: false },
      analysis: {
        entry: { headline: "Setup forming" },
        confluence: { htf_s1: false },
        sniper: { w2_washout: false, coiled: false },
      },
    });
    const text = el.textContent ?? "";

    expect(text).toContain("Not confirmed");
    expect(text).toContain("No washout");
    expect(text).toContain("Not coiled");
  });

  it("shows crossing only from the canonical bars-to-cross value and never from status inference", () => {
    const el = mount({
      analysis: {
        entry: {
          status: "await_confluence",
          headline: "Waiting",
          next_trigger: "2D MACD",
        },
        confluence: { bars_to_cross: 0 },
      },
    });
    const text = el.textContent ?? "";

    expect(text).toContain("2D MACD");
    expect(text).toContain("Crossing");
    expect(text).not.toContain("await_confluence");
  });

  it("does not print a raw confluence tier when canonical trigger copy is absent", () => {
    const el = mount({
      analysis: {
        entry: { headline: "Setup forming" },
        confluence: { tier: "T3" },
        sniper: { w2_washout: true },
      },
    });
    const text = el.textContent ?? "";

    expect(text).not.toContain("T3");
    expect(el.querySelector("[data-testid='precision-trigger']")).toBeNull();
  });

  it("does not leak raw status enums when canonical headline copy is absent", () => {
    const el = mount({
      analysis: {
        entry: { status: "await_confluence", confidence: 60 },
      },
    });
    const text = el.textContent ?? "";

    expect(text).not.toContain("await_confluence");
    expect(el.querySelector("[data-testid='precision-posture']")).toBeNull();
    expect(el.querySelector("[data-testid='precision-bottom-confidence']")?.textContent).toContain("60");
  });

  it("fails visibly when none of the Precision intel blocks are available", () => {
    const el = mount({
      schema: "intel/v1",
      asof: "2026-09-23",
      tape: { stale: false },
      cards: { ai_judgment: { verdict: "Buy" } },
    });
    const strip = el.querySelector("[data-testid='precision-entry-strip']");
    const state = el.querySelector("[data-testid='precision-data-state']");
    const text = strip?.textContent ?? "";

    expect(strip?.getAttribute("data-precision-availability")).toBe("unavailable");
    expect(state?.getAttribute("data-precision-data")).toBe("unavailable");
    expect(state?.textContent).toContain("Intel unavailable");
    expect(text).not.toContain("Buy");
    expect(el.querySelector("[data-testid='precision-posture']")).toBeNull();
  });

  for (const lang of ["en", "zh"] as const) {
    const headline = lang === "en" ? "Wait for confluence" : "等待共振";
    const opposite = lang === "en" ? "等待共振" : "Wait for confluence";
    const withoutSelectedHeadline = {
      ...READY_INTEL,
      analysis: {
        ...READY_INTEL.analysis,
        entry: {
          ...READY_INTEL.analysis.entry,
          headline: lang === "en" ? "" : READY_INTEL.analysis.entry.headline,
          headline_zh: lang === "zh" ? "" : READY_INTEL.analysis.entry.headline_zh,
        },
      },
    };

    it("omits absent " + lang + " posture without falling back to the opposite headline", () => {
      const el = mount(withoutSelectedHeadline, { lang });
      expect(el.querySelector("[data-testid='precision-posture']")).toBeNull();
      expect(el.textContent).not.toContain(opposite);
      expect(el.querySelector("[data-testid='precision-entry-strip']")?.getAttribute("data-precision-availability")).toBe("ready");
    });

    it("updates " + lang + " posture through omission, restoration and a language change", () => {
      const el = mount(READY_INTEL, { lang });
      expect(el.querySelector("[data-testid='precision-posture']")?.textContent).toContain(headline);
      act(() => root!.render(
        <PrecisionEntryStrip readout={buildPrecisionEntryReadout(withoutSelectedHeadline)} horizon="swing" lang={lang} />,
      ));
      expect(el.querySelector("[data-testid='precision-posture']")).toBeNull();
      expect(el.textContent).not.toContain(opposite);
      act(() => root!.render(
        <PrecisionEntryStrip readout={buildPrecisionEntryReadout(READY_INTEL)} horizon="swing" lang={lang} />,
      ));
      expect(el.querySelector("[data-testid='precision-posture']")?.textContent).toContain(headline);
      act(() => root!.render(
        <PrecisionEntryStrip readout={buildPrecisionEntryReadout(READY_INTEL)} horizon="swing" lang={lang === "en" ? "zh" : "en"} />,
      ));
      expect(el.querySelector("[data-testid='precision-posture']")?.textContent).toContain(opposite);
      expect(el.textContent).not.toContain(headline);
    });

    for (const [name, analysis] of [
      ["empty", { entry: {}, confluence: {}, sniper: {} }],
      ["metadata-only", { entry: { asof: "2026-11-10" }, confluence: { asof: "2026-11-10" }, sniper: { asof: "2026-11-10" } }],
      ["malformed", { entry: { confidence: "0" }, confluence: { htf_s1: "false" }, sniper: { coiled: 0 } }],
    ] as const) {
      it("shows localized unavailability for " + name + " containers in " + lang, () => {
        const el = mount({ tape: { stale: false }, analysis }, { lang });
        expect(el.querySelector("[data-testid='precision-entry-strip']")?.getAttribute("data-precision-availability")).toBe("unavailable");
        const badge = el.querySelector("[data-testid='precision-data-state']");
        expect(badge?.getAttribute("data-precision-data")).toBe("unavailable");
        expect(badge?.textContent).toBe(lang === "en" ? "Intel unavailable" : "智能数据不可用");
        expect(el.querySelector("[data-testid='precision-posture']")).toBeNull();
      });
    }

    it("renders zero and false facts without a missing-data badge in " + lang, () => {
      const el = mount({
        analysis: {
          entry: { confidence: 0 },
          confluence: { htf_s1: false, bars_to_cross: 0 },
          sniper: { w2_stoch_d: 0, w2_washout: false, coiled: false },
        },
      }, { lang });
      expect(el.querySelector("[data-testid='precision-entry-strip']")?.getAttribute("data-precision-availability")).toBe("ready");
      expect(el.querySelector("[data-testid='precision-data-state']")).toBeNull();
      expect(el.querySelector("[data-testid='precision-bottom-confidence']")?.textContent).toContain("0");
      expect(el.querySelector("[data-testid='precision-htf']")?.textContent).toContain(lang === "en" ? "Not confirmed" : "未确认");
      expect(el.querySelector("[data-testid='precision-trigger']")?.textContent).toContain(lang === "en" ? "Crossing" : "正在交叉");
      expect(el.querySelector("[data-testid='precision-w2']")?.textContent).toContain(lang === "en" ? "Stoch D 0" : "随机指标 D 0");
    });
  }

});
