import { describe, it, expect, afterEach, vi } from "vitest";
import {
  broadcastCrosshair, broadcastRange, paneLinkOf, registerPane, registeredPaneIds, setPaneLinks, setPaneSync,
  subscribePaneRegistry, type PaneLink, type PaneRegistration,
} from "../paneSync";
import { toTimeWindow, type AxisClock, type LogicalRange } from "../timeWindow";

// ── E09: independent chart link groups ON the existing bus ──────────────────────────────────
// Groups narrow WHO the one paneSync bus mirrors to — same group, the dimension that group shares,
// the same timeframe — while registration, the calendar conversion (lib/timeWindow.ts) and the
// echo bookkeeping stay the single ones. Every window assertion below is written in CALENDAR
// terms, with peers whose histories start on different dates, so an implementation that groups
// correctly but mirrors bar numbers still fails.

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

function businessDays(startISO: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${startISO}T00:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// Same fake as paneSyncTimeAxis.test.ts: the Lightweight Charts v5.2 surface paneSync touches,
// including the library's own range clamp and range events that land on a LATER frame (`flush`).
const WIDTH = 600;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

class FakePane {
  range: LogicalRange;
  writes = 0;
  private pending = false;
  private listeners: ((r: LogicalRange) => void)[] = [];
  crosshair: { price: number | null; time: unknown } | null = null;
  /** Every chart / time-scale / series member the bus reached for — the AC-E09-02 surface audit. */
  readonly touched = new Set<string>();

  constructor(readonly id: number, readonly bars: string[], readonly tf = "D") {
    this.range = { from: bars.length - 240, to: bars.length - 1 };
  }

  private applyClamp(r: LogicalRange): LogicalRange {
    const n = this.bars.length;
    const base = n - 1;
    const count = r.to - r.from + 1;
    const barSpacing = clamp(WIDTH / count, 0.5, WIDTH * 0.5);
    const minRightOffset = 0 - base - 1 + Math.min(2, n);
    const maxRightOffset = WIDTH / barSpacing - Math.min(2, n);
    const rightOffset = clamp(r.to - base, minRightOffset, maxRightOffset);
    const bars = WIDTH / barSpacing;
    const to = rightOffset + base;
    return { from: to - bars + 1, to };
  }

  private set(r: LogicalRange) {
    const next = this.applyClamp(r);
    if (Math.abs(next.from - this.range.from) < 1e-9 && Math.abs(next.to - this.range.to) < 1e-9) return;
    this.range = next;
    this.pending = true;
  }

  userView(r: LogicalRange) { this.set(r); this.pending = false; this.fire(); }
  flush() { if (!this.pending) return; this.pending = false; this.fire(); }
  onRange(cb: (r: LogicalRange) => void) { this.listeners.push(cb); }
  hasPending() { return this.pending; }
  private fire() { for (const l of [...this.listeners]) l(this.range); }

  private audit<T extends object>(prefix: string, target: T): T {
    return new Proxy(target, {
      get: (obj, key, recv) => { if (typeof key === "string") this.touched.add(`${prefix}${key}`); return Reflect.get(obj, key, recv); },
    });
  }

  get chart() {
    const pane = this; // eslint-disable-line @typescript-eslint/no-this-alias
    const timeScale = pane.audit("timeScale.", {
      getVisibleLogicalRange: () => ({ ...pane.range }),
      getVisibleRange: () => null,
      setVisibleLogicalRange: (r: LogicalRange) => { pane.writes++; pane.set(r); },
      timeToIndex: (time: string) => { const i = pane.bars.indexOf(time); return i >= 0 ? i : null; },
    });
    return pane.audit("chart.", {
      timeScale: () => timeScale,
      clearCrosshairPosition: () => { pane.crosshair = null; },
      setCrosshairPosition: (price: number, time: unknown) => { pane.crosshair = { price, time }; },
    }) as unknown as PaneRegistration["chart"];
  }

  get series() {
    const pane = this; // eslint-disable-line @typescript-eslint/no-this-alias
    return pane.audit("series.", {
      dataByIndex: (i: number, mismatch?: number) => {
        const n = pane.bars.length;
        if (i >= 0 && i < n && Number.isInteger(i)) return { time: pane.bars[i], close: 100 + i };
        if (mismatch === -1) return i >= n ? { time: pane.bars[n - 1], close: 100 + n - 1 } : null;
        if (mismatch === 1) return i < 0 ? { time: pane.bars[0], close: 100 } : null;
        return null;
      },
    }) as unknown as PaneRegistration["series"];
  }

  window(): { from: number; to: number } {
    const clock: AxisClock = {
      first: 0,
      last: this.bars.length - 1,
      msAt: (i) => (i >= 0 && i < this.bars.length ? ms(this.bars[i]) : NaN),
      step: DAY,
    };
    return toTimeWindow(clock, this.range)!;
  }
}

const cleanups: (() => void)[] = [];

function mount(pane: FakePane, onCrosshair?: PaneRegistration["onCrosshair"]) {
  const off = registerPane(pane.id, {
    chart: pane.chart,
    series: pane.series,
    tf: pane.tf,
    valueAt: (t) => { const i = pane.bars.indexOf(t as string); return i >= 0 ? 100 + i : null; },
    onCrosshair,
  });
  pane.onRange((r) => broadcastRange(pane.id, r));
  cleanups.push(off);
  return off;
}

function settle(panes: FakePane[], maxFrames = 20): number {
  for (let frame = 0; frame < maxFrames; frame++) {
    if (!panes.some((p) => p.hasPending())) return frame;
    for (const p of panes) p.flush();
  }
  throw new Error("pane sync never settled — mirrored range is bouncing between panes");
}

function expectSameWindow(a: FakePane, b: FakePane, toleranceDays = 1.5) {
  expect(Math.abs(a.window().from - b.window().from) / DAY).toBeLessThan(toleranceDays);
  expect(Math.abs(a.window().to - b.window().to) / DAY).toBeLessThan(toleranceDays);
}

const link = (group: string, crosshair = true, window = true): PaneLink => ({ group, crosshair, window });

// A manual frame clock, so a crosshair sample can be queued, the world changed, and THEN flushed.
let frames: Array<FrameRequestCallback | null> = [];
function manualFrames() {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", (h: number) => { frames[h - 1] = null; });
}
function runFrames() { const due = frames; frames = []; for (const cb of due) cb?.(0); }

afterEach(() => {
  setPaneSync(false);
  while (cleanups.length) cleanups.pop()!();
  vi.unstubAllGlobals();
});

const ALL = businessDays("2019-01-01", 1200);

describe("AC-E09-01 — only current members of the selected group receive synchronisation", () => {
  it("two groups and an independent chart: each move reaches its own group and nobody else", () => {
    // Different listing depths inside each group, so a bar-number mirror would land in another year.
    const a0 = new FakePane(0, ALL);
    const a1 = new FakePane(1, ALL.slice(400));
    const b2 = new FakePane(2, ALL.slice(100));
    const b3 = new FakePane(3, ALL.slice(700));
    const solo = new FakePane(4, ALL);
    const panes = [a0, a1, b2, b3, solo];
    panes.forEach((p) => mount(p));
    setPaneLinks({ 0: link("A"), 1: link("A"), 2: link("B"), 3: link("B") });

    a0.userView({ from: 820, to: 900 });
    settle(panes);
    expectSameWindow(a0, a1);
    expect([b2.writes, b3.writes, solo.writes]).toEqual([0, 0, 0]);

    const aWrites = [a0.writes, a1.writes];
    b2.userView({ from: 650, to: 760 });
    settle(panes);
    expectSameWindow(b2, b3);
    expect([a0.writes, a1.writes]).toEqual(aWrites);
    expect(solo.writes).toBe(0);

    // The independent chart neither receives nor broadcasts.
    const before = panes.map((p) => p.writes);
    solo.userView({ from: 300, to: 380 });
    settle(panes);
    expect(panes.map((p) => p.writes)).toEqual(before);

    broadcastCrosshair(0, ALL[860]);
    expect(a1.crosshair).toEqual({ price: 100 + ALL.slice(400).indexOf(ALL[860]), time: ALL[860] });
    expect([b2.crosshair, b3.crosshair, solo.crosshair]).toEqual([null, null, null]);
    broadcastCrosshair(4, ALL[1000]);
    expect(b2.crosshair).toBeNull();
    expect(a1.crosshair?.time).toBe(ALL[860]);
  });

  it("re-grouping changes the audience immediately: a moved chart follows its NEW group only", () => {
    const a0 = new FakePane(0, ALL);
    const p1 = new FakePane(1, ALL.slice(300));
    const b2 = new FakePane(2, ALL.slice(600));
    const panes = [a0, p1, b2];
    panes.forEach((p) => mount(p));
    setPaneLinks({ 0: link("A"), 1: link("A"), 2: link("B") });
    setPaneLinks({ 0: link("A"), 1: link("B"), 2: link("B") });

    const p1Writes = p1.writes;
    a0.userView({ from: 700, to: 800 });
    settle(panes);
    expect(p1.writes).toBe(p1Writes);
    expect(b2.writes).toBe(0);

    const aWindow = a0.window();
    b2.userView({ from: 300, to: 420 });
    settle(panes);
    expectSameWindow(b2, p1);
    expect(a0.window()).toEqual(aWindow);                                    // A stays where its own move left it
  });

  it("a pane absent from the plan, or sharing nothing, is independent", () => {
    const a = new FakePane(0, ALL);
    const b = new FakePane(1, ALL);
    const c = new FakePane(2, ALL);
    [a, b, c].forEach((p) => mount(p));
    setPaneLinks({ 0: link("A"), 1: link("A", false, false) });
    expect(paneLinkOf(0)).toEqual(link("A"));
    expect(paneLinkOf(1)).toBeNull();
    expect(paneLinkOf(2)).toBeNull();
    a.userView({ from: 500, to: 600 });
    broadcastCrosshair(0, ALL[550]);
    settle([a, b, c]);
    expect([b.writes, c.writes]).toEqual([0, 0]);
    expect([b.crosshair, c.crosshair]).toEqual([null, null]);
  });
});

describe("AC-E09-02 — crosshair and window are independent and move nothing else", () => {
  it("a crosshair-only group never moves windows; a window-only group never moves crosshairs", () => {
    const x0 = new FakePane(0, ALL);
    const x1 = new FakePane(1, ALL.slice(250));
    const w2 = new FakePane(2, ALL);
    const w3 = new FakePane(3, ALL.slice(500));
    const panes = [x0, x1, w2, w3];
    panes.forEach((p) => mount(p));
    setPaneLinks({ 0: link("A", true, false), 1: link("A", true, false), 2: link("B", false, true), 3: link("B", false, true) });

    x0.userView({ from: 600, to: 700 });
    settle(panes);
    expect(x1.writes).toBe(0);
    broadcastCrosshair(0, ALL[650]);
    expect(x1.crosshair?.time).toBe(ALL[650]);

    w2.userView({ from: 800, to: 900 });
    settle(panes);
    expectSameWindow(w2, w3);
    broadcastCrosshair(2, ALL[850]);
    expect(w3.crosshair).toBeNull();
  });

  it("the bus reaches for nothing but the visible range and the crosshair — no symbol, data, options or scale", () => {
    const a = new FakePane(0, ALL);
    const b = new FakePane(1, ALL.slice(300));
    const c = new FakePane(2, ALL.slice(300));
    const panes = [a, b, c];
    const crosshairSeen: Array<[number | null, unknown]> = [];
    mount(a); mount(b, (price, time) => crosshairSeen.push([price, time])); mount(c);
    setPaneLinks({ 0: link("A"), 1: link("A"), 2: link("B") });
    a.userView({ from: 700, to: 780 });
    settle(panes);
    broadcastCrosshair(0, ALL[750]);
    broadcastCrosshair(0, null);
    setPaneLinks({ 0: link("A"), 1: link("B"), 2: link("B") });       // a regroup clears mirrored crosshairs
    c.userView({ from: 500, to: 560 });
    settle(panes);

    const allowed = new Set([
      "chart.timeScale", "chart.setCrosshairPosition", "chart.clearCrosshairPosition",
      "timeScale.getVisibleLogicalRange", "timeScale.setVisibleLogicalRange", "timeScale.timeToIndex",
      "series.dataByIndex",
    ]);
    for (const p of panes) for (const k of p.touched) expect(allowed.has(k), `${p.id}: ${k}`).toBe(true);
    // plan applied (clear) → mirrored → pointer left → regroup (clear): the bus only ever places
    // or clears the crosshair it owns.
    expect(crosshairSeen.map(([, t]) => t)).toEqual([null, ALL[750], null, null]);
  });

  it("the bus itself refuses cross-timeframe mirroring even inside one group", () => {
    const d = new FakePane(0, ALL, "D");
    const w = new FakePane(1, ALL, "W");
    mount(d); mount(w);
    setPaneLinks({ 0: link("A"), 1: link("A") });
    d.userView({ from: 500, to: 600 });
    broadcastCrosshair(0, ALL[550]);
    settle([d, w]);
    expect(w.writes).toBe(0);
    expect(w.crosshair).toBeNull();
  });
});

describe("AC-E09-03 — calendar windows and echo suppression survive group changes", () => {
  it("an echo still in flight when its pane changes group is absorbed, not re-broadcast to the new group", () => {
    const a0 = new FakePane(0, ALL);
    const p1 = new FakePane(1, ALL.slice(450));
    const b2 = new FakePane(2, ALL.slice(150));
    mount(a0); mount(p1); mount(b2);
    setPaneLinks({ 0: link("A"), 1: link("A"), 2: link("B") });

    a0.userView({ from: 900, to: 1000 });       // pane 1 is written; its range event is still queued
    expect(p1.writes).toBe(1);
    expect(p1.hasPending()).toBe(true);
    setPaneLinks({ 0: link("A"), 1: link("B"), 2: link("B") });

    p1.flush();                                  // the echo lands AFTER the regroup
    settle([a0, p1, b2]);
    expect(b2.writes).toBe(0);                   // absorbed: the new group never saw pane 1's echo

    p1.userView({ from: 200, to: 300 });         // a genuine move in the new group follows by calendar
    settle([a0, p1, b2]);
    expectSameWindow(p1, b2);
    expect(b2.writes).toBe(1);
    expect(a0.window().from).toBeGreaterThan(p1.window().from + 300 * DAY);
  });

  it("re-grouping back and forth never starts a feedback loop between depth-mismatched peers", () => {
    const a = new FakePane(0, ALL);
    const b = new FakePane(1, ALL.slice(900));      // far shorter history: no-overlap clamp territory
    mount(a); mount(b);
    for (let round = 0; round < 4; round++) {
      setPaneLinks(round % 2 ? { 0: link("A"), 1: link("A") } : { 0: link("B"), 1: link("B") });
      a.userView({ from: 100 + round * 40, to: 160 + round * 40 });   // before b's first bar
      expect(settle([a, b])).toBeLessThanOrEqual(3);                  // `settle` throws on a loop
    }
  });
});

describe("AC-E09-04 — retired registrations and stale notifications cannot reach new owners", () => {
  it("a crosshair queued by a registration that was replaced before the frame is dropped", () => {
    manualFrames();
    const old0 = new FakePane(0, ALL);
    const peer = new FakePane(1, ALL);
    const offOld = mount(old0);
    mount(peer);
    setPaneLinks({ 0: link("A"), 1: link("A") });

    broadcastCrosshair(0, ALL[700]);              // queued for the next frame
    const new0 = new FakePane(0, ALL.slice(600)); // slot 0 is re-registered (symbol switch) first…
    mount(new0);
    runFrames();
    expect(peer.crosshair).toBeNull();            // …so the old sample never speaks for the new owner

    offOld();                                     // the retired owner's late cleanup is a no-op
    expect(registeredPaneIds()).toBe("0,1");
    broadcastCrosshair(0, ALL[800]);
    runFrames();
    expect(peer.crosshair?.time).toBe(ALL[800]);  // the new owner is registered and linked
  });

  it("a crosshair queued before a regroup reaches neither the old group nor the new one", () => {
    manualFrames();
    const a = new FakePane(0, ALL);
    const b = new FakePane(1, ALL);
    const c = new FakePane(2, ALL);
    [a, b, c].forEach((p) => mount(p));
    setPaneLinks({ 0: link("A"), 1: link("A"), 2: link("B") });
    broadcastCrosshair(0, ALL[700]);
    setPaneLinks({ 0: link("B"), 1: link("A"), 2: link("B") });
    runFrames();
    expect([b.crosshair, c.crosshair]).toEqual([null, null]);
    broadcastCrosshair(0, ALL[710]);
    runFrames();
    expect(c.crosshair?.time).toBe(ALL[710]);
    expect(b.crosshair).toBeNull();
  });

  it("re-sending the same plan is a no-op: a queued sample survives an unrelated re-render", () => {
    manualFrames();
    const a = new FakePane(0, ALL);
    const b = new FakePane(1, ALL);
    mount(a); mount(b);
    const plan = { 0: link("A"), 1: link("A") };
    setPaneLinks(plan);
    broadcastCrosshair(0, ALL[640]);
    setPaneLinks({ ...plan });
    runFrames();
    expect(b.crosshair?.time).toBe(ALL[640]);
  });

  it("a disposed pane's callbacks are never called again, and its slot's next owner starts clean", () => {
    const a = new FakePane(0, ALL);
    const gone = new FakePane(1, ALL);
    const goneSeen = vi.fn();
    mount(a);
    const offGone = mount(gone, goneSeen);
    setPaneLinks({ 0: link("A"), 1: link("A") });
    broadcastCrosshair(0, ALL[500]);
    expect(goneSeen).toHaveBeenLastCalledWith(100 + 500, ALL[500]);
    offGone();
    const callsAtRetire = goneSeen.mock.calls.length;
    const writesAtRetire = gone.writes;

    const next = new FakePane(1, ALL.slice(200));
    const nextSeen = vi.fn();
    mount(next, nextSeen);
    broadcastCrosshair(0, ALL[520]);
    a.userView({ from: 900, to: 980 });
    settle([a, next]);
    expect(goneSeen.mock.calls.length).toBe(callsAtRetire);
    expect(gone.writes).toBe(writesAtRetire);
    expect(nextSeen).toHaveBeenLastCalledWith(100 + ALL.slice(200).indexOf(ALL[520]), ALL[520]);
    expectSameWindow(a, next);
  });

  it("the registry is observable, and only a CURRENT owner's retirement notifies", () => {
    const seen = vi.fn();
    const off = subscribePaneRegistry(seen);
    try {
      const a = new FakePane(3, ALL);
      const offA = mount(a);
      expect(registeredPaneIds()).toBe("3");
      const offA2 = mount(new FakePane(3, ALL));
      const calls = seen.mock.calls.length;
      offA();                                 // stale cleanup of the replaced registration
      expect(seen.mock.calls.length).toBe(calls);
      expect(registeredPaneIds()).toBe("3");
      offA2();
      expect(registeredPaneIds()).toBe("");
      expect(seen.mock.calls.length).toBe(calls + 1);
    } finally { off(); }
  });

  it("the legacy switch replaces a group plan entirely (one owner of the bus state)", () => {
    const a = new FakePane(0, ALL);
    const b = new FakePane(1, ALL.slice(300));
    mount(a); mount(b);
    setPaneLinks({ 0: link("A", true, false), 1: link("B", true, false) });
    setPaneSync(true);
    expect(paneLinkOf(0)).toEqual({ group: "*", crosshair: true, window: true });
    a.userView({ from: 800, to: 900 });
    settle([a, b]);
    expectSameWindow(a, b);
    setPaneSync(false);
    expect(paneLinkOf(0)).toBeNull();
    a.userView({ from: 500, to: 560 });
    settle([a, b]);
    expect(b.window().from).toBeGreaterThan(a.window().from + 200 * DAY);
  });
});
