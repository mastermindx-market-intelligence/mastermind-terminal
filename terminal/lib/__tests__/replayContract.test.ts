import { describe, it, expect } from "vitest";
import {
  REPLAY_MIN_IDX,
  REPLAY_MIN_TOTAL,
  replayIsAvailable,
  replayChartKey,
  resolveReplayTotal,
  replayHasSpan,
  clampReplayIdx,
  initialReplayIdx,
  replayClockOf,
  barAvailableAt,
  replayAxisOf,
  replayVisibleCount,
  replayIdxAt,
  replayCutoffAt,
  stepReplayCutoff,
  replayExitFor,
  sameReplayAxis,
  type ReplayCutoff,
} from "@/lib/replayContract";
import { groupSessionBars } from "@/lib/sessionBars";
import aaplDoc from "@/public/data/AAPL.json";

// ─────────────────────────────────────────────────────────────────────────────
// Bar Replay temporal authority. The defect this locks: a workspace presented one
// global Replay transport while only the ACTIVE pane was sliced into history, so
// its neighbour silently stayed at present time — and the transport's own length
// came from whichever pane last reported, which was not necessarily either of them.
//
// The numbers below are the shipped fixtures (terminal/public/data/*.json), and
// they are the whole argument for the contract: on IDENTICAL daily bars, one
// integer index names two dates almost two years apart.
//
//   AAPL  1255 bars from 2021-06-28   → index 300 = 2022-09-06
//   ARM    698 bars from 2023-09-14   → index 300 = 2024-11-21
// ─────────────────────────────────────────────────────────────────────────────
const AAPL_TOTAL = 1255;
const ARM_TOTAL = 698;

describe("replay availability — the single-chart contract", () => {
  it("offers Replay only to a workspace of exactly one chart", () => {
    expect(replayIsAvailable(1)).toBe(true);
    expect(replayIsAvailable(2)).toBe(false);
    expect(replayIsAvailable(4)).toBe(false);
  });

  it("still refuses a grid whose panes share a timeframe", () => {
    // The old gate was `mixedTfs` — matching timeframes were allowed through, which
    // is exactly how AAPL and ARM both entered Replay on "D" and then disagreed
    // about what bar 300 meant. Pane COUNT is the contract; timeframe is not.
    expect(replayIsAvailable(2)).toBe(false);
    expect(resolveReplayTotal({ "AAPL|D": AAPL_TOTAL, "ARM|D": ARM_TOTAL }, ["AAPL", "ARM"], ["D", "D"])).toBe(0);
  });

  it("refuses a grid of the SAME symbol at the same timeframe", () => {
    expect(resolveReplayTotal({ "AAPL|D": AAPL_TOTAL }, ["AAPL", "AAPL"], ["D", "D"])).toBe(0);
  });
});

describe("replay span — bound to the chart on screen, never to a neighbour", () => {
  const totals = { "AAPL|D": AAPL_TOTAL, "AAPL|3D": 419, "ARM|D": ARM_TOTAL };

  it("reports the bar count of the one chart that may replay", () => {
    expect(resolveReplayTotal(totals, ["AAPL"], ["D"])).toBe(AAPL_TOTAL);
    expect(resolveReplayTotal(totals, ["ARM"], ["D"])).toBe(ARM_TOTAL);
  });

  it("keys the span by timeframe, so a resampled series cannot borrow the daily length", () => {
    expect(resolveReplayTotal(totals, ["AAPL"], ["3D"])).toBe(419);
    expect(replayChartKey("AAPL", "3D")).not.toBe(replayChartKey("AAPL", "D"));
  });

  it("reports 0 — not a stale number — when the chart on screen has not measured itself", () => {
    // The live defect: the shell held one `total` written by the last pane to load
    // while active. Focusing AAPL (1255 bars) left the transport reading ARM's 698,
    // so the rail claimed "619 / 698" about a 1255-bar chart. An unknown span must
    // read as unknown.
    expect(resolveReplayTotal(totals, ["NVDA"], ["D"])).toBe(0);
    expect(resolveReplayTotal({}, ["AAPL"], ["D"])).toBe(0);
    expect(resolveReplayTotal({ "AAPL|D": 0 }, ["AAPL"], ["D"])).toBe(0);
  });

  it("treats an unscrubbable span as no span", () => {
    expect(replayHasSpan(0)).toBe(false);
    expect(replayHasSpan(REPLAY_MIN_TOTAL - 1)).toBe(false);
    expect(replayHasSpan(REPLAY_MIN_TOTAL)).toBe(true);
    expect(replayHasSpan(AAPL_TOTAL)).toBe(true);
  });
});

describe("transport authority — every control clamps the same way", () => {
  it("never addresses a bar the chart will not honor", () => {
    expect(clampReplayIdx(-5, AAPL_TOTAL)).toBe(REPLAY_MIN_IDX);
    expect(clampReplayIdx(0, AAPL_TOTAL)).toBe(REPLAY_MIN_IDX);
    expect(clampReplayIdx(300, AAPL_TOTAL)).toBe(300);
    expect(clampReplayIdx(99_999, AAPL_TOTAL)).toBe(AAPL_TOTAL - 1);
  });

  it("collapses to the floor when there is no span to scrub", () => {
    expect(clampReplayIdx(300, 0)).toBe(REPLAY_MIN_IDX);
    expect(clampReplayIdx(300, 5)).toBe(REPLAY_MIN_IDX);
  });

  it("carries a position from a longer chart into a shorter one without inventing bars", () => {
    // AAPL's last bar is index 1254; ARM's series ends at 697. Carried onto ARM the
    // position clamps to ARM's own last bar instead of addressing 557 bars ARM never
    // had — which is what a shared index across panes would have asked for.
    expect(AAPL_TOTAL - 1).toBeGreaterThan(ARM_TOTAL - 1);
    expect(clampReplayIdx(AAPL_TOTAL - 1, ARM_TOTAL)).toBe(ARM_TOTAL - 1);
    expect(clampReplayIdx(618, ARM_TOTAL)).toBe(618);   // in range on both — no clamp
  });

  it("opens on a run-up of recent history, never past the warmup floor", () => {
    expect(initialReplayIdx(AAPL_TOTAL)).toBe(AAPL_TOTAL - 80);
    expect(initialReplayIdx(ARM_TOTAL)).toBe(ARM_TOTAL - 80);
    expect(initialReplayIdx(60)).toBe(REPLAY_MIN_IDX);   // shorter than the run-up
    expect(initialReplayIdx(0)).toBe(REPLAY_MIN_IDX);
  });

  it("keeps the opening position inside the span it was computed from", () => {
    for (const total of [REPLAY_MIN_TOTAL, 60, ARM_TOTAL, AAPL_TOTAL]) {
      const idx = initialReplayIdx(total);
      expect(idx).toBeGreaterThanOrEqual(REPLAY_MIN_IDX);
      expect(idx).toBeLessThanOrEqual(total - 1);
    }
  });
});

describe("chart identity", () => {
  it("distinguishes symbols and timeframes, and tolerates an unmounted pane", () => {
    expect(replayChartKey("AAPL", "D")).toBe("AAPL|D");
    expect(replayChartKey("ARM", "D")).toBe("ARM|D");
    expect(replayChartKey(undefined, undefined)).toBe("|");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The replay position is an INSTANT. The residual defect: a timeframe change kept the
// integer, so daily bar N became weekly bar N — on NVDA, 2026-03-04 under a REPLAY badge
// turned into the whole weekly history through 2026-06-26. The cutoff is now the moment
// the replay has reached, read through the canonical bar identity (time = which bar,
// closeTime / interval end = when it was knowable), and the integer is derived per chart.
// ─────────────────────────────────────────────────────────────────────────────
type Row = { time: string };
const DAILY: Row[] = aaplDoc.bars.map((b) => ({ time: String(b[0]) }));

/** ISO-week bucket keyed by its LAST session — the calendar rule ChartPanel's resampler uses. */
function weekly(rows: Row[]): Row[] {
  const out: Row[] = [];
  let key = "";
  for (const r of rows) {
    const d = new Date(`${r.time}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    if (monday !== key) { out.push({ time: r.time }); key = monday; } else out[out.length - 1] = { time: r.time };
  }
  return out;
}
const WEEKLY = weekly(DAILY);
const THREE_DAY = groupSessionBars(DAILY, 3, 0, (from, to) => ({ from, to }));
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

describe("replay cutoff — one instant across timeframes", () => {
  it("fixture sanity: the shipped AAPL daily series and its weekly bucketing", () => {
    expect(DAILY.length).toBe(AAPL_TOTAL);
    expect(DAILY[300].time).toBe("2022-09-06");
    expect(WEEKLY.length).toBeGreaterThan(200);
    expect(WEEKLY.length).toBeLessThan(DAILY.length / 4);
  });

  it("keeps the replay date through D → W → D instead of keeping the bar number", () => {
    const dAxis = replayAxisOf(DAILY, "D");
    const wAxis = replayAxisOf(WEEKLY, "W");
    const cutoff = replayCutoffAt(dAxis, 300)!;
    expect(cutoff).toEqual({ clock: "session", at: day("2022-09-06") });

    // The defect, stated: carried as an integer onto the shorter weekly array, bar 300
    // clamps to the LAST weekly bar — the present, under a REPLAY badge.
    expect(WEEKLY[clampReplayIdx(300, WEEKLY.length)].time).toBe(DAILY[AAPL_TOTAL - 1].time);

    const w = replayIdxAt(wAxis, cutoff);
    expect(w).toBeGreaterThanOrEqual(REPLAY_MIN_IDX);
    expect(WEEKLY[w].time <= "2022-09-06").toBe(true);           // nothing past the cutoff
    expect(WEEKLY[w + 1].time > "2022-09-06").toBe(true);         // …and nothing knowable withheld
    expect(replayVisibleCount(WEEKLY, "W", cutoff)).toBe(w + 1);

    // Back on daily the cutoff — not a re-derived index — puts the chart where it was.
    expect(replayIdxAt(dAxis, cutoff)).toBe(300);
    expect(replayVisibleCount(DAILY, "D", cutoff)).toBe(301);
  });

  it("withholds the week still in progress at the cutoff", () => {
    // 2022-09-07 is a Wednesday; that week's bar is keyed by its last session (Friday
    // 2022-09-09) and is not knowable until then. The last visible weekly bar is the week
    // before, even though its key is two sessions behind the cutoff.
    const cutoff: ReplayCutoff = { clock: "session", at: day("2022-09-07") };
    const n = replayVisibleCount(WEEKLY, "W", cutoff);
    expect(WEEKLY[n - 1].time).toBe("2022-09-02");
    expect(WEEKLY[n].time).toBe("2022-09-09");
    // At Friday's close the week is complete and appears.
    expect(WEEKLY[replayVisibleCount(WEEKLY, "W", { clock: "session", at: day("2022-09-09") }) - 1].time).toBe("2022-09-09");
  });

  it("reads a 3D bar's availability from closeTime, never from its opening-session key", () => {
    const b = THREE_DAY[100];
    expect(b.closeTime > b.time).toBe(true);
    expect(barAvailableAt(b, "3D")).toBe(day(b.closeTime));
    // At the bar's own key (its opening session) it is not complete — it must not show.
    expect(replayVisibleCount(THREE_DAY, "3D", { clock: "session", at: day(b.time) })).toBe(100);
    expect(replayVisibleCount(THREE_DAY, "3D", { clock: "session", at: day(b.closeTime) })).toBe(101);
    // And the transport on 3D lands on that bar's completion instant.
    expect(replayCutoffAt(replayAxisOf(THREE_DAY, "3D"), 100)).toEqual({ clock: "session", at: day(b.closeTime) });
  });

  it("dates an intraday bar by the end of its interval", () => {
    const t0 = 1_700_000_000;                                      // display-epoch seconds
    const rows = Array.from({ length: 40 }, (_, i) => ({ time: t0 + i * 3600 }));
    expect(barAvailableAt(rows[0], "1h")).toBe((t0 + 3600) * 1000);
    expect(barAvailableAt(rows[0], "30s")).toBe((t0 + 30) * 1000);
    const end25 = (t0 + 25 * 3600 + 3600) * 1000;
    expect(replayVisibleCount(rows, "1h", { clock: "intraday", at: end25 })).toBe(26);
    expect(replayVisibleCount(rows, "1h", { clock: "intraday", at: end25 - 1 })).toBe(25);
    // 4h over the same instant: a 4h bar opening 3h before the cutoff is still forming.
    const four = Array.from({ length: 10 }, (_, i) => ({ time: t0 + i * 14_400 }));
    expect(replayVisibleCount(four, "4h", { clock: "intraday", at: (t0 + 14_400 + 3 * 3600) * 1000 })).toBe(1);
  });

  it("never pads a chart that has too little history before the cutoff", () => {
    const early: ReplayCutoff = { clock: "session", at: day(DAILY[30].time) };
    const n = replayVisibleCount(WEEKLY, "W", early);
    expect(n).toBeLessThan(REPLAY_MIN_TOTAL);
    expect(WEEKLY[n - 1].time <= DAILY[30].time).toBe(true);
  });
});

describe("replay cutoff — two clocks never mix", () => {
  const session: ReplayCutoff = { clock: "session", at: day("2022-09-06") };
  const hourly = replayAxisOf(Array.from({ length: 50 }, (_, i) => ({ time: 1_660_000_000 + i * 3600 })), "1h");

  it("classifies every timeframe onto one clock", () => {
    for (const tf of ["D", "2D", "3D", "W", "2W", "1M", "3M"]) expect(replayClockOf(tf)).toBe("session");
    for (const tf of ["1s", "30s", "1m", "15m", "1h", "4h"]) expect(replayClockOf(tf)).toBe("intraday");
  });

  it("places no bar of one clock against a cutoff on the other", () => {
    expect(replayIdxAt(hourly, session)).toBe(-1);
    expect(replayVisibleCount([{ time: 1_660_000_000 }], "1h", session)).toBe(0);
    expect(replayVisibleCount(DAILY, "D", null)).toBe(0);
    expect(replayIdxAt(replayAxisOf(DAILY, "D"), null)).toBe(-1);
  });
});

describe("replay exit — a timeframe that cannot honour the cutoff ends Replay", () => {
  const dAxis = replayAxisOf(DAILY, "D");
  const wAxis = replayAxisOf(WEEKLY, "W");

  it("ends on a change of clock, before the new chart has even measured itself", () => {
    const cutoff = replayCutoffAt(dAxis, 300)!;
    expect(replayExitFor(cutoff, "1h", undefined)).toBe("clock");
    expect(replayExitFor(cutoff, "1h", dAxis)).toBe("clock");
  });

  it("ends when fewer than the warmup floor of bars are knowable at the cutoff", () => {
    const floor = replayCutoffAt(dAxis, REPLAY_MIN_IDX)!;
    expect(replayExitFor(floor, "D", dAxis)).toBeNull();
    expect(replayExitFor(floor, "W", wAxis)).toBe("range");
  });

  it("keeps Replay when the new timeframe reaches the cutoff", () => {
    expect(replayExitFor(replayCutoffAt(dAxis, 300)!, "W", wAxis)).toBeNull();
    expect(replayExitFor(replayCutoffAt(dAxis, 300)!, "D", dAxis)).toBeNull();
  });

  it("decides nothing from a chart that has not measured itself yet", () => {
    const cutoff = replayCutoffAt(dAxis, REPLAY_MIN_IDX)!;
    expect(replayExitFor(cutoff, "W", undefined)).toBeNull();
    expect(replayExitFor(cutoff, "W", replayAxisOf([], "W"))).toBeNull();     // reload in flight
    expect(replayExitFor(null, "1h", hourlyAxis())).toBeNull();
  });

  function hourlyAxis() { return replayAxisOf([{ time: 1 }], "1h"); }
});

describe("replay transport over the cutoff", () => {
  const dAxis = replayAxisOf(DAILY, "D");

  it("clamps like every other control and refuses a chart with no span", () => {
    expect(replayCutoffAt(dAxis, 0)).toEqual({ clock: "session", at: day(DAILY[REPLAY_MIN_IDX].time) });
    expect(replayCutoffAt(dAxis, 99_999)).toEqual({ clock: "session", at: day(DAILY[AAPL_TOTAL - 1].time) });
    expect(replayCutoffAt(replayAxisOf(DAILY.slice(0, REPLAY_MIN_TOTAL - 1), "D"), 5)).toBeNull();
    expect(replayCutoffAt(undefined, 300)).toBeNull();
  });

  it("steps one bar of the chart on screen", () => {
    const c = replayCutoffAt(dAxis, 300);
    expect(replayIdxAt(dAxis, stepReplayCutoff(dAxis, c, 1))).toBe(301);
    expect(replayIdxAt(dAxis, stepReplayCutoff(dAxis, c, -1))).toBe(299);
    expect(replayIdxAt(dAxis, stepReplayCutoff(dAxis, replayCutoffAt(dAxis, AAPL_TOTAL - 1), 1))).toBe(AAPL_TOTAL - 1);
    expect(replayIdxAt(dAxis, stepReplayCutoff(dAxis, replayCutoffAt(dAxis, REPLAY_MIN_IDX), -1))).toBe(REPLAY_MIN_IDX);
  });

  it("compares axes by value so a reload of the same bars changes nothing", () => {
    expect(sameReplayAxis(replayAxisOf(DAILY, "D"), dAxis)).toBe(true);
    expect(sameReplayAxis(undefined, dAxis)).toBe(false);
    expect(sameReplayAxis(replayAxisOf(DAILY.slice(1), "D"), dAxis)).toBe(false);
    expect(sameReplayAxis(replayAxisOf(WEEKLY, "W"), replayAxisOf(WEEKLY, "2W"))).toBe(true);
    expect(sameReplayAxis(replayAxisOf([{ time: 1 }], "1h"), replayAxisOf([{ time: 1 }], "D"))).toBe(false);
  });
});
