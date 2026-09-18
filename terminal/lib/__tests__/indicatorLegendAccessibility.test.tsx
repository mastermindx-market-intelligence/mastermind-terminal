// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChartOverlays, { type PaneInfo } from "@/components/ChartOverlays";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function renderLegend(overrides: Partial<React.ComponentProps<typeof ChartOverlays>> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const actions = {
    onEye: vi.fn(),
    onSettings: vi.fn(),
    onSource: vi.fn(),
    onRemove: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onCollapse: vi.fn(),
    onMaximize: vi.fn(),
    canMoveUp: vi.fn(() => false),
    canMoveDown: vi.fn(() => false),
  };
  const panes: PaneInfo[] = [{
    key: "__price__",
    paneIndex: 0,
    isPrice: true,
    top: 0,
    height: 400,
    collapsed: false,
    maximized: false,
    entries: [{ key: "ema", label: "Moving Averages", kind: "overlay", hidden: false, isPine: false }],
  }];
  act(() => root!.render(
    <ChartOverlays
      panes={panes}
      hoveredKey={null}
      legendOpen
      onToggleLegend={() => {}}
      {...actions}
      {...overrides}
    />,
  ));
  return { host, actions };
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("indicator legend More menu keyboard semantics", () => {
  it("renders every actionable menu row as a native button and moves focus into the menu", () => {
    const { host } = renderLegend();
    const more = host.querySelector<HTMLButtonElement>(".lg-row .lg-menu .lg-ic:last-child");
    expect(more).not.toBeNull();
    more!.focus();
    act(() => more!.click());

    const rows = [...host.querySelectorAll<HTMLButtonElement>(".lg-more-row")];
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((row) => row.tagName === "BUTTON")).toBe(true);
    expect(rows.every((row) => row.tabIndex === 0)).toBe(true);
    expect(document.activeElement).toBe(rows[0]);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector(".lg-more")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("uses disabled native buttons for unavailable pane moves instead of pointer-only divs", () => {
    const pane: PaneInfo = {
      key: "rsi",
      removeKey: "rsi",
      paneIndex: 1,
      isPrice: false,
      top: 400,
      height: 180,
      collapsed: false,
      maximized: false,
      entries: [{ key: "rsi", label: "RSI", kind: "pane", hidden: false, isPine: false }],
    };
    const { host } = renderLegend({
      panes: [pane],
      hoveredKey: "rsi",
      paneButtons: "always",
    });
    const more = host.querySelector<HTMLButtonElement>(".lg-row .lg-menu .lg-ic:last-child");
    expect(more).not.toBeNull();
    act(() => more!.click());

    const rows = [...host.querySelectorAll<HTMLButtonElement>(".lg-more-row")];
    const moveUp = rows.find((row) => row.textContent?.includes("Move pane up"));
    const moveDown = rows.find((row) => row.textContent?.includes("Move pane down"));
    expect(moveUp).toBeDefined();
    expect(moveDown).toBeDefined();
    expect(moveUp!.disabled).toBe(true);
    expect(moveDown!.disabled).toBe(true);
    expect(moveUp!.matches(":disabled")).toBe(true);
    expect(moveDown!.matches(":disabled")).toBe(true);
  });
});
