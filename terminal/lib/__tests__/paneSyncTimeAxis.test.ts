import { describe, it, expect, afterEach } from "vitest";
import { broadcastCrosshair, broadcastRange, registerPane, setPaneSync, subscribePaneVisibleWindow, type PaneRegistration } from "../paneSync";
import { toTimeWindow, type AxisClock, type LogicalRange } from "../timeWindow";

// ── The defect this suite pins ───────────────────────────────────────────────────────────────
// "Sync crosshair & time-axis across panes" used to mirror the source's LOGICAL range onto every
// peer. Logical indexes are local to each chart's own bar array, so with two same-timeframe
// symbols whose histories start on different dates, index 700 is a different DATE in each pane:
// the crosshairs lined up (they already travelled by time) and the viewports did not.
//
// The fixtures below are that shape on purpose — pane A holds sessions 1…1000 and pane B only
// 501…1000 — and every assertion is written against the CALENDAR window each pane displays, so
// it holds for any implementation that gets the calendar right and fails for one that mirrors
// bar numbers.

const DAY = 86_400_000;

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

function everyDay(startISO: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${startISO}T00:00:00Z`);
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

// ── Fake chart ───────────────────────────────────────────────────────────────────────────────
// Implements exactly the Lightweight Charts v5.2 surface paneSync touches, including the parts
// that make this problem hard: `setVisibleLogicalRange` rewrites the request through the
// library's own clamp (`_correctOffset`: MinVisibleBarsCount = 2), and the resulting change event
// is delivered on a LATER frame, not inside the call. `flush()` is that later frame.

const WIDTH = 600;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

class FakePane {
  range: LogicalRange;
  writes = 0;                       // setVisibleLogicalRange calls received
  private pending = false;
  private listeners: ((r: LogicalRange) => void)[] = [];
  crosshair: { price: number | null; time: unknown } | null = null;

  constructor(readonly id: number, readonly bars: string[], readonly tf = "D") {
    this.range = { from: bars.length - 240, to: bars.length - 1 };
  }

  /** Lightweight Charts' own rewrite of a requested logical range (v5.2 `_internal_setVisibleRange`). */
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

  /** The user drags/zooms this pane: the range changes and the event lands immediately. */
  userView(r: LogicalRange) { this.set(r); this.pending = false; this.fire(); }

  /** Deliver every range event the library has queued — one animation frame. */
  flush() { if (!this.pending) return; this.pending = false; this.fire(); }
  /** What ChartPanel subscribes with: `timeScale().subscribeVisibleLogicalRangeChange`. */
  onRange(cb: (r: LogicalRange) => void) { this.listeners.push(cb); }
  hasPending() { return this.pending; }
  private fire() { for (const l of [...this.listeners]) l(this.range); }

  get chart() {
    const pane = this;
    return {
      timeScale: () => ({
        getVisibleLogicalRange: () => ({ ...pane.range }),
        setVisibleLogicalRange: (r: LogicalRange) => {
          expect(r.from, "lightweight-charts asserts from <= to").toBeLessThanOrEqual(r.to);
          pane.writes++;
          pane.set(r);
        },
        timeToIndex: (time: string, findNearest?: boolean) => {
          const i = pane.bars.indexOf(time);
          if (i >= 0) return i;
          if (!findNearest) return null;
          const t = ms(time);
          let best = 0;
          for (let k = 1; k < pane.bars.length; k++) {
            if (Math.abs(ms(pane.bars[k]) - t) < Math.abs(ms(pane.bars[best]) - t)) best = k;
          }
          return best;
        },
      }),
      clearCrosshairPosition: () => { pane.crosshair = null; },
      setCrosshairPosition: (price: number, time: unknown) => { pane.crosshair = { price, time }; },
    } as unknown as PaneRegistration["chart"];
  }

  get series() {
    const pane = this;
    return {
      dataByIndex: (i: number, mismatch?: number) => {
        const n = pane.bars.length;
        if (i >= 0 && i < n && Number.isInteger(i)) return { time: pane.bars[i], close: 100 + i };
        if (mismatch === -1) return i >= n ? { time: pane.bars[n - 1], close: 100 + n - 1 } : null;
        if (mismatch === 1) return i < 0 ? { time: pane.bars[0], close: 100 } : null;
        return null;
      },
    } as unknown as PaneRegistration["series"];
  }

  /** The calendar window this pane is actually displaying, whitespace included. */
  window(): { from: number; to: number } {
    const clock: AxisClock = {
      first: 0,
      last: this.bars.length - 1,
      msAt: (i) => (i >= 0 && i < this.bars.length ? ms(this.bars[i]) : NaN),
      step: DAY,
    };
    return toTimeWindow(clock, this.range)!;
  }

  /** Human-readable calendar edges, rounded to the day — what the operator sees on the axis. */
  dates(): { from: string; to: string } {
    const w = this.window();
    return {
      from: new Date(Math.round(w.from / DAY) * DAY).toISOString().slice(0, 10),
      to: new Date(Math.round(w.to / DAY) * DAY).toISOString().slice(0, 10),
    };
  }
}

const cleanups: (() => void)[] = [];

function mount(
  pane: FakePane,
  onVisibleWindow?: (window: { from: number; to: number } | null) => void,
) {
  const off = registerPane(pane.id, {
    chart: pane.chart,
    series: pane.series,
    tf: pane.tf,
    valueAt: (t) => {
      const i = pane.bars.indexOf(t as string);
      return i >= 0 ? 100 + i : null;
    },
  });
  const offViewport = onVisibleWindow
    ? subscribePaneVisibleWindow(pane.id, onVisibleWindow)
    : () => {};
  pane.onRange((r) => broadcastRange(pane.id, r));
  const cleanup = () => { offViewport(); off(); };
  cleanups.push(cleanup);
  return cleanup;
}

/** Settle the bus: deliver queued events until nothing is left, or blow up on a feedback loop. */
function settle(panes: FakePane[], maxFrames = 20): number {
  for (let frame = 0; frame < maxFrames; frame++) {
    if (!panes.some((p) => p.hasPending())) return frame;
    for (const p of panes) p.flush();
  }
  throw new Error("pane sync never settled — mirrored range is bouncing between panes");
}

afterEach(() => { setPaneSync(false); while (cleanups.length) cleanups.pop()!(); });

// A calendar window is "the same" when both edges land on the same session, give or take a
// fraction of a bar — panes have different bar sets, so exact float equality is not the contract.
function expectSameWindow(a: FakePane, b: FakePane, toleranceDays = 1.5) {
  const wa = a.window();
  const wb = b.window();
  expect(Math.abs(wa.from - wb.from) / DAY).toBeLessThan(toleranceDays);
  expect(Math.abs(wa.to - wb.to) / DAY).toBeLessThan(toleranceDays);
}

describe("paneSync visible-window observation", () => {
  it("reports the real calendar viewport even when cross-pane sync is disabled", () => {
    const pane = new FakePane(41, businessDays("2026-01-02", 120));
    const seen: Array<{ from: number; to: number } | null> = [];
    mount(pane, (window) => seen.push(window));
    setPaneSync(false);

    // Registration itself reports the current viewport.
    expect(seen.length).toBe(1);
    expect(seen[0]).toEqual(pane.window());

    pane.userView({ from: -5, to: 20 }); // includes left-side whitespace
    expect(seen.at(-1)).toEqual(pane.window());
    expect((seen.at(-1)!.from)).toBeLessThan(ms(pane.bars[0]));
  });
});

describe("paneSync range authority is the calendar, not the bar index", () => {
  it("RED: a peer with a shorter history lands on the same DATES, where bar numbers would not", () => {
    const a = new FakePane(1, businessDays("2020-01-01", 1000));
    const b = new FakePane(2, businessDays("2020-01-01", 1000).slice(500));   // sessions 501…1000
    mount(a); mount(b);
    setPaneSync(true);

    // The window the operator picks on pane A, named in calendar terms.
    const want = { from: a.bars[600], to: a.bars[700] };
    a.userView({ from: 600, to: 700 });
    settle([a, b]);

    expect(b.dates()).toEqual({ from: want.from, to: want.to });
    expectSameWindow(a, b);

    // …and the same window expressed as raw logical indexes — the behaviour being replaced —
    // would have put pane B 500 sessions into a different year.
    const mutant = new FakePane(3, b.bars);
    mutant.userView({ from: 600, to: 700 });
    expect(mutant.dates().from).not.toEqual(want.from);
    expect(Math.abs(mutant.window().from - a.window().from) / DAY).toBeGreaterThan(300);
  });

  it("partial overlap shows the true overlap in place, with whitespace where the peer has no bars", () => {
    const all = businessDays("2020-01-01", 1000);
    const a = new FakePane(1, all);
    const b = new FakePane(2, all.slice(500));
    mount(a); mount(b);
    setPaneSync(true);

    // Window straddles B's first session (index 500 of A): half data, half nothing.
    a.userView({ from: 400, to: 600 });
    settle([a, b]);

    expect(b.dates()).toEqual({ from: all[400], to: all[600] });
    // The peer is positioned so its first bar sits inside the window, not jammed against an edge.
    expect(b.range.from).toBeLessThan(0);
    expect(b.range.to).toBeGreaterThan(0);
    expectSameWindow(a, b);
  });

  it("no overlap parks the peer at its own boundary and stops — no oscillation, no re-driving", () => {
    const all = businessDays("2020-01-01", 1000);
    const a = new FakePane(1, all);
    const b = new FakePane(2, all.slice(500));
    mount(a); mount(b);
    setPaneSync(true);

    a.userView({ from: 100, to: 200 });          // entirely before B's first session
    const frames = settle([a, b]);
    expect(frames).toBeLessThanOrEqual(2);       // settles immediately; a loop would throw above

    // Deterministic landing: B is pinned at the library's own left limit — its earliest sessions
    // sit at the right edge, saying "this symbol's history begins after the window you are on".
    expect(b.range.to).toBeCloseTo(1, 6);
    // The CALENDAR span survives the clamp even though the bar count cannot: with no bars in the
    // window, the peer spaces pure whitespace at its own representative step.
    const spanA = a.window().to - a.window().from;
    const spanB = b.window().to - b.window().from;
    expect(Math.abs(spanB - spanA) / DAY).toBeLessThan(1.5);

    // Re-broadcasting the same window must not touch the peer again: an un-reachable target that
    // is re-issued every frame is exactly the runaway-pan failure.
    const writesAfterFirst = b.writes;
    a.userView({ from: 100, to: 200 });
    settle([a, b]);
    expect(b.writes).toBe(writesAfterFirst);
  });

  it("mirrors across a 4-pane grid with four different history depths", () => {
    const all = businessDays("2018-01-01", 1400);
    const panes = [
      new FakePane(1, all),
      new FakePane(2, all.slice(200)),
      new FakePane(3, all.slice(600)),
      new FakePane(4, all.slice(900)),
    ];
    panes.forEach((pane) => mount(pane));
    setPaneSync(true);

    panes[0].userView({ from: 1000, to: 1200 });
    settle(panes);

    for (const p of panes.slice(1)) {
      expect(p.dates()).toEqual({ from: all[1000], to: all[1200] });
      expectSameWindow(panes[0], p);
    }
  });

  it("agrees with a peer that trades a different session calendar", () => {
    const equity = new FakePane(1, businessDays("2022-01-03", 500));
    const crypto = new FakePane(2, everyDay("2022-01-03", 700));   // seven-day sessions
    mount(equity); mount(crypto);
    setPaneSync(true);

    equity.userView({ from: 200, to: 300 });
    settle([equity, crypto]);

    expectSameWindow(equity, crypto);
    // The peer needed MORE of its own bars to cover the same calendar span — proof the mapping
    // is by date and not by count.
    expect(crypto.range.to - crypto.range.from).toBeGreaterThan(equity.range.to - equity.range.from);
  });

  it("drives the source pane from any peer, not just pane 0", () => {
    const all = businessDays("2020-01-01", 900);
    const a = new FakePane(1, all);
    const b = new FakePane(2, all.slice(300));
    mount(a); mount(b);
    setPaneSync(true);

    b.userView({ from: 100, to: 250 });
    settle([a, b]);
    expect(a.dates()).toEqual({ from: b.bars[100], to: b.bars[250] });
  });
});

describe("paneSync echo suppression is an operation token, not a stopwatch", () => {
  it("absorbs a mirrored write instead of re-broadcasting it", () => {
    const all = businessDays("2020-01-01", 800);
    const a = new FakePane(1, all);
    const b = new FakePane(2, all.slice(400));
    mount(a); mount(b);
    setPaneSync(true);

    a.userView({ from: 500, to: 650 });
    const aWritesBefore = a.writes;
    settle([a, b]);
    expect(b.writes).toBe(1);        // driven exactly once
    expect(a.writes).toBe(aWritesBefore);   // the source is never driven by its own echo
  });

  it("still suppresses an echo delivered many frames late", () => {
    const all = businessDays("2020-01-01", 800);
    const a = new FakePane(1, all);
    const b = new FakePane(2, all.slice(400));
    mount(a); mount(b);
    setPaneSync(true);

    a.userView({ from: 500, to: 650 });
    // A wall-clock suppression window is the thing being replaced: simulate the frame arriving
    // long after any timeout would have expired.
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 60_000;
      settle([a, b]);
    } finally { Date.now = realNow; }
    expect(a.writes).toBe(0);
    expect(b.writes).toBe(1);
  });

  it("does not deafen a pane: a genuine move on a mirrored peer still propagates back", () => {
    const all = businessDays("2020-01-01", 800);
    const a = new FakePane(1, all);
    const b = new FakePane(2, all.slice(400));
    mount(a); mount(b);
    setPaneSync(true);

    a.userView({ from: 500, to: 650 });
    settle([a, b]);

    b.userView({ from: 120, to: 220 });          // the operator now drags the PEER
    settle([a, b]);
    expect(a.dates()).toEqual({ from: b.bars[120], to: b.bars[220] });
  });

  it("survives a continuous pan without fighting", () => {
    const all = businessDays("2019-01-01", 1200);
    const a = new FakePane(1, all);
    const b = new FakePane(2, all.slice(500));
    mount(a); mount(b);
    setPaneSync(true);

    for (let i = 0; i < 40; i++) {
      a.userView({ from: 600 + i * 3, to: 840 + i * 3 });
      settle([a, b]);                             // throws if the panes ever bounce
    }
    expectSameWindow(a, b);
    expect(a.writes).toBe(0);                     // the source was never driven during its own drag
  });
});

describe("paneSync registration and gating", () => {
  it("leaves every viewport independent when sync is off", () => {
    const all = businessDays("2020-01-01", 800);
    const a = new FakePane(1, all);
    const b = new FakePane(2, all.slice(400));
    mount(a); mount(b);
    setPaneSync(false);

    const before = { ...b.range };
    a.userView({ from: 500, to: 650 });
    settle([a, b]);
    expect(b.range).toEqual(before);
    expect(b.writes).toBe(0);
  });

  it("never mirrors a pane on a different timeframe", () => {
    const all = businessDays("2020-01-01", 800);
    const a = new FakePane(1, all, "D");
    const weekly = new FakePane(2, all.slice(400), "W");
    mount(a); mount(weekly);
    setPaneSync(true);

    const before = { ...weekly.range };
    a.userView({ from: 500, to: 650 });
    settle([a, weekly]);
    expect(weekly.range).toEqual(before);
  });

  it("drops a removed pane and leaves no stale registration behind", () => {
    const all = businessDays("2020-01-01", 800);
    const a = new FakePane(1, all);
    const b = new FakePane(2, all.slice(400));
    mount(a);
    const offB = mount(b);
    setPaneSync(true);

    offB();
    const before = { ...b.range };
    a.userView({ from: 500, to: 650 });
    settle([a, b]);
    expect(b.range).toEqual(before);
    expect(b.writes).toBe(0);
  });

  it("re-registering an id replaces the previous pane rather than doubling it", () => {
    const all = businessDays("2020-01-01", 800);
    const a = new FakePane(1, all);
    const stale = new FakePane(2, all.slice(400));
    const fresh = new FakePane(2, all.slice(200));
    mount(a);
    const offStale = mount(stale);
    mount(fresh);
    offStale();                                    // ChartPanel's cleanup runs AFTER the re-register
    setPaneSync(true);

    a.userView({ from: 500, to: 650 });
    settle([a, stale, fresh]);
    expect(fresh.writes).toBe(1);
    expect(stale.writes).toBe(0);
  });

  it("keeps the crosshair on the peer's OWN value at the broadcast timestamp", () => {
    const all = businessDays("2020-01-01", 800);
    const a = new FakePane(1, all);
    const b = new FakePane(2, all.slice(400));
    mount(a); mount(b);
    setPaneSync(true);

    broadcastCrosshair(1, all[500] as never);
    expect(b.crosshair).toEqual({ price: 100 + 100, time: all[500] });   // index 100 in B's array

    broadcastCrosshair(1, all[100] as never);      // before B's history begins
    expect(b.crosshair).toBeNull();

    broadcastCrosshair(1, null);
    expect(b.crosshair).toBeNull();
  });
});
