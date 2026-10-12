// @vitest-environment jsdom
import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Drawing } from "@/lib/drawings";

// ChartPanel rebuilds every drawing node from scratch whenever the identity of its `drawings`
// prop changes (its `useEffect(() => renderRef.current?.(), [drawings])`). The stand-in below
// keeps exactly that dependency, so `rebuilds` counts the real teardown-and-rebuild passes.
const seen = vi.hoisted(() => ({
  drawings: [] as unknown[],
  rebuilds: 0,
  onDrawingsChange: null as null | ((d: unknown[]) => void),
}));
vi.mock("@/components/ChartPanel", () => ({
  default: function ChartPanelStandIn(props: { drawings: unknown[]; onDrawingsChange: (d: unknown[]) => void }) {
    seen.drawings.push(props.drawings);
    seen.onDrawingsChange = props.onDrawingsChange;
    useEffect(() => { seen.rebuilds += 1; }, [props.drawings]);
    return null;
  },
}));
vi.mock("@/components/ChartFrameBar", () => ({
  default: () => null,
  DEFAULT_CHART_SETTINGS: { titleMode: "name", showLogo: false, showSymbolName: true, extHours: false },
}));
vi.mock("@/components/ChartSettingsModal", () => ({ default: () => null }));
vi.mock("@/components/AssetLogo", () => ({ default: () => null }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("@/lib/markets", () => ({ displayName: (row: { name?: string } | null | undefined) => row?.name ?? "" }));
vi.mock("@/lib/intradaySources", () => ({ classify: () => "us", isIntradayTf: () => false }));
vi.mock("@/lib/macroSymbols", () => ({ isMacroSymbol: () => false }));

import ChartPane from "@/components/ChartPane";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const line = (id: string, p: number): Drawing => ({ id, kind: "trendline", points: [{ t: "2026-01-02", p }, { t: "2026-01-09", p: p + 1 }] });

// TerminalShell's call site: a freshly spread `drawings` array on every one of its renders,
// built from the per-symbol store. `pulse` stands for any unrelated shell state (a save starting
// or finishing, a quote tick) that re-renders the shell without touching the store.
const shell: { pulse: () => void; setStore: (next: Drawing[]) => void; setVisible: (next: boolean) => void } = {
  pulse: () => {},
  setStore: () => {},
  setVisible: () => {},
};
function Shell({ initial }: { initial: Drawing[] }) {
  const [store, setStoreState] = useState(initial);
  const [tick, setTick] = useState(0);
  const [visible, setVisibleState] = useState(true);
  useEffect(() => {
    shell.pulse = () => setTick((n) => n + 1);
    shell.setStore = setStoreState;
    shell.setVisible = setVisibleState;
  }, []);
  return (
    <ChartPane
      idx={0} symbol="AAPL" drawingOwnerKey="account:test" isActive onActivate={() => {}}
      row={{ name: "Apple", last: 200 + tick, chg: 0.5 }} tf="D" chartType="candles" inds={new Set<string>()}
      tool={null} detectCmd={null} compare={[]} magnet="off" replayCutoff={null} onMeta={() => {}}
      drawings={[...store]} drawingsVisible={visible} onDrawingsChange={(d) => setStoreState(d)}
    />
  );
}

describe("ChartPane drawing identity across unrelated shell renders", () => {
  let root: Root, host: HTMLDivElement;
  const latest = () => seen.drawings[seen.drawings.length - 1];
  beforeEach(() => {
    seen.drawings = []; seen.rebuilds = 0; seen.onDrawingsChange = null;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it("keeps the same drawings array, and does not rebuild the layer, when the shell re-renders with the same drawings", async () => {
    const stored = [line("a", 10), line("b", 20)];
    await act(async () => root.render(<Shell initial={stored} />));
    const before = latest();
    const rebuildsBefore = seen.rebuilds;
    const rendersBefore = seen.drawings.length;

    await act(async () => shell.pulse());
    await act(async () => shell.pulse());

    expect(seen.drawings.length).toBeGreaterThan(rendersBefore);   // the chart really re-rendered
    expect(latest()).toBe(before);
    expect(seen.rebuilds).toBe(rebuildsBefore);
  });

  it("still hands over a new array, and rebuilds once, when a drawing really changes", async () => {
    const a = line("a", 10), b = line("b", 20);
    await act(async () => root.render(<Shell initial={[a, b]} />));
    const before = latest();
    const rebuildsBefore = seen.rebuilds;

    const moved = { ...b, points: [{ t: "2026-01-02", p: 30 }, { t: "2026-01-09", p: 31 }] };
    await act(async () => shell.setStore([a, moved]));

    expect(latest()).not.toBe(before);
    expect(latest()).toEqual([a, moved]);
    expect((latest() as Drawing[])[1]).toBe(moved);
    expect(seen.rebuilds).toBe(rebuildsBefore + 1);

    // Removing a drawing and re-adding the same object in another order are real changes too.
    await act(async () => shell.setStore([moved, a]));
    expect(latest()).toEqual([moved, a]);
    expect(seen.rebuilds).toBe(rebuildsBefore + 2);
    await act(async () => shell.setStore([moved]));
    expect(latest()).toEqual([moved]);
    expect(seen.rebuilds).toBe(rebuildsBefore + 3);
  });

  it("keeps the merged array stable while pane-local detected drawings are shown", async () => {
    const hand = line("a", 10);
    await act(async () => root.render(<Shell initial={[hand]} />));
    const detected: Drawing = { ...line("auto1", 5), source: "detector", auto: true };
    // A detector result reaches the pane through its change callback; only the pane keeps it.
    await act(async () => seen.onDrawingsChange?.([hand, detected]));
    expect(latest()).toEqual([hand, detected]);
    const before = latest();
    const rebuildsBefore = seen.rebuilds;

    await act(async () => shell.pulse());

    expect(latest()).toBe(before);
    expect(seen.rebuilds).toBe(rebuildsBefore);
  });

  it("keeps the empty list stable while drawings are hidden", async () => {
    await act(async () => root.render(<Shell initial={[line("a", 10)]} />));
    await act(async () => shell.setVisible(false));
    expect(latest()).toEqual([]);
    const before = latest();
    const rebuildsBefore = seen.rebuilds;

    await act(async () => shell.pulse());

    expect(latest()).toBe(before);
    expect(seen.rebuilds).toBe(rebuildsBefore);

    await act(async () => shell.setVisible(true));
    expect(latest()).toEqual([line("a", 10)]);
    expect(seen.rebuilds).toBe(rebuildsBefore + 1);
  });
});
