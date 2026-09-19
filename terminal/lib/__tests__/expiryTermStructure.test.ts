import { describe, it, expect } from "vitest";
import {
  byExpiryToTermStructure,
  expiryNetFor,
  dteFrom,
  expLabel,
  type ExpiryRow,
} from "@/lib/expiryTermStructure";

// Legacy archived shape: NET gamma + delta only, no calls/puts split.
const ROWS: ExpiryRow[] = [
  { exp: "2026-07-11", gamma_net: 1.284, delta_net: 6.84 },
  { exp: "2026-07-18", gamma_net: 0.984, delta_net: 4.12 },
  { exp: "2026-09-19", gamma_net: -0.124, delta_net: -0.48 }, // negative → var(--down)
];

const ENRICHED_ROWS: ExpiryRow[] = [
  { exp: "2026-07-11", gamma_net: 1.284, delta_net: 6.84, vanna_net: 2.4, charm_net: -0.6 },
  { exp: "2026-07-18", gamma_net: 0.984, delta_net: 4.12, vanna_net: -1.2, charm_net: 0.4 },
  { exp: "2026-09-19", gamma_net: -0.124, delta_net: -0.48, vanna_net: 0.3, charm_net: 0.1 },
];
const ASOF = "2026-07-05T16:05:00Z"; // the by_expiry snapshot day (deterministic DTE anchor)

describe("expiryNetFor — lens selection", () => {
  it("reads every published net field and keeps missing legacy fields null", () => {
    expect(expiryNetFor(ENRICHED_ROWS[0], "gamma")).toBe(1.284);
    expect(expiryNetFor(ENRICHED_ROWS[0], "delta")).toBe(6.84);
    expect(expiryNetFor(ENRICHED_ROWS[0], "vanna")).toBe(2.4);
    expect(expiryNetFor(ENRICHED_ROWS[0], "charm")).toBe(-0.6);
    expect(expiryNetFor(ROWS[0], "vanna")).toBeNull();
    expect(expiryNetFor(ROWS[0], "charm")).toBeNull();
  });
  it("a missing delta_net is null, not zero", () => {
    expect(expiryNetFor({ exp: "2026-07-11", gamma_net: 1 }, "delta")).toBeNull();
  });
});

describe("dteFrom — deterministic whole-day DTE off the snapshot date", () => {
  it("counts calendar days from the as-of date (NOT the wall clock)", () => {
    expect(dteFrom("2026-07-11", ASOF)).toBe(6); // 07-05 → 07-11
    expect(dteFrom("2026-09-19", ASOF)).toBe(76);
  });
  it("same-day / past expiry clamps to 0", () => {
    expect(dteFrom("2026-07-05", ASOF)).toBe(0);
    expect(dteFrom("2026-07-01", ASOF)).toBe(0);
  });
  it("tolerates a space-suffixed expiry ('YYYY-MM-DD HH:MM:SS')", () => {
    expect(dteFrom("2026-07-11 00:00:00", ASOF)).toBe(6);
  });
});

describe("expLabel", () => {
  it("returns MM-DD", () => {
    expect(expLabel("2026-07-11")).toBe("07-11");
    expect(expLabel("2026-07-11 00:00:00")).toBe("07-11");
  });
});

describe("byExpiryToTermStructure — gamma lens", () => {
  const ts = byExpiryToTermStructure(ROWS, "gamma", ASOF);

  it("is available and Net-only (no calls/puts split in the payload)", () => {
    expect(ts.available).toBe(true);
    expect(ts.splitAvailable).toBe(false);
  });
  it("emits a node per row, sorted nearest-expiration first", () => {
    expect(ts.nodes.map((n) => n.exp)).toEqual(["2026-07-11", "2026-07-18", "2026-09-19"]);
    expect(ts.nodes.map((n) => n.label)).toEqual(["07-11", "07-18", "09-19"]);
    expect(ts.nodes.map((n) => n.dteLabel)).toEqual(["6d", "13d", "76d"]);
  });
  it("carries an explicit three-state sign for colour selection", () => {
    expect(ts.nodes[0].sign).toBe(1);
    expect(ts.nodes[2].sign).toBe(-1);
    expect(ts.nodes[2].net).toBeCloseTo(-0.124);
  });
  it("frac normalizes |net| to the max magnitude (bubble/bar scale)", () => {
    expect(ts.maxAbs).toBeCloseTo(1.284);
    expect(ts.nodes[0].frac).toBeCloseTo(1); // the largest magnitude
    expect(ts.nodes[1].frac).toBeCloseTo(0.984 / 1.284);
    expect(ts.nodes[2].frac).toBeCloseTo(0.124 / 1.284);
  });

  it("preserves exact zero as neutral rather than positive or negative", () => {
    const zeroRows: ExpiryRow[] = [
      { exp: "2026-07-11", gamma_net: 1.0 },
      { exp: "2026-07-18", gamma_net: 0.0 },
      { exp: "2026-07-25", gamma_net: -0.5 },
    ];
    const zero = byExpiryToTermStructure(zeroRows, "gamma", ASOF);
    expect(zero.nodes.map((n) => n.sign)).toEqual([1, 0, -1]);
    expect(zero.nodes[1].frac).toBe(0);
  });
});

describe("byExpiryToTermStructure — delta lens uses delta_net", () => {
  const ts = byExpiryToTermStructure(ROWS, "delta", ASOF);
  it("plots delta_net magnitudes", () => {
    expect(ts.available).toBe(true);
    expect(ts.maxAbs).toBeCloseTo(6.84);
    expect(ts.nodes[0].net).toBeCloseTo(6.84);
  });
  it("drops rows missing delta_net rather than faking a zero", () => {
    const mixed: ExpiryRow[] = [
      { exp: "2026-07-11", gamma_net: 1, delta_net: 5 },
      { exp: "2026-07-18", gamma_net: 2 }, // no delta_net → dropped for delta lens
    ];
    const d = byExpiryToTermStructure(mixed, "delta", ASOF);
    expect(d.nodes.map((n) => n.exp)).toEqual(["2026-07-11"]);
  });
});

describe("byExpiryToTermStructure — vanna/charm + honest fallbacks", () => {
  it("renders vanna/charm when current payload rows actually publish them", () => {
    const vanna = byExpiryToTermStructure(ENRICHED_ROWS, "vanna", ASOF);
    expect(vanna.available).toBe(true);
    expect(vanna.nodes.map((n) => n.net)).toEqual([2.4, -1.2, 0.3]);
    expect(vanna.maxAbs).toBeCloseTo(2.4);

    const charm = byExpiryToTermStructure(ENRICHED_ROWS, "charm", ASOF);
    expect(charm.available).toBe(true);
    expect(charm.nodes.map((n) => n.net)).toEqual([-0.6, 0.4, 0.1]);
    expect(charm.nodes[0].sign).toBe(-1);
  });

  it("legacy payloads without vanna/charm remain unavailable, never zero-filled", () => {
    for (const lens of ["vanna", "charm"] as const) {
      const ts = byExpiryToTermStructure(ROWS, lens, ASOF);
      expect(ts.available).toBe(false);
      expect(ts.nodes).toEqual([]);
      expect(ts.maxAbs).toBe(0);
    }
  });

  it("partially covered new lenses drop missing rows rather than zero-imputing them", () => {
    const mixed: ExpiryRow[] = [
      { exp: "2026-07-11", gamma_net: 1, vanna_net: 2 },
      { exp: "2026-07-18", gamma_net: 2 },
    ];
    const ts = byExpiryToTermStructure(mixed, "vanna", ASOF);
    expect(ts.available).toBe(true);
    expect(ts.nodes.map((n) => [n.exp, n.net])).toEqual([["2026-07-11", 2]]);
  });

  it("null / empty by_expiry → empty structure (gamma stays 'available' as a lens)", () => {
    expect(byExpiryToTermStructure(null, "gamma", ASOF).nodes).toEqual([]);
    expect(byExpiryToTermStructure([], "gamma", ASOF).nodes).toEqual([]);
    expect(byExpiryToTermStructure(undefined, "gamma", ASOF).maxAbs).toBe(0);
    expect(byExpiryToTermStructure([], "gamma", ASOF).available).toBe(true);
  });
  it("splitAvailable is ALWAYS false — the drawer must label itself Net-only", () => {
    // Guards the honesty contract: if the payload ever grew a split, this test forces a
    // deliberate revisit rather than a silent 'Call/Put' claim on Net-only data.
    expect(byExpiryToTermStructure(ROWS, "gamma", ASOF).splitAvailable).toBe(false);
  });
});
