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
    turns: [
      // SP11: the pivot is DATES[0]; it became knowable only at DATES[1].
      { date: DATES[0], k: "trough" as const, major: true, provisional: false, mag_pct: null, known_since: DATES[1] },
    ],
  })),
});

/* v1.1: the lane-8 wire `sector_cycles.forecast_heads.v1` exactly as
 * published today, with adverse_tail withdrawn (the first-class state). */
const headsWire = () => {
  const head = (status: string, reason: string, extra: Record<string, unknown> = {}) => ({
    status,
    reason_code: reason,
    research_disposition: reason === "research_withheld_failed" ? "WITHHELD_FAILED" : "QUALIFIED_RESEARCH",
    research_reasons: [],
    evidence: { protocol: "p.md", report_ref: "r.json", results_doc: "d.md" },
    target: "what this head measures",
    horizon_sessions: 20,
    market: "US",
    ...extra,
  });
  return {
    schema: "sector_cycles.forecast_heads.v1",
    observed_cycles: "shown",
    protocol: "p.md",
    report_ref: "r.json",
    heads: {
      remaining_return_distribution: head("withheld", "research_withheld_failed"),
      adverse_tail: head("withdrawn", "research_withheld_failed", { withdrawn_asof: "2026-11-04" }),
      target_before_invalidation: head("withheld", "live_state_not_protocol_epoch"),
      transition_time: head("withheld", "live_state_not_protocol_epoch"),
    },
    may_rank: false,
    may_gate: false,
    may_size: false,
    may_trade: false,
    may_escalate: false,
  };
};

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
  gen?: typeof generation | null;
  /** Lane-3 mount context (TERMINAL_SLOTS.md §2): generation through context. */
  context?: {
    generation: unknown;
    transport?: "ready" | "access" | "unavailable" | "error" | "invalid" | "loading";
    qualification?: "accepted" | "stale" | "degraded" | null;
    subject?: { id: string } | null;
  } | null;
  subject?: { family: "sectors" | "baskets" | "nasdaq" | "russell"; id: string | null } | null;
  /** Access denial reason (R5-S07 cycles slices); null keeps the normal path. */
  denyAccess?: "denied" | "unauthenticated" | "locked" | null;
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
            generation={(props.gen === undefined ? generation : props.gen) ?? null}
            context={props.context}
            subject={props.subject === undefined ? { family: "sectors", id: "xlk" } : props.subject}
            region="us"
            accessGeneration={(props.gen ?? generation).accessGeneration}
            returnBinding={props.returnBinding ?? "host"}
            captureRef={handle}
            denyAccess={props.denyAccess ?? null}
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
            generation={(props.gen === undefined ? generation : props.gen) ?? null}
            context={props.context}
            subject={props.subject === undefined ? { family: "sectors", id: "xlk" } : props.subject}
            region="us"
            accessGeneration={(props.gen ?? generation).accessGeneration}
            returnBinding={props.returnBinding ?? "host"}
            captureRef={handle}
            denyAccess={props.denyAccess ?? null}
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

let addSpy: ReturnType<typeof vi.spyOn>;
let removeSpy: ReturnType<typeof vi.spyOn>;

const popstateAdds = () => addSpy.mock.calls.filter((c) => c[0] === "popstate");
const popstateRemoves = () => removeSpy.mock.calls.filter((c) => c[0] === "popstate");

beforeEach(() => {
  addSpy = vi.spyOn(window, "addEventListener");
  removeSpy = vi.spyOn(window, "removeEventListener");
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
    let outcome: { status: string; reason: string | null } | undefined;
    act(() => {
      outcome = lens.handle.current!.applyView(requested);
    });
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
    expect(popstateAdds().length).toBe(1);
    expect(popstateRemoves().length).toBe(0);
    lens.unmount();
    expect(popstateRemoves().length).toBe(1);
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
    expect(popstateAdds().length).toBe(1);
    first.unmount();
    expect(popstateAdds().length).toBe(1);
    const second = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
      returnBinding: "self",
    });
    // Same page, one router: still exactly one live listener.
    expect(popstateAdds().length - popstateRemoves().length).toBe(1);
    second.unmount();
    expect(popstateAdds().length - popstateRemoves().length).toBe(0);
  });

  it("back through the self router rebinds the captured subject and applies its view", () => {
    const lens = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
      returnBinding: "self",
    });
    // Set up a cursor + open exact values so the captured view has content.
    const input = chartInput()!;
    setInputValue(input, "3");
    const before = lens.handle.current!.captureView()!;
    expect(before.id).toBe("xlk");
    expect(before.valuesOpen).toBe(false);
    // Leaving the subject pushes the xlk view onto the entry being left.
    act(() => railButton("XLF")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(lens.handle.current!.captureView()!.id).toBe("xlf");
    // Browser back delivers the xlk snapshot: the router rebinds Technology
    // (donor host contract) and the codec restores the captured fields.
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { sc: before } }));
    });
    const restored = lens.handle.current!.captureView()!;
    expect(restored.id).toBe("xlk");
    expect(restored.valuesOpen).toBe(false);
    // Cursor retirement on rebind: the observation returns to the last date.
    expect(chartInput()!.getAttribute("aria-valuetext")).toBe(DATES[7]);
    // A foreign subject in a snapshot rebinds nothing and is honestly rejected.
    act(() => {
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: { sc: { ...before, id: "ghost" } } }),
      );
    });
    expect(lens.handle.current!.captureView()!.id).toBe("xlk");
    lens.unmount();
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

describe("cycles controller: lane-3 context mount (TERMINAL_SLOTS.md §2)", () => {
  it("derives generation, subject and staleness from the context", () => {
    const lens = mountLens({
      gen: null,
      context: { generation, transport: "ready", qualification: "stale", subject: { id: "xlf" } },
      subject: null,
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    expect(lensRoot()).not.toBeNull();
    // Subject came from the context (xlf), not the default prop (xlk).
    expect(lens.handle.current!.captureView()).toMatchObject({ id: "xlf" });
    // qualification: "stale" marks the ready feed as a historical snapshot.
    expect(lensRoot()?.textContent).toContain("Historical snapshot");
    lens.unmount();
  });

  it("context transport 'access' renders the denied screen", () => {
    const lens = mountLens({
      gen: null,
      context: { generation, transport: "access" },
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    expect(lensRoot()?.textContent).toContain("Cycle evidence is not available with this access");
    expect(document.querySelector('[data-testid="cycle-phase-rail"]')).toBeNull();
    lens.unmount();
  });

  it("context transport 'unavailable' with no feeds withholds everything", () => {
    const lens = mountLens({
      gen: null,
      context: { generation, transport: "unavailable" },
    });
    expect(lensRoot()?.textContent).toContain("Cycle evidence unavailable");
    expect(document.querySelector('[data-testid="cycle-phase-rail"]')).toBeNull();
    lens.unmount();
  });
});

describe("cycles controller: R5 device and access states", () => {
  it("going offline keeps the loaded view behind an honest device banner (S06)", () => {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get: () => false,
    });
    try {
      const lens = mountLens({
        cyclesFeed: { state: "ready", data: deepCycles() },
        historyFeed: { state: "ready", data: historyPayload() },
      });
      act(() => {
        window.dispatchEvent(new Event("offline"));
      });
      // Device state, not a data claim: the loaded experience stays mounted.
      expect(lensRoot()?.textContent).toContain("showing the last loaded Cycles view");
      expect(document.querySelector('[data-testid="cycle-phase-rail"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="cycle-depth-grid"]')).not.toBeNull();
      lens.unmount();
    } finally {
      if (desc) Object.defineProperty(Navigator.prototype, "onLine", desc);
    }
  });

  it("denyAccess 'locked' renders the locked screen with no rail (S07 cycles:locked)", () => {
    const lens = mountLens({
      denyAccess: "locked",
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    expect(lensRoot()?.textContent).toContain("Cycles evidence is locked at your access level");
    expect(document.querySelector('[data-testid="cycle-phase-rail"]')).toBeNull();
    lens.unmount();
  });

  it("an incompatible-generation snapshot keeps the legacy core with the refusal banner (S06)", () => {
    const lens = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    expect(lens.handle.current!.captureView()).not.toBeNull();
    // The publication is replaced under the same generation pin: the deep
    // evidence no longer matches, but the legacy rs-history core still serves.
    const foreign = deepCycles();
    foreign.evidence = { ...foreign.evidence, publicationId: "cycp1-" + "ef".repeat(32) };
    lens.rerender({ cyclesFeed: { state: "ready", data: foreign } });
    expect(lensRoot()?.textContent).toContain("overlay refused across builds");
    expect(document.querySelector('[data-testid="cycle-phase-rail"]')).not.toBeNull();
    // Deep-only view state is gone with the refused overlay.
    expect(lens.handle.current!.captureView()).toBeNull();
    lens.unmount();
  });
});

describe("cycles controller: v1.1 per-head forecast capabilities (lane 8 wire)", () => {
  it("renders each head's own verdict; one withdrawn head hides no sibling and no observed fact (SP10)", () => {
    const data = deepCycles();
    (data.sectors[0] as unknown as Record<string, unknown>).forecast_heads = headsWire();
    const lens = mountLens({
      cyclesFeed: { state: "ready", data },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    const card = document.querySelector('[data-testid="cycle-forecast-heads"]');
    expect(card).not.toBeNull();
    // Four independent rows, canonical order — never one shared verdict.
    const rows = Array.from(card!.querySelectorAll("[data-head]"));
    expect(rows.map((r) => r.getAttribute("data-head"))).toEqual([
      "remaining_return_distribution",
      "adverse_tail",
      "target_before_invalidation",
      "transition_time",
    ]);
    // Withdrawal is first-class: the withdrawn head carries its date, never a stale pass.
    expect(card!.textContent).toContain("Withdrawn 2026-11-04");
    // Each withheld head carries its OWN published reason line.
    expect(card!.textContent).toContain("the research test failed this forecast");
    expect(card!.textContent).toContain("does not match the research protocol");
    expect(card!.textContent).toContain("20 completed sessions");
    expect(card!.textContent).toContain("Leg-direction fact");
    // No number for a withheld or withdrawn head: no estimate, no percent.
    expect(card!.textContent).not.toContain("%");
    // The withdrawn head's siblings AND the observed Cycles facts both remain.
    expect(card!.textContent).toContain("Withheld");
    expect(document.querySelector('[data-testid="cycle-phase-rail"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="cycle-hero"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="cycle-leg-timeline"]')).not.toBeNull();
    lens.unmount();
  });

  it("a record without the block renders the honest absent line, never an inferred verdict", () => {
    const lens = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    const card = document.querySelector('[data-testid="cycle-forecast-heads"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("No forecast capability block is attached");
    expect(card!.textContent).not.toContain("Withdrawn");
    lens.unmount();
  });

  it("keeps the pivot date and the first-known date distinct (SP11)", () => {
    const lens = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    const turns = document.querySelector('[data-testid="cycle-turns"]');
    expect(turns).not.toBeNull();
    // Both facts are shown for the same turn, as two different dates.
    expect(turns!.textContent).toContain(DATES[0]);
    expect(turns!.textContent).toContain(`first known ${DATES[1]}`);
    expect(turns!.textContent).toContain("Turn dates are pivot dates");
    lens.unmount();
  });

  it("renders honest session-count windows, never calendar-month relabelling", () => {
    const lens = mountLens({
      cyclesFeed: { state: "ready", data: deepCycles() },
      historyFeed: { state: "ready", data: historyPayload() },
    });
    const select = document.querySelector('[data-testid="cycle-chart-panel"] select');
    expect(select).not.toBeNull();
    expect(select!.textContent).toContain("21 sessions");
    expect(select!.textContent).toContain("63 sessions");
    expect(select!.textContent).toContain("252 sessions");
    expect(select!.textContent).not.toContain("1 month");
    expect(select!.textContent).not.toContain("1 year");
    lens.unmount();
  });
});
