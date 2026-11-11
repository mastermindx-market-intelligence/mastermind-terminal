// @vitest-environment jsdom
import React, { StrictMode, act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VisualIntelligencePanel, { type VisualIntelligenceHandle } from "@/components/VisualIntelligencePanel";
import { buildVisualSeries, VISUAL_INTELLIGENCE_DEFAULTS, type VisualFrame } from "@/lib/visualIntelligence";
import { track } from "@/lib/analytics";

const language = vi.hoisted(() => ({ value: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: language.value }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/fund", () => ({ getFund: vi.fn(async () => null) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("chart reader feedback acknowledgement", () => {
  let container: HTMLElement;
  let target: HTMLElement;
  let outside: HTMLButtonElement;
  let root: Root;
  const frame: VisualFrame = {
    series: buildVisualSeries("NVDA", "1d", Array.from({ length: 120 }, (_, index) => ({
      time: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      o: 100 + index, h: 103 + index, l: 99 + index, c: 102 + index, v: 1000 + index,
    })), "momentum"),
    replay: false, colored: true, basis: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
      return (this.isConnected ? [new DOMRect(0, 0, 320, 44)] : []) as unknown as DOMRectList;
    });
    container = document.createElement("div");
    target = document.createElement("div");
    outside = document.createElement("button");
    document.body.append(container, target, outside);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    target.remove();
    outside.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  for (const lang of ["en", "zh"] as const) {
    for (const choice of ["useful", "unclear"] as const) {
      for (const ownsFocus of [true, false]) {
        it(`${lang} / ${choice}: acknowledges once and preserves ${ownsFocus ? "reader" : "outside"} focus`, async () => {
          language.value = lang;
          const ref = createRef<VisualIntelligenceHandle>();
          await act(async () => root.render(<StrictMode><VisualIntelligencePanel
            ref={ref} symbol="NVDA" timeframe="1d" visible replay={false}
            settings={VISUAL_INTELLIGENCE_DEFAULTS}
            dock={{ open: true, target, onOpen: vi.fn(), onClose: vi.fn() }}
            onSettings={vi.fn()} onInspectTime={vi.fn()} onCalendar={vi.fn()}
          /></StrictMode>));
          await act(async () => ref.current!.update(frame));
          const reader = target.querySelector<HTMLElement>("[data-context-reader]")!;
          const control = (key: string) => reader.querySelector<HTMLButtonElement>(`[data-context-focus="${key}"]`)!;
          act(() => control("previous").click());
          const selected = reader.querySelector("[data-context-bar-time]")!.textContent;
          act(() => control("help").click());
          const action = control(choice);
          const other = control(choice === "useful" ? "unclear" : "useful");
          (ownsFocus ? action : outside).focus();
          // Multiple activations before React commits must still record only the first choice.
          act(() => { action.click(); other.click(); action.click(); });

          const thanks = lang === "zh" ? "感谢你的反馈" : "Thank you for the feedback";
          expect(action.isConnected).toBe(true);
          expect(control(choice)).toBe(action);
          expect(document.activeElement).toBe(ownsFocus ? action : outside);
          expect(action.getAttribute("aria-disabled")).toBe("true");
          expect(action.disabled).toBe(false);
          expect(action.textContent).toBe(thanks);
          expect(other.hidden).toBe(true);
          expect(reader.querySelector('[role="status"]')?.textContent).toBe(thanks);
          expect(reader.querySelector("[data-context-bar-time]")!.textContent).toBe(selected);
          expect(reader.querySelector("[data-context-calendar]")?.getAttribute("data-context-calendar")).toBe("withheld");
          expect(control("help").closest("details")!.open).toBe(true);

          // A repeated activation, including a stale reference to the hidden choice,
          // must not emit another event or change the acknowledged choice.
          act(() => { action.click(); action.click(); other.click(); });
          const feedback = vi.mocked(track).mock.calls.map(([event]) => event)
            .filter(event => typeof event.meta === "object" && event.meta !== null && "action" in event.meta && event.meta.action === "feedback");
          expect(feedback).toEqual([{
            type: "click", ticker: "NVDA",
            meta: { feature: "visual_intelligence", action: "feedback", timeframe: "1d", language: lang, useful: choice === "useful" },
          }]);
          expect(action.textContent).toBe(thanks);
          expect(other.hidden).toBe(true);
          expect(document.activeElement).toBe(ownsFocus ? action : outside);
        });
      }
    }
  }
});
