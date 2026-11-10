// @vitest-environment jsdom
/**
 * Controller lifecycle tests for the Cycles lens (Round 3 gates):
 * mount → capture is non-null and exact; applyView restores exactly, is
 * rejected on invalid/foreign views, and reports an honest partial when the
 * source vanishes mid-apply; a replaced generation or a new subject retires
 * cursors; the self-bound popstate router is exactly one listener that dies
 * with the controller and never duplicates on remount.
 *
 * The real SectorCycleLens, its real children and the real capture/apply
 * codec run here; only the feeds are fixture props. Assertions are about
 * observable behaviour, never internal state.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SectorCycleLens from "@/components/sector-intelligence/SectorCycleLens";
import type {
  SectorCycleCaptureHandle,
  SectorCycleFeed,
} from "@/components/sector-intelligence/cycles/cycleProps";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-10-30";
const PUB = "cycp1-" + "ab".repeat(32);
const day = (i: number) => new Date(Date.UTC(2026, 9, 23) + i * 86_400_000).toISOString().slice(0, 10);
const DATES = Array.from({ length: 8 }, (_, i) => day(i));

/* ── Fixtures (parser-valid, deterministic) ──────────────────────────────── */

const deepCycles = () => ({
  meta: {
    asOf: AS_OF,
    structure_basis: "tr",
    membership: "current_membership",
    history_mode: "reconstructed_price_history",
    classifier: "cycle_pos_v2",
    live_hazard_parity: { verdict: "PARITY_HOLDS" },
  },
  evidence: {
    schema: "sector_cycles.evidence.v1",
    status: "verified",
    publicationId: PUB,
    asOf: AS_OF,
    region: "us",
    parts: { core: "verified", series: "verified" },
  },
  sectors: [
    {
      id: "xlk",
      ticker: "XLK",
      kind: "sector",
      name: "Technology",
      name_zh: "科技",
      basis: "tr",
      now: {
        phase: "Expansion",
        phase_v2: "Expansion",
        phase_v2_source: "ontology",
        pos_v2: 72,
        phase_v2_position_input: "pos_v2",
        above200d: true,
        read: "Technology is Trending within its cycle.",
        read_zh: "科技板块上行中。",
        phase_v2_age: { status: "measured", sessions: 25 },
      },
      osc: Array.from({ length: 60 }, (_, i) => ({
        x: +(2025 + i * 0.1).toFixed(1),
        v: +((i % 10) * 9 + 5).toFixed(1),
      })),
      story: { en: "s", zh: "s", epoch: AS_OF },
    },
    {
      id: "xlf",
      ticker: "XLF",
      kind: "sector",
      name: "Financials",
      name_zh: "金融",
      basis: "price",
      now: {
        phase: "Recovery",
        phase_v2: "Recovery",
        phase_v2_source: "ontology",
        pos_v2: 41,
        phase_v2_position_input: "pos_v2",
        above200d: false,
        phase_v2_age: { status: "measured", sessions: 9 },
      },
    },
  ],
});

const historyPayload = () => ({
  meta: {
    asOf: AS_OF,
    rs_history: {
      schema: "sector_cycles.rs_history.v1",
      mode: "reconstructed_price_history",
      naturally_observed: false,
      basis: "tr",
      benchmark: "SPY",
      horizons_sessions: [21, 63],
      max_points_per_sector: 252,
    },
  },
  sectors: ["xlk", "xlf"].map((id, k) => ({
    id,
    kind: "sector",
    ticker: id === "xlk" ? "XLK" : "XLF",
    rs_history: DATES.map((d, i) => ({
      date: d,
      rs_21d: +((i - 4) * 1.5).toFixed(2),
      rs_63d: +((i - 4) * 0.8 - k).toFixed(2),
    })),
    turns: [{ date: DATES[0], k: "trough" as const, major: true, provisional: false, mag_pct: null }],
  })),
});

const generation = {
  accessGeneration: "ag-1",
  region: "us" as const,
  asOf: AS_OF,
  publicationId: PUB,
};

/* ── Mount helper ────────────────────────────────────────────────────────── */

interface LensProps {
  cyclesFeed?: SectorCycleFeed;
  historyFeed?: SectorCycleFeed;
  returnBinding?: "self" | "host";
  gen?: typeof generation;
}

function mountLens(initial: LensProps) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  const handle: { current: SectorCycleCaptureHandle | null } = { current: null };
  let props = initial;
  const render = () => {
    act(() => {
      root.render(
        <LangProvider>
          <SectorCycleLens
            generation={props.gen ?? generation}
            subject={{ family: "sectors", id: "xlk" }}
            region="us"
            accessGeneration={props.gen?.accessGeneration ?? "ag-1"}
            returnBinding={props.returnBinding ?? "host"}
            captureRef={handle}
            cyclesFeed={props.cyclesFeed}
            historyFeed={props.historyFeed}
          />
        </LangProvider>,
      );
    });
  };
  render();
  return {
    host,
    handle,
    rerender(next: LensProps) {
      props = { ...props, ...next };
      render();
    },
    /** Schedules a re-render WITHOUT committing it, so a subsequent applyView
     * inside the same act plans against the old view but flushes into the
     * new props — the real mid-apply source-vanishing path. */
    schedule(next: LensProps) {
      props = { ...props, ...next };
      root.render(
        <LangProvider>
          <SectorCycleLens
            generation={props.gen ?? generation}
            subject={{ family: "sectors", id: "xlk" }}
            region="us"
            accessGeneration={props.gen?.accessGeneration ?? "ag-1"}
            returnBinding={props.returnBinding ?? "host"}
            captureRef={handle}
            cyclesFeed={props.cyclesFeed}
            historyFeed={props.historyFeed}
          />
        </LangProvider>,
      );
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

const lensRoot = () => document.querySelector('[data-testid="sector-cycle-lens"]');
const chartInput = () =>
  document.querySelector<HTMLInputElement>('input[type="range"][aria-valuetext]');
const railButton = (ticker: string) =>
  Array.from(document.querySelectorAll('[data-testid="cycle-phase-rail"] button')).find(
    (b) => b.textContent?.includes(ticker),
  );
const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

/* ── Tests ───────────────────────────────────────────────────────────────── */

let popstateAdds: string[] = [];
let popstateRemoves: string[] = [];
let addSpy: ReturnType<typeof vi.spyOn>;
let removeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  popstateAdds = [];
  popstateRemoves = [];
  addSpy = vi.spyOn(window, "addEventListener").mockImplementation(((type: string) => {
    if (type === "popstate") popstateAdds.push(type);
  }) as typeof window.addEventListener);
  removeSpy = vi.spyOn(window, "removeEventListener").mockImplementation(((type: string) => {
    if (type === "popstate") popstateRemoves.push(type);
  }) as typeof window.removeEventListener);
});
afterEach(() => {
  addSpy.mockRestore();
  removeSpy.mockRestore();
  document.body.innerHTML = "";
});

describe("cycles controller: capture and apply", () => {
  it("mounts the deep experience and captures an exact nine-field view", () => {
    const lens = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    expect(lensRoot()).not.toBeNull();
    const snap = lens.handle.current!.captureView();
    expect(snap).not.toBeNull();
    expect(snap).toMatchObject({
      schema: "sector_dossier.view.v1",
      publicationId: PUB,
      id: "xlk",
      family: "sectors",
      asOf: AS_OF,
      valuesOpen: false,
      sourcesOpen: false,
      valuesOffset: 0,
    });
    expect(snap!.range).not.toBeNull();
    expect(Object.keys(snap!).sort()).toEqual([
      "asOf",
      "family",
      "id",
      "publicationId",
      "range",
      "schema",
      "sourcesOpen",
      "valuesOffset",
      "valuesOpen",
    ]);
    lens.unmount();
  });

  it("applies an exact restore and reports applied", () => {
    const lens = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    const before = lens.handle.current!.captureView()!;
    const requested = {
      ...before,
      range: null as null,
      valuesOpen: true,
      sourcesOpen: true,
      valuesOffset: 50,
    };
    const outcome = lens.handle.current!.applyView(requested);
    expect(outcome).toEqual({ status: "applied", reason: null });
    const after = lens.handle.current!.captureView()!;
    expect(after.valuesOpen).toBe(true);
    expect(after.sourcesOpen).toBe(true);
    expect(after.valuesOffset).toBe(50);
    expect(after.range).toBeNull();
    lens.unmount();
  });

  it("rejects invalid and foreign views without touching the current view", () => {
    const lens = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    const before = lens.handle.current!.captureView()!;
    expect(lens.handle.current!.applyView({ ...before, extra: 1 })).toEqual({
      status: "rejected",
      reason: "invalid_view",
    });
    expect(lens.handle.current!.applyView({ ...before, id: "xlf" })).toEqual({
      status: "rejected",
      reason: "source_changed",
    });
    expect(lens.handle.current!.applyView({ ...before, valuesOffset: 900 })).toEqual({
      status: "rejected",
      reason: "values_unavailable",
    });
    // Nothing moved: the live view still equals the capture taken before.
    expect(lens.handle.current!.captureView()).toMatchObject({
      id: before.id,
      valuesOffset: before.valuesOffset,
      valuesOpen: before.valuesOpen,
    });
    lens.unmount();
  });

  it("reports an honest partial when the source vanishes mid-apply", () => {
    const lens = mountLens({
      cyclesFeed: { state: "stale", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    const before = lens.handle.current!.captureView()!;
    expect(before).not.toBeNull();
    // The feed dies between plan and verify: the controller re-renders inside
    // the same apply and its capture comes back unavailable.
    let outcome: { status: string; reason: string | null } | undefined;
    act(() => {
      lens.schedule({ cyclesFeed: { state: "unavailable" } });
      outcome = lens.handle.current!.applyView(before);
    });
    expect(outcome).toEqual({ status: "partial", reason: "view_unavailable" });
    lens.unmount();
  });
});

describe("cycles controller: generation and cursor retirement", () => {
  it("retires the observation cursor when the subject changes", () => {
    const lens = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    const input = chartInput()!;
    expect(input.getAttribute("aria-valuetext")).toBe(DATES[7]);
    setInputValue(input, "0");
    expect(chartInput()!.getAttribute("aria-valuetext")).toBe(DATES[0]);
    act(() => railButton("XLF")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const after = chartInput()!;
    expect(after.getAttribute("aria-valuetext")).toBe(DATES[7]);
    lens.unmount();
  });

  it("a replaced generation never renders the old history", () => {
    const lens = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    lens.rerender({
      gen: { accessGeneration: "ag-2", region: "us", asOf: "2026-11-06", publicationId: "cycp1-" + "cd".repeat(32) },
    });
    // No mixed-source rendering: the lens withholds everything and says so.
    expect(lensRoot()?.textContent).toContain("Snapshots do not match");
    expect(document.querySelector('[data-testid="cycle-phase-rail"]')).toBeNull();
    lens.unmount();
  });
});

describe("cycles controller: return router lifetime", () => {
  it("binds exactly one popstate listener and leaves zero on unmount", () => {
    const lens = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
      returnBinding: "self",
    });
    expect(popstateAdds.length).toBe(1);
    expect(popstateRemoves.length).toBe(0);
    lens.unmount();
    expect(popstateRemoves.length).toBe(1);
    // A late popstate event reaches nobody: no throw, no resurrection.
    expect(() =>
      window.dispatchEvent(new PopStateEvent("popstate", { state: { sc: null } })),
    ).not.toThrow();
    expect(lensRoot()).toBeNull();
  });

  it("remounts without duplicating the router", () => {
    const first = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
      returnBinding: "self",
    });
    expect(popstateAdds.length).toBe(1);
    first.unmount();
    expect(popstateAdds.length).toBe(1);
    const second = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
      returnBinding: "self",
    });
    // Same page, one router: still exactly one live listener.
    expect(popstateAdds.length - popstateRemoves.length).toBe(1);
    second.unmount();
    expect(popstateAdds.length - popstateRemoves.length).toBe(0);
  });
});

describe("cycles controller: legacy core", () => {
  it("renders the #1249 core without the deep publication and captures nothing", () => {
    const lens = mountLens({
      cyclesFeed: { state: "unavailable" },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    expect(lensRoot()).not.toBeNull();
    expect(document.querySelector('[data-testid="cycle-phase-rail"]')).not.toBeNull();
    expect(lens.handle.current!.captureView()).toBeNull();
    expect(lens.handle.current!.applyView({ any: "thing" })).toEqual({
      status: "rejected",
      reason: "view_unavailable",
    });
    lens.unmount();
  });
});
