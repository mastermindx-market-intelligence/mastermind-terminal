/**
 * drawingSidebarAcceptedTool.test.tsx — the dock's group button must follow the tool the
 * parent actually armed, not the one the user merely asked for.
 *
 * TerminalShell refuses a tool whenever the active symbol's drawings are not ready (an
 * account read still pending or failed, or a drawing-owner switch in flight) without
 * setting `creationDisabledReason`. The sidebar used to record the request as its group's
 * last-used tool before calling `onTool`, so a refused pick still repainted the group
 * button, and a refused double-click still pinned the tool for its next activation.
 *
 * Mounts DrawingSidebar with react-dom/client (jsdom) behind a parent that owns `tool`.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useEffect, useState } from "react";
import DrawingSidebar, { type DrawingSidebarProps } from "@/components/DrawingSidebar";
import type { DrawKind } from "@/lib/drawings";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

type Harness = {
  accept: boolean;
  onPinned: ReturnType<typeof vi.fn>;
  setTool: (tool: DrawKind | null) => void;
};

let harness: Harness;

/** Arms `tool` the way another surface (shortcut, phone sheet, native bridge) would. */
function SetToolBridge({ setTool }: { setTool: (tool: DrawKind | null) => void }) {
  useEffect(() => { harness.setTool = setTool; }, [setTool]);
  return null;
}

function Parent() {
  const [tool, setTool] = useState<DrawKind | null>(null);
  const props: DrawingSidebarProps = {
    tool,
    creationDisabledReason: null,
    magnet: "off",
    sticky: false,
    stayActive: false,
    pinned: false,
    drawingsVisible: true,
    drawingsLocked: false,
    drawingCount: 0,
    userDrawingCount: 0,
    detectedDrawingCount: 0,
    indicatorCount: 0,
    canUndo: false,
    canRedo: false,
    drawStyle: { color: "#4d82ff", width: 1.5, dash: "solid" },
    // Mirrors TerminalShell.activateDrawingTool: a refusal leaves `tool` untouched.
    onTool: (id) => {
      if (id !== null && !harness.accept) return false;
      setTool(id);
      return true;
    },
    onMagnet: () => {},
    onSticky: () => {},
    onPinned: harness.onPinned,
    onToggleVisibility: () => {},
    onToggleLock: () => {},
    onUndo: () => {},
    onRedo: () => {},
    onClear: () => {},
    onDrawStyle: () => {},
  };
  return (
    <>
      <SetToolBridge setTool={setTool} />
      <DrawingSidebar {...props} />
    </>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  harness = { accept: true, onPinned: vi.fn(), setTool: () => {} };
  act(() => { root.render(<Parent />); });
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

const byTestId = (id: string) => {
  const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`missing [data-testid="${id}"]`);
  return element;
};
const linesMain = () => byTestId("drawing-group-lines-main");

/** Keyboard-equivalent pick (detail 0) from the Lines flyout: immediate, no dblclick window. */
function pickFromLinesMenu(tool: DrawKind) {
  act(() => { byTestId("drawing-group-lines-menu-trigger").click(); });
  act(() => {
    byTestId(`drawing-tool-${tool}`).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
  });
}

describe("DrawingSidebar — group button follows the accepted tool", () => {
  it("keeps the group button on its previous tool when the parent refuses the pick", () => {
    expect(linesMain().getAttribute("data-tool-id")).toBe("trendline");
    harness.accept = false;

    pickFromLinesMenu("hline");

    expect(linesMain().getAttribute("aria-pressed")).toBe("false");
    expect(linesMain().getAttribute("data-tool-id")).toBe("trendline");
  });

  it("remembers an accepted pick after the tool disarms (existing last-used behaviour)", () => {
    pickFromLinesMenu("hline");
    expect(linesMain().getAttribute("aria-pressed")).toBe("true");
    expect(linesMain().getAttribute("data-tool-id")).toBe("hline");

    act(() => { harness.setTool(null); });
    expect(linesMain().getAttribute("aria-pressed")).toBe("false");
    expect(linesMain().getAttribute("data-tool-id")).toBe("hline");
  });

  it("remembers a tool armed through another surface (shortcut, phone sheet, native bridge)", () => {
    act(() => { harness.setTool("vline"); });
    act(() => { harness.setTool(null); });
    expect(linesMain().getAttribute("data-tool-id")).toBe("vline");
  });

  it("does not pin a tool the parent refused", () => {
    harness.accept = false;
    act(() => { linesMain().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(harness.onPinned).not.toHaveBeenCalled();
    expect(linesMain().getAttribute("aria-pressed")).toBe("false");
  });

  it("still pins an accepted double-click", () => {
    act(() => { linesMain().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(harness.onPinned).toHaveBeenCalledWith("trendline");
  });
});
