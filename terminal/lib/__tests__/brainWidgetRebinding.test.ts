// @vitest-environment jsdom
//
// Reviewer ruling M6(c): proves BrainWidget's per-callback write-through effects (M6(a),
// components/BrainWidget.tsx) actually keep the document-level `window.MM_BRAIN_CFG` singleton
// bound to the CURRENTLY MOUNTED instance across a mount -> unmount -> remount cycle (e.g.
// toggling the Brain dock off then on — freeze §7's own new capability). Before M6(a),
// onCommand/onAnnotate/onAuthRequired/getAiContext were captured ONCE by the mount-once install
// effect and never rebound on a later mount (whose install effect no-ops because the <script> tag
// from the first mount is still present) — so the singleton kept calling back into the first,
// now-unmounted instance's stale refs forever. `symbol` is asserted too even though it needed no
// fix (handoffMastermindBrainSymbol already rebinds it on every mount) so this test covers the
// exact "all four callbacks + getAiContext" set the reviewer named.
//
// No @testing-library/react in this repo (vitest.config.ts's `include` is
// lib/__tests__/**/*.test.ts only, no .test.tsx precedent) — this uses react-dom/client's
// createRoot + react's act directly (both already direct dependencies), written as .ts with
// React.createElement instead of JSX so it matches the existing include glob without widening it.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import BrainWidget from "@/components/BrainWidget";
import type { MastermindBrainHost } from "@/lib/mastermindBrain";

// No @testing-library/react's environment setup in this repo, so tell React directly that act()
// is expected — otherwise every act() call logs a harmless-but-noisy console warning.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = {
  active: string;
  onCommand: (j: any) => void;
  onAnnotate: (j: any) => void;
  onAuthRequired: () => void;
  getAiContext: () => any;
};

describe("BrainWidget CFG singleton rebinds across mount -> unmount -> remount (reviewer ruling M6)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const w = window as unknown as MastermindBrainHost & Record<string, unknown>;
    delete w.MM_BRAIN_CFG;
    delete w.MMBrain;
    delete w.__MM_BRAIN_ACTIVE_SYMBOL__;
    document.querySelectorAll('script[src*="mm_brain.js"]').forEach((el) => el.remove());
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  function mount(props: Props) {
    act(() => {
      root = createRoot(container);
      root!.render(React.createElement(BrainWidget, props));
    });
  }

  it("rebinds onCommand/onAnnotate/onAuthRequired/getAiContext/symbol to the second instance, not the first", () => {
    const calls: string[] = [];
    mount({
      active: "AAPL",
      onCommand: () => calls.push("instance1.onCommand"),
      onAnnotate: () => calls.push("instance1.onAnnotate"),
      onAuthRequired: () => calls.push("instance1.onAuthRequired"),
      getAiContext: () => {
        calls.push("instance1.getAiContext");
        return { marker: "instance1" };
      },
    });

    const w = window as unknown as MastermindBrainHost;
    expect(w.MM_BRAIN_CFG).toBeDefined();

    // Unmount instance #1 — the write-through effects' cleanups relinquish the singleton's keys
    // (each checks it still holds THIS instance's own closure before clearing it).
    act(() => {
      root?.unmount();
    });

    mount({
      active: "MSFT",
      onCommand: () => calls.push("instance2.onCommand"),
      onAnnotate: () => calls.push("instance2.onAnnotate"),
      onAuthRequired: () => calls.push("instance2.onAuthRequired"),
      getAiContext: () => {
        calls.push("instance2.getAiContext");
        return { marker: "instance2" };
      },
    });

    // The install effect no-ops on this remount — the <script> tag from instance #1's mount is
    // still in the DOM (never removed on unmount) — proving the fix lives entirely in the
    // per-callback write-through effects, not a reset of the install effect's guard.
    expect(document.querySelectorAll('script[src*="mm_brain.js"]').length).toBe(1);

    const cfg = w.MM_BRAIN_CFG as Record<string, any>;
    cfg.onCommand({});
    cfg.onAnnotate({});
    cfg.onAuthRequired();
    const ctx = cfg.getAiContext();
    const symbol = cfg.symbol();

    expect(calls).toEqual([
      "instance2.onCommand",
      "instance2.onAnnotate",
      "instance2.onAuthRequired",
      "instance2.getAiContext",
    ]);
    expect(ctx.marker).toBe("instance2");
    expect(symbol).toBe("MSFT");
  });
});
