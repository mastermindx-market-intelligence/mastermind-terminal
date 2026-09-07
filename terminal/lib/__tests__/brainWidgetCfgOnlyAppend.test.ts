// @vitest-environment jsdom
//
// Meta-CEO B ruling r6, MINOR-1 promoted to a required fix (review round-`0ce9d77e`):
// `components/BrainWidget.tsx` used to gate its ENTIRE install effect on
// `if (w.MM_BRAIN_CFG) return;`, placed BEFORE the separate host/script append gate
// (`if (hostAlreadyMounted || document.querySelector(...)) return;`). The in-tree comment
// above that effect already claimed "Seed CFG whenever it is missing; only the
// script-append is gated on an existing host" — but the code did the opposite: on a document
// where `MM_BRAIN_CFG` exists (a prior mount already seeded it, e.g. a fast route remount)
// while `window.MMBrain` and the `<script src="mm_brain.js">` tag do NOT exist yet, the whole
// effect returned at the CFG check and `mm_brain.js` was never appended — the Brain never
// loads for that document at all.
//
// This test preseeds `window.MM_BRAIN_CFG` ONLY (no `window.MMBrain`, no existing script tag)
// before mounting BrainWidget, mirroring exactly that document state, and asserts the script
// IS appended. Before the fix (early return moved after the append gate) this is RED: the
// query below finds no such <script> element. Same no-@testing-library harness as
// brainWidgetColdSymbol.test.ts / brainWidgetRebinding.test.ts (react-dom/client createRoot +
// react act).
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import BrainWidget from "@/components/BrainWidget";
import type { MastermindBrainHost } from "@/lib/mastermindBrain";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;
const SCRIPT_SELECTOR = 'script[src="https://www.mastermind-x.com/mm_brain.js"]';

describe("BrainWidget appends mm_brain.js when MM_BRAIN_CFG already exists but no host/script does (Meta-CEO B ruling r6, MINOR-1 promoted)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    document.querySelectorAll(SCRIPT_SELECTOR).forEach((el) => el.remove());
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
    const w = window as unknown as MastermindBrainHost & Record<string, unknown>;
    delete w.MM_BRAIN_CFG;
    delete w.MMBrain;
    document.querySelectorAll(SCRIPT_SELECTOR).forEach((el) => el.remove());
  });

  it("still appends the script when CFG is preseeded but no host and no script tag exist yet", () => {
    const w = window as unknown as MastermindBrainHost & Record<string, unknown>;
    delete w.MMBrain;
    // Preseed CFG exactly like an earlier mount already ran — but crucially with NO
    // window.MMBrain and NO existing <script> tag, i.e. the append gate would say "go ahead".
    w.MM_BRAIN_CFG = {
      anchor: "top",
      api: "",
      symbol: () => "NVDA",
      onCommand: noop,
      onAnnotate: noop,
      onAuthRequired: noop,
      getAiContext: () => undefined,
    };

    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();

    act(() => {
      root = createRoot(container);
      root!.render(
        React.createElement(BrainWidget, {
          active: "NVDA",
          onCommand: noop,
          onAnnotate: noop,
        }),
      );
    });

    expect(document.querySelector(SCRIPT_SELECTOR)).not.toBeNull();
  });

  it("does NOT append a second script when a host is already mounted (unchanged behavior)", () => {
    const w = window as unknown as MastermindBrainHost & Record<string, unknown>;
    w.MM_BRAIN_CFG = {
      anchor: "top",
      api: "",
      symbol: () => "NVDA",
      onCommand: noop,
      onAnnotate: noop,
      onAuthRequired: noop,
      getAiContext: () => undefined,
    };
    w.MMBrain = {} as unknown as MastermindBrainHost["MMBrain"];

    act(() => {
      root = createRoot(container);
      root!.render(
        React.createElement(BrainWidget, {
          active: "NVDA",
          onCommand: noop,
          onAnnotate: noop,
        }),
      );
    });

    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
  });
});
