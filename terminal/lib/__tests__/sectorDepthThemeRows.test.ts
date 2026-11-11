import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { themeChartHref, themeRowsFromCarriedBlock } from "../sectorDepthThemeRows";

/* ── rows increment (wire v1.1 §1/§3/§4) — the carried theme_rows block ────
 *
 * The fixtures are the REAL producer specimens (never hand-trimmed): each is
 * pinned twice — by the hash of the committed bytes, and by the hash of its
 * first N bytes, which equals the entry the programme COO's SHA256SUMS.txt
 * recorded (the committed file carries exactly one appended trailing newline
 * over the summed content; that packaging newline is documented in the lane
 * return). A trimmed or edited specimen fails both pins. */

const SPECIMENS: Record<string, { file: string; full: string; bytes: number; prefix: string; prefixBytes: number }> = {
  sp500: {
    file: "confluence_universe_sp500.json",
    full: "dd1287f19b6b50912862f8a9830da52cb1139d766865b21b06604adebdd7f479",
    bytes: 151949,
    prefix: "282d777fb2450f7b0f4710f7df4df10cdeab9c9e38881ac367e404e2cc5a0f4e",
    prefixBytes: 151948,
  },
  nasdaq: {
    file: "confluence_universe_nasdaq.json",
    full: "c8bc54f81cda93dce07d7d6a2430fa10422c1ba2d03951d819a6df9dfc681fae",
    bytes: 16100,
    prefix: "61ca1547055979e856d01d403d42500660e8103364f93142e40cb7570c06ddcb",
    prefixBytes: 16099,
  },
  russell: {
    file: "confluence_universe_russell.json",
    full: "1b10c2fe5d13f28d5c281e6e9a7f487454c642a70e54026965a60aec02f075ef",
    bytes: 553,
    prefix: "93435717ac9511ca3b9d856e513a7e9d8dd31b772ac911f57618bdb59c9a7dd2",
    prefixBytes: 552,
  },
  baskets: {
    file: "confluence_universe_baskets.json",
    full: "6584c8cd360f1237fe42021f5a3e5a8d94d291d69756aa2bf0c88fd8de54f5f3",
    bytes: 252433,
    prefix: "aebc4d579f97472d725f27c488326a023d69feb9cb3390ded43db8995446eca7",
    prefixBytes: 252432,
  },
  themeRows: {
    file: "theme_rows.json",
    full: "2504c11e21cee39609e1a43df58765f24931a950df62e683fc7b0250cafb663b",
    bytes: 39663,
    prefix: "a7f49b728518a709f56e06608482b2f3200e9e3fc3400d3a8b0df2e54db8385d",
    prefixBytes: 39662,
  },
  served: {
    file: "typed_blocks_entitled.json",
    full: "168ba857142e38f3c2436364041e67e6337d9d08d69d696ccaabb9b2f0efcbff",
    bytes: 482105,
    prefix: "49247b7b64d4f646a400771405a9e670038b447624f41e3cb1ffcbe4ab8f557e",
    prefixBytes: 482104,
  },
};

const sha = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex");

function specimenBuf(name: keyof typeof SPECIMENS): Buffer {
  return readFileSync(join(__dirname, "fixtures", SPECIMENS[name].file));
}

function specimenJson(name: keyof typeof SPECIMENS): unknown {
  return JSON.parse(specimenBuf(name).toString("utf8"));
}

/** The readers take the served ENTRY (status/reason/value) — a bare specimen
 * file is a block VALUE, so specimen-backed reads wrap it as an available
 * entry exactly as the route would serve it. */
const carried = (value: unknown): unknown => ({ status: "available", value });

describe("rows specimens are the real producer bytes (never hand-trimmed)", () => {
  for (const [name, spec] of Object.entries(SPECIMENS)) {
    it(`${name}: committed bytes hash to the recorded digest (and the COO's summed prefix still matches)`, () => {
      const buf = specimenBuf(name as keyof typeof SPECIMENS);
      expect(buf.length).toBe(spec.bytes);
      expect(sha(buf)).toBe(spec.full);
      expect(sha(buf.subarray(0, spec.prefixBytes))).toBe(spec.prefix);
    });
  }
});

describe("theme_rows reader — the real specimen parses available", () => {
  const read = themeRowsFromCarriedBlock(carried(specimenJson("themeRows")));

  it("carries the envelope dates and all 49 rows in producer order", () => {
    expect(read.state).toBe("available");
    if (read.state !== "available") return;
    expect(read.asOf).toBe("2026-11-06");
    expect(read.perfAsOf).toBe("2026-11-06");
    expect(read.rows).toHaveLength(49);
    // Producer order preserved, never re-sorted by the consumer.
    expect(read.rows[0]!.id).toBe("memory_storage");
    expect(read.rows[0]!.name).toBe("Memory, HBM & Storage");
    expect(read.rows[0]!.name_zh).toBe("内存、HBM 与存储");
    expect(read.rows[0]!.chart_key).toBe("b-memory-storage");
  });

  it("state carries the eleven keys verbatim-typed; unknown keys are ignored", () => {
    if (read.state !== "available") throw new Error("unavailable");
    const s = read.rows[0]!.state;
    expect(s).toEqual({
      label: "deteriorating",
      reco: "avoid",
      score: 32,
      rank: 1,
      alloc_rank: 1,
      health: "broken",
      breadth: 0,
      r10: -0.2599,
      val_state: "quiet",
      days_in_label: 10,
      score_delta_5d: 1,
    });
  });

  it("perf windows carry ret and rel; tonight every row has all eight", () => {
    if (read.state !== "available") throw new Error("unavailable");
    for (const row of read.rows) {
      expect(row.perf).not.toBeNull();
      expect(Object.keys(row.perf!).sort()).toEqual(
        ["10d", "1d", "20d", "5d", "60d", "full", "mtd", "ytd"].sort(),
      );
    }
    const first = read.rows[0]!.perf!["1d"]!;
    expect(first.ret).toBeCloseTo(0.015111492376541191, 15);
    expect(first.rel).toBeCloseTo(0.011987375013180035, 15);
  });

  it("a row with one allow-listed key deleted reads not stated for it, and nothing else changes", () => {
    const doc = structuredClone(specimenJson("themeRows")) as { rows: Record<string, unknown>[] };
    delete doc.rows[0]!.perf; // whole perf key gone
    delete (doc.rows[0]!.state as Record<string, unknown>).score;
    const mutated = themeRowsFromCarriedBlock(carried(doc));
    if (mutated.state !== "available") throw new Error("unavailable");
    const row = mutated.rows[0]!;
    expect(row.perf).toBeNull(); // absent stays absent — never defaulted
    expect(row.state.score).toBeNull();
    expect(row.state.rank).toBe(1); // nothing else changed
    expect(mutated.rows).toHaveLength(49);
  });

  it("a window deleted from one row's perf leaves the other windows and rows intact", () => {
    const doc = structuredClone(specimenJson("themeRows")) as { rows: { perf?: Record<string, unknown> }[] };
    delete doc.rows[0]!.perf!["1d"];
    const mutated = themeRowsFromCarriedBlock(carried(doc));
    if (mutated.state !== "available") throw new Error("unavailable");
    expect(mutated.rows[0]!.perf!["1d"]).toBeUndefined();
    expect(mutated.rows[0]!.perf!["5d"]).toBeDefined();
    expect(mutated.rows[1]!.perf!["1d"]).toBeDefined();
  });
});

describe("theme_rows reader — envelope failures read invalid_shape, never partly", () => {
  const base = (): Record<string, unknown> => structuredClone(specimenJson("themeRows")) as Record<string, unknown>;

  it.each([
    ["as_of emptied", (d: Record<string, unknown>) => void (d.as_of = "")],
    ["as_of deleted", (d: Record<string, unknown>) => void delete d.as_of],
    ["rows not a list", (d: Record<string, unknown>) => void (d.rows = "nope")],
    ["row without an own non-empty id", (d: Record<string, unknown>) => void ((d.rows as Record<string, unknown>[])[0] = { name: "x" })],
    ["state present but not a mapping", (d: Record<string, unknown>) => void ((d.rows as Record<string, unknown>[])[0]!.state = 5)],
    ["perf present but not a mapping", (d: Record<string, unknown>) => void ((d.rows as Record<string, unknown>[])[0]!.perf = [])],
  ])("%s", (_label, mutate) => {
    const doc = base();
    mutate(doc);
    const read = themeRowsFromCarriedBlock(carried(doc));
    expect(read).toEqual({ state: "unavailable", reason: "invalid_shape" });
  });

  it("an inherited id (prototype pollution probe) is not an own id — refused", () => {
    const doc = base();
    const rows = doc.rows as Record<string, unknown>[];
    rows[0] = Object.create({ id: "inherited" }) as Record<string, unknown>;
    expect(themeRowsFromCarriedBlock(carried(doc))).toEqual({ state: "unavailable", reason: "invalid_shape" });
  });

  it("soft values never invalidate the block: non-finite perf numbers read null; unknown window keys are ignored; non-string names/chart_keys read null", () => {
    const doc = base();
    const row = (doc.rows as Record<string, unknown>[])[0]! as {
      perf: Record<string, Record<string, unknown>>;
      name: unknown;
      name_zh: unknown;
      chart_key: unknown;
    };
    row.perf["1d"] = { ret: Number.POSITIVE_INFINITY, rel: "x" };
    row.perf["99d"] = { ret: 1 }; // unknown window key — ignored, never rendered
    row.name = 7;
    row.name_zh = {};
    row.chart_key = false;
    const read = themeRowsFromCarriedBlock(carried(doc));
    if (read.state !== "available") throw new Error("unavailable");
    const r = read.rows[0]!;
    expect(r.perf!["1d"]).toEqual({ ret: null, rel: null }); // finite numbers only
    expect((r.perf! as unknown as Record<string, unknown>)["99d"]).toBeUndefined();
    expect(r.name).toBeNull();
    expect(r.name_zh).toBeNull();
    expect(r.chart_key).toBeNull();
  });
});

describe("theme_rows reader — the served twelve-entry object reads through the same entry contract", () => {
  it("all five new blocks read available from typed_blocks_entitled.json", () => {
    const served = specimenJson("served") as Record<string, unknown>;
    expect(Object.keys(served).sort()).toEqual(
      [
        "bottoming_watch",
        "confluence",
        "confluence_universe_baskets",
        "confluence_universe_nasdaq",
        "confluence_universe_russell",
        "confluence_universe_sp500",
        "etf_flows",
        "r1_rising_priced_share",
        "r2_display_order",
        "r2_hazard_qualification",
        "theme_rows",
        "theme_table",
      ].sort(),
    );
    const read = themeRowsFromCarriedBlock(served.theme_rows);
    expect(read.state).toBe("available");
    if (read.state === "available") expect(read.rows).toHaveLength(49);
  });

  it.each([
    ["audience_not_entitled"],
    ["not_produced"],
    ["invalid_shape"],
    ["block_too_large"],
  ])("an unavailable entry with reason %s reads that reason", (reason) => {
    expect(themeRowsFromCarriedBlock({ status: "unavailable", reason, value: null })).toEqual({
      state: "unavailable",
      reason,
    });
  });

  it("an unknown or missing reason reads the generic unknown, never a partial table", () => {
    expect(themeRowsFromCarriedBlock({ status: "unavailable", reason: "solar_flare", value: null })).toEqual({
      state: "unavailable",
      reason: "unknown",
    });
    expect(themeRowsFromCarriedBlock({ status: "unavailable" })).toEqual({
      state: "unavailable",
      reason: "unknown",
    });
    expect(themeRowsFromCarriedBlock(null)).toEqual({ state: "unavailable", reason: "unknown" });
    expect(themeRowsFromCarriedBlock("nope")).toEqual({ state: "unavailable", reason: "unknown" });
  });
});

describe("themeChartHref — the composed link obeys the navigable-id law, hostile keys never link", () => {
  it("a real chart_key composes the same-site detail path", () => {
    expect(themeChartHref("b-memory-storage")).toBe("/subsector/b-memory-storage.html");
    expect(themeChartHref(undefined)).toBeUndefined();
    expect(themeChartHref(null)).toBeUndefined();
    expect(themeChartHref("")).toBeUndefined();
  });

  it.each([
    ["javascript:alert(1)"],
    ["javascript:alert(1)\u0000"],
    [".."],
    ["../escape"],
    ["a b"],
    ["a/b"],
    ["a\\b"],
    ["a\tb"],
  ])("hostile chart_key %p yields no link", (key) => {
    expect(themeChartHref(key as string)).toBeUndefined();
  });
});

describe("theme_rows reader — hostile rows never throw and never invent links", () => {
  it("a 300-char ticker-safe id, prototype-carried extras and inherited fields do not throw", () => {
    const doc = structuredClone(specimenJson("themeRows")) as { rows: Record<string, unknown>[] };
    doc.rows[0]!.id = "x".repeat(300); // not a navigable id — the row still reads
    doc.rows[1] = Object.assign(Object.create({ inherited: "yes" }), doc.rows[1]);
    const read = themeRowsFromCarriedBlock(carried(doc));
    if (read.state !== "available") throw new Error("unavailable");
    expect(read.rows).toHaveLength(49);
    expect(read.rows[0]!.id).toBe("x".repeat(300)); // carried verbatim; linking is gated elsewhere
    expect(themeChartHref(read.rows[0]!.chart_key)).toBe("/subsector/b-memory-storage.html");
  });
});
