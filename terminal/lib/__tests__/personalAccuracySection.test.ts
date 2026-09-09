// @vitest-environment jsdom
//
// Review MAJOR (round 2): accDetLoadErr was rendered in the glance body when
// loadErr was set. Spec 2.6 / reviewer §3.5 allow that sentence only behind
// the detail control. This mounts the real SectionAccuracy (no test double)
// and reads the rendered text before and after the toggle.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import SectionAccuracy from "@/components/settings/SectionAccuracy";
import { LEX } from "@/lib/i18n";
import { emptyAccuracyReadout, populatedAccuracyFixture } from "@/lib/personalAccuracy";
import type { AccuracyProps } from "@/components/settings/SectionAccuracy";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeT(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const e = LEX[key];
    return e ? e[lang === "zh" ? 1 : 0] : (fallback ?? key);
  };
}

function baseProps(lang: "en" | "zh", extra: Partial<AccuracyProps> = {}): AccuracyProps {
  return {
    t: makeT(lang),
    lang,
    identity: { kind: "guest" },
    email: "a@example.com",
    user: null,
    onClose: () => {},
    onPatchMeta: () => {},
    onRefreshUser: async () => {},
    readout: emptyAccuracyReadout(),
    loadErr: false,
    ...extra,
  };
}

describe("SectionAccuracy load-error placement (review MAJOR round 2)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  function mount(lang: "en" | "zh", extra: Partial<AccuracyProps> = {}) {
    act(() => {
      root = createRoot(container);
      root!.render(React.createElement(SectionAccuracy, baseProps(lang, extra)));
    });
  }

  it("EN: a load error is not in the glance body; it appears after Show the full record", () => {
    const err = LEX.accDetLoadErr[0];
    mount("en", { readout: null, loadErr: true });
    expect(container.textContent).not.toContain(err);
    expect(container.textContent).toContain(LEX.accCeiling[0]);
    const toggle = container.querySelector("button.acs-acc-toggle") as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.textContent).toBe(LEX.accDetailOpen[0]);
    act(() => {
      toggle.click();
    });
    expect(container.querySelector(".acs-acc-detail")?.textContent).toContain(err);
    expect(container.querySelector(".acs-body")?.textContent).toContain(err);
  });

  it("ZH: a load error is not in the glance body; it appears after 查看完整记录", () => {
    const err = LEX.accDetLoadErr[1];
    mount("zh", { readout: null, loadErr: true });
    expect(container.textContent).not.toContain(err);
    const toggle = container.querySelector("button.acs-acc-toggle") as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    expect(container.querySelector(".acs-acc-detail")?.textContent).toContain(err);
  });

  it("EN: a healthy empty ledger still prints the frozen empty sentence, never the load-error line", () => {
    mount("en", { readout: emptyAccuracyReadout(), loadErr: false });
    expect(container.textContent).toContain(LEX.accEmpty[0]);
    expect(container.textContent).not.toContain(LEX.accDetLoadErr[0]);
  });

  it("EN: a populated detail row prints the hits sentence, not a slash fraction", () => {
    mount("en", { readout: populatedAccuracyFixture(), loadErr: false });
    const toggle = container.querySelector("button.acs-acc-toggle") as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    const detail = container.querySelector(".acs-acc-detail")?.textContent || "";
    expect(detail).not.toMatch(/\b7\s*\/\s*10\b/);
    expect(detail).toContain("7");
    expect(detail).toContain("10");
  });
});
