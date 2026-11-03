import { describe, it, expect } from "vitest";
import {
  clampFrame,
  stampAt,
  isAtHead,
  initReplay,
  replayReducer,
  keyToAction,
  tickIntervalMs,
  fmtStamp,
  stampMinutes,
  frameClockPositions,
  frameGapStats,
  sessionBands,
  createEngagementTracker,
  type ReplayState,
} from "@/lib/replayEngine";

const STAMPS = ["0931", "0941", "0951", "1001", "1011"]; // 5 frames

function stateAt(frame: number, extra: Partial<ReplayState> = {}): ReplayState {
  return { stamps: STAMPS, frame, playing: false, speed: 1, ...extra };
}

describe("clampFrame", () => {
  it("clamps below/above range", () => {
    expect(clampFrame(-3, 5)).toBe(0);
    expect(clampFrame(9, 5)).toBe(4);
    expect(clampFrame(2, 5)).toBe(2);
  });
  it("empty index → 0", () => {
    expect(clampFrame(4, 0)).toBe(0);
  });
  it("rounds fractional scrubber positions", () => {
    expect(clampFrame(2.7, 5)).toBe(3);
  });
});

describe("frame ↔ stamp mapping", () => {
  it("stampAt returns the stamp for the frame", () => {
    expect(stampAt(stateAt(0))).toBe("0931");
    expect(stampAt(stateAt(4))).toBe("1011");
  });
  it("stampAt clamps an out-of-range frame", () => {
    expect(stampAt(stateAt(99))).toBe("1011");
  });
  it("stampAt on empty index → null", () => {
    expect(stampAt({ stamps: [], frame: 0, playing: false, speed: 1 })).toBeNull();
  });
  it("isAtHead only at the last frame", () => {
    expect(isAtHead(stateAt(4))).toBe(true);
    expect(isAtHead(stateAt(3))).toBe(false);
  });
  it("fmtStamp HHMM → HH:MM", () => {
    expect(fmtStamp("0931")).toBe("09:31");
    expect(fmtStamp(null)).toBe("—");
    expect(fmtStamp("live")).toBe("live");
  });
});

describe("initReplay — starts pinned to head (LIVE)", () => {
  it("head frame for a non-empty index", () => {
    const s = initReplay(STAMPS);
    expect(s.frame).toBe(4);
    expect(isAtHead(s)).toBe(true);
    expect(s.playing).toBe(false);
  });
  it("empty index", () => {
    const s = initReplay([]);
    expect(s.frame).toBe(0);
    expect(s.stamps).toEqual([]);
  });
});

describe("replayReducer — button + keybind transitions", () => {
  it("toFirst / toLast (Home / End) jump to the ends and pause", () => {
    expect(replayReducer(stateAt(3, { playing: true }), { type: "toFirst" })).toMatchObject({
      frame: 0,
      playing: false,
    });
    expect(replayReducer(stateAt(1), { type: "toLast" })).toMatchObject({ frame: 4 });
  });

  it("stepBack / stepFwd move one frame and clamp", () => {
    expect(replayReducer(stateAt(2), { type: "stepFwd" }).frame).toBe(3);
    expect(replayReducer(stateAt(2), { type: "stepBack" }).frame).toBe(1);
    expect(replayReducer(stateAt(4), { type: "stepFwd" }).frame).toBe(4); // clamp at head
    expect(replayReducer(stateAt(0), { type: "stepBack" }).frame).toBe(0); // clamp at 0
  });

  it("togglePlay pauses when playing", () => {
    expect(replayReducer(stateAt(2, { playing: true }), { type: "togglePlay" }).playing).toBe(false);
  });

  it("togglePlay/play at the head restarts from frame 0", () => {
    const s = replayReducer(stateAt(4), { type: "togglePlay" });
    expect(s.playing).toBe(true);
    expect(s.frame).toBe(0);
  });

  it("play mid-timeline just plays from where it is", () => {
    const s = replayReducer(stateAt(2), { type: "play" });
    expect(s.playing).toBe(true);
    expect(s.frame).toBe(2);
  });

  it("setFrame (scrubber) clamps and pauses", () => {
    expect(replayReducer(stateAt(0, { playing: true }), { type: "setFrame", frame: 3 })).toMatchObject(
      { frame: 3, playing: false },
    );
    expect(replayReducer(stateAt(0), { type: "setFrame", frame: 100 }).frame).toBe(4);
  });

  it("setSpeed changes speed only", () => {
    expect(replayReducer(stateAt(2), { type: "setSpeed", speed: 4 }).speed).toBe(4);
  });

  it("tick advances one frame while playing and stops (pauses) at head", () => {
    const s1 = replayReducer(stateAt(2, { playing: true }), { type: "tick" });
    expect(s1.frame).toBe(3);
    expect(s1.playing).toBe(true);
    const s2 = replayReducer(stateAt(4, { playing: true }), { type: "tick" });
    expect(s2.frame).toBe(4);
    expect(s2.playing).toBe(false); // reached head → stop
  });

  it("tick is a no-op when paused", () => {
    const s = stateAt(2, { playing: false });
    expect(replayReducer(s, { type: "tick" })).toBe(s);
  });
});

describe("replayReducer — setStamps head-follow semantics", () => {
  it("follows the new head when already at head (LIVE viewer)", () => {
    const grown = ["0931", "0941", "0951", "1001", "1011", "1021"];
    const s = replayReducer(stateAt(4), { type: "setStamps", stamps: grown });
    expect(s.frame).toBe(5); // followed the new head
    expect(isAtHead(s)).toBe(true);
  });

  it("holds the current frame for a scrubbed-back viewer", () => {
    const grown = ["0931", "0941", "0951", "1001", "1011", "1021"];
    const s = replayReducer(stateAt(1), { type: "setStamps", stamps: grown });
    expect(s.frame).toBe(1); // not yanked forward
  });

  it("keepHead forces head-follow even when scrubbed back", () => {
    const grown = ["0931", "0941", "0951", "1001", "1011", "1021"];
    const s = replayReducer(stateAt(1), { type: "setStamps", stamps: grown, keepHead: true });
    expect(s.frame).toBe(5);
  });

  it("empty new index resets frame to 0", () => {
    const s = replayReducer(stateAt(3), { type: "setStamps", stamps: [] });
    expect(s.frame).toBe(0);
    expect(s.stamps).toEqual([]);
  });

  it("shrinking index clamps the frame into range", () => {
    const s = replayReducer(stateAt(4), { type: "setStamps", stamps: ["0931", "0941"] });
    expect(s.frame).toBe(1);
  });
});

describe("keyToAction", () => {
  it("maps the replay keys", () => {
    expect(keyToAction("Home")).toEqual({ type: "toFirst" });
    expect(keyToAction("End")).toEqual({ type: "toLast" });
    expect(keyToAction(" ")).toEqual({ type: "togglePlay" });
    expect(keyToAction("Spacebar")).toEqual({ type: "togglePlay" });
    expect(keyToAction("ArrowLeft")).toEqual({ type: "stepBack" });
    expect(keyToAction("ArrowRight")).toEqual({ type: "stepFwd" });
  });
  it("returns null for non-replay keys", () => {
    expect(keyToAction("a")).toBeNull();
    expect(keyToAction("Enter")).toBeNull();
  });
});

describe("tickIntervalMs", () => {
  it("faster speed → shorter interval", () => {
    expect(tickIntervalMs(1)).toBe(700);
    expect(tickIntervalMs(2)).toBe(350);
    expect(tickIntervalMs(4)).toBe(175);
    expect(tickIntervalMs(8)).toBe(88);
  });
});

// ─── Scrubber annotations (OEU T-B) ──────────────────────────────────────────
//
// The bands are drawn from the stamp list alone. Two properties matter: positions come from
// the CLOCK (so a session with gaps still puts 15:00 where 15:00 belongs), and a landmark is
// only emitted once it has actually happened — mid-session there is no close to mark.

describe("stampMinutes", () => {
  it("parses HHMM to minutes past midnight", () => {
    expect(stampMinutes("0930")).toBe(570);
    expect(stampMinutes("1600")).toBe(960);
    expect(stampMinutes("0000")).toBe(0);
  });
  it("rejects malformed / out-of-range stamps", () => {
    expect(stampMinutes("930")).toBeNaN();
    expect(stampMinutes("09:30")).toBeNaN();
    expect(stampMinutes("2500")).toBeNaN();
    expect(stampMinutes("0999")).toBeNaN();
    expect(stampMinutes("")).toBeNaN();
  });
});

describe("observed-frame rail", () => {
  it("positions frames by elapsed clock time rather than by index", () => {
    // The 60-minute hole occupies most of the rail instead of looking like one normal step.
    expect(frameClockPositions(["0930", "0935", "1035"])).toEqual([0, 5 / 65, 1]);
  });

  it("falls back to even spacing for malformed or degenerate indexes", () => {
    expect(frameClockPositions(["bad", "also-bad", "still-bad"])).toEqual([0, 0.5, 1]);
    expect(frameClockPositions(["0930", "0930"])).toEqual([0, 1]);
    expect(frameClockPositions(["0930"])).toEqual([0]);
  });

  it("reports the measured median, largest gap, and irregularity", () => {
    expect(frameGapStats(["0930", "0935", "0940", "1010"])).toEqual({
      medianSec: 300,
      maxSec: 1800,
      irregular: true,
    });
    expect(frameGapStats(["0930", "0935", "0940"])).toEqual({
      medianSec: 300,
      maxSec: 300,
      irregular: false,
    });
    expect(frameGapStats(["0930"])).toEqual({ medianSec: null, maxSec: null, irregular: false });
  });
});

describe("sessionBands", () => {
  /** A full RTH day, 5-min cadence 09:31 → 15:56 (the surface store's shape). */
  const fullDay = (() => {
    const out: string[] = [];
    for (let m = 9 * 60 + 31; m <= 15 * 60 + 56; m += 5) {
      out.push(String(Math.floor(m / 60)).padStart(2, "0") + String(m % 60).padStart(2, "0"));
    }
    return out;
  })();

  const byKey = (bands: ReturnType<typeof sessionBands>) =>
    Object.fromEntries(bands.map((b) => [b.key, b]));

  it("returns nothing for a degenerate index", () => {
    expect(sessionBands([])).toEqual([]);
    expect(sessionBands(["0931"])).toEqual([]);
    expect(sessionBands(["bad", "worse"])).toEqual([]);
  });

  it("a completed session gets all three landmarks", () => {
    const keys = sessionBands(fullDay).map((b) => b.key);
    expect(keys).toEqual(["open", "power", "close"]);
  });

  it("the open clamps to the left edge (09:30 precedes the first frame)", () => {
    const { open } = byKey(sessionBands(fullDay));
    expect(open.from).toBe(0);
    expect(open.to).toBe(0); // a marker, not a span
  });

  it("power hour spans 15:00 → 16:00 by clock position, not frame count", () => {
    const { power } = byKey(sessionBands(fullDay));
    // first=571 (09:31), last=956 (15:56) → 15:00 sits at (900-571)/(956-571).
    expect(power.from).toBeCloseTo((900 - 571) / (956 - 571), 6);
    expect(power.to).toBe(1); // 16:00 is past the last frame → clamped to the right edge
    expect(power.to).toBeGreaterThan(power.from);
  });

  it("mid-session: no power hour and no close yet", () => {
    const morning = fullDay.filter((s) => stampMinutes(s) <= 11 * 60);
    const keys = sessionBands(morning).map((b) => b.key);
    expect(keys).toEqual(["open"]);
  });

  it("into power hour but before the bell: power band, still no close", () => {
    const upTo1520 = fullDay.filter((s) => stampMinutes(s) <= 15 * 60 + 20);
    const keys = sessionBands(upTo1520).map((b) => b.key);
    expect(keys).toEqual(["open", "power"]);
  });

  it("within the grace window of the bell: the close is marked", () => {
    const upTo1551 = fullDay.filter((s) => stampMinutes(s) <= 15 * 60 + 51);
    expect(sessionBands(upTo1551).map((b) => b.key)).toContain("close");
    const upTo1549 = fullDay.filter((s) => stampMinutes(s) <= 15 * 60 + 49);
    expect(sessionBands(upTo1549).map((b) => b.key)).not.toContain("close");
  });

  it("every fraction stays inside the track", () => {
    for (const stamps of [fullDay, fullDay.slice(0, 20), fullDay.slice(0, 70)]) {
      for (const b of sessionBands(stamps)) {
        expect(b.from).toBeGreaterThanOrEqual(0);
        expect(b.to).toBeLessThanOrEqual(1);
        expect(b.to).toBeGreaterThanOrEqual(b.from);
      }
    }
  });

  it("a gappy session still positions by the clock", () => {
    // 09:31, then a hole, then 15:00 and 15:56. Power hour must start ~85% along by clock,
    // NOT at 1/3 of the way (which is where frame-index positioning would put it).
    const { power } = byKey(sessionBands(["0931", "1500", "1556"]));
    expect(power.from).toBeCloseTo((900 - 571) / (956 - 571), 6);
    expect(power.from).toBeGreaterThan(0.8);
  });
});

// ─── B5: group engagement — symmetric teardown, no listener accumulation ─────
//
// The provider's binder used to (a) set the hover flag on `focusin` with nothing ever
// clearing it — so one click inside the group hijacked Space and the arrows page-wide for the
// rest of the session — and (b) build a NEW handler pair on every bind invocation, so
// removeEventListener was always handed a different function object than addEventListener had
// received and listeners piled up. Both are asserted here against a fake element; the harness
// has no DOM, which is exactly why the logic lives in this pure module.

/** Minimal EventTarget stand-in that records what is currently attached. */
function fakeEl(children: object[] = []) {
  const listeners = new Map<string, Set<(ev?: unknown) => void>>();
  return {
    listeners,
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    addEventListener(type: string, fn: (ev?: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (ev?: unknown) => void) {
      listeners.get(type)?.delete(fn);
    },
    contains: (n: unknown) => children.includes(n as object),
    fire(type: string, ev?: unknown) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(ev);
    },
  };
}

describe("createEngagementTracker", () => {
  it("starts disengaged", () => {
    expect(createEngagementTracker().engaged()).toBe(false);
  });

  it("hover engages and disengages", () => {
    const tr = createEngagementTracker();
    const el = fakeEl();
    tr.bind(el);
    el.fire("mouseenter");
    expect(tr.engaged()).toBe(true);
    el.fire("mouseleave");
    expect(tr.engaged()).toBe(false);
  });

  it("focusout clears what focusin set (the hijack bug)", () => {
    const tr = createEngagementTracker();
    const el = fakeEl();
    tr.bind(el);
    el.fire("focusin");
    expect(tr.engaged()).toBe(true);
    el.fire("focusout", { relatedTarget: null });
    expect(tr.engaged()).toBe(false);
  });

  it("focus moving between the group's own controls does not disengage", () => {
    const inner = {};
    const tr = createEngagementTracker();
    const el = fakeEl([inner]);
    tr.bind(el);
    el.fire("focusin");
    el.fire("focusout", { relatedTarget: inner }); // tab from one control to another
    expect(tr.engaged()).toBe(true);
    el.fire("focusout", { relatedTarget: {} }); // out of the group entirely
    expect(tr.engaged()).toBe(false);
  });

  it("hover survives focus leaving, and vice versa", () => {
    const tr = createEngagementTracker();
    const el = fakeEl();
    tr.bind(el);
    el.fire("mouseenter");
    el.fire("focusin");
    el.fire("focusout", { relatedTarget: null });
    expect(tr.engaged()).toBe(true); // still hovered
    el.fire("mouseleave");
    expect(tr.engaged()).toBe(false);
  });

  it("attaches exactly one handler per event and never accumulates on rebinds", () => {
    const tr = createEngagementTracker();
    const a = fakeEl();
    tr.bind(a);
    const afterFirst = a.count();
    expect(afterFirst).toBe(4); // mouseenter, mouseleave, focusin, focusout

    // Re-binding the SAME node is a no-op, not a second attach.
    for (let i = 0; i < 20; i++) tr.bind(a);
    expect(a.count()).toBe(afterFirst);

    // Binding a different node detaches cleanly from the old one — the accumulation bug.
    const b = fakeEl();
    tr.bind(b);
    expect(a.count()).toBe(0);
    expect(b.count()).toBe(4);

    // Many alternations leave exactly one handler set on the live node and none behind.
    for (let i = 0; i < 50; i++) tr.bind(i % 2 === 0 ? a : b);
    expect(a.count() + b.count()).toBe(4);

    tr.bind(null);
    expect(a.count()).toBe(0);
    expect(b.count()).toBe(0);
    expect(tr.target()).toBeNull();
  });

  it("a fresh element starts disengaged even if the old one was engaged", () => {
    const tr = createEngagementTracker();
    const a = fakeEl();
    const b = fakeEl();
    tr.bind(a);
    a.fire("mouseenter");
    expect(tr.engaged()).toBe(true);
    tr.bind(b);
    expect(tr.engaged()).toBe(false);
  });

  it("a detached element's events no longer reach the tracker", () => {
    const tr = createEngagementTracker();
    const a = fakeEl();
    tr.bind(a);
    tr.bind(null);
    a.fire("mouseenter"); // nothing is listening
    expect(tr.engaged()).toBe(false);
  });
});

it("disables playback for empty or single-observation sessions, including an index refresh", () => {
  for (const stamps of [[], ["0931"]]) {
    const state = initReplay(stamps);
    expect(replayReducer(state, { type: "play" }).playing).toBe(false);
    expect(replayReducer(state, { type: "togglePlay" }).playing).toBe(false);
    expect(replayReducer(stateAt(2, { playing: true }), { type: "setStamps", stamps }).playing).toBe(false);
  }
});
