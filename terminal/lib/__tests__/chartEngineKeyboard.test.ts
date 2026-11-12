import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  createKeyboardController,
  formatHoverAnnouncement,
  type AnnouncementFormatters,
  type CrosshairState,
  type KeyRecord,
  type KeyboardControllerDeps,
  type PaneRect,
  type TimeScaleState,
} from "../chart-engine/canvas/keyboard";

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard navigation & accessibility layer for the native chart engine
// (lib/chart-engine/canvas/keyboard.ts). The controller is pure: every clock and
// every side effect is an injected dep, so these tests drive it with a mutable
// state object plus vi.fn() spies and never touch a DOM. The last suite greps the
// implementation source itself for the acceptance law (no DOM references).
// ─────────────────────────────────────────────────────────────────────────────

type HarnessOpts = {
  paneCount?: number;
  barCount?: number | null; // null = do NOT inject barCount (derived-last-bar path)
  timeScale?: Partial<TimeScaleState>;
  crosshair?: Partial<CrosshairState>;
  describeBar?: (logical: number) => string | null;
  paneRect?: (paneIndex: number) => PaneRect | null;
};

function makeHarness(opts: HarnessOpts = {}) {
  const timeScale: TimeScaleState = {
    visibleFrom: 0,
    visibleTo: 240,
    barSpacing: 10,
    rightOffset: 24,
    widthPx: 2400,
    ...opts.timeScale,
  };
  const crosshair: CrosshairState = { logical: null, paneIndex: 0, ...opts.crosshair };
  const announcements: string[] = [];
  const ranges: Array<[number, number]> = [];
  let nowMs = 0;

  const deps: KeyboardControllerDeps = {
    getTimeScale: () => timeScale,
    setVisibleLogicalRange: vi.fn((from: number, to: number) => {
      ranges.push([from, to]);
      timeScale.visibleFrom = from;
      timeScale.visibleTo = to;
    }),
    getCrosshair: () => crosshair,
    setCrosshair: vi.fn((logical: number | null, paneIndex: number) => {
      crosshair.logical = logical;
      crosshair.paneIndex = paneIndex;
    }),
    clearCrosshair: vi.fn(() => {
      crosshair.logical = null;
    }),
    resetView: vi.fn(),
    paneCount: () => opts.paneCount ?? 3,
    announce: (text: string) => {
      announcements.push(text);
    },
    now: () => nowMs,
  };
  if (opts.barCount !== null) deps.barCount = () => opts.barCount ?? 5000;
  if (opts.describeBar) deps.describeBar = opts.describeBar;
  if (opts.paneRect) deps.paneRect = opts.paneRect;

  const controller = createKeyboardController(deps);
  return {
    controller,
    deps,
    timeScale,
    crosshair,
    announcements,
    ranges,
    setNow: (ms: number) => {
      nowMs = ms;
    },
  };
}

/** KeyboardEvent-shaped record with DOM defaults; timeStamp must be given per test. */
function key(partial: Partial<KeyRecord> & { key: string }): KeyRecord {
  return {
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    timeStamp: 0,
    ...partial,
  };
}

const crosshairCalls = (h: ReturnType<typeof makeHarness>): number[] =>
  vi.mocked(h.deps.setCrosshair).mock.calls.map(([logical]) => logical as number);

// ── Key mappings ──────────────────────────────────────────────────────────────

describe("key mappings", () => {
  it("ArrowRight moves the crosshair one bar from a null crosshair's visible centre", () => {
    const h = makeHarness();
    h.controller.focus();
    expect(h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 0 }))).toEqual({ handled: true });
    expect(h.deps.setCrosshair).toHaveBeenCalledTimes(1);
    expect(h.deps.setCrosshair).toHaveBeenCalledWith(120, 0); // round((0+240)/2)
  });

  it("ArrowLeft/ArrowRight step one bar", () => {
    const h = makeHarness({ crosshair: { logical: 10 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 0 }));
    expect(h.crosshair.logical).toBe(11);
    h.controller.handleKey(key({ key: "ArrowLeft", timeStamp: 100 }));
    expect(h.crosshair.logical).toBe(10);
  });

  it("Shift+arrows move 10 bars", () => {
    const h = makeHarness({ crosshair: { logical: 50 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "ArrowRight", shiftKey: true, timeStamp: 0 }));
    expect(h.crosshair.logical).toBe(60);
    h.controller.handleKey(key({ key: "ArrowLeft", shiftKey: true, timeStamp: 100 }));
    expect(h.crosshair.logical).toBe(50);
  });

  it("Alt+arrows pan the visible range one bar and leave the crosshair alone", () => {
    const h = makeHarness({ crosshair: { logical: 100 } });
    h.controller.focus();
    expect(h.controller.handleKey(key({ key: "ArrowRight", altKey: true, timeStamp: 0 }))).toEqual({ handled: true });
    expect(h.ranges).toEqual([[1, 241]]);
    expect(h.deps.setCrosshair).not.toHaveBeenCalled();
    h.controller.handleKey(key({ key: "ArrowLeft", altKey: true, timeStamp: 100 }));
    expect(h.ranges).toEqual([[1, 241], [0, 240]]);
  });

  it("Alt+Shift+arrows pan 10 bars and pan clamps at both data edges", () => {
    const h = makeHarness({ crosshair: { logical: 0 } });
    h.controller.focus();
    // Left edge: cannot pan past the first bar.
    h.controller.handleKey(key({ key: "ArrowLeft", altKey: true, shiftKey: true, timeStamp: 0 }));
    expect(h.ranges).toEqual([[0, 240]]);
    // Right edge: lastBar(4999) + rightOffset(24) = 5023, so max from = 4783.
    h.controller.handleKey(key({ key: "ArrowRight", altKey: true, shiftKey: true, timeStamp: 100 }));
    expect(h.ranges).toEqual([[0, 240], [10, 250]]);
    const nearEdge = makeHarness({ crosshair: { logical: 0 }, timeScale: { visibleFrom: 4782, visibleTo: 5022 } });
    nearEdge.controller.focus();
    nearEdge.controller.handleKey(key({ key: "ArrowRight", altKey: true, shiftKey: true, timeStamp: 0 }));
    expect(nearEdge.ranges).toEqual([[4783, 5023]]);
  });

  it("+ and = zoom in, - zooms out", () => {
    const zoomH = (crosshair: number | null) => {
      const h = makeHarness({ timeScale: { visibleFrom: 100, visibleTo: 340 }, crosshair: { logical: crosshair } });
      h.controller.focus();
      return h;
    };
    const inAtCrosshair = zoomH(220);
    inAtCrosshair.controller.handleKey(key({ key: "+", timeStamp: 0 }));
    // PERF-A C2/T5 correction: zoom pins the anchor bar's PIXEL CENTRE
    // (x = (anchor - from + 0.5) * spacing stays fixed), replacing the old
    // ratio anchoring that slid the anchored bar by 0.5 * Δspacing per step.
    // Span 240 → 200: from = 220.5 - 120.5 * (200/240) = 120.08333…
    expect(inAtCrosshair.ranges[0][0]).toBeCloseTo(120 + 1 / 12, 10);
    expect(inAtCrosshair.ranges[0][1]).toBeCloseTo(320 + 1 / 12, 10);

    const inAtEquals = zoomH(220);
    inAtEquals.controller.handleKey(key({ key: "=", timeStamp: 0 }));
    expect(inAtEquals.ranges[0][0]).toBeCloseTo(120 + 1 / 12, 10);
    expect(inAtEquals.ranges[0][1]).toBeCloseTo(320 + 1 / 12, 10);

    const out = zoomH(220);
    out.controller.handleKey(key({ key: "-", timeStamp: 0 }));
    // Span 240 → 288 around anchor 220: from = 220.5 - 120.5 * 1.2 = 75.9.
    expect(out.ranges[0][0]).toBeCloseTo(75.9, 10);
    expect(out.ranges[0][1]).toBeCloseTo(363.9, 10);
  });

  it("zoom anchors at the visible centre when no crosshair is set", () => {
    const h = makeHarness(); // range (0,240), centre 120
    h.controller.focus();
    h.controller.handleKey(key({ key: "+", timeStamp: 0 }));
    // PERF-A C2/T5: pixel-centre anchoring (see the zoom test above).
    expect(h.ranges[0][0]).toBeCloseTo(20 + 1 / 12, 10);
    expect(h.ranges[0][1]).toBeCloseTo(220 + 1 / 12, 10);
  });

  it("zoom keeps a FRACTIONAL anchor's float index fixed (no bar snap, ruling 3)", () => {
    // Case 1: no crosshair, range (100.3, 340.3) → centre 220.3, with the
    // harness's widthPx 2400 / span 240. The float-index pixel-centre law
    // (x = (anchor - from + 0.5) * (width / span)) keeps the centre under
    // the pointer across a zoom — bar-snap would have rounded 220.3 → 220 and
    // the assertion below would fail.
    const h1 = makeHarness({ timeScale: { visibleFrom: 100.3, visibleTo: 340.3, barSpacing: 10, rightOffset: 24, widthPx: 2400 } });
    h1.controller.focus();
    const xc1 = (220.3 - 100.3 + 0.5) * (2400 / 240);
    h1.controller.handleKey(key({ key: "+", timeStamp: 0 }));
    const [f1, t1] = h1.ranges[0];
    // Float-index invariant: the centre pixel xc1 is still the centre.
    expect(Math.abs(f1 + xc1 * (t1 - f1) / 2400 - 0.5 - 220.3)).toBeLessThan(1e-9);

    // Case 2: crosshair logical 220.4, range (100, 340) → anchor 220.4, with
    // the same harness. The float-index pixel-centre law still pins xc2 =
    // (220.4 - 100 + 0.5) * 10 under the crosshair.
    const h2 = makeHarness({ timeScale: { visibleFrom: 100, visibleTo: 340, barSpacing: 10, rightOffset: 24, widthPx: 2400 }, crosshair: { logical: 220.4 } });
    h2.controller.focus();
    const xc2 = (220.4 - 100 + 0.5) * (2400 / 240);
    h2.controller.handleKey(key({ key: "+", timeStamp: 0 }));
    const [f2, t2] = h2.ranges[0];
    expect(Math.abs(f2 + xc2 * (t2 - f2) / 2400 - 0.5 - 220.4)).toBeLessThan(1e-9);
  });

  it("zoom floors the span at 2 bars and never collapses the range", () => {
    const h = makeHarness({ timeScale: { visibleFrom: 0, visibleTo: 2 }, crosshair: { logical: 1 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "+", timeStamp: 0 }));
    expect(h.ranges).toEqual([[0, 2]]);
  });

  it("Escape clears the crosshair", () => {
    const h = makeHarness({ crosshair: { logical: 42 } });
    h.controller.focus();
    expect(h.controller.handleKey(key({ key: "Escape", timeStamp: 0 }))).toEqual({ handled: true });
    expect(h.deps.clearCrosshair).toHaveBeenCalledTimes(1);
    expect(h.crosshair.logical).toBeNull();
  });

  it("bare r resets the view", () => {
    const h = makeHarness();
    h.controller.focus();
    expect(h.controller.handleKey(key({ key: "r", timeStamp: 0 }))).toEqual({ handled: true });
    expect(h.deps.resetView).toHaveBeenCalledTimes(1);
  });

  it("unmapped keys are not handled", () => {
    const h = makeHarness();
    h.controller.focus();
    for (const k of ["x", "Enter", " ", "PageDown", "R"]) {
      expect(h.controller.handleKey(key({ key: k, timeStamp: 0 }))).toEqual({ handled: false });
    }
    expect(h.deps.setCrosshair).not.toHaveBeenCalled();
    expect(h.deps.setVisibleLogicalRange).not.toHaveBeenCalled();
    expect(h.deps.resetView).not.toHaveBeenCalled();
  });
});

// ── Modifiers ─────────────────────────────────────────────────────────────────

describe("modifiers", () => {
  it("ctrl and meta keys are never handled (browser shortcuts win)", () => {
    const h = makeHarness({ crosshair: { logical: 10 } });
    h.controller.focus();
    expect(h.controller.handleKey(key({ key: "ArrowRight", ctrlKey: true, timeStamp: 0 }))).toEqual({ handled: false });
    expect(h.controller.handleKey(key({ key: "+", metaKey: true, timeStamp: 0 }))).toEqual({ handled: false });
    expect(h.controller.handleKey(key({ key: "r", ctrlKey: true, timeStamp: 0 }))).toEqual({ handled: false });
    expect(h.controller.handleKey(key({ key: "Escape", metaKey: true, timeStamp: 0 }))).toEqual({ handled: false });
    expect(h.deps.setCrosshair).not.toHaveBeenCalled();
    expect(h.deps.setVisibleLogicalRange).not.toHaveBeenCalled();
    expect(h.deps.resetView).not.toHaveBeenCalled();
  });

  it("r with Shift or Alt is not the reset key", () => {
    const h = makeHarness();
    h.controller.focus();
    expect(h.controller.handleKey(key({ key: "r", shiftKey: true, timeStamp: 0 }))).toEqual({ handled: false });
    expect(h.controller.handleKey(key({ key: "r", altKey: true, timeStamp: 0 }))).toEqual({ handled: false });
    expect(h.deps.resetView).not.toHaveBeenCalled();
  });
});

// ── Roving focus ──────────────────────────────────────────────────────────────

describe("roving focus", () => {
  it("ArrowDown/ArrowUp move pane focus and wrap at both ends", () => {
    const h = makeHarness({ paneCount: 3 });
    h.controller.focus();
    h.controller.handleKey(key({ key: "ArrowDown", timeStamp: 0 }));
    expect(h.controller.focusRing()?.paneIndex).toBe(1);
    h.controller.handleKey(key({ key: "ArrowDown", timeStamp: 100 }));
    expect(h.controller.focusRing()?.paneIndex).toBe(2);
    h.controller.handleKey(key({ key: "ArrowDown", timeStamp: 200 })); // wrap down
    expect(h.controller.focusRing()?.paneIndex).toBe(0);
    h.controller.handleKey(key({ key: "ArrowUp", timeStamp: 300 })); // wrap up
    expect(h.controller.focusRing()?.paneIndex).toBe(2);
    // Roving never touches the crosshair.
    expect(h.deps.setCrosshair).not.toHaveBeenCalled();
  });

  it("crosshair keys act in the focused pane", () => {
    const h = makeHarness({ paneCount: 3, crosshair: { logical: 5 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "ArrowDown", timeStamp: 0 }));
    h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 100 }));
    expect(h.crosshair.paneIndex).toBe(1);
    expect(h.crosshair.logical).toBe(6);
  });

  it("focus() starts at the crosshair's pane and clamps it", () => {
    const h = makeHarness({ paneCount: 3, crosshair: { logical: 1, paneIndex: 2 } });
    h.controller.focus();
    expect(h.controller.focusRing()?.paneIndex).toBe(2);
    h.controller.handleKey(key({ key: "ArrowDown", timeStamp: 0 })); // wrap to 0
    expect(h.controller.focusRing()?.paneIndex).toBe(0);
  });

  it("the focus ring carries the pane rect when geometry is injected", () => {
    const h = makeHarness({
      paneRect: (i) => ({ x: 8, y: 300 * i, width: 2400, height: 300 }),
    });
    h.controller.focus();
    expect(h.controller.focusRing()).toEqual({
      paneIndex: 0,
      rect: { x: 8, y: 0, width: 2400, height: 300 },
    });
    h.controller.handleKey(key({ key: "ArrowDown", timeStamp: 0 }));
    expect(h.controller.focusRing()?.rect?.y).toBe(300);
    const bare = makeHarness();
    bare.controller.focus();
    expect(bare.controller.focusRing()).toEqual({ paneIndex: 0, rect: null });
  });

  it("a single pane still consumes roving keys", () => {
    const h = makeHarness({ paneCount: 1 });
    h.controller.focus();
    expect(h.controller.handleKey(key({ key: "ArrowUp", timeStamp: 0 }))).toEqual({ handled: true });
    expect(h.controller.focusRing()?.paneIndex).toBe(0);
  });
});

// ── Home / End edges ──────────────────────────────────────────────────────────

describe("Home/End edges", () => {
  it("Home jumps to the first bar and shows the range from bar 0", () => {
    const h = makeHarness({ barCount: 1000, timeScale: { visibleFrom: 700, visibleTo: 924 }, crosshair: { logical: 500 } });
    h.controller.focus();
    expect(h.controller.handleKey(key({ key: "Home", timeStamp: 0 }))).toEqual({ handled: true });
    expect(h.deps.setCrosshair).toHaveBeenCalledWith(0, 0);
    expect(h.ranges).toEqual([[0, 224]]); // span 224 preserved
  });

  it("End jumps to the last bar and sets the right offset so it is visible", () => {
    const h = makeHarness({ barCount: 1000, timeScale: { visibleFrom: 700, visibleTo: 924 }, crosshair: { logical: 500 } });
    h.controller.focus();
    expect(h.controller.handleKey(key({ key: "End", timeStamp: 0 }))).toEqual({ handled: true });
    expect(h.deps.setCrosshair).toHaveBeenCalledWith(999, 0);
    expect(h.ranges).toEqual([[799, 1023]]); // last(999) + rightOffset(24) at the right edge
  });

  it("End derives the last bar as visibleTo - rightOffset when no barCount is injected", () => {
    const h = makeHarness({ barCount: null, timeScale: { visibleFrom: 700, visibleTo: 924 }, crosshair: { logical: 500 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "End", timeStamp: 0 }));
    expect(h.deps.setCrosshair).toHaveBeenCalledWith(900, 0); // 924 - 24
    expect(h.ranges).toEqual([[700, 924]]);
  });

  it("a crosshair move past the last visible bar scrolls the range with it", () => {
    const h = makeHarness({ crosshair: { logical: 239 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 0 }));
    expect(h.crosshair.logical).toBe(240);
    expect(h.ranges).toEqual([[1, 241]]); // minimal shift, span preserved
    // A stationary crosshair that slid off screen (Alt-pan) is revealed at the edge.
    const left = makeHarness({ crosshair: { logical: 0 }, timeScale: { visibleFrom: 700, visibleTo: 924 } });
    left.controller.focus();
    left.controller.handleKey(key({ key: "ArrowLeft", timeStamp: 0 }));
    expect(left.deps.setCrosshair).not.toHaveBeenCalled(); // stationary, no move
    expect(left.ranges).toEqual([[0, 224]]); // revealed at the left edge, span kept
  });

  it("the crosshair clamps at the first bar and at the gutter end", () => {
    const first = makeHarness({ crosshair: { logical: 0 } });
    first.controller.focus();
    expect(first.controller.handleKey(key({ key: "ArrowLeft", timeStamp: 0 }))).toEqual({ handled: true });
    expect(first.deps.setCrosshair).not.toHaveBeenCalled(); // no-op at the edge

    const gutterEnd = makeHarness({ crosshair: { logical: 5023 } }); // last(4999) + 24
    gutterEnd.controller.focus();
    gutterEnd.controller.handleKey(key({ key: "ArrowRight", timeStamp: 0 }));
    expect(gutterEnd.deps.setCrosshair).not.toHaveBeenCalled();
  });
});

// ── Focus/blur gating ─────────────────────────────────────────────────────────

describe("inactive controller ignores keys", () => {
  it("nothing is handled before focus()", () => {
    const h = makeHarness({ crosshair: { logical: 10 } });
    expect(h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 0 }))).toEqual({ handled: false });
    expect(h.controller.handleKey(key({ key: "Escape", timeStamp: 0 }))).toEqual({ handled: false });
    expect(h.deps.setCrosshair).not.toHaveBeenCalled();
    expect(h.deps.setVisibleLogicalRange).not.toHaveBeenCalled();
    expect(h.deps.resetView).not.toHaveBeenCalled();
    expect(h.controller.focusRing()).toBeNull();
    expect(h.controller.state().active).toBe(false);
  });

  it("blur() deactivates and drains any pending announcement", () => {
    const h = makeHarness({ describeBar: (l) => `bar ${l}`, crosshair: { logical: 0 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 0 })); // pending "bar 1"
    expect(h.announcements).toEqual([]);
    h.controller.blur();
    expect(h.announcements).toEqual(["bar 1"]); // flushed even though immature
    expect(h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 100 }))).toEqual({ handled: false });
    expect(h.controller.focusRing()).toBeNull();
  });
});

// ── Auto-repeat acceleration ──────────────────────────────────────────────────

describe("auto-repeat acceleration", () => {
  it("classifies the streak by timeStamp while now() never moves", () => {
    const h = makeHarness({ crosshair: { logical: 0 } });
    h.controller.focus();
    // 25 presses 60 ms apart (now() stays frozen at 0 the whole time).
    for (let i = 0; i < 25; i++) {
      h.controller.handleKey(key({ key: "ArrowRight", timeStamp: i * 60 }));
    }
    // steps(streak) = 1 + floor((streak-1)/3): 1,1,1,2,2,2,…,8,8,8,9 → 117 bars.
    expect(h.crosshair.logical).toBe(117);
  });

  it("caps the jump at 20 bars per event", () => {
    const h = makeHarness({ crosshair: { logical: 0 } });
    h.controller.focus();
    for (let i = 0; i < 70; i++) {
      h.controller.handleKey(key({ key: "ArrowRight", timeStamp: i * 50 }));
    }
    const calls = crosshairCalls(h);
    expect(calls[69] - calls[68]).toBe(20);
    expect(calls[69]).toBeLessThanOrEqual(calls[68] + 20);
  });

  it("Shift acceleration saturates at the 20-bar cap", () => {
    const h = makeHarness({ crosshair: { logical: 0 } });
    h.controller.focus();
    for (let i = 0; i < 5; i++) {
      h.controller.handleKey(key({ key: "ArrowRight", shiftKey: true, timeStamp: i * 50 }));
    }
    // streak 1..5 → 10,10,10,20,20 (base 10 × steps 1,1,1,2,2, capped at 20).
    expect(crosshairCalls(h)).toEqual([10, 20, 30, 50, 70]);
  });

  it("timeStamps more than 500 ms apart never accelerate, whatever now() says", () => {
    const h = makeHarness({ crosshair: { logical: 0 } });
    h.controller.focus();
    for (let i = 0; i < 4; i++) {
      h.setNow(i * 1000);
      h.controller.handleKey(key({ key: "ArrowRight", timeStamp: i * 1000 }));
    }
    expect(h.crosshair.logical).toBe(4); // one bar per press
  });

  it("a fast-moving now() cannot accelerate slowly-typed keys", () => {
    // The two clocks disagree: event timeStamps are 1 s apart (no auto-repeat),
    // while now() advances only 50 ms per press. Classification must follow the
    // timeStamps — one bar per press, no acceleration.
    const h = makeHarness({ crosshair: { logical: 0 } });
    h.controller.focus();
    for (let i = 0; i < 4; i++) {
      h.setNow(i * 50);
      h.controller.handleKey(key({ key: "ArrowRight", timeStamp: i * 1000 }));
    }
    expect(h.crosshair.logical).toBe(4);
  });

  it("a different key or direction resets the streak", () => {
    const h = makeHarness({ crosshair: { logical: 0 } });
    h.controller.focus();
    for (let i = 0; i < 4; i++) {
      h.controller.handleKey(key({ key: "ArrowRight", timeStamp: i * 50 }));
    }
    expect(h.crosshair.logical).toBe(5); // 1+1+1+2
    h.controller.handleKey(key({ key: "ArrowLeft", timeStamp: 200 })); // fresh streak
    expect(h.crosshair.logical).toBe(4);
  });

  it("zoom compounds the per-step factor over the streak", () => {
    const h = makeHarness({ crosshair: { logical: 120 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "+", timeStamp: 0 }));
    h.controller.handleKey(key({ key: "+", timeStamp: 60 })); // streak 2 → 1 step still
    h.controller.handleKey(key({ key: "+", timeStamp: 120 }));
    h.controller.handleKey(key({ key: "+", timeStamp: 180 })); // streak 4 → 2 steps
    // span: 240 → 200 → 166.67 → 138.89 → 138.89/1.2² = 96.45
    expect(h.timeScale.visibleTo - h.timeScale.visibleFrom).toBeCloseTo(240 / (1.2 ** 5), 6);
  });
});

// ── Announcements ─────────────────────────────────────────────────────────────

describe("announcements", () => {
  it("keyboard crosshair moves debounce to the last value within 150 ms of now()", () => {
    const h = makeHarness({ describeBar: (l) => `bar ${l}`, crosshair: { logical: 0 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 0 })); // pending "bar 1"
    h.setNow(100);
    h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 100 })); // replaced by "bar 2"
    expect(h.announcements).toEqual([]);
    h.setNow(250); // 250 - 100 >= 150 → "bar 2" matures; the new move re-arms
    h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 250 }));
    expect(h.announcements).toEqual(["bar 2"]);
    h.controller.flush();
    expect(h.announcements).toEqual(["bar 2", "bar 3"]);
  });

  it("an immature pending value is replaced, not emitted", () => {
    const h = makeHarness({ describeBar: (l) => `bar ${l}`, crosshair: { logical: 0 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 0 }));
    h.setNow(149);
    h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 149 })); // 149 < 150
    expect(h.announcements).toEqual([]);
    h.controller.flush();
    expect(h.announcements).toEqual(["bar 2"]);
  });

  it("the public announce() channel debounces the same way", () => {
    const h = makeHarness();
    h.controller.focus();
    h.controller.announce("A");
    h.setNow(50);
    h.controller.announce("B");
    h.setNow(300);
    h.controller.flush();
    expect(h.announcements).toEqual(["B"]);
  });

  it("a null bar description clears the pending announcement (newest state wins)", () => {
    let say: string | null = "yes";
    const h = makeHarness({ describeBar: () => say, crosshair: { logical: 0 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 0 })); // pending
    say = null;
    h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 100 }));
    h.controller.flush();
    expect(h.announcements).toEqual([]);
  });

  it("no describeBar dep means keyboard moves stay silent", () => {
    const h = makeHarness({ crosshair: { logical: 0 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 0 }));
    h.controller.flush();
    expect(h.announcements).toEqual([]);
  });

  it("zoom, pan, roving, Escape and reset never announce", () => {
    const h = makeHarness({ describeBar: (l) => `bar ${l}`, crosshair: { logical: 120 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "+", timeStamp: 0 }));
    h.controller.handleKey(key({ key: "ArrowRight", altKey: true, timeStamp: 100 }));
    h.controller.handleKey(key({ key: "ArrowDown", timeStamp: 200 }));
    h.controller.handleKey(key({ key: "Escape", timeStamp: 300 }));
    h.controller.handleKey(key({ key: "r", timeStamp: 400 }));
    h.controller.flush();
    expect(h.announcements).toEqual([]);
  });

  it("Escape drops a pending announcement", () => {
    const h = makeHarness({ describeBar: (l) => `bar ${l}`, crosshair: { logical: 0 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "ArrowRight", timeStamp: 0 }));
    h.controller.handleKey(key({ key: "Escape", timeStamp: 100 }));
    h.controller.flush();
    expect(h.announcements).toEqual([]);
  });

  it("Home and End announce the bar they land on", () => {
    const h = makeHarness({ describeBar: (l) => `bar ${l}`, barCount: 1000, crosshair: { logical: 500 } });
    h.controller.focus();
    h.controller.handleKey(key({ key: "Home", timeStamp: 0 }));
    h.controller.flush();
    h.controller.handleKey(key({ key: "End", timeStamp: 100 }));
    h.controller.flush();
    expect(h.announcements).toEqual(["bar 0", "bar 999"]);
  });
});

// ── formatHoverAnnouncement ───────────────────────────────────────────────────

describe("formatHoverAnnouncement", () => {
  const fmt: AnnouncementFormatters = {
    formatTime: (t) => `T(${String(t)})`,
    formatPrice: (p) => `$${p.toFixed(2)}`,
    t: (k) =>
      k === "chartKeyboardBarAnnouncement"
        ? "Bar {time}: O {open} H {high} L {low} C {close}"
        : "Bar {time}: O {open} H {high} L {low} C {close} · Volume {volume}",
  };

  it("formats OHLC through the injected formatters", () => {
    expect(
      formatHoverAnnouncement(
        { time: 1767225600, open: 100, high: 110, low: 99, close: 105 },
        fmt,
      ),
    ).toBe("Bar T(1767225600): O $100.00 H $110.00 L $99.00 C $105.00");
  });

  it("appends the volume sentence only when volume is present and finite", () => {
    expect(
      formatHoverAnnouncement(
        { time: 1767225600, open: 100, high: 110, low: 99, close: 105, volume: 1234.5 },
        fmt,
      ),
    ).toBe("Bar T(1767225600): O $100.00 H $110.00 L $99.00 C $105.00 · Volume $1234.50");
    expect(
      formatHoverAnnouncement(
        { time: 1767225600, open: 1, high: 2, low: 0.5, close: 1.5, volume: Number.NaN },
        fmt,
      ),
    ).not.toContain("Volume");
  });

  it("word order and copy come from t(), never from embedded English", () => {
    const zh: AnnouncementFormatters = {
      formatTime: (t) => (typeof t === "number" ? `${t}` : String(t)),
      formatPrice: (p) => `${p}`,
      t: (k) =>
        k === "chartKeyboardBarAnnouncement"
          ? "{time} 柱线：开 {open} 高 {high} 低 {low} 收 {close}"
          : "{time} 柱线：开 {open} 高 {high} 低 {low} 收 {close}，量 {volume}",
    };
    expect(
      formatHoverAnnouncement({ time: "2026-01-02", open: 10, high: 11, low: 9, close: 10.5, volume: 7 }, zh),
    ).toBe("2026-01-02 柱线：开 10 高 11 低 9 收 10.5，量 7");
  });
});

// ── ariaProps ─────────────────────────────────────────────────────────────────

describe("ariaProps", () => {
  it("spreads the application landmark onto the container", () => {
    const h = makeHarness();
    expect(
      h.controller.ariaProps({ roledescription: "chart", label: "Mastermind price chart" }),
    ).toEqual({
      role: "application",
      "aria-roledescription": "chart",
      "aria-label": "Mastermind price chart",
      tabIndex: 0,
    });
  });
});

// ── Acceptance law: the implementation never references the DOM ───────────────

describe("source purity", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "lib/chart-engine/canvas/keyboard.ts"),
    "utf8",
  );

  it("contains no DOM or timer references", () => {
    expect(source).not.toMatch(/\bdocument\b/);
    expect(source).not.toMatch(/\bwindow\b/);
    expect(source).not.toMatch(/\bglobalThis\b/);
    expect(source).not.toMatch(/\bself\b/);
    expect(source).not.toMatch(/\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/);
    expect(source).not.toMatch(/\baddEventListener\b|\bremoveEventListener\b/);
  });

  it("never imports lightweight-charts (masterplan law 1)", () => {
    expect(source).not.toMatch(/lightweight-charts/);
  });

  it("uses the plain substrings nowhere either (naive grep stays clean)", () => {
    expect(source.includes("document")).toBe(false);
    expect(source.includes("window")).toBe(false);
  });
});
