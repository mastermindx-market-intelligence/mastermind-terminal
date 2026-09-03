// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const panelReceipts = vi.hoisted(() => [] as Array<{
  dataReady: boolean;
  scaleLeft: boolean;
  mode: number;
}>);

vi.mock("@/components/ChartPanel", () => ({
  default: (props: {
    dataReady: boolean;
    chartSettings: { scaleLeft?: boolean; mode?: number };
  }) => {
    panelReceipts.push({
      dataReady: props.dataReady,
      scaleLeft: props.chartSettings.scaleLeft === true,
      mode: props.chartSettings.mode ?? 0,
    });
    return null;
  },
}));

vi.mock("@/components/ChartFrameBar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ChartFrameBar")>();
  const ReactModule = await import("react");
  return {
    ...actual,
    default: (props: {
      settings: { scaleLeft?: boolean };
      onSettings: (patch: { scaleLeft: boolean }) => void;
    }) => ReactModule.createElement("button", {
      "data-chart-side-toggle": "",
      onClick: () => props.onSettings({ scaleLeft: !props.settings.scaleLeft }),
    }),
  };
});
vi.mock("@/components/ChartSettingsModal", () => ({ default: () => null }));
vi.mock("@/components/AssetLogo", () => ({ default: () => null }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("@/lib/markets", () => ({ displayName: () => "NVIDIA" }));

import ChartPane from "@/components/ChartPane";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LEFT_PERCENT = { scaleLeft: true, mode: 2, scaleFontSize: 16 };
const storageWrites: string[] = [];

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
    if (key === "mm.chartSettings") storageWrites.push(String(value));
  }
}

function paneProps() {
  return {
    idx: 0,
    symbol: "NVDA",
    drawingOwnerKey: "guest",
    isActive: true,
    onActivate: () => {},
    row: { name: "NVIDIA", last: 192.53, chg: 1.2 },
    tf: "D",
    chartType: "candles",
    dataReady: true,
    inds: new Set<string>(),
    tool: null,
    detectCmd: null as never,
    compare: [] as string[],
    magnet: "off" as const,
    replayIdx: null,
    onMeta: () => {},
    drawings: [],
    onDrawingsChange: () => {},
  };
}

describe("ChartPane persisted chart-settings authority", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
    localStorage.clear();
    storageWrites.length = 0;
    panelReceipts.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  it("withholds fast child readiness until persisted left/percentage settings are authoritative", async () => {
    localStorage.setItem("mm.chartSettings", JSON.stringify(LEFT_PERCENT));

    await act(async () => {
      root!.render(React.createElement(ChartPane, paneProps()));
    });

    expect(panelReceipts.length).toBeGreaterThan(0);
    expect(
      panelReceipts.some((receipt) => receipt.dataReady && !receipt.scaleLeft),
      "no generation may be current-ready while the persisted left owner is still default/right",
    ).toBe(false);
    expect(panelReceipts.at(-1)).toMatchObject({
      dataReady: true,
      scaleLeft: true,
      mode: 2,
    });
  });

  it("never overwrites persisted settings with the initial default during StrictMode effect replay", async () => {
    localStorage.setItem("mm.chartSettings", JSON.stringify(LEFT_PERCENT));
    storageWrites.length = 0;

    await act(async () => {
      root!.render(React.createElement(
        StrictMode,
        null,
        React.createElement(ChartPane, paneProps()),
      ));
    });

    expect(JSON.parse(localStorage.getItem("mm.chartSettings") ?? "null")).toMatchObject(LEFT_PERCENT);
    expect(
      storageWrites.some((value) => JSON.parse(value).scaleLeft !== true),
      "the initial default must never be persisted over an existing settings owner",
    ).toBe(false);
    expect(
      panelReceipts.some((receipt) => receipt.dataReady && !receipt.scaleLeft),
      "StrictMode replay must not expose or persist a current-ready default generation",
    ).toBe(false);
  });

  it("does not accept requested left state until the live series reports the left owner", async () => {
    const { isRequestedPriceScaleApplied } = await vi.importActual<
      typeof import("@/components/ChartPanel")
    >("@/components/ChartPanel");
    let liveOwner = "right";
    const series = { options: () => ({ priceScaleId: liveOwner }) };

    expect(isRequestedPriceScaleApplied({ scaleLeft: true }, series)).toBe(false);
    liveOwner = "left";
    expect(isRequestedPriceScaleApplied({ scaleLeft: true }, series)).toBe(true);
    liveOwner = "right";
    expect(isRequestedPriceScaleApplied({ scaleLeft: false }, series)).toBe(true);
    expect(isRequestedPriceScaleApplied({ scaleLeft: false }, null)).toBe(false);
  });

  it("keeps no-storage startup right and forwards later live side changes without reopening hydration", async () => {
    await act(async () => {
      root!.render(React.createElement(ChartPane, paneProps()));
    });

    expect(panelReceipts.at(-1)).toMatchObject({ dataReady: true, scaleLeft: false, mode: 0 });
    const toggle = container.querySelector<HTMLButtonElement>("[data-chart-side-toggle]");
    expect(toggle).not.toBeNull();

    await act(async () => toggle!.click());
    expect(panelReceipts.at(-1)).toMatchObject({ dataReady: true, scaleLeft: true });

    await act(async () => toggle!.click());
    expect(panelReceipts.at(-1)).toMatchObject({ dataReady: true, scaleLeft: false });
  });
});
