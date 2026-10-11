import { describe, expect, it } from "vitest";
import { backendPath, isValidF, r2Key } from "@/lib/flowSource";

/**
 * Every piece of an f-param that reaches an upstream URL stays one inert path segment.
 *
 * isValidF is the first layer: it admits only roots, dates, stamps and literal names. The URL
 * builders are the second. A piece that got past a looser rule, or a new family added without
 * one, must not be able to add a path step, a query or a fragment to the request the server
 * makes on the reader's behalf (CodeQL js/request-forgery on the upstream fetch).
 */

const BACKEND = "http://127.0.0.1:8000";
const R2 = "https://r2.example";

/** Climbs two directories and adds a query and a fragment if it is interpolated raw. */
const HOSTILE = "../../admin?x=1#y";

/** Each form whose pieces are interpolated, as a builder from its pieces, with good pieces. */
const FORMS: Array<{ name: string; build: (p: string[]) => string; good: string[] }> = [
  ...["ticker:", "vol:", "gex_dates:", "gex:", "levels:", "agg:", "grades:", "moves:",
    "oi_time:", "max_pain:", "oi_change:", "tctx:", "gexstate:", "matrix:", "surface_dates:",
    "surface_idx:"].map((prefix) => ({ name: prefix, build: (p: string[]) => prefix + p[0], good: ["BRK.B"] })),
  { name: "gex_at:", build: (p) => `gex_at:${p[0]}:${p[1]}`, good: ["SPY", "2026-01-02"] },
  { name: "surface_idx_at:", build: (p) => `surface_idx_at:${p[0]}:${p[1]}`, good: ["SPY", "2026-01-02"] },
  { name: "surface_at:", build: (p) => `surface_at:${p[0]}:${p[1]}:${p[2]}`, good: ["SPY", "2026-01-02", "1430_a-b"] },
  { name: "surface:", build: (p) => `surface:${p[0]}:${p[1]}`, good: ["SPY", "1430_a-b"] },
];

/** Every piece position of every form, with that one piece replaced. */
function variants(piece: string) {
  return FORMS.flatMap((form) => form.good.map((_, i) => ({
    label: `${form.name} piece ${i}`,
    good: form.build(form.good),
    bad: form.build(form.good.map((g, j) => (j === i ? piece : g))),
  })));
}

function expectOneInertSegment(goodUrl: string, badUrl: string) {
  const bad = new URL(badUrl);
  expect(bad.search).toBe("");
  expect(bad.hash).toBe("");
  const goodSegs = new URL(goodUrl).pathname.split("/");
  const badSegs = bad.pathname.split("/");
  // Same depth, and only the segment that holds the piece differs: no step up, none added.
  expect(badSegs.length).toBe(goodSegs.length);
  expect(badSegs.filter((s, i) => s !== goodSegs[i])).toHaveLength(1);
}

describe("upstream URLs keep each f-param piece inside its own path segment", () => {
  it("leaves every admitted piece unchanged", () => {
    for (const { good } of variants("SPY")) {
      expect(isValidF(good)).toBe(true);
      expect(backendPath(good)).not.toContain("%");
      expect(r2Key(good)).not.toContain("%");
    }
    expect(backendPath("ticker:BRK.B")).toBe("/api/flow/ticker/BRK.B");
    expect(r2Key("surface_at:BRK.B:2026-01-02:1430_a-b")).toBe("live_flow/surface/BRK.B/2026-01-02/1430_a-b.json");
    expect(backendPath("feed")).toBe("/api/flow/feed");
    expect(r2Key("feed")).toBe("live_flow/feed_current.json");
  });

  it("never lets a piece step out of its directory or add a query on the backend", () => {
    for (const { good, bad } of variants(HOSTILE)) {
      expectOneInertSegment(BACKEND + backendPath(good), BACKEND + backendPath(bad));
    }
    expectOneInertSegment(BACKEND + backendPath("feed"), BACKEND + backendPath(HOSTILE));
  });

  it("never lets a piece step out of its directory or add a query on R2", () => {
    for (const { good, bad } of variants(HOSTILE)) {
      expectOneInertSegment(`${R2}/${r2Key(good)}`, `${R2}/${r2Key(bad)}`);
    }
    expectOneInertSegment(`${R2}/${r2Key("feed")}`, `${R2}/${r2Key(HOSTILE)}`);
  });

  it("refuses a piece made only of dots, which encoding alone cannot make inert", () => {
    for (const piece of [".", ".."]) {
      for (const { label, bad } of variants(piece)) {
        expect(isValidF(bad), label).toBe(false);
      }
      expect(isValidF(piece)).toBe(false);
    }
  });
});
