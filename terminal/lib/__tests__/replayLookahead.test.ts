import { describe, it, expect } from "vitest";
import { detectGapZones, gapZonesAsOf, type GapBar } from "@/lib/gapZones";
import {
  eodSnapshotKnown,
  replaySignalAdmission,
  replayExitFor,
  replayExitOnScreen,
  recordReplayAxis,
  replayAxisOf,
  replayVisibleCount,
  type ReplayCutoff,
} from "@/lib/replayContract";
import { deriveOptLevels } from "@/lib/optionsLevels";
import { runPine } from "@/lib/pine-engine";
import { ORACLE_V1_PINE } from "@/lib/pine";
import nvdaDoc from "@/public/data/NVDA.json";

// ─────────────────────────────────────────────────────────────────────────────
// Replay lookahead: everything drawn over a replayed chart must be knowable at the
// replay date. The candles and studies were already sliced; these are the consumers
// that read their OWN data instead of the sliced bars, and so painted the future
// over a historical chart:
//
//   • Gap Zones scanned the FULL daily history for fills, so a gap still open at the
//     replay date was drawn faded ("filled") because of a bar months later;
//   • Options Levels drew today's dealer walls on a chart rewound to a past date;
//   • a RETRO projection — "the rule in force since 2026-08-10 would have entered" —
//     was painted on charts rewound to before that rule existed.
// ─────────────────────────────────────────────────────────────────────────────

type Row = [string, number, number, number, number, number];
const NVDA: GapBar[] = (nvdaDoc as unknown as { bars: Row[] }).bars.map((b) => ({ time: b[0], h: b[2], l: b[3] }));
const THR = 0.003;   // the Gap Zones default minGapPct (0.3%)
const knownAt = (date: string) => NVDA.filter((b) => (b.time as string) <= date).length;

describe("Gap Zones as of a replay date", () => {
  const all = detectGapZones(NVDA, THR);

  it("a gap still open at the replay date is not drawn as filled by a later bar", () => {
    // NVDA fixture: 2025-11-04 gapped down (high 203.97 under the prior low 205.56). Nothing
    // traded back up into that band until 2026-04-24. Replayed to 2026-03-04 it was OPEN.
    const known = knownAt("2026-03-04");
    expect(known).toBe(1176);
    const gap = all.find((g) => g.date === "2025-11-04")!;
    expect(gap).toMatchObject({ type: "down", lo: 203.9699, hi: 205.56, fillDate: "2026-04-24" });
    expect(gapZonesAsOf(all, known).find((g) => g.date === "2025-11-04")?.fill).toBeNull();
    expect(gapZonesAsOf(all, NVDA.length).find((g) => g.date === "2025-11-04")?.fill).toBe("2026-04-24");
  });

  it("a gap that forms after the replay date does not exist yet", () => {
    const known = knownAt("2026-03-04");
    const late = all.filter((g) => g.date > "2026-03-04");
    expect(late.length).toBeGreaterThan(0);
    const view = gapZonesAsOf(all, known);
    expect(view.some((g) => g.date > "2026-03-04")).toBe(false);
    for (const g of view) if (g.fill) expect(g.fill <= "2026-03-04").toBe(true);
  });

  it("matches, at every cutoff, what a chart holding only the known bars computes", () => {
    // The property that rules out lookahead: knowing more history cannot change what was
    // knowable. Mid-week, month-end and warmup-floor cutoffs included.
    for (const known of [21, 200, 511, 777, 1000, 1176, 1212, 1254, NVDA.length]) {
      const prefix = NVDA.slice(0, known);
      expect(gapZonesAsOf(all, known), `cutoff ${known}`).toEqual(gapZonesAsOf(detectGapZones(prefix, THR), known));
    }
  });

  it("the open/filled split differs between the replay date and today on this fixture", () => {
    const open = (k: number) => gapZonesAsOf(all, k).filter((g) => !g.fill).length;
    expect(open(NVDA.length)).toBe(19);
    expect(open(knownAt("2026-03-04"))).toBe(17);
  });

  it("detects gaps up and down, honours the size floor and finds the first fill", () => {
    const bars: GapBar[] = [
      { time: "2024-01-02", h: 10, l: 9 },
      { time: "2024-01-03", h: 12, l: 11 },     // up gap [10, 11]
      { time: "2024-01-04", h: 13, l: 11.5 },
      { time: "2024-01-05", h: 11.8, l: 9.5 },  // fills the up gap (low ≤ 10)
      { time: "2024-01-08", h: 9.4, l: 8.8 },   // down gap [9.4, 9.5] — 1.05%
    ];
    const gaps = detectGapZones(bars, 0);
    expect(gaps.map((g) => [g.date, g.type, g.lo, g.hi, g.fillDate])).toEqual([
      ["2024-01-03", "up", 10, 11, "2024-01-05"],
      ["2024-01-08", "down", 9.4, 9.5, null],
    ]);
    expect(detectGapZones(bars, 0.05).map((g) => g.date)).toEqual(["2024-01-03"]);
    expect(gapZonesAsOf(gaps, 4).map((g) => g.fill)).toEqual(["2024-01-05"]);
    expect(gapZonesAsOf(gaps, 3)).toEqual([{ date: "2024-01-03", type: "up", lo: 10, hi: 11, fill: null }]);
  });
});

describe("Options Levels are an end-of-day snapshot dated by their newest input", () => {
  const session = (date: string): ReplayCutoff => ({ clock: "session", at: Date.parse(`${date}T00:00:00Z`) });

  it("live charts are unaffected", () => {
    expect(eodSnapshotKnown("2026-06-26", null)).toBe(true);
    expect(eodSnapshotKnown(null, null)).toBe(true);
  });

  it("a snapshot after the replay date is not knowable; one on or before it is", () => {
    const cut = session("2026-03-04");
    expect(eodSnapshotKnown("2026-06-26", cut)).toBe(false);
    expect(eodSnapshotKnown("2026-06-26T16:00:00-04:00", cut)).toBe(false);
    expect(eodSnapshotKnown("2026-03-04", cut)).toBe(true);
    expect(eodSnapshotKnown("2026-03-03", cut)).toBe(true);
    // an undated snapshot cannot be placed before anything
    expect(eodSnapshotKnown(null, cut)).toBe(false);
  });

  it("on the intraday clock a session's EOD snapshot is known only after that session", () => {
    const at = (iso: string): ReplayCutoff => ({ clock: "intraday", at: Date.parse(iso) });
    expect(eodSnapshotKnown("2026-03-04", at("2026-03-04T15:00:00Z"))).toBe(false);
    expect(eodSnapshotKnown("2026-03-04", at("2026-03-05T14:30:00Z"))).toBe(true);
  });

  it("the derivation reports the NEWEST contributing date beside the oldest", () => {
    const gex = { root: "NVDA", asof: "2026-06-26T16:00:00-04:00", spot_ref: 150, call_wall: 160, put_wall: 140 };
    const moves = { root: "NVDA", asof: "2026-06-24", expected_move: { lo: 145, hi: 155 } };
    const r = deriveOptLevels(gex, moves, "NVDA");
    expect(r.asofDate).toBe("2026-06-24");
    expect(r.newestDate).toBe("2026-06-26");
    expect(deriveOptLevels(null, null, "NVDA").newestDate).toBeNull();
    // an undated contributor leaves the snapshot undated at both ends
    expect(deriveOptLevels({ ...gex, asof: "n/a" }, moves, "NVDA").newestDate).toBeNull();
  });
});

describe("signal marks under replay", () => {
  const retro = { ts: "2026-03-02", type: "BUY", retro_override: true, retro_ctx: { name: "Semis" } };

  it("live: unchanged — date horizon only, retro projection shown", () => {
    expect(replaySignalAdmission(retro, "2026-08-12", false)).toEqual({ show: true, retro: true });
    expect(replaySignalAdmission({ ts: "2026-08-13" }, "2026-08-12", false)).toEqual({ show: false, retro: false });
    // live keeps the chart-coordinate horizon it always had
    expect(replaySignalAdmission({ ts: "2026-03-03", known_ts: "2026-03-06" }, "2026-03-04", false).show).toBe(true);
  });

  it("a retro projection is not painted on a chart rewound to before its rule existed", () => {
    expect(replaySignalAdmission(retro, "2026-03-04", true)).toEqual({ show: true, retro: false });
    // after the rule date the projection was knowable
    expect(replaySignalAdmission(retro, "2026-08-12", true)).toEqual({ show: true, retro: true });
  });

  it("a signal only observable after the replay date is not shown", () => {
    const late = { ts: "2026-03-03", known_ts: "2026-03-06", type: "BUY" };
    expect(replaySignalAdmission(late, "2026-03-04", true).show).toBe(false);
    expect(replaySignalAdmission(late, "2026-03-06", true).show).toBe(true);
    expect(replaySignalAdmission({ ts: "2026-03-05" }, "2026-03-04", true).show).toBe(false);
    expect(replaySignalAdmission({ ts: 7 }, "2026-03-04", true).show).toBe(false);
  });

  it("the client-Pine fallback is prefix-stable: later bars never move or add an earlier mark", () => {
    // The fallback runs once on the full daily history and is filtered to the replay date.
    // That is only lookahead-free if what it marks on or before any date does not depend on
    // bars after it — checked here on the shipped fixture at mid-week and month-end cutoffs.
    const bars = (nvdaDoc as unknown as { bars: Row[] }).bars.map((b) => ({ time: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }));
    const marks = (rows: typeof bars) => {
      const out = runPine(ORACLE_V1_PINE, rows as never, { timeframe: "D", symbol: "NVDA" });
      expect(out.ok).toBe(true);
      return out.result!.shapes
        .filter((s) => s.text === "★" || s.text === "CUT" || s.text === "RE-BUY")
        .map((s) => `${String(s.time)}|${s.text}|${s.position}`);
    };
    const full = marks(bars);
    expect(full.length).toBeGreaterThan(10);
    for (const end of ["2023-05-24", "2024-07-31", "2025-04-09", "2026-03-04"]) {
      const k = bars.filter((b) => b.time <= end).length;
      const prefix = marks(bars.slice(0, k));
      expect(prefix, `cutoff ${end}`).toEqual(full.filter((m) => m.slice(0, 10) <= end));
    }
  }, 60_000);
});

describe("an empty chart cannot keep Replay armed", () => {
  const cut: ReplayCutoff = { clock: "session", at: Date.parse("2026-03-04T00:00:00Z") };

  it("a chart measured empty on the replay's clock ends Replay", () => {
    expect(replayExitOnScreen(cut, "D", replayAxisOf([], "D"))).toBe("range");
    expect(replayExitOnScreen(cut, "W", replayAxisOf([], "W"))).toBe("range");
  });

  it("an unmeasured chart still decides nothing; clocks and ranges are unchanged", () => {
    expect(replayExitOnScreen(cut, "D", undefined)).toBeNull();
    expect(replayExitOnScreen(cut, "1h", undefined)).toBe("clock");
    expect(replayExitOnScreen(null, "D", replayAxisOf([], "D"))).toBeNull();
    const rows = NVDA.map((b) => ({ time: b.time }));
    expect(replayExitOnScreen(cut, "D", replayAxisOf(rows, "D"))).toBeNull();
    expect(replayExitOnScreen(cut, "D", replayAxisOf(rows.slice(1170), "D"))).toBe("range");
    // the pure contract keeps its documented reading of an empty axis
    expect(replayExitFor(cut, "W", replayAxisOf([], "W"))).toBeNull();
    expect(replayVisibleCount(rows, "D", cut)).toBe(1176);
  });
});

describe("the per-chart axis map stays bounded", () => {
  const axis = (n: number) => replayAxisOf(NVDA.slice(0, n).map((b) => ({ time: b.time })), "D");

  it("an unchanged report keeps the same map, so the shell does not re-render", () => {
    const m = recordReplayAxis({}, "NVDA|D", axis(30), new Set(["NVDA|D"]));
    expect(recordReplayAxis(m, "NVDA|D", axis(30), new Set(["NVDA|D"]))).toBe(m);
    expect(recordReplayAxis(m, "NVDA|D", axis(31), new Set(["NVDA|D"]))).not.toBe(m);
  });

  it("visiting many symbols does not keep every one's axis for the life of the page", () => {
    let m: ReturnType<typeof recordReplayAxis> = {};
    for (let i = 0; i < 40; i++) {
      const key = `S${i}|D`;
      m = recordReplayAxis(m, key, axis(30 + i), new Set([key]));
      expect(Object.keys(m).length).toBeLessThanOrEqual(1 + 4 + 1);
      expect(m[key]).toBeDefined();
    }
    // a chart on screen is never dropped, and the reporter is kept even before the layout names it
    m = recordReplayAxis(m, "NEW|W", axis(25), new Set(["S39|D"]));
    expect(m["S39|D"]).toBeDefined();
    expect(m["NEW|W"]).toBeDefined();
  });
});
