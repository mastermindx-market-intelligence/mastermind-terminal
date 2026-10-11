// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import IndicatorsModal from "@/components/IndicatorsModal";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = function scrollTo() {};
}

if (typeof window.matchMedia !== "function") {
  window.matchMedia = (() => ({
    matches: false,
    media: "",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  })) as typeof window.matchMedia;
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function Harness() {
  const [configured, setConfigured] = useState(true);
  const [canUndo, setCanUndo] = useState(true);
  return (
    <LangProvider>
      <IndicatorsModal
        open
        active={configured ? new Set(["structure", "trend", "rsix", "gaps"]) : new Set(["ema"])}
        activeChartWorkflow={configured ? "reversal-reclaim" : undefined}
        onClose={() => {}}
        onToggle={() => {}}
        onApplyChartWorkflow={() => {}}
        onUndoChartWorkflow={canUndo ? () => {
          setCanUndo(false);
          setConfigured(false);
        } : undefined}
        userTier="pro"
      />
    </LangProvider>
  );
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("Reversal & Reclaim undo focus", () => {
  it("keeps keyboard focus inside the Indicator Library when Undo removes its own button", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<Harness />); });

    const dialog = host.querySelector<HTMLElement>("#indicator-library-dialog");
    expect(dialog).not.toBeNull();

    const presets = [...host.querySelectorAll<HTMLButtonElement>(".im-nav-item")]
      .find((button) => button.textContent?.includes("Systems & Presets"));
    expect(presets).toBeDefined();
    await act(async () => { presets!.click(); });

    const undo = host.querySelector<HTMLButtonElement>('[data-testid="undo-chart-workflow"]');
    expect(undo).not.toBeNull();
    undo!.focus();
    expect(document.activeElement).toBe(undo);

    await act(async () => { undo!.click(); });

    expect(host.querySelector('[data-testid="undo-chart-workflow"]')).toBeNull();
    expect(dialog!.contains(document.activeElement)).toBe(true);
  });
});
