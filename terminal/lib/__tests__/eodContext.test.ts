// EOD context belt (OEU T-E) — the four silent-failure classes this lane can produce.
//
//  1. ROUTING. `volregime` sits one character away from the existing `vol:` prefix family
//     and `moves:` beside `matrix:`/`meta`. A mis-resolved f-param does not throw — it
//     misses the backend, misses R2, returns null, and renders as an empty cell that is
//     indistinguishable from "macro hasn't published this". So every new form's backend
//     path and R2 key is pinned, and the near-miss pairs are asserted not to collide.
//  2. SOURCE PARITY. Consume the versioned Macro fields and source-issued patterns.
//     Never manufacture accumulation/distribution from short-marked volume.
//  3. ABSENT-STATE COLLAPSE. "not covered by the panel", "the artifact is missing" and
//     "covered but nothing unusual" are three different facts. The whole honesty case for
//     this belt is that they never collapse into one empty box, so each is asserted to
//     produce its own distinguishable state.
//  4. VINTAGE. Every value on the belt is settled-close data beside live tape; the stamp is
//     what makes it honest. Two stores can run different sessions, so cells must carry
//     their OWN source's date, and a bare YYYY-MM-DD must not lose a day to a timezone.
import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DarkPoolMini } from "@/components/eodcontext/DarkPoolMini";
import { promises as fs } from "fs";
import path from "path";
import { isValidF, backendPath, r2Key, fixtureFor } from "@/lib/flowSource";
import {
  DP_ACC_RZ,
  DP_ACC_TREND,
  DP_DIS_RZ,
  DP_DIS_TREND,
  DP_STANDOUT_OE,
  DP_STANDOUT_Z,
  buildStructureCells,
  darkPoolLean,
  darkPoolNorm,
  darkPoolRead,
  darkPoolShortRead,
  eodDate,
  fmtEodDay,
  fmtLevel,
  fmtOiCompact,
  normalizeVolUnits,
  oiConfRead,
  ordinal,
  pickDarkPoolRow,
  structureIsEmpty,
  structureReceiptLine,
  volRegimeRead,
  type DarkPoolEodPayload,
  type DarkPoolRow,
  type StructureReceipt,
  type VolRegimePayload,
} from "@/lib/eodContext";

const dataFile = (n: string) => path.join(process.cwd(), "public", "data", n);
const loadJson = async <T>(n: string): Promise<T> =>
  JSON.parse(await fs.readFile(dataFile(n), "utf8")) as T;

/** A dated v2 source observation, not a locally inferred direction. */
const baseRow = (over: Partial<DarkPoolRow> = {}): DarkPoolRow => ({
  ticker: "TEST", asof: "2026-10-08", session_status: "current",
  participation_z: 2, participation: 0.55, short_trend_pp: 0, short_rate_z: 0,
  price_change_pct: 0, pattern: "heavy_price_flat", n_usable: 42,
  ...over,
});
const v2Payload = (row: DarkPoolRow): DarkPoolEodPayload => ({
  schema: "darkpool_eod.v2", tier: "eod", source: "finra_facilities",
  asof: "2026-10-08", universe: [row],
});

// ─── 1. Routing ───────────────────────────────────────────────────────────────

describe("f-param validation — EOD context forms", () => {
  it("accepts the three new forms", () => {
    expect(isValidF("darkpool")).toBe(true);
    expect(isValidF("volregime")).toBe(true);
    expect(isValidF("moves:SPY")).toBe(true);
  });

  it("rejects a parameterized form with its root missing", () => {
    expect(isValidF("moves:")).toBe(false);
  });

  it("rejects near-misses of the new names", () => {
    expect(isValidF("darkpools")).toBe(false);
    expect(isValidF("volregimes")).toBe(false);
    expect(isValidF("move:SPY")).toBe(false);
    expect(isValidF("moves")).toBe(false);
  });

  it("does not disturb the vol: family it sits beside", () => {
    // `volregime` and `vol:SPY` differ by one character in the same position. Both must
    // stay valid AND resolve to different objects (asserted in the routing suites below).
    expect(isValidF("vol:SPY")).toBe(true);
    expect(isValidF("volregime")).toBe(true);
    expect(isValidF("vol:")).toBe(false);
  });
});

describe("routing — backend path", () => {
  it("maps each new form to its own hub path", () => {
    expect(backendPath("darkpool")).toBe("/api/hub/darkpool");
    expect(backendPath("volregime")).toBe("/api/hub/volregime");
    expect(backendPath("moves:SPY")).toBe("/api/hub/moves/SPY");
  });

  it("keeps the neighbouring prefixes distinct", () => {
    expect(backendPath("vol:SPY")).toBe("/api/hub/vol/SPY");
    expect(backendPath("volregime")).not.toBe(backendPath("vol:SPY"));
    expect(backendPath("moves:SPY")).not.toBe(backendPath("matrix:SPY"));
  });
});

describe("routing — R2 key", () => {
  it("maps each new form to the key macro actually mirrors", () => {
    // These two live at the BUCKET ROOT, not under options_hub/ — the macro mirror
    // (scripts/mirror_terminal_context_r2.py) writes whole files under their own names.
    expect(r2Key("darkpool")).toBe("darkpool/eod.json");
    expect(r2Key("volregime")).toBe("vol/regime.json");
    // The expected-move band is a per-root sibling of gex/vol in the options_hub plane.
    expect(r2Key("moves:SPY")).toBe("options_hub/moves/SPY.json");
  });

  it("keeps the neighbouring prefixes distinct", () => {
    expect(r2Key("vol:SPY")).toBe("options_hub/vol/SPY.json");
    expect(r2Key("volregime")).not.toBe(r2Key("vol:SPY"));
    expect(r2Key("moves:SPY")).not.toBe(r2Key("gex:SPY"));
  });

  it("never falls through to the generic live_flow key", () => {
    for (const f of ["darkpool", "volregime", "moves:SPY"]) {
      expect(r2Key(f).startsWith("live_flow/")).toBe(false);
    }
  });
});

// ─── 2. Fixtures ──────────────────────────────────────────────────────────────

describe("fixtures — the belt's dev data plane", () => {
  it("darkpool fixture parses as the mirrored schema", async () => {
    const dp = await loadJson<DarkPoolEodPayload>("darkpool_fixture.json");
    expect(dp.schema).toBe("darkpool_eod.v2");
    expect(dp.tier).toBe("eod");
    expect(Array.isArray(dp.universe)).toBe(true);
    expect(dp.universe!.length).toBeGreaterThan(0);
  });

  it("darkpool fixture exercises source patterns and non-standouts", async () => {
    const dp = await loadJson<DarkPoolEodPayload>("darkpool_fixture.json");
    const patterns = new Set(dp.universe!.map((r) => r.pattern));
    expect(patterns).toContain("heavy_into_weakness");
    expect(patterns).toContain("heavy_into_strength");
    expect(patterns).toContain("heavy_price_flat");
    const tags = new Set(dp.universe!.map((r) => darkPoolRead(dp, r.ticker).lean));
    expect(tags).toEqual(new Set(["unusual", null]));
  });

  it("volregime fixture carries a renderable game_plan in BOTH languages", async () => {
    const vr = await loadJson<VolRegimePayload>("volregime_fixture.json");
    expect(vr.schema).toBe("vol_regime.v1");
    expect(volRegimeRead(vr, "en")?.label).toBeTruthy();
    expect(volRegimeRead(vr, "zh")?.label).toBeTruthy();
    // A zh view showing the EN verdict is the i18n leak this asserts against.
    expect(volRegimeRead(vr, "zh")!.label).not.toBe(volRegimeRead(vr, "en")!.label);
  });

  it("moves fixture is keyed by root and carries a band", async () => {
    const mv = await loadJson<Record<string, { expected_move?: { pct?: number } }>>(
      "moves_fixture.json"
    );
    expect(Object.keys(mv).length).toBeGreaterThan(0);
    expect(mv.SPY?.expected_move?.pct).toBeTypeOf("number");
  });

  it("fixtureFor serves each new form", async () => {
    expect((await fixtureFor("darkpool")).schema).toBe("darkpool_eod.v2");
    expect((await fixtureFor("volregime")).schema).toBe("vol_regime.v1");
    expect((await fixtureFor("moves:SPY")).root).toBe("SPY");
  });

  it("an unknown moves root returns empty, never a fallback root's band", async () => {
    // Showing SPY's expected move under NOPE's ticker is worse than showing none.
    expect(await fixtureFor("moves:NOPE")).toEqual({});
  });

  it("gexstate answers only for the root its fixture declares", async () => {
    // Regression: the gexstate fixture used to be served root-blind, so NVDA's desk showed
    // SPY's walls/flip/max-pain. Invisible until this belt printed them beside the NVDA
    // ladder's own numbers and the two disagreed.
    const spy = await fixtureFor("gexstate:SPY");
    expect(spy.root).toBe("SPY");
    expect(await fixtureFor("gexstate:NVDA")).toEqual({});
    expect(await fixtureFor("gexstate:NOPE")).toEqual({});
  });

  it("a root the structure snapshot can't answer falls back to the ladder, disclosed", async () => {
    // The other half of the same fix: NVDA still gets levels, from the store that HAS them,
    // wearing that store's session and marked as a fallback rather than blended silently.
    const gexRaw = (await fixtureFor("gex:NVDA")) as {
      asof?: string; call_wall?: number; put_wall?: number; gamma_flip?: number;
    };
    const cells = buildStructureCells({
      gexState: null, gex: gexRaw, root: "NVDA",
    });
    const wall = cells.find((c) => c.key === "callWall")!;
    expect(wall.value).toBe(String(gexRaw.call_wall));
    expect(wall.source).toBe("gex");
  });

  it("moves fixture lookup is case-insensitive on the root", async () => {
    expect((await fixtureFor("moves:spy")).root).toBe("SPY");
  });
});

// ─── 3. Dark-pool lean parity with macro's published classifier ───────────────

describe("off-exchange v2 consumer — source observations, never inferred direction", () => {
  it("retains Macro's existing display gates", () => {
    expect(DP_STANDOUT_Z).toBe(1.5);
    expect(DP_STANDOUT_OE).toBe(0.4);
    expect(DP_ACC_TREND).toBe(-2.0);
    expect(DP_ACC_RZ).toBe(-0.75);
    expect(DP_DIS_TREND).toBe(4.0);
    expect(DP_DIS_RZ).toBe(1.0);
  });

  it("requires both gates and the source-issued price conjunction", () => {
    expect(darkPoolLean(baseRow({ participation_z: 1.49 }))).toBeNull();
    expect(darkPoolLean(baseRow({ participation: 0.399 }))).toBeNull();
    expect(darkPoolLean(baseRow({ participation_z: 1.5, participation: 0.4 }))).toBe("unusual");
    expect(darkPoolLean(baseRow({ pattern: null }))).toBeNull();
    expect(darkPoolLean(baseRow({ pattern: "accumulation" }))).toBeNull();
    expect(darkPoolLean(baseRow({ price_change_pct: null }))).toBeNull();
    expect(darkPoolLean(null)).toBeNull();
  });

  it.each([-99, 0, 99])("short-marking change %s never creates direction", (change) => {
    const read = darkPoolRead(v2Payload(baseRow({
      short_trend_pp: change, short_rate_z: change, trend_pp: change, ratio_z: change,
    })), "TEST");
    expect(read.lean).toBe("unusual");
    expect(read.pattern).toBe("heavy_price_flat");
  });

  it("matches the frozen full Macro artifact, including all 275 current rows", async () => {
    // Exact public producer bytes: macro@7bf322e8925b90e7986b0b2b0a4e14e6a43f8b90
    // site/darkpool_eod.json. This is a dated fixture, not a live feed assertion.
    const raw = await fs.readFile(dataFile("darkpool_fixture.json"));
    const digest = createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
    expect(digest).toBe("bec8d5310e640f4e6804d8743349de091ac455ff");
    const dp = JSON.parse(raw.toString("utf8")) as DarkPoolEodPayload;
    expect(dp.universe).toHaveLength(275);
    expect(dp.historical_rows).toHaveLength(97);
    const tagged: string[] = [];
    for (const row of dp.universe!) {
      const read = darkPoolRead(dp, row.ticker);
      expect(read.state, row.ticker).toBe("available");
      expect(read.oeSharePct, row.ticker).toBeCloseTo(row.participation! * 100, 8);
      expect(read.oeZ, row.ticker).toBe(row.participation_z);
      expect(read.nDays, row.ticker).toBe(row.n_usable);
      expect(read.asof, row.ticker).toBe("2026-10-08");
      expect([null, "unusual"]).toContain(read.lean);
      if (read.lean) tagged.push(row.ticker);
    }
    expect(tagged.sort()).toEqual([
      "AMGN", "ASO", "BBY", "BKNG", "CGNX", "CIEN", "CME", "COHR", "DDOG",
      "DE", "DELL", "ETN", "GEV", "HL", "KEY", "MPC", "MRVL", "NOVT", "NVR",
      "PHM", "PSX", "PTC", "ROK", "TDY", "VLO", "VRT", "VST",
    ]);
  });

  it("keeps comparable history, source patterns, and historical clocks distinct", async () => {
    const dp = await loadJson<DarkPoolEodPayload>("darkpool_fixture.json");
    expect(darkPoolRead(dp, "BKNG")).toMatchObject({
      nDays: 101, historyRebased: true, pattern: "heavy_price_flat",
    });
    expect(pickDarkPoolRow(dp, "BKNG")?.n_days).toBe(801);
    expect(darkPoolRead(dp, "QQQ")).toMatchObject({
      state: "unavailable", reason: "HISTORICAL_ONLY", row: null,
      asof: null, historicalAsOf: "2026-08-04", lean: null,
    });
    expect(darkPoolRead(dp, "APH")).toMatchObject({
      state: "available", oeSharePct: 39.34, oeZ: 6.43, lean: null,
      pattern: "heavy_price_flat", norm: "far",
    });
  });

  it.each([
    ["participation", null], ["participation", Number.NaN], ["participation", Infinity],
    ["participation", -0.1], ["participation", 1.01], ["participation", "0.5"],
    ["participation_z", null], ["participation_z", Number.NaN], ["participation_z", Infinity],
    ["n_usable", null], ["n_usable", -1], ["n_usable", 2.5], ["n_usable", Infinity],
  ])("keeps invalid %s=%s absent without hiding the other measurements", (field, value) => {
    const row = baseRow({ [field]: value } as Partial<DarkPoolRow>);
    const read = darkPoolRead(v2Payload(row), "TEST");
    expect(read.state).toBe("partial");
    expect(read.lean).toBeNull();
    if (field === "participation") {
      expect(read.oeSharePct).toBeNull();
      expect(read.oeZ).toBe(2);
    } else if (field === "participation_z") {
      expect(read.oeZ).toBeNull();
      expect(read.oeSharePct).toBeCloseTo(55);
    } else expect(read.nDays).toBeNull();
  });

  it("preserves real zero and never substitutes the total history count", () => {
    expect(darkPoolRead(v2Payload(baseRow({
      participation: 0, participation_z: 0, short_trend_pp: 0, short_rate_z: 0,
      n_usable: 0, n_days: 801, pattern: null,
    })), "TEST")).toMatchObject({
      state: "available", oeSharePct: 0, oeZ: 0, nDays: 0, lean: null,
      short: { key: "normal", pp: null },
    });
  });

  it("does not read legacy fields inside a declared v2 artifact", () => {
    const row: DarkPoolRow = {
      ticker: "TEST", asof: "2026-10-08", oe_share: 0.9, oe_z: 4,
      trend_pp: -10, ratio_z: -3, n_days: 801,
    };
    expect(darkPoolRead(v2Payload(row), "TEST")).toMatchObject({
      state: "partial", oeSharePct: null, oeZ: null, short: null, nDays: null, lean: null,
    });
  });

  it("keeps explicit v1 observations compatible without accumulation/distribution", () => {
    const dp: DarkPoolEodPayload = {
      schema: "darkpool_eod.v1", tier: "eod", asof: "2026-10-08",
      universe: [{ ticker: "TEST", oe_share: 0.55, oe_z: 2, trend_pp: -9, n_days: 42 }],
    };
    const read = darkPoolRead(dp, "TEST");
    expect(read).toMatchObject({
      state: "available", oeZ: 2, nDays: 42, lean: "unusual",
      pattern: null, short: { key: "fading", pp: 9 },
    });
    expect(read.oeSharePct).toBeCloseTo(55, 8);
  });

  it.each([undefined, "darkpool_eod.v3", "equity.tick_plane.minute_observation/v0"])
  ("rejects unsupported schema %s", (schema) => {
    expect(darkPoolRead({ ...v2Payload(baseRow()), schema }, "TEST")).toMatchObject({
      state: "unavailable", reason: "UNSUPPORTED_SCHEMA", row: null, lean: null,
    });
  });

  it.each([
    { asof: undefined }, { asof: "2026-10-07" }, { asof: "2026-10-09" },
    { asof: "2026-02-30" }, { session_status: "stale" }, { session_status: null },
  ])("refuses an unqualified row clock/status %j", (changes) => {
    expect(darkPoolRead(v2Payload(baseRow(changes)), "TEST")).toMatchObject({
      state: "unavailable", reason: "ROW_SESSION_MISMATCH", row: null, lean: null, asof: null,
    });
  });

  it("does not turn a fresh build clock or a non-EOD tier into a source session", () => {
    expect(darkPoolRead({ ...v2Payload(baseRow()), asof: undefined, built: "2026-10-09 14:14 UTC" }, "TEST").state)
      .toBe("unavailable");
    expect(darkPoolRead({ ...v2Payload(baseRow()), tier: "intraday" }, "TEST").state).toBe("unavailable");
  });

  it("keeps duplicate, malformed, empty, and uncovered rows separate", () => {
    const dp = v2Payload(baseRow());
    expect(darkPoolRead({ ...dp, universe: [baseRow(), baseRow()] }, "TEST").reason)
      .toBe("DUPLICATE_CURRENT_ROW");
    expect(darkPoolRead({ ...dp, universe: [] }, "TEST").state).toBe("unavailable");
    expect(darkPoolRead(dp, "MISSING").state).toBe("not_covered");
    expect(darkPoolRead(null, "TEST").state).toBe("unavailable");
    expect(darkPoolRead(undefined, "TEST").state).toBe("unavailable");
    expect(pickDarkPoolRow({ universe: [null, { ticker: 9 }, []] as never }, "TEST")).toBeNull();
    expect(pickDarkPoolRow(dp, " test ")?.ticker).toBe("TEST");
  });
});

describe("off-exchange observations — metric semantics", () => {
  it("uses participation_z for the existing norm bands", () => {
    expect(darkPoolNorm(baseRow({ participation_z: 2.5 }))).toBe("far");
    expect(darkPoolNorm(baseRow({ participation_z: 1.5 }))).toBe("well");
    expect(darkPoolNorm(baseRow({ participation_z: 0.5 }))).toBe("above");
    expect(darkPoolNorm(baseRow({ participation_z: 0.49 }))).toBe("at");
    expect(darkPoolNorm(baseRow({ participation_z: null, oe_z: 3 }))).toBeNull();
  });

  it("reads v2 short-marking fields, never the participation trend or legacy aliases", () => {
    expect(darkPoolShortRead(baseRow({ short_trend_pp: 6.05 }))).toEqual({ key: "building", pp: 6.05 });
    expect(darkPoolShortRead(baseRow({ short_trend_pp: -6.63 }))).toEqual({ key: "fading", pp: 6.63 });
    expect(darkPoolShortRead(baseRow({ short_trend_pp: 1, short_rate_z: -1 }))?.key).toBe("light");
    expect(darkPoolShortRead(baseRow({ short_trend_pp: 1, short_rate_z: 1.2 }))?.key).toBe("heavy");
    expect(darkPoolShortRead(baseRow({
      short_trend_pp: null, short_rate_z: null, participation_trend_pp: 9, trend_pp: 9, ratio_z: 2,
    }))).toBeNull();
  });
});

describe("off-exchange component — rendered copy and provenance", () => {
  const render = (payload: DarkPoolEodPayload | null, root = "TEST", lang: "en" | "zh" = "en") =>
    renderToStaticMarkup(createElement(DarkPoolMini, { payload, root, lang }));

  it("renders available and partial measurements without a false quiet conclusion", () => {
    for (const row of [
      baseRow({ participation_z: 0.2, pattern: null }),
      baseRow({ participation: 0.3934, participation_z: 6.43 }),
      baseRow({ participation: null }),
      baseRow({ short_trend_pp: null, short_rate_z: null }),
    ]) {
      const html = render(v2Payload(row));
      expect(html).not.toMatch(/Nothing unusual|inside this name|Quiet accumulation|Distribution pressure|mixed short-marking/);
      expect(html).toContain("Off-exchange");
    }
  });

  it("does not invent a not-published explanation for an unsupported or historical source", () => {
    const html = render({ ...v2Payload(baseRow()), schema: "unknown" });
    expect(html).toContain("Off-exchange panel unavailable");
    expect(html).not.toContain("hasn&#x27;t published");
    expect(html).not.toContain("Nothing unusual");
  });

  it("renders the real v2 denominator and source provenance in both languages", async () => {
    const dp = await loadJson<DarkPoolEodPayload>("darkpool_fixture.json");
    const en = render(dp, "BKNG");
    expect(en).toContain("101 matched days");
    expect(en).not.toContain("801 matched days");
    expect(en).toContain('data-history-rebased="true"');
    expect(en).toContain('data-source-pattern="heavy_price_flat"');
    expect(en).toContain('data-source-session="2026-10-08"');
    expect(en).toContain("Unusual, unclear");
    expect(en).not.toMatch(/accumulation|distribution|mixed short-marking/);
    const zh = render(dp, "BKNG", "zh");
    expect(zh).toContain("101 个匹配交易日");
    expect(zh).toContain("场外占比");
    expect(zh).not.toMatch(/悄然吸筹|派发压力|无异常/);
  });
});

describe("OI confirmation — 'feed absent' is not 'nothing confirmed'", () => {
  const rows = [
    { root: "NVDA", right: "C", exp: "2026-07-18", strike: 160, delta_oi: 3200 },
    { root: "NVDA", right: "P", exp: "2026-07-18", strike: 150, delta_oi: 900 },
    { root: "TSLA", right: "C", exp: "2026-08-15", strike: 320, delta_oi: 1100 },
  ];

  it("reports covered:false only when the feed itself is missing", () => {
    expect(oiConfRead(null, "NVDA")).toEqual({
      covered: false, count: 0, topDeltaOi: null, asof: null,
    });
    // A present feed that confirmed nothing for this root is a REAL answer: covered, zero.
    expect(oiConfRead({ confirmed: [] }, "NVDA")).toMatchObject({ covered: true, count: 0 });
  });

  it("counts a root's rows and reports the largest OI build", () => {
    const r = oiConfRead({ schema: "x", asof: "2026-07-23", confirmed: rows }, "NVDA");
    expect(r).toMatchObject({ covered: true, count: 2, topDeltaOi: 3200, asof: "2026-07-23" });
  });

  it("accepts both the fixture array and the production object", () => {
    expect(oiConfRead(rows, "TSLA")).toMatchObject({ covered: true, count: 1 });
    expect(oiConfRead({ confirmed: rows }, "TSLA")).toMatchObject({ covered: true, count: 1 });
  });

  it("reads the shipped oiconf fixture and gets a stampable as-of", async () => {
    // The fixture carries the production object shape, so the belt's OI cell can stamp a
    // real session instead of falling back to "date unknown".
    const fx = await fixtureFor("oiconf");
    const read = oiConfRead(fx as never, "NVDA");
    expect(read.covered).toBe(true);
    expect(eodDate(read.asof)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── 5. Structure strip cells ─────────────────────────────────────────────────

describe("structure cells — source preference, fallback, vintage", () => {
  const gexState = {
    asof: "2026-07-10T06:21:31+00:00",
    call_wall: 760, put_wall: 740, gamma_flip: 748.25, max_pain: 745,
  };
  const gex = {
    asof: "2026-07-23", call_wall: 800, put_wall: 738, gamma_flip: 275,
  };

  it("prefers the structure snapshot and stamps ITS session, not the ladder's", () => {
    const cells = buildStructureCells({ gexState, gex, root: "SPY" });
    const wall = cells.find((c) => c.key === "callWall")!;
    expect(wall.value).toBe("760");           // gex_state's, not the ladder's 800
    expect(wall.source).toBe("gexstate");
    expect(wall.vintage).toBe("2026-07-10");  // …stamped with gex_state's own date
  });

  it("falls back to the ladder payload and SAYS SO", () => {
    // The fallback must be reportable: two stores a fortnight apart, silently blended,
    // is the exact failure this belt exists to make visible.
    const cells = buildStructureCells({ gexState: null, gex, root: "SPY" });
    const wall = cells.find((c) => c.key === "callWall")!;
    expect(wall.value).toBe("800");
    expect(wall.source).toBe("gex");
    expect(wall.vintage).toBe("2026-07-23");
  });

  it("prints max pain only from the store that publishes it", () => {
    // The ladder payload has no max_pain at all; the cell must go absent, not zero.
    const withState = buildStructureCells({ gexState, gex, root: "SPY" });
    expect(withState.find((c) => c.key === "maxPain")!.value).toBe("745");
    const without = buildStructureCells({ gexState: null, gex, root: "SPY" });
    expect(without.find((c) => c.key === "maxPain")!.value).toBeNull();
  });

  it("renders the expected-move band from its own store", () => {
    const cells = buildStructureCells({
      gexState, gex, root: "SPY",
      moves: {
        asof: "2026-07-23",
        expected_move: { pct: 1.9618, lo: 723.6982, hi: 752.6618, band_mult: 1.96 },
      },
    });
    const em = cells.find((c) => c.key === "expMove")!;
    expect(em.value).toBe("±2.0%");
    expect(em.detail).toBe("723.7 – 752.7");
    expect(em.vintage).toBe("2026-07-23");
  });

  it("renders the IV percentile from the vol store's own rank", () => {
    const cells = buildStructureCells({
      gexState, gex, root: "SPY",
      vol: { asof: "2026-07-23", iv_rank_252: 72.2, atm_iv: 15.8893 },
    });
    const iv = cells.find((c) => c.key === "ivPct")!;
    expect(iv.value).toBe("72");
    expect(iv.detail).toBe("ATM IV 15.9%");
    expect(iv.source).toBe("vol");
  });

  it("prints ATM IV the same whether the store ships a percent or a fraction", () => {
    // Live options_hub/vol ships 15.8893; the checked-in fixture still ships 0.162. One
    // display, both conventions — the alternative is "0.2%" in dev and 1588.9% in prod.
    const pct = buildStructureCells({
      root: "SPY", vol: { iv_rank_252: 38.1, atm_iv: 16.2 },
    }).find((c) => c.key === "ivPct")!;
    const frac = buildStructureCells({
      root: "SPY", vol: { iv_rank_252: 38.1, atm_iv: 0.162 },
    }).find((c) => c.key === "ivPct")!;
    expect(pct.detail).toBe("ATM IV 16.2%");
    expect(frac.detail).toBe("ATM IV 16.2%");
  });

  it("emits every cell with a null value when nothing is published", () => {
    const cells = buildStructureCells({ gexState: null, gex: null, root: "NOPE" });
    expect(cells).toHaveLength(7);
    expect(structureIsEmpty(cells)).toBe(true);
    // Absent means null — never 0, never "—" baked into the value.
    for (const c of cells) expect(c.value).toBeNull();
  });

  it("is not 'empty' when only the OI-confirmation feed answered", () => {
    const cells = buildStructureCells({
      gexState: null, gex: null, root: "NVDA", oiConf: { confirmed: [] },
    });
    expect(structureIsEmpty(cells)).toBe(false);
    expect(cells.find((c) => c.key === "oiConf")!.value).toBe("0");
  });
});

// ─── 5. IV UNIT REGIME ────────────────────────────────────────────────────────
//
// options_hub/vol ships every IV-family field as a PERCENT in production. A reader that
// assumes fractions prints a live SPY at 1588.9%; one that assumes percents prints the
// fraction-shipping fixture at 0.2%. The subtler failure is the obvious fix: applying
// ivPercent's `iv < 5 → ×100` rule PER LEAF rescues the headline and wrecks the smile,
// because a real chain's tails live near that threshold (live SPY bottoms at 6.25) and a
// tail that dips under 5 would be blown up to 490, taking the chart's y-scale with it.
// So the regime is decided ONCE per payload and every leaf moves by that single factor.

describe("normalizeVolUnits", () => {
  /** Live-shaped: options_hub/vol/SPY.json as R2 actually serves it — percents throughout. */
  const percentPayload = () => ({
    schema: "options_hub.vol/v1",
    asof: "2026-07-23",
    root: "SPY",
    iv_rank_252: 72.2,
    atm_iv: 15.8893,
    iv_52w_hi: 26.6,
    iv_52w_lo: 12.6743,
    rv20: 12.2318,
    vrp: 3.6575,
    term: [{ dte: 0, exp: "2026-07-23", atm_iv: 10.405 }],
    smile: [{ exp: "2026-07-27", points: [{ strike: 520, call_iv: 6.25, put_iv: 18.4 }] }],
    history: [{ date: "2026-07-22", iv_rank: 71.0, atm_iv: 19.79, close: 738.1 }],
  });

  /** The same schema in fraction units — what the vol fixture shipped before this lane. */
  const fractionPayload = () => ({
    schema: "options_hub.vol/v1",
    root: "SPY",
    iv_rank_252: 38.1,
    atm_iv: 0.162,
    iv_52w_hi: 0.481,
    iv_52w_lo: 0.088,
    rv20: 0.141,
    vrp: 0.021,
    term: [{ dte: 4, exp: "2026-07-11", atm_iv: 0.178 }],
    smile: [{ exp: "2026-07-11", points: [{ strike: 520, call_iv: 0.198, put_iv: 0.265 }] }],
    history: [{ date: "2026-04-07", iv_rank: 91.8, atm_iv: 0.481, close: 491.2 }],
  });

  it("leaves a percent payload exactly as it found it", () => {
    const out = normalizeVolUnits(percentPayload());
    expect(out).toEqual(percentPayload());
    expect(out.atm_iv).toBe(15.8893);
    expect(out.term[0].atm_iv).toBe(10.405);
    expect(out.history[0].atm_iv).toBe(19.79);
    expect(out.vrp).toBe(3.6575);
    expect(out.iv_rank_252).toBe(72.2);
  });

  it("leaves a smile tail alone even when the tail alone would read as a fraction", () => {
    // The pin that separates per-PAYLOAD from per-LEAF. 6.25 is a real live SPY tail; 4.9 is
    // the same tail one bad session lower, and a per-leaf ivPercent would print it as 490%.
    const out = normalizeVolUnits(percentPayload());
    expect(out.smile[0].points[0].call_iv).toBe(6.25);

    const deepTail = normalizeVolUnits({
      ...percentPayload(),
      smile: [{ exp: "2026-07-27", points: [{ strike: 400, call_iv: 4.9, put_iv: 3.2 }] }],
    });
    expect(deepTail.smile[0].points[0].call_iv).toBe(4.9);
    expect(deepTail.smile[0].points[0].put_iv).toBe(3.2);
  });

  it("scales every IV-family field of a fraction payload by one hundred", () => {
    const out = normalizeVolUnits(fractionPayload());
    expect(out.atm_iv).toBe(16.2);
    expect(out.iv_52w_hi).toBe(48.1);
    expect(out.iv_52w_lo).toBe(8.8);
    expect(out.rv20).toBe(14.1);
    expect(out.vrp).toBe(2.1);
    expect(out.term[0].atm_iv).toBe(17.8);
    expect(out.smile[0].points[0].call_iv).toBe(19.8);
    expect(out.smile[0].points[0].put_iv).toBe(26.5);
    expect(out.history[0].atm_iv).toBe(48.1);
  });

  it("never touches a rank, a strike, a close or a DTE", () => {
    // Ranks are 0–100 under BOTH conventions and the rest are not vols at all.
    const out = normalizeVolUnits(fractionPayload());
    expect(out.iv_rank_252).toBe(38.1);
    expect(out.history[0].iv_rank).toBe(91.8);
    expect(out.history[0].close).toBe(491.2);
    expect(out.smile[0].points[0].strike).toBe(520);
    expect(out.term[0].dte).toBe(4);
    expect(out.root).toBe("SPY");
  });

  it("reads the regime off iv_52w_hi when atm_iv is absent", () => {
    const out = normalizeVolUnits({ ...fractionPayload(), atm_iv: null });
    expect(out.atm_iv).toBeNull();
    expect(out.iv_52w_hi).toBe(48.1);
    expect(out.term[0].atm_iv).toBe(17.8);
    expect(out.smile[0].points[0].call_iv).toBe(19.8);
  });

  it("reads the regime off the first term entry when both top-level anchors are absent", () => {
    const out = normalizeVolUnits({ ...fractionPayload(), atm_iv: null, iv_52w_hi: null });
    expect(out.term[0].atm_iv).toBe(17.8);
    expect(out.history[0].atm_iv).toBe(48.1);
  });

  it("returns the payload untouched when nothing can anchor the regime", () => {
    // Nothing to decide from, so nothing is guessed — iv_52w_lo keeps whatever it shipped.
    const p = {
      schema: "options_hub.vol/v1", root: "SPY",
      atm_iv: null, iv_52w_hi: null, iv_52w_lo: 0.088,
      term: [], smile: [], history: [],
    };
    const out = normalizeVolUnits(p);
    expect(out).toBe(p);
    expect(out.iv_52w_lo).toBe(0.088);
  });

  it("passes a null leaf through as null rather than scaling it to zero", () => {
    const out = normalizeVolUnits({
      ...fractionPayload(),
      smile: [{
        exp: "2026-07-11",
        points: [{ strike: 520, call_iv: 0.198, put_iv: null as number | null }],
      }],
    });
    expect(out.smile[0].points[0].put_iv).toBeNull();
    expect(out.smile[0].points[0].call_iv).toBe(19.8);
  });

  it("does not mutate the payload it was handed", () => {
    const p = fractionPayload();
    const out = normalizeVolUnits(p);
    expect(p.atm_iv).toBe(0.162);
    expect(p.term[0].atm_iv).toBe(0.178);
    expect(p.smile[0].points[0].call_iv).toBe(0.198);
    expect(p.history[0].atm_iv).toBe(0.481);
    expect(out).not.toBe(p);
    expect(out.term).not.toBe(p.term);
    expect(out.smile[0].points).not.toBe(p.smile[0].points);
  });
});

describe("vintage formatting", () => {
  it("takes the date off an ISO timestamp", () => {
    expect(eodDate("2026-07-10T06:21:31+00:00")).toBe("2026-07-10");
    expect(eodDate("2026-07-23")).toBe("2026-07-23");
    expect(eodDate("")).toBeNull();
    expect(eodDate(null)).toBeNull();
    expect(eodDate("garbage")).toBeNull();
  });

  it("formats a bare date without losing a day to a timezone", () => {
    // `new Date("2026-01-01")` is UTC midnight → "Dec 31" for any viewer west of GMT.
    // String arithmetic is the only implementation that cannot do that.
    expect(fmtEodDay("2026-01-01", "en")).toBe("Jan 1");
    expect(fmtEodDay("2026-01-01", "zh")).toBe("1月1日");
    expect(fmtEodDay("2026-07-23", "en")).toBe("Jul 23");
    expect(fmtEodDay("2026-12-31", "en")).toBe("Dec 31");
    expect(fmtEodDay(null, "en")).toBeNull();
    expect(fmtEodDay("2026-13-01", "en")).toBeNull();
  });

  it("formats levels the way GexSummaryBar does", () => {
    expect(fmtLevel(760)).toBe("760");
    expect(fmtLevel(748.25)).toBe("748.3");
    expect(fmtLevel(null)).toBeNull();
    expect(fmtLevel(Number.NaN)).toBeNull();
  });
});

// ─── 6. Vol regime chip ───────────────────────────────────────────────────────

describe("vol regime — pure pass-through of macro's verdict", () => {
  const payload: VolRegimePayload = {
    schema: "vol_regime.v1",
    snapshot: { available: true, asof: "2026-07-24", regime: "normalizing" },
    game_plan: {
      available: true,
      verdict: { en: "Mixed — normalizing", zh: "中性 · 修复中" },
      css: "gp-neutral",
      sub: { en: "The vol surface is neither cheap-calm nor stressed.", zh: "波动率曲面既不便宜平静、也未承压。" },
      asof: "2026-07-24",
    },
  };

  it("carries macro's wording verbatim in both languages", () => {
    expect(volRegimeRead(payload, "en")!.label).toBe("Mixed — normalizing");
    expect(volRegimeRead(payload, "zh")!.label).toBe("中性 · 修复中");
    expect(volRegimeRead(payload, "en")!.sub).toContain("cheap-calm");
  });

  it("maps macro's four tone tokens", () => {
    const tone = (css: string) =>
      volRegimeRead({ ...payload, game_plan: { ...payload.game_plan!, css } }, "en")!.tone;
    expect(tone("gp-calm")).toBe("calm");
    expect(tone("gp-neutral")).toBe("neutral");
    expect(tone("gp-warn")).toBe("warn");
    expect(tone("gp-jumpy")).toBe("jumpy");
    // An unknown token degrades to neutral rather than throwing or colouring at random.
    expect(tone("gp-brandnew")).toBe("neutral");
  });

  it("returns null (→ absent chip) rather than an empty chip", () => {
    expect(volRegimeRead(null, "en")).toBeNull();
    expect(volRegimeRead({}, "en")).toBeNull();
    expect(volRegimeRead({ game_plan: { available: false } }, "en")).toBeNull();
    // Present-but-wordless is also absent: a chip with a blank label says nothing.
    expect(volRegimeRead({ game_plan: { available: true, verdict: {} } }, "en")).toBeNull();
  });

  it("falls back through the payload's asof chain", () => {
    const noGpAsof = { ...payload, game_plan: { ...payload.game_plan!, asof: undefined } };
    expect(volRegimeRead(noGpAsof, "en")!.asof).toBe("2026-07-24");
  });
});

// ─── 7. Prophet contract structure receipt ────────────────────────────────────

describe("structure receipt — macro's words, this surface's layout", () => {
  const full: StructureReceipt = {
    band: "liquid", band_en: "liquid", band_zh: "流动性好",
    spread_pct: 5.1, spread_abs: 0.94, open_interest: 8600,
    oi_vintage: "prior session close (OPRA reports OI for the previous day)",
    iv_pct: 44.0, iv_rank_pct: 44.0, iv_rank_n_obs: 210, iv_rank_history_days: 252,
    iv_rank_young: false,
    note_en: "bid/ask gap 5.1% of the mid price; 8,600 contracts open at this strike (prior session)",
    note_zh: "买卖价差为中间价的5.1%；该行权价未平仓8,600张（上一交易日）",
    authority_tier: "display",
  };

  it("renders the brief's glance idiom", () => {
    expect(structureReceiptLine(full, "en")!.glance).toBe(
      "Liquid contract · 5.1% spread · 8.6k OI · IV 44th pctile of its range"
    );
  });

  it("renders a ZH glance with no English left in it", () => {
    const zh = structureReceiptLine(full, "zh")!;
    expect(zh.glance).toContain("流动性好");
    expect(zh.glance).toContain("未平仓 8.6k");
    expect(zh.glance).toContain("第 44 百分位");
    // The i18n leak check: no Latin words from the EN line survive into the ZH glance.
    expect(zh.glance).not.toMatch(/spread|contract|pctile/i);
  });

  it("hands macro's own sentence to the Tier-2 hover, per language", () => {
    expect(structureReceiptLine(full, "en")!.detail).toBe(full.note_en);
    expect(structureReceiptLine(full, "zh")!.detail).toBe(full.note_zh);
  });

  it("degrades to a shorter honest line when fields are missing", () => {
    // Every field is independently nullable upstream; a partial receipt must not print
    // "null", a placeholder dash, or a fabricated middle value.
    const noOi = structureReceiptLine({ ...full, open_interest: null }, "en")!;
    expect(noOi.glance).not.toContain("OI");
    expect(noOi.glance).toContain("5.1% spread");

    const bandOnly = structureReceiptLine({ band: "thin", band_en: "thin" }, "en")!;
    expect(bandOnly.glance).toBe("Thin contract");
    expect(bandOnly.detail).toBe("");
  });

  it("falls back to raw IV when the percentile has too little history", () => {
    const noRank = structureReceiptLine({ ...full, iv_rank_pct: null }, "en")!;
    expect(noRank.glance).toContain("IV 44%");
    expect(noRank.glance).not.toContain("pctile");
  });

  it("surfaces the short-history caveat rather than hiding it", () => {
    expect(structureReceiptLine({ ...full, iv_rank_young: true }, "en")!.young).toBe(true);
    expect(structureReceiptLine(full, "en")!.young).toBe(false);
  });

  it("returns null for a plan with no receipt at all", () => {
    expect(structureReceiptLine(null, "en")).toBeNull();
    expect(structureReceiptLine(undefined, "en")).toBeNull();
    expect(structureReceiptLine({}, "en")).toBeNull();
  });

  it("keeps the worst-first band token for tone", () => {
    expect(structureReceiptLine({ ...full, band: "wide" }, "en")!.band).toBe("wide");
  });

  it("reads the shipped prophet fixture's receipt end to end", async () => {
    const p = await loadJson<{
      plans: { asset: string; option_contract?: { structure?: StructureReceipt } | null }[];
    }>("prophet_fixture.json");
    const withReceipt = p.plans.find((x) => x.option_contract?.structure);
    expect(withReceipt).toBeTruthy();
    const line = structureReceiptLine(withReceipt!.option_contract!.structure!, "en")!;
    expect(line.glance).toContain("contract");
    expect(line.detail.length).toBeGreaterThan(0);
    // …and a contract WITHOUT a receipt must exist too, so the absent row is reachable.
    const noReceipt = p.plans.find((x) => x.option_contract && !x.option_contract.structure);
    expect(noReceipt).toBeTruthy();
  });
});

describe("receipt number formatting", () => {
  it("compacts contract counts", () => {
    expect(fmtOiCompact(8600)).toBe("8.6k");
    expect(fmtOiCompact(999)).toBe("999");
    expect(fmtOiCompact(1_250_000)).toBe("1.3M");
    expect(fmtOiCompact(null)).toBeNull();
  });

  it("ordinalizes percentiles, including the teens", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(44)).toBe("44th");
  });
});
