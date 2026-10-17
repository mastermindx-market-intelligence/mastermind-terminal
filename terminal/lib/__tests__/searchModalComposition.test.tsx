// @vitest-environment jsdom
// Mount the real modal, deferred query, filtering, and EN/ZH lexicon.
// Removing the native IME guard must expose composing-key actions and selection changes.
// Synthetic component coverage only; this does not prove platform IME or full-shell behavior.
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchModal from "@/components/SearchModal";
import { LangProvider, LEX } from "@/lib/i18n";

// Keep unrelated service boundaries inert without replacing the search implementation.
vi.mock("@/components/onboarding/OnboardingProvider", () => ({
  useOnboarding: () => ({ open: vi.fn(), close: vi.fn() }),
}));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof SearchModal>;
type Mode = NonNullable<Props["mode"]>;
type Lang = "en" | "zh";
const MANIFEST: Props["manifest"] = {
  AAPL: { name: "Apple Inc.", zh: "苹果公司", col: "#777", verdict: null, sec: "Stock", mkt: "NASDAQ" },
  AAPX: { name: "Apple Example", zh: "苹果示例", col: "#777", verdict: null, sec: "Stock", mkt: "NASDAQ" },
};
const COMPOSITION_FLAGS = [
  ["isComposing", { isComposing: true }],
  ["legacy keyCode 229", { isComposing: false, keyCode: 229 }],
] as const;
let host: HTMLDivElement;
let root: Root;
let props: Props;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.setAttribute("data-lang", "en");
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false, media, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => true,
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  props = {
    open: true, seed: "", manifest: MANIFEST, inWatchlist: new Set<string>(), active: "MSFT",
    onClose: vi.fn(), onPick: vi.fn(), onAdd: vi.fn(), onToggleCompare: vi.fn(),
  };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  document.documentElement.removeAttribute("data-lang");
  vi.unstubAllGlobals();
});

const input = () => host.querySelector<HTMLInputElement>('[role="combobox"]')!;
const activeSymbol = () => {
  const id = input().getAttribute("aria-activedescendant");
  return id && document.getElementById(id)?.querySelector(".tk")?.textContent;
};

async function mount(lang: Lang, mode: Mode, strict: boolean) {
  document.documentElement.setAttribute("data-lang", lang);
  props.mode = mode;
  // Existing AAPL comparison makes an accidental Enter observably remove an overlay.
  props.compare = mode === "compare" ? ["AAPL"] : [];
  await act(async () => {
    const modal = <LangProvider><SearchModal {...props} /></LangProvider>;
    root.render(strict ? <React.StrictMode>{modal}</React.StrictMode> : modal);
  });
  const placeholder = mode === "compare" ? "comparePlaceholder" : "searchInputPlaceholder";
  expect(input().placeholder).toBe(LEX[placeholder][lang === "zh" ? 1 : 0]);
  const query = lang === "zh" ? "苹果" : "apple";
  await act(async () => {
    input().focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), query);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(input().value).toBe(query);
  expect(document.activeElement).toBe(input());
  expect(activeSymbol()).toBe("AAPL");
}

function key(value: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra });
  act(() => { input().dispatchEvent(event); });
  return event;
}

function startComposition() {
  act(() => {
    input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
  });
}

function noAction() {
  expect(props.onPick).not.toHaveBeenCalled();
  expect(props.onAdd).not.toHaveBeenCalled();
  expect(props.onToggleCompare).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
}

// The portable 60-case matrix runs in both render modes without environment switches.
describe.each(["normal", "StrictMode"] as const)("SearchModal focused IME (%s)", renderMode => {
  const strict = renderMode === "StrictMode";

  describe.each(["en", "zh"] as const)("%s", lang => {
    describe.each(["pick", "go", "add", "compare"] as const)("%s mode", mode => {
      it.each(COMPOSITION_FLAGS)("does not execute the selected symbol while Enter is %s", async (_label, flags) => {
        await mount(lang, mode, strict);
        startComposition();
        expect(key("Enter", flags).defaultPrevented).toBe(false);
        expect(activeSymbol()).toBe("AAPL");
        noAction();
      });

      it.each(COMPOSITION_FLAGS)("does not close the search while Escape is %s", async (_label, flags) => {
        await mount(lang, mode, strict);
        startComposition();
        expect(key("Escape", flags).defaultPrevented).toBe(false);
        expect(activeSymbol()).toBe("AAPL");
        noAction();
      });

      it("ordinary Enter executes exactly the intended action", async () => {
        await mount(lang, mode, strict);
        expect(key("Enter").defaultPrevented).toBe(true);
        if (mode === "add") {
          expect(props.onAdd).toHaveBeenCalledTimes(1);
          expect(props.onAdd).toHaveBeenCalledWith("AAPL");
          expect(props.onClose).not.toHaveBeenCalled();
          expect(props.onPick).not.toHaveBeenCalled();
          expect(props.onToggleCompare).not.toHaveBeenCalled();
        } else if (mode === "compare") {
          expect(props.onToggleCompare).toHaveBeenCalledTimes(1);
          expect(props.onToggleCompare).toHaveBeenCalledWith("AAPL");
          expect(props.onClose).not.toHaveBeenCalled();
          expect(props.onPick).not.toHaveBeenCalled();
          expect(props.onAdd).not.toHaveBeenCalled();
        } else {
          expect(props.onPick).toHaveBeenCalledTimes(1);
          expect(props.onPick).toHaveBeenCalledWith("AAPL");
          expect(props.onClose).toHaveBeenCalledTimes(1);
          expect(props.onAdd).not.toHaveBeenCalled();
          expect(props.onToggleCompare).not.toHaveBeenCalled();
        }
      });

      it("ordinary Escape closes without choosing", async () => {
        await mount(lang, mode, strict);
        key("Escape");
        expect(props.onClose).toHaveBeenCalledTimes(1);
        expect(props.onPick).not.toHaveBeenCalled();
        expect(props.onAdd).not.toHaveBeenCalled();
        expect(props.onToggleCompare).not.toHaveBeenCalled();
      });
    });

    it.each(COMPOSITION_FLAGS)("does not move symbol selection while ArrowDown is %s", async (_label, flags) => {
      await mount(lang, "pick", strict);
      expect(key("ArrowDown", flags).defaultPrevented).toBe(false);
      expect(activeSymbol()).toBe("AAPL");
      noAction();
    });

    it("compositionend restores ordinary Enter selection", async () => {
      await mount(lang, "pick", strict);
      startComposition();
      act(() => {
        input().dispatchEvent(new CompositionEvent("compositionend", {
          bubbles: true, data: lang === "zh" ? "苹果" : "apple",
        }));
      });
      expect(key("Enter").defaultPrevented).toBe(true);
      expect(props.onPick).toHaveBeenCalledTimes(1);
      expect(props.onPick).toHaveBeenCalledWith("AAPL");
      expect(props.onClose).toHaveBeenCalledTimes(1);
      expect(props.onAdd).not.toHaveBeenCalled();
      expect(props.onToggleCompare).not.toHaveBeenCalled();
    });

    it("does not execute during repeated composing Enter", async () => {
      await mount(lang, "pick", strict);
      expect(key("Enter", { isComposing: true, repeat: true }).defaultPrevented).toBe(false);
      expect(activeSymbol()).toBe("AAPL");
      noAction();
    });

    it("a composing key outside the field does not invoke its local handler", async () => {
      await mount(lang, "pick", strict);
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      outside.focus();
      try {
        expect(document.activeElement).toBe(outside);
        act(() => {
          outside.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter", isComposing: true, bubbles: true, cancelable: true,
          }));
        });
        noAction();
      } finally {
        outside.remove();
      }
    });

    it("ordinary ArrowDown chooses the next row", async () => {
      await mount(lang, "pick", strict);
      expect(key("ArrowDown").defaultPrevented).toBe(true);
      expect(activeSymbol()).toBe("AAPX");
      noAction();
    });
  });
});
