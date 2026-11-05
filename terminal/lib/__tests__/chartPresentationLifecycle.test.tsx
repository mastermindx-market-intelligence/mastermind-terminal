// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ChartPanel", () => ({ default: () => null }));
vi.mock("@/components/ChartFrameBar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ChartFrameBar")>();
  const ReactModule = await import("react");
  return {
    ...actual,
    default: (props: { onSettings: (patch: { mode: number }) => void }) =>
      ReactModule.createElement("div", null,
        ReactModule.createElement("button", {
          "data-invalid-presentation": "", onClick: () => props.onSettings({ mode: 99 }),
        }),
        ReactModule.createElement("button", {
          "data-valid-presentation": "", onClick: () => props.onSettings({ mode: 0 }),
        })),
  };
});
vi.mock("@/components/ChartSettingsModal", () => ({ default: () => null }));
vi.mock("@/components/AssetLogo", () => ({ default: () => null }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("@/lib/markets", () => ({ displayName: () => "NVIDIA" }));

import ChartPane from "@/components/ChartPane";
import {
  CHART_PRESENTATION_SCHEMA, commitChartPresentation, readChartPresentation,
  type ChartPresentationCache, type ChartPresentationIdentity, type ChartPresentationSource,
} from "../chartPresentation";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const unavailable = { schema: CHART_PRESENTATION_SCHEMA, status: "unavailable",
  reason: "presentation_settings_invalid" };

describe("mounted chart presentation lifetime", () => {
  let container: HTMLDivElement;
  let root: Root;
  let cache: ChartPresentationCache;
  let updates: Array<{
    packet: Record<string, unknown> | null;
    source: ChartPresentationSource;
    deliver: (packet: Record<string, unknown> | null) => (() => void) | undefined;
    release: (() => void) | undefined;
  }>;
  const changed = vi.fn();

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    cache = {};
    updates = [];
    changed.mockClear();
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  function props(pane: number, active: boolean) {
    const identity: ChartPresentationIdentity = {
      symbol: "NVDA", tf: "D", pane_id: pane, chart_type: "candles",
      replay: false, day_trade_mode: false,
    };
    return {
      idx: pane, symbol: "NVDA", drawingOwnerKey: "guest", isActive: active,
      onActivate: () => {}, tf: "D", chartType: "candles", dataReady: true,
      inds: new Set<string>(), tool: null, detectCmd: null as never,
      compare: [] as string[], magnet: "off" as const, replayCutoff: null,
      onMeta: () => {}, drawings: [], onDrawingsChange: () => {},
      onPresentationState: (packet: Record<string, unknown> | null, source: ChartPresentationSource) => {
        const deliver = (next: Record<string, unknown> | null) =>
          commitChartPresentation(cache, identity, source, next, changed);
        const release = deliver(packet);
        updates.push({ packet, source, deliver, release });
        return release;
      },
    };
  }
  function expected(pane: number): ChartPresentationIdentity {
    return { symbol: "NVDA", tf: "D", pane_id: pane, chart_type: "candles",
      replay: false, day_trade_mode: false };
  }
  function click(selector: string) {
    act(() => container.querySelector<HTMLButtonElement>(selector)!.click());
  }

  it.each([[0, true], [1, false]] as const)(
    "invalid current settings retire observed evidence in pane %i (active=%s), then recover",
    (pane, active) => {
      act(() => root.render(React.createElement(ChartPane, props(pane, active))));
      const observed = readChartPresentation(cache, expected(pane));
      expect(observed?.status).toBe("observed");
      const previous = updates.at(-1)!;

      click("[data-invalid-presentation]");
      expect(updates.at(-1)?.packet).toMatchObject(unavailable);
      expect(readChartPresentation(cache, expected(pane))).toBeNull();
      // An old observer cannot resurrect evidence after current unavailability.
      previous.deliver(observed);
      expect(readChartPresentation(cache, expected(pane))).toBeNull();
      const invalidGeneration = updates.at(-1)!;

      click("[data-valid-presentation]");
      const recovered = readChartPresentation(cache, expected(pane));
      expect(recovered?.status).toBe("observed");
      invalidGeneration.deliver(unavailable);
      previous.release?.();
      expect(readChartPresentation(cache, expected(pane))).toBe(recovered);
    },
  );

  it("readiness loss withholds the last snapshot and cold recovery creates a new source", () => {
    const initial = props(0, true);
    act(() => root.render(React.createElement(ChartPane, initial)));
    const old = updates.at(-1)!;
    expect(readChartPresentation(cache, expected(0))?.status).toBe("observed");
    act(() => root.render(React.createElement(ChartPane, { ...initial, dataReady: false })));
    expect(readChartPresentation(cache, expected(0))).toBeNull();
    old.deliver(old.packet);
    expect(readChartPresentation(cache, expected(0))).toBeNull();
    act(() => root.render(React.createElement(ChartPane, initial)));
    expect(readChartPresentation(cache, expected(0))?.status).toBe("observed");
  });

  it("foreign pane absence and retired cleanup cannot clear a current sibling", () => {
    act(() => root.render(React.createElement(React.Fragment, null,
      React.createElement(ChartPane, { ...props(0, true), key: 0 }),
      React.createElement(ChartPane, { ...props(1, false), key: 1 }),
    )));
    const first = updates.filter((update) => update.source.identity.pane_id === 0).at(-1)!;
    const sibling = readChartPresentation(cache, expected(1));
    expect(sibling?.status).toBe("observed");
    commitChartPresentation(cache, expected(1), first.source, unavailable, changed);
    expect(readChartPresentation(cache, expected(1))).toBe(sibling);
    expect(readChartPresentation(cache, { ...expected(1), tf: "W" })).toBeNull();
  });

  it("StrictMode cleanup leaves the committed source usable and unmount closes it", () => {
    act(() => root.render(React.createElement(StrictMode, null,
      React.createElement(ChartPane, props(0, true)))));
    expect(readChartPresentation(cache, expected(0))?.status).toBe("observed");
    const current = updates.at(-1)!;
    act(() => root.render(null));
    expect(current.source.isCurrent()).toBe(false);
    current.deliver(current.packet);
    expect(readChartPresentation(cache, expected(0))).toBeNull();
  });
});
