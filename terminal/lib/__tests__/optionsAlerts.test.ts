import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import {
  evalGammaFlipCross,
  evalWallProximity,
  evalWallMigration,
  evalSignFragile,
  evalOpexConcentration,
  evalPremiumBurst,
  eval0dteShare,
  evalSurfaceHotPocket,
  sessionSlopeStats,
  optAlertPreview,
  buildOptCondition,
  type GexState,
  type GexPayload,
  type TidePayload,
  type DtePayload,
  type SurfaceFramePayload,
} from "../optionsAlerts";

const DATA = path.join(process.cwd(), "public", "data");
const readFixture = async (name: string) => JSON.parse(await fs.readFile(path.join(DATA, name), "utf8"));

// ─── (a) gamma-flip cross ────────────────────────────────────────────────────
describe("evalGammaFlipCross — hysteresis state machine", () => {
  const gs = (spot: number, flip = 748.25): GexState => ({ root: "SPY", spot, gamma_flip: flip, asof: "2026-07-10T06:21Z" });
  const cond = { type: "opt_gamma_flip" as const, root: "SPY", band_pct: 0.05 };

  it("first observation arms without firing (records side)", () => {
    const r = evalGammaFlipCross(cond, gs(751.71), {});
    expect(r.fired).toBe(false);
    expect(r.nextState.side).toBe("above");
    expect(r.value).toBe(751.71);
  });

  it("below→above fires once with 'crossed above' + the level", () => {
    // clear the band decisively: 748.25 → 752 is +0.5% > 0.05% band.
    const r = evalGammaFlipCross(cond, gs(752), { side: "below" });
    expect(r.fired).toBe(true);
    expect(r.note).toContain("crossed above");
    expect(r.note).toContain("748.25");
    expect(r.note).toContain("long-gamma");
    expect(r.note).toContain("as of");
    expect(r.value).toBe(752);
    expect(r.nextState.side).toBe("above");
  });

  it("above→below fires 'crossed below'", () => {
    const r = evalGammaFlipCross(cond, gs(744), { side: "above" });
    expect(r.fired).toBe(true);
    expect(r.note).toContain("crossed below");
    expect(r.note).toContain("short-gamma");
    expect(r.nextState.side).toBe("below");
  });

  it("hysteresis: a spot inside the dead-band after a confirmed side does NOT flip or fire", () => {
    // prior side above; spot dips just below flip but within 0.05% band → hold "above".
    // 748.25 * 0.0005 = 0.374 → 748.0 is 0.033% below, inside the band.
    const r = evalGammaFlipCross(cond, gs(748.0), { side: "above" });
    expect(r.fired).toBe(false);
    expect(r.nextState.side).toBe("above"); // held, not flipped
  });

  it("repeated same-side evals do not refire", () => {
    const first = evalGammaFlipCross(cond, gs(752), { side: "below" });
    expect(first.fired).toBe(true);
    const again = evalGammaFlipCross(cond, gs(753), first.nextState);
    expect(again.fired).toBe(false);
    expect(again.nextState.side).toBe("above");
  });

  it("missing spot or flip → fired:null (cannot evaluate), state untouched", () => {
    expect(evalGammaFlipCross(cond, { root: "SPY", gamma_flip: 748.25 }, { side: "below" }).fired).toBeNull();
    expect(evalGammaFlipCross(cond, { root: "SPY", spot: 752 }, { side: "below" }).fired).toBeNull();
    const r = evalGammaFlipCross(cond, {}, { side: "below" });
    expect(r.fired).toBeNull();
    expect(r.note).toContain("unavailable");
    expect(r.nextState.side).toBe("below"); // preserved
  });
});

// ─── (b) wall proximity ──────────────────────────────────────────────────────
describe("evalWallProximity — enter/leave state machine", () => {
  // NVDA fixture shape: call_wall 150, put_wall 120, spot_ref varies.
  const gx = (spot: number): GexPayload => ({ root: "NVDA", spot_ref: spot, call_wall: 150, put_wall: 120, asof: "2026-07-05T16:05:00Z" });
  const cond = { type: "opt_wall_touch" as const, root: "NVDA", wall: "call" as const, within_pct: 0.25 };

  it("first observation while OUTSIDE arms (no fire)", () => {
    const r = evalWallProximity(cond, gx(135.7), {}); // 9.5% away
    expect(r.fired).toBe(false);
    expect(r.nextState.inside).toBe(false);
  });

  it("first observation while INSIDE arms (no fire — created near the wall must not fire)", () => {
    const r = evalWallProximity(cond, gx(149.9), {}); // inside 0.25%
    expect(r.fired).toBe(false);
    expect(r.nextState.inside).toBe(true);
  });

  it("ENTER (false→true) fires once, note says EOD", () => {
    const r = evalWallProximity(cond, gx(149.8), { inside: false }); // 0.133% away
    expect(r.fired).toBe(true);
    expect(r.note).toContain("EOD");
    expect(r.note).toContain("call wall");
    expect(r.note).toContain("150");
    expect(r.value).toBe(149.8);
    expect(r.nextState.inside).toBe(true);
  });

  it("staying inside does not refire", () => {
    const r = evalWallProximity(cond, gx(149.85), { inside: true });
    expect(r.fired).toBe(false);
    expect(r.nextState.inside).toBe(true);
  });

  it("leave then re-enter fires again", () => {
    const enter1 = evalWallProximity(cond, gx(149.8), { inside: false });
    expect(enter1.fired).toBe(true);
    const leave = evalWallProximity(cond, gx(145), enter1.nextState); // 3.3% away
    expect(leave.fired).toBe(false);
    expect(leave.nextState.inside).toBe(false);
    const enter2 = evalWallProximity(cond, gx(149.8), leave.nextState);
    expect(enter2.fired).toBe(true);
  });

  it("put wall reads put_wall", () => {
    const putCond = { type: "opt_wall_touch" as const, root: "NVDA", wall: "put" as const, within_pct: 0.25 };
    const r = evalWallProximity(putCond, gx(120.2), { inside: false }); // 0.167% from 120
    expect(r.fired).toBe(true);
    expect(r.note).toContain("put wall");
    expect(r.note).toContain("120");
  });

  it("missing wall → fired:null", () => {
    const r = evalWallProximity(cond, { root: "NVDA", spot_ref: 149.8, put_wall: 120 }, { inside: false });
    expect(r.fired).toBeNull();
    expect(r.note).toContain("unavailable");
  });
});

// ─── (c) premium burst ───────────────────────────────────────────────────────
// ── shared burst fixtures ────────────────────────────────────────────────────
// Build a tide payload from per-minute DELTAS. Both legs ride the same cumulative
// path so `leg` selection is orthogonal to the math (the leg tests assert labelling,
// not magnitude); the one-sided rule gets its own explicit fixtures below.
const tideFromDeltas = (deltas: number[]): TidePayload => {
  const stamp = (i: number) => {
    const m = 30 + i;
    return `${String(9 + Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };
  const minutes: { t: string; ncp: number; npp: number }[] = [];
  let v = 0;
  minutes.push({ t: stamp(0), ncp: v, npp: v });
  deltas.forEach((d, i) => {
    v += d;
    minutes.push({ t: stamp(i + 1), ncp: v, npp: v });
  });
  return { minutes, asof: "2026-07-05T15:42:00Z", session_date: "2026-07-05" };
};
const rep = (pair: number[], times: number) => Array.from({ length: times }, () => pair).flat();
const M = 1_000_000; // z is scale-invariant; realistic premium magnitudes
// 20 calm deltas (1M/2M alternating) then a 3-minute 10M/min burst.
const HOT = rep([1, 2], 10).concat([10, 10, 10]).map((x) => x * M);
// 20 FAST deltas (10M/11M) then a 3-minute dead stop. The old two-sided |z| fired here.
const SLOW = rep([10, 11], 10).concat([0, 0, 0]).map((x) => x * M);
// 15 calm deltas then a 5-minute ~67x burst. The old contaminated baseline MISSED this.
const CONTAM = rep([1, 2], 7).concat([1]).concat([100, 100, 100, 100, 100]).map((x) => x * M);
// Calm all the way through — the control.
const CALM = rep([1, 2], 10).concat([1, 2, 1]).map((x) => x * M);

/** The OLD (pre-fix) formula, kept ONLY so the regression tests can prove what changed. */
const oldZ = (series: number[], window: number): number => {
  const d: number[] = [];
  for (let i = 1; i < series.length; i++) d.push(series[i] - series[i - 1]);
  const n = d.length;
  const mean = d.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(d.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
  const w = Math.max(1, Math.min(window, n));
  const recentMean = d.slice(n - w).reduce((a, b) => a + b, 0) / w;
  return (recentMean - mean) / std;
};
const seriesOf = (t: TidePayload) => t.minutes!.map((m) => m.ncp);

describe("sessionSlopeStats — z-math on cumulative series", () => {
  it("baseline is the deltas STRICTLY BEFORE the window (hand-computed)", () => {
    const s = sessionSlopeStats(seriesOf(tideFromDeltas(HOT)), 3);
    expect(s.n).toBe(23);
    expect(s.w).toBe(3);
    expect(s.baseN).toBe(20); // the 3 burst deltas are NOT in the baseline
    expect(s.baseMean).toBeCloseTo(1.5 * M, 3); // mean of the 20 calm deltas only
    expect(s.baseStd).toBeCloseTo(0.5 * M, 3);
    expect(s.winMean).toBe(10 * M);
    // Two-sample SE of (winMean − baseMean): baseStd·√(1/w + 1/baseN).
    const se = 0.5 * M * Math.sqrt(1 / 3 + 1 / 20);
    expect(s.se).toBeCloseTo(se, 3);
    expect(s.z).toBeCloseTo((10 * M - 1.5 * M) / se, 5);
    expect(s.z).toBeCloseTo(27.457477, 5);
    expect(s.why).toBe("");
  });

  it("REGRESSION: the old one-sample SE (baseStd/√w) inflated z by omitting the baseline's own sampling error", () => {
    // At the guard's minimum admitted baseline (baseN = MIN_BASELINE_MULT·w = 2w), the
    // true SE is baseStd·√(1/w + 1/2w) = baseStd·√(1.5/w) — exactly √1.5 ≈ 1.2247× the old
    // baseStd/√w. A "2σ" alert built on the old form was truly firing at 2/√1.5 ≈ 1.633σ.
    const base = rep([1, 2], 5); // 10 calm deltas, baseStd 0.5
    const atMin = sessionSlopeStats(seriesOf(tideFromDeltas(base.concat([9, 9, 9, 9, 9]))), 5);
    expect(atMin.baseN).toBe(10); // exactly MIN_BASELINE_MULT(2) × w(5)
    const oldSe = (atMin.baseStd as number) / Math.sqrt(atMin.w);
    const oldZ = ((atMin.winMean as number) - (atMin.baseMean as number)) / oldSe;
    expect((atMin.z as number) / oldZ).toBeCloseTo(1 / Math.sqrt(1.5), 6);
    expect(oldZ / (atMin.z as number)).toBeCloseTo(Math.sqrt(1.5), 6);
  });

  it("the SE reflects BOTH sample sizes — not just the window (what the fix corrects)", () => {
    // Same baseline (40 calm deltas, baseStd 0.5), two window sizes. The OLD formula
    // (baseStd/√w) implied z scales by EXACTLY √(w2/w1) between them; the correct
    // two-sample SE also carries a 1/baseN term shared by both, so the true ratio is
    // smaller than that old identity.
    const base = rep([1, 2], 20); // 40 calm deltas, baseStd 0.5
    const s1 = sessionSlopeStats(seriesOf(tideFromDeltas(base.concat([9]))), 1);
    const s4 = sessionSlopeStats(seriesOf(tideFromDeltas(base.concat([9, 9, 9, 9]))), 4);
    expect(s1.baseN).toBe(40);
    expect(s4.baseN).toBe(40);
    const se1 = 0.5 * Math.sqrt(1 / 1 + 1 / 40);
    const se4 = 0.5 * Math.sqrt(1 / 4 + 1 / 40);
    expect(s1.se).toBeCloseTo(se1, 9);
    expect(s4.se).toBeCloseTo(se4, 9);
    expect((s4.z as number) / (s1.z as number)).toBeCloseTo(se1 / se4, 9);
    // REGRESSION: the old w-only correction claimed exactly √4 = 2× here.
    expect((s4.z as number) / (s1.z as number)).not.toBeCloseTo(2, 2);
  });

  it("as the baseline grows much larger than the window, the SE converges to the old w-only form", () => {
    // With baseN >> w, 1/baseN → 0 and baseStd·√(1/w + 1/baseN) → baseStd/√w — the old
    // formula was a large-baseline SPECIAL CASE of the correct one, not a separate idea.
    const hugeBase = rep([1, 2], 5000); // 10,000 calm deltas
    const s = sessionSlopeStats(seriesOf(tideFromDeltas(hugeBase.concat([9, 9, 9]))), 3);
    const oldSe = 0.5 / Math.sqrt(3);
    expect(s.se as number).toBeCloseTo(oldSe, 3);
  });

  it("min-sample guard: baseline shorter than 2× the window → z null, not a guess", () => {
    const s = sessionSlopeStats(seriesOf(tideFromDeltas(rep([1, 2], 7))), 10);
    expect(s.baseN).toBe(4);
    expect(s.z).toBeNull();
    expect(s.why).toContain("not enough baseline");
  });

  it("flat baseline → z null (nothing to scale against)", () => {
    const s = sessionSlopeStats(seriesOf(tideFromDeltas(Array(20).fill(5).concat([9, 9, 9]))), 3);
    expect(s.baseStd).toBe(0);
    expect(s.z).toBeNull();
    expect(s.why).toContain("flat baseline");
  });

  it("empty series → z null", () => {
    expect(sessionSlopeStats([], 3).z).toBeNull();
    expect(sessionSlopeStats([1], 3).z).toBeNull();
  });
});

describe("evalPremiumBurst — pace alert", () => {
  const cond = { type: "opt_premium_burst" as const, root: "SPY", leg: "ncp" as const, window_min: 3, z: 2 };

  it("a hot burst fires with z ≥ threshold and 'unusual pace'", () => {
    const r = evalPremiumBurst(cond, tideFromDeltas(HOT), {});
    expect(r.fired).toBe(true);
    expect(r.note).toContain("unusual pace");
    expect(r.note).toContain("net-call premium");
    expect(r.note).toContain("intraday tape");
    expect(r.value).toBeCloseTo(27.46, 2);
    // the note states the baseline it was judged against, not just the window
    expect(r.note).toContain("vs the 20m before it");
  });

  it("npp leg labels net-put premium", () => {
    const r = evalPremiumBurst({ ...cond, leg: "npp" }, tideFromDeltas(HOT), {});
    expect(r.fired).toBe(true);
    expect(r.note).toContain("net-put premium");
  });

  it("REGRESSION (one-sided): a dead-SLOW tape does NOT fire — the old |z| did", () => {
    const tide = tideFromDeltas(SLOW);
    const r = evalPremiumBurst(cond, tide, {});
    expect(r.fired).toBe(false);
    expect(r.value as number).toBeLessThan(0); // pace collapsed, not burst
    // Proof of what changed: the old two-sided formula cleared the 2σ gate here.
    expect(Math.abs(oldZ(seriesOf(tide), 3))).toBeGreaterThanOrEqual(2);
  });

  it("REGRESSION (baseline contamination): a ~67× burst fires — the old math missed it", () => {
    const tide = tideFromDeltas(CONTAM);
    const r = evalPremiumBurst({ ...cond, window_min: 5 }, tide, {});
    expect(r.fired).toBe(true);
    expect(r.value).toBeCloseTo(382.47, 1);
    // Proof: including the burst in its own baseline capped the old z below the gate.
    // The old form is bounded ABOVE by √((n−w)/w) — here √(15/5) = √3 ≈ 1.7321 — no matter
    // how violent the burst. (The bound is approached, not reached, when the baseline has
    // real variance of its own, as it does here.) So the 2σ gate was unreachable.
    const CEILING = Math.sqrt((20 - 5) / 5);
    const zOld = oldZ(seriesOf(tide), 5);
    expect(zOld).toBeLessThan(CEILING);
    expect(zOld).toBeCloseTo(1.732, 3);
    expect(Math.abs(zOld)).toBeLessThan(2);
  });

  it("a calm continuation does NOT fire (control)", () => {
    const r = evalPremiumBurst(cond, tideFromDeltas(CALM), {});
    expect(r.fired).toBe(false);
    expect(Math.abs(r.value as number)).toBeLessThan(2);
  });

  it("idempotent per identical latest stamp — refire is suppressed", () => {
    const tide = tideFromDeltas(HOT);
    const first = evalPremiumBurst(cond, tide, {});
    expect(first.fired).toBe(true);
    const again = evalPremiumBurst(cond, tide, first.nextState);
    expect(again.fired).toBe(false); // same latest T
  });

  it("REGRESSION (multiplicity): a burst that stays hot for several NEW minutes fires ONCE, not once per poll", () => {
    // Before the fix, `lastFiredT` advanced to the latest stamp on every evaluation that
    // met the z bar (fired or not) — so the very next new minute always looked "unfired"
    // against the just-updated state, and a burst that stayed hot for K minutes fired K
    // times (once per poll of the session).
    const first = evalPremiumBurst(cond, tideFromDeltas(HOT), {});
    expect(first.fired).toBe(true);

    // One minute later the tape is STILL hot (z still ≫ 2) — this is exactly where the
    // old code fired again.
    const persistent = HOT.concat([10 * M]);
    const second = evalPremiumBurst(cond, tideFromDeltas(persistent), first.nextState);
    expect(second.fired).toBe(false); // suppressed — inside the cooldown (< windowMin=3)

    // Once a full fresh window (3 minutes) has elapsed since the first fire, a tape
    // that is STILL hot can fire again — the guard is a cooldown, not a one-shot latch.
    const later = HOT.concat([10 * M, 10 * M, 10 * M]);
    const third = evalPremiumBurst(cond, tideFromDeltas(later), second.nextState);
    expect(third.fired).toBe(true);
  });

  it("REGRESSION (short history): too little baseline → fired:null, never a guess", () => {
    // 15 samples with window 10: the OLD guard (len < window+2) let this through and
    // returned a z off a 4-delta baseline. The new guard needs (1+2)×10+1 = 31 samples.
    const tide = tideFromDeltas(rep([1, 2], 7));
    expect(tide.minutes!.length).toBe(15);
    const r = evalPremiumBurst({ ...cond, window_min: 10 }, tide, {});
    expect(r.fired).toBeNull();
    expect(r.note).toContain("not enough tape");
    expect(Number.isFinite(oldZ(seriesOf(tide), 10))).toBe(true); // old code scored it anyway
  });

  it("flat tape → fired:null", () => {
    const minutes = [];
    for (let i = 0; i < 40; i++) minutes.push({ t: `09:${String(30 + i).padStart(2, "0")}`, ncp: 5 * M, npp: 5 * M });
    const r = evalPremiumBurst(cond, { minutes, asof: "x" }, {});
    expect(r.fired).toBeNull();
    expect(r.note).toContain("flat baseline");
  });
});

// ─── (d) 0DTE share ──────────────────────────────────────────────────────────
describe("eval0dteShare — 0DTE net-premium share", () => {
  const cond = { type: "opt_0dte_spike" as const, root: "SPY", share_pct: 55 };
  // Two buckets; 0d dominates at the latest stamp.
  const bigShare = (): DtePayload => ({
    asof: "2026-07-05T15:42:00Z",
    buckets: {
      "0d": [
        { t: "09:30", ncp: 100, npp: 50 },
        { t: "09:40", ncp: 8_000_000, npp: -1_000_000 },
      ],
      "1_7d": [
        { t: "09:30", ncp: 200, npp: 100 },
        { t: "09:40", ncp: 500_000, npp: -300_000 },
      ],
    },
  });

  it("a large 0d share fires", () => {
    // at 09:40: |8M|+|1M|=9M over 9M+0.8M=9.8M → 91.8% ≥ 55.
    const r = eval0dteShare(cond, bigShare(), {});
    expect(r.fired).toBe(true);
    expect(r.note).toContain("0DTE share");
    expect(r.note).toContain("10-min DTE tape");
    expect(r.value).toBeGreaterThanOrEqual(55);
    expect(r.nextState.lastFiredT).toBe("09:40");
  });

  it("a small 0d share does not fire", () => {
    const small: DtePayload = {
      asof: "x",
      buckets: {
        "0d": [{ t: "09:40", ncp: 100_000, npp: 0 }],
        "1_7d": [{ t: "09:40", ncp: 9_000_000, npp: 0 }],
      },
    };
    const r = eval0dteShare(cond, small, {});
    expect(r.fired).toBe(false); // ~1.1%
    expect(r.value).toBeLessThan(55);
  });

  it("absent '0d' bucket → fired:null (HONEST DISABLE, never fabricated)", () => {
    const no0d: DtePayload = { asof: "x", buckets: { "1_7d": [{ t: "09:40", ncp: 1, npp: 1 }] } };
    const r = eval0dteShare(cond, no0d, {});
    expect(r.fired).toBeNull();
    expect(r.note).toContain("0DTE split unavailable");
  });

  it("no buckets at all → fired:null", () => {
    expect(eval0dteShare(cond, {}, {}).fired).toBeNull();
    expect(eval0dteShare(cond, { buckets: {} }, {}).fired).toBeNull();
  });

  it("REGRESSION: an EMPTY non-0d bucket (e.g. '90p' with no flow yet) no longer collapses the whole intersection to zero", () => {
    // Mirrors the real dte_fixture bucket set ('0d','1_7d','8_30d','31_90d','90p') with the
    // longest-dated bucket still empty — routine early in a session. Before the fix, ONE
    // empty bucket zeroed the common-stamp intersection and pinned the alert at
    // fired:null for the rest of the session, indistinguishable from "feed absent".
    const withEmptyBucket: DtePayload = {
      asof: "x",
      buckets: {
        ...bigShare().buckets,
        "90p": [],
      },
    };
    const r = eval0dteShare(cond, withEmptyBucket, {});
    expect(r.fired).toBe(true); // same reading as bigShare() alone — the empty bucket contributed nothing
    expect(r.value).toBeGreaterThanOrEqual(55);
  });

  it("an empty '0d' bucket (present, no 0DTE flow yet) is evaluable, not null — a real 0% share", () => {
    const emptyZero: DtePayload = {
      asof: "x",
      buckets: {
        "0d": [],
        "1_7d": [{ t: "09:40", ncp: 100, npp: 0 }],
      },
    };
    const r = eval0dteShare(cond, emptyZero, {});
    expect(r.fired).toBe(false); // 0% share, honestly computed — not "cannot evaluate"
    expect(r.value).toBe(0);
  });

  it("every bucket empty (including '0d') → fired:null (nothing to evaluate, honestly)", () => {
    const allEmpty: DtePayload = { asof: "x", buckets: { "0d": [], "1_7d": [] } };
    const r = eval0dteShare(cond, allEmpty, {});
    expect(r.fired).toBeNull();
    expect(r.note).toContain("0DTE split unavailable");
  });

  it("idempotent per stamp", () => {
    const big = bigShare();
    const first = eval0dteShare(cond, big, {});
    expect(first.fired).toBe(true);
    const again = eval0dteShare(cond, big, first.nextState);
    expect(again.fired).toBe(false);
  });
});

// ─── real-fixture smoke: each type parses the committed fixture shape ─────────
describe("real fixtures parse into each evaluator without throwing", () => {
  it("gexstate_fixture feeds gamma-flip (arms on first obs)", async () => {
    const gs = (await readFixture("gexstate_fixture.json")) as GexState;
    const r = evalGammaFlipCross({ type: "opt_gamma_flip", root: gs.root }, gs, {});
    // spot 751.71 ≥ flip 748.25 → side "above", arming
    expect(r.fired).toBe(false);
    expect(r.nextState.side).toBe("above");
  });

  it("gex_fixture[NVDA] feeds wall proximity", async () => {
    const all = (await readFixture("gex_fixture.json")) as Record<string, GexPayload>;
    const gx = all.NVDA;
    const r = evalWallProximity({ type: "opt_wall_touch", root: "NVDA", wall: "call" }, gx, {});
    // spot_ref 135.7 vs call_wall 150 → far outside → arms false, evaluable (not null)
    expect(r.fired).toBe(false);
    expect(r.value).toBe(gx.spot_ref);
  });

  it("tide_fixture feeds premium burst (evaluable — not null)", async () => {
    const tide = (await readFixture("tide_fixture.json")) as TidePayload;
    const r = evalPremiumBurst({ type: "opt_premium_burst", root: "SPY", leg: "ncp" }, tide, {});
    expect(r.fired).not.toBeNull(); // 390 cumulative minutes → z is computable
  });

  it("dte_fixture feeds 0DTE share (0d present → evaluable, not null)", async () => {
    const dte = (await readFixture("dte_fixture.json")) as DtePayload;
    const r = eval0dteShare({ type: "opt_0dte_spike", root: "SPY" }, dte, {});
    expect(r.fired).not.toBeNull(); // 0d bucket IS present
    expect(typeof r.value).toBe("number"); // real share (~8% on this fixture)
  });

  it("surface_fixture[SPY] feeds the hot pocket (evaluable — not null)", async () => {
    const all = (await readFixture("surface_fixture.json")) as Record<string, SurfaceFramePayload>;
    const r = evalSurfaceHotPocket({ type: "opt_surface_pocket", root: "SPY" }, all.SPY, {});
    expect(r.fired).not.toBeNull(); // 41 strikes × 78 intervals → scoreable
    expect(typeof r.value).toBe("number");
  });

  it("a root with no surface store → honest null, never a fabricated pocket", async () => {
    const all = (await readFixture("surface_fixture.json")) as Record<string, SurfaceFramePayload>;
    expect(all.QQQ).toBeUndefined(); // only SPY is materialized in the fixture
    const r = evalSurfaceHotPocket({ type: "opt_surface_pocket", root: "QQQ" }, all.QQQ, {});
    expect(r.fired).toBeNull();
    expect(r.note).toContain("no surface for this root yet");
  });
});

// ─── (e) surface hot pocket ──────────────────────────────────────────────────
describe("evalSurfaceHotPocket — a strike running hot on the surface", () => {
  const cond = { type: "opt_surface_pocket" as const, root: "SPY", k: 4, near_pct: 5 };
  const STEPS = ["09:31", "09:36", "09:41", "09:46", "09:51"];
  const LEVELS = [90, 95, 100, 105, 110]; // spot 100 → ±5% keeps 95/100/105 only
  /** 5 strikes × 5 intervals; the four trailing intervals are a flat 1M, the newest is per-row. */
  const gridWith = (newest: number[]) => newest.map((v) => [1e6, 1e6, 1e6, 1e6, v]);
  const frameOf = (newest: number[], over: Partial<SurfaceFramePayload> = {}): SurfaceFramePayload => ({
    spot: 100,
    price_levels: LEVELS,
    time_steps: STEPS,
    grids: { netprem: gridWith(newest) },
    asof: "2026-07-06T09:51:00-04:00",
    root: "SPY",
    ...over,
  });

  it("a near-spot cell at 8× the trailing cell-scale fires", () => {
    const r = evalSurfaceHotPocket(cond, frameOf([0, 0, 8e6, 0, 0]), {});
    expect(r.fired).toBe(true);
    expect(r.value).toBeCloseTo(8, 6); // 8M / 1M scale
    expect(r.note).toContain("100 strike lit up 8.0×");
    expect(r.note).toContain("call-side");
    expect(r.note).toContain("09:51");
    expect(r.nextState.lastFiredT).toBe("09:51");
    expect(r.nextState.lastStrike).toBe(100);
  });

  it("negative net premium reads as put-side", () => {
    const r = evalSurfaceHotPocket(cond, frameOf([0, 0, -8e6, 0, 0]), {});
    expect(r.fired).toBe(true);
    expect(r.note).toContain("put-side");
  });

  it("a cell only 2× the scale does NOT fire", () => {
    const r = evalSurfaceHotPocket(cond, frameOf([0, 0, 2e6, 0, 0]), {});
    expect(r.fired).toBe(false);
    expect(r.value).toBeCloseTo(2, 6);
  });

  it("a monster print OUTSIDE the ±5% band is ignored (band is load-bearing)", () => {
    // 90 is 10% from spot → excluded from both the scale and the hunt.
    const r = evalSurfaceHotPocket(cond, frameOf([50e6, 0, 0, 0, 0]), {});
    expect(r.fired).toBe(false);
    expect(r.value).toBe(0);
  });

  it("the newest interval is EXCLUDED from its own scale (baseline discipline)", () => {
    // Trailing cells are 1M; if the 8M newest cell were included in the scale the
    // ratio would fall to ~5.5. It must stay exactly 8.
    const r = evalSurfaceHotPocket(cond, frameOf([0, 0, 8e6, 0, 0]), {});
    expect(r.value).toBeCloseTo(8, 6);
  });

  it("idempotent per interval — refire on the same stamp is suppressed", () => {
    const f = frameOf([0, 0, 8e6, 0, 0]);
    const first = evalSurfaceHotPocket(cond, f, {});
    expect(first.fired).toBe(true);
    expect(evalSurfaceHotPocket(cond, f, first.nextState).fired).toBe(false);
  });

  it("too few intervals to scale against → null", () => {
    const r = evalSurfaceHotPocket(cond, frameOf([0, 0, 8e6, 0, 0], {
      time_steps: ["09:31", "09:36", "09:41"],
      grids: { netprem: [0, 0, 8e6, 0, 0].map((v) => [1e6, 1e6, v]) },
    }), {});
    expect(r.fired).toBeNull();
    expect(r.note).toContain("not enough surface history");
  });

  it("all-zero trailing cells → null (no scale), never a divide-by-zero fire", () => {
    const r = evalSurfaceHotPocket(cond, frameOf([0, 0, 8e6, 0, 0], {
      grids: { netprem: [0, 0, 8e6, 0, 0].map((v) => [0, 0, 0, 0, v]) },
    }), {});
    expect(r.fired).toBeNull();
    expect(r.note).toContain("too sparse to scale");
  });

  it("no strike inside the band → null (never silently widens the band)", () => {
    const r = evalSurfaceHotPocket(cond, frameOf([0, 0, 8e6, 0, 0], { spot: 500 }), {});
    expect(r.fired).toBeNull();
    expect(r.note).toContain("no strikes near spot");
  });

  it("missing frame / missing metric grid → null", () => {
    expect(evalSurfaceHotPocket(cond, null, {}).fired).toBeNull();
    expect(evalSurfaceHotPocket(cond, frameOf([0, 0, 8e6, 0, 0], { grids: {} }), {}).fired).toBeNull();
    expect(evalSurfaceHotPocket(cond, frameOf([0, 0, 8e6, 0, 0], { spot: null }), {}).fired).toBeNull();
  });
});

// ─── UI helpers ──────────────────────────────────────────────────────────────
describe("optAlertPreview + buildOptCondition", () => {
  it("previews are plain-word and carry no banned vocabulary", () => {
    const banned = /\b(signal|buy|sell|validated)\b/i;
    for (const [kind, extra] of [
      ["opt_gamma_flip", {}],
      ["opt_wall_touch", { wall: "call", within_pct: 0.25 }],
      ["opt_premium_burst", { leg: "ncp" }],
      ["opt_0dte_spike", { share_pct: 55 }],
      ["opt_surface_pocket", { k: 4, near_pct: 5 }],
    ] as const) {
      const cond = buildOptCondition(kind, "SPY", extra as any);
      const en = optAlertPreview(cond, "en");
      const zh = optAlertPreview(cond, "zh");
      if (kind === "opt_premium_burst" || kind === "opt_0dte_spike") {
        expect(en).toContain("covered options tape");
        expect(zh).toContain("覆盖范围内");
        expect(en).not.toContain("market-wide");
        expect(zh).not.toContain("全市场");
      } else {
        expect(en).toContain("SPY");
        expect(zh).toContain("SPY");
      }
      expect(en).not.toMatch(banned);
      expect(zh).toMatch(/[一-鿿]/); // has Chinese
    }
  });

  it("buildOptCondition emits the fields each evaluator reads, root upper-cased", () => {
    expect(buildOptCondition("opt_gamma_flip", "spy", { band_pct: 0.1 })).toEqual({ type: "opt_gamma_flip", root: "SPY", band_pct: 0.1 });
    expect(buildOptCondition("opt_wall_touch", "qqq", { wall: "put", within_pct: 0.3 })).toEqual({ type: "opt_wall_touch", root: "QQQ", wall: "put", within_pct: 0.3 });
    expect(buildOptCondition("opt_premium_burst", "iwm", { leg: "npp", window_min: 15, z: 2.5 })).toEqual({ type: "opt_premium_burst", root: "MARKET", leg: "npp", window_min: 15, z: 2.5 });
    expect(buildOptCondition("opt_0dte_spike", "spy", { share_pct: 60 })).toEqual({ type: "opt_0dte_spike", root: "MARKET", share_pct: 60 });
    expect(buildOptCondition("opt_surface_pocket", "spy", { k: 5, near_pct: 3 })).toEqual({ type: "opt_surface_pocket", root: "SPY", k: 5, near_pct: 3 });
  });

  it("canonicalizes market-wide alert identity even for a stale or bypassing client", async () => {
    const { canonicalizeOptAlertIdentity, isMarketWideOptKind } = await import("../optionsAlerts");
    expect(isMarketWideOptKind("opt_premium_burst")).toBe(true);
    expect(isMarketWideOptKind("opt_0dte_spike")).toBe(true);
    expect(isMarketWideOptKind("opt_gamma_flip")).toBe(false);
    expect(canonicalizeOptAlertIdentity("SPY", {
      type: "opt_premium_burst", root: "QQQ", leg: "ncp",
    })).toEqual({
      symbol: "MARKET",
      condition: { type: "opt_premium_burst", root: "MARKET", leg: "ncp" },
    });
    expect(canonicalizeOptAlertIdentity(" qqq ", {
      type: "opt_gamma_flip", root: "QQQ",
    })).toEqual({
      symbol: "QQQ",
      condition: { type: "opt_gamma_flip", root: "QQQ" },
    });
    expect(canonicalizeOptAlertIdentity("SPY", {
      type: "opt_gamma_flip", root: " qqq ",
    })).toEqual({
      symbol: "QQQ",
      condition: { type: "opt_gamma_flip", root: "QQQ" },
    });
    expect(canonicalizeOptAlertIdentity("SPY", {
      type: "opt_gamma_flip", root: "../../QQQ",
    })).toBeNull();
    const { normalizeOptAlertRoot } = await import("../optionsAlerts");
    expect(normalizeOptAlertRoot("ABCDEFGHIJ.ABCD")).toBeNull();
    expect(canonicalizeOptAlertIdentity("SPY", {
      type: "opt_gamma_flip", root: "ABCDEFGHIJ.ABCD",
    })).toBeNull();
  });

  it("omitted numeric params fall through to evaluator defaults (field absent in condition)", () => {
    const c = buildOptCondition("opt_gamma_flip", "SPY", {});
    expect(c).toEqual({ type: "opt_gamma_flip", root: "SPY" }); // no band_pct → evaluator uses 0.05
    // preview still renders defaults
    expect(optAlertPreview(c, "en")).toContain("crosses its gamma flip");
  });
});

// ─── (b2) wall migration ─────────────────────────────────────────────────────
describe("evalWallMigration — re-strike state machine", () => {
  const gx = (callWall: number, spot = 745): GexPayload =>
    ({ root: "SPY", spot_ref: spot, call_wall: callWall, put_wall: 700, asof: "2026-07-31" });
  const cond = { type: "opt_wall_migration" as const, root: "SPY", wall: "call" as const };

  it("first observation arms without firing (records the wall strike)", () => {
    const r = evalWallMigration(cond, gx(760), {});
    expect(r.fired).toBe(false);
    expect(r.nextState.level).toBe(760);
  });

  it("fires when the wall re-strikes by ≥ min_move_pct of spot", () => {
    // 760 → 765 on spot 745 = 0.67% ≥ default 0.4%
    const r = evalWallMigration(cond, gx(765), { level: 760 });
    expect(r.fired).toBe(true);
    expect(r.value).toBe(765);
    expect(r.note).toContain("760 → 765");
    expect(r.note).toContain("EOD build");
    expect(r.nextState.level).toBe(765);
  });

  it("sub-threshold jitter does not fire but STILL updates the anchor (no late fire from drift)", () => {
    // one $1 strike on spot 745 = 0.13% < 0.4%
    const r = evalWallMigration(cond, gx(761), { level: 760 });
    expect(r.fired).toBe(false);
    expect(r.nextState.level).toBe(761);
  });

  it("respects a custom min_move_pct", () => {
    const tight = { ...cond, min_move_pct: 0.1 };
    const r = evalWallMigration(tight, gx(761), { level: 760 });
    expect(r.fired).toBe(true);
  });

  it("watches the PUT wall when asked", () => {
    const putCond = { type: "opt_wall_migration" as const, root: "SPY", wall: "put" as const };
    const gxPut: GexPayload = { root: "SPY", spot_ref: 745, call_wall: 760, put_wall: 706, asof: "2026-07-31" };
    const r = evalWallMigration(putCond, gxPut, { level: 700 });
    expect(r.fired).toBe(true);
    expect(r.note).toContain("put wall");
  });

  it("missing wall or spot → honest null, state preserved", () => {
    const r = evalWallMigration(cond, { root: "SPY", spot_ref: 745 }, { level: 760 });
    expect(r.fired).toBe(null);
    expect(r.nextState.level).toBe(760);
  });
});

// ─── (b3) sign fragility ─────────────────────────────────────────────────────
describe("evalSignFragile — tilt-collapse transition", () => {
  const gx = (callAbs: number, putAbs: number): GexPayload => ({
    root: "SPY",
    spot_ref: 745,
    asof: "2026-07-31",
    by_strike: [
      { gamma_call: callAbs * 0.6, gamma_put: -putAbs * 0.5 },
      { gamma_call: callAbs * 0.4, gamma_put: -putAbs * 0.5 },
    ],
  });
  const cond = { type: "opt_sign_fragile" as const, root: "SPY" };

  it("first observation arms without firing, even when already fragile", () => {
    const r = evalSignFragile(cond, gx(100, 95), {}); // tilt 2.56% < 12
    expect(r.fired).toBe(false);
    expect(r.nextState.fragile).toBe(true);
  });

  it("fires on the robust→fragile transition with the tilt in the note", () => {
    const r = evalSignFragile(cond, gx(100, 95), { fragile: false });
    expect(r.fired).toBe(true);
    expect(r.value).toBeCloseTo(2.6, 1);
    expect(r.note).toContain("dealer-sign assumption");
  });

  it("does not re-fire while it stays fragile", () => {
    const r = evalSignFragile(cond, gx(100, 95), { fragile: true });
    expect(r.fired).toBe(false);
  });

  it("a robust book never fires (tilt above the default 12%)", () => {
    const r = evalSignFragile(cond, gx(100, 50), { fragile: false }); // tilt 33%
    expect(r.fired).toBe(false);
    expect(r.nextState.fragile).toBe(false);
  });

  it("respects a custom tilt_pct threshold", () => {
    const wide = { ...cond, tilt_pct: 40 };
    const r = evalSignFragile(wide, gx(100, 50), { fragile: false }); // tilt 33% < 40
    expect(r.fired).toBe(true);
  });

  it("empty or gamma-less ladder → honest null", () => {
    expect(evalSignFragile(cond, { root: "SPY", by_strike: [] }, {}).fired).toBe(null);
    expect(evalSignFragile(cond, { root: "SPY" }, {}).fired).toBe(null);
  });
});

// ─── (b4) OPEX concentration ─────────────────────────────────────────────────
describe("evalOpexConcentration — front-expiry share transition", () => {
  const gx = (frontMn: number, restMn: number[]): GexPayload => ({
    root: "SPY",
    spot_ref: 745,
    asof: "2026-07-31",
    by_expiry: [
      // deliberately out of order: the evaluator must sort by exp, not trust row order
      { exp: "2026-09-18", gamma_net: restMn[0] ?? 0 },
      { exp: "2026-08-03", gamma_net: frontMn },
      { exp: "2026-08-21", gamma_net: restMn[1] ?? 0 },
    ],
  });
  const cond = { type: "opt_opex_concentration" as const, root: "SPY" };

  it("first observation arms without firing", () => {
    const r = evalOpexConcentration(cond, gx(80, [10, 10]), {}); // 80%
    expect(r.fired).toBe(false);
    expect(r.nextState.above).toBe(true);
  });

  it("fires on ENTER above the default 35% with the front exp named", () => {
    const r = evalOpexConcentration(cond, gx(50, [30, 20]), { above: false }); // 50%
    expect(r.fired).toBe(true);
    expect(r.value).toBe(50);
    expect(r.note).toContain("2026-08-03");
    expect(r.note).toContain("OPEX");
  });

  it("uses ABSOLUTE gamma per expiry (a negative front leg still concentrates)", () => {
    const r = evalOpexConcentration(cond, gx(-50, [30, 20]), { above: false });
    expect(r.fired).toBe(true);
    expect(r.value).toBe(50);
  });

  it("below threshold never fires and records above=false", () => {
    const r = evalOpexConcentration(cond, gx(20, [50, 30]), { above: false }); // 20%
    expect(r.fired).toBe(false);
    expect(r.nextState.above).toBe(false);
  });

  it("does not re-fire while it stays concentrated", () => {
    const r = evalOpexConcentration(cond, gx(50, [30, 20]), { above: true });
    expect(r.fired).toBe(false);
  });

  it("missing/empty breakdown → honest null", () => {
    expect(evalOpexConcentration(cond, { root: "SPY" }, {}).fired).toBe(null);
    expect(evalOpexConcentration(cond, { root: "SPY", by_expiry: [] }, {}).fired).toBe(null);
  });
});

// ─── §8 builder + preview coverage for the three new kinds ───────────────────
describe("buildOptCondition + optAlertPreview — §8 kinds", () => {
  it("wall migration builds {type, root, wall} with optional min_move_pct", () => {
    expect(buildOptCondition("opt_wall_migration", "spy", {})).toEqual({
      type: "opt_wall_migration", root: "SPY", wall: "call",
    });
    expect(buildOptCondition("opt_wall_migration", "SPY", { wall: "put", min_move_pct: 0.8 })).toEqual({
      type: "opt_wall_migration", root: "SPY", wall: "put", min_move_pct: 0.8,
    });
  });

  it("sign fragile / opex build minimal conditions with optional thresholds", () => {
    expect(buildOptCondition("opt_sign_fragile", "qqq", {})).toEqual({ type: "opt_sign_fragile", root: "QQQ" });
    expect(buildOptCondition("opt_opex_concentration", "QQQ", { share_pct: 40 })).toEqual({
      type: "opt_opex_concentration", root: "QQQ", share_pct: 40,
    });
  });

  it("previews read in both languages with defaults named", () => {
    const en = optAlertPreview({ type: "opt_wall_migration", root: "SPY", wall: "call" }, "en");
    expect(en).toContain("re-strikes");
    expect(en).toContain("0.4");
    const zh = optAlertPreview({ type: "opt_sign_fragile", root: "SPY" }, "zh");
    expect(zh).toContain("12");
    const opex = optAlertPreview({ type: "opt_opex_concentration", root: "SPY", share_pct: 40 }, "en");
    expect(opex).toContain("40");
  });
});
