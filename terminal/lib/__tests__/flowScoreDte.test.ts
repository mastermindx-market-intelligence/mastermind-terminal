/**
 * flowScoreDte.test.ts — an unreadable expiry must not outscore a real contract (F02-Q2T).
 *
 * The live feed is about to send dte: null and dte_bucket: "unknown" when the expiry
 * cannot be read. The Python scorer treats that as 0.20. These tests pin that parity,
 * and they pin every finite day-count against a copy of the pre-fix factor body.
 */
import { describe, expect, it } from "vitest";
import { computeFlowScore, type ScorerInput } from "@/lib/flowScore";

const DTE_BUCKETS = ["0d", "1_7d", "8_30d", "31_90d", "90p"] as const;
type KnownDteBucket = (typeof DTE_BUCKETS)[number];

/** Same fields the scorer requires. Tests override only dte and dte_bucket. */
const BASE: ScorerInput = {
  premium: 1_200_000,
  premium_z: 2,
  mny_bucket: "atm",
  vol_gt_oi: true,
  repeated: false,
  n_prints: 1,
  side: "~buy",
  signing_source: "tape",
  zerodte: false,
  dte: 10,
  dte_bucket: "8_30d",
};

/** 0.20 × weight 0.15 × 100, rounded to one decimal the way the component is. */
const UNKNOWN_EXPIRY_COMPONENT = Math.round(0.20 * 0.15 * 100 * 10) / 10;

/**
 * Copy of dteFactor as it stood before the unknown-expiry fix.
 * Finite day counts must keep returning this value.
 */
function baseDteFactor(dte: number, bucket: KnownDteBucket): number {
  if (bucket === "0d" || dte === 0) return 0.20;
  if (dte >= 1 && dte <= 45) return 1.0;
  if (dte <= 90) {
    return 1.0 - ((dte - 45) / 45) * 0.5;
  }
  return 0.30;
}

function componentFromFactor(factor: number): number {
  return Math.round(factor * 0.15 * 100 * 10) / 10;
}

/** Cast through unknown so a rejected feed shape fails on the value, not the type. */
function feed(overrides: { dte: unknown; dte_bucket: string }): ScorerInput {
  return { ...BASE, ...overrides } as unknown as ScorerInput;
}

function dteRelevanceValue(ev: ScorerInput): number {
  const row = computeFlowScore(ev).components.find((c) => c.key === "dteRelevance");
  if (!row) throw new Error("dteRelevance component missing");
  return row.value;
}

describe("flow score DTE factor — unknown expiry", () => {
  it("T1 null dte with bucket unknown scores like a same-day contract", () => {
    const unread = feed({ dte: null, dte_bucket: "unknown" });
    const sameDay = feed({ dte: 0, dte_bucket: "0d" });

    expect.soft(dteRelevanceValue(unread)).toBe(UNKNOWN_EXPIRY_COMPONENT);
    expect.soft(computeFlowScore(unread).score).toBe(computeFlowScore(sameDay).score);
  });

  it("T2 undefined and NaN dte score like a same-day contract", () => {
    const missing = feed({ dte: undefined, dte_bucket: "8_30d" });
    const notANumber = feed({ dte: Number.NaN, dte_bucket: "8_30d" });

    expect.soft(dteRelevanceValue(missing)).toBe(UNKNOWN_EXPIRY_COMPONENT);
    expect.soft(dteRelevanceValue(notANumber)).toBe(UNKNOWN_EXPIRY_COMPONENT);
  });

  it("T3 finite dte from -5 to 400 keeps the base factor for every known bucket", () => {
    const mismatches: string[] = [];
    for (let dte = -5; dte <= 400; dte += 1) {
      for (const bucket of DTE_BUCKETS) {
        const actual = dteRelevanceValue({ ...BASE, dte, dte_bucket: bucket });
        const expected = componentFromFactor(baseDteFactor(dte, bucket));
        if (actual !== expected) {
          mismatches.push(`dte=${dte} bucket=${bucket} actual=${actual} expected=${expected}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("T4 a 10-day contract outscores an unread expiry", () => {
    const tenDay = computeFlowScore(feed({ dte: 10, dte_bucket: "8_30d" }));
    const unread = computeFlowScore(feed({ dte: null, dte_bucket: "unknown" }));

    expect(
      tenDay.score,
      `10-day score ${tenDay.score} should exceed unread score ${unread.score}`,
    ).toBeGreaterThan(unread.score);
  });
});
