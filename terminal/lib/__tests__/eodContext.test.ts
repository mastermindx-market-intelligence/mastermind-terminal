// EOD context belt (OEU T-E) — the four silent-failure classes this lane can produce.
//
//  1. ROUTING. `volregime` sits one character away from the existing `vol:` prefix family
//     and `moves:` beside `matrix:`/`meta`. A mis-resolved f-param does not throw — it
//     misses the backend, misses R2, returns null, and renders as an empty cell that is
//     indistinguishable from "macro hasn't published this". So every new form's backend
//     path and R2 key is pinned, and the near-miss pairs are asserted not to collide.
//  2. LEAN PARITY. The dark-pool lean is a VERBATIM port of macro's published classifier
//     (engine/darkpool_context.py) because the mirrored artifact ships the inputs but not
//     the label. A drift here means the two estates call the same footprint different
//     names, which is worse than no label — so every threshold is pinned on both sides of
//     its boundary, including the precedence between "building" and "fading".
//  3. ABSENT-STATE COLLAPSE. "not covered by the panel", "the artifact is missing" and
//     "covered but nothing unusual" are three different facts. The whole honesty case for
//     this belt is that they never collapse into one empty box, so each is asserted to
//     produce its own distinguishable state.
//  4. VINTAGE. Every value on the belt is settled-close data beside live tape; the stamp is
//     what makes it honest. Two stores can run different sessions, so cells must carry
//     their OWN source's date, and a bare YYYY-MM-DD must not lose a day to a timezone.
import { describe, it, expect } from "vitest";
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
import { getEodStr } from "@/components/eodcontext/eodStrings";

const dataFile = (n: string) => path.join(process.cwd(), "public", "data", n);
const loadJson = async <T>(n: string): Promise<T> =>
  JSON.parse(await fs.readFile(dataFile(n), "utf8")) as T;

/** A standout row that is neither building nor fading — the "unusual" baseline. */
const baseRow = (over: Partial<DarkPoolRow> = {}): DarkPoolRow => ({
  ticker: "TEST",
  asof: "2026-07-24",
  oe_z: 2.0,
  oe_share: 0.55,
  trend_pp: 0,
  ratio_z: 0,
  n_days: 42,
  ...over,
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
    expect(dp.schema).toBe("darkpool_eod.v1");
    expect(dp.tier).toBe("eod");
    expect(Array.isArray(dp.universe)).toBe(true);
    expect(dp.universe!.length).toBeGreaterThan(0);
  });

  it("darkpool fixture exercises EVERY lean branch plus the quiet one", async () => {
    // A fixture that only ever produces one state cannot show a developer the branch they
    // are about to break — the four states have to be reachable without a network.
    const dp = await loadJson<DarkPoolEodPayload>("darkpool_fixture.json");
    const leans = new Set(dp.universe!.map((r) => darkPoolLean(r)));
    expect(leans).toContain("accumulation");
    expect(leans).toContain("distribution");
    expect(leans).toContain("unusual");
    expect(leans).toContain(null); // covered, but not a standout
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
    expect((await fixtureFor("darkpool")).schema).toBe("darkpool_eod.v1");
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

describe("dark-pool lean — thresholds match macro's published rule", () => {
  it("pins the constants to macro engine/darkpool_context.py", () => {
    expect(DP_STANDOUT_Z).toBe(1.5);
    expect(DP_STANDOUT_OE).toBe(0.4);
    expect(DP_ACC_TREND).toBe(-2.0);
    expect(DP_ACC_RZ).toBe(-0.75);
    expect(DP_DIS_TREND).toBe(4.0);
    expect(DP_DIS_RZ).toBe(1.0);
  });

  it("requires BOTH standout gates", () => {
    expect(darkPoolLean(baseRow({ oe_z: 1.49 }))).toBeNull();          // z below
    expect(darkPoolLean(baseRow({ oe_share: 0.399 }))).toBeNull();     // share below
    expect(darkPoolLean(baseRow({ oe_z: 1.5, oe_share: 0.4 }))).toBe("unusual"); // both at
  });

  it("never tags a name without enough history to have a z", () => {
    // Honest-null, not forced: macro refuses to classify these and so must the Terminal.
    expect(darkPoolLean(baseRow({ oe_z: null }))).toBeNull();
    expect(darkPoolLean(baseRow({ oe_share: null }))).toBeNull();
    expect(darkPoolLean(null)).toBeNull();
  });

  it("reads short-marking BUILDING as distribution", () => {
    expect(darkPoolLean(baseRow({ trend_pp: 4.0 }))).toBe("distribution");
    expect(darkPoolLean(baseRow({ trend_pp: 3.9 }))).toBe("unusual");
    expect(darkPoolLean(baseRow({ trend_pp: 0, ratio_z: 1.0 }))).toBe("distribution");
  });

  it("reads short-marking FADING as accumulation", () => {
    expect(darkPoolLean(baseRow({ trend_pp: -2.0 }))).toBe("accumulation");
    expect(darkPoolLean(baseRow({ trend_pp: -1.9 }))).toBe("unusual");
    expect(darkPoolLean(baseRow({ trend_pp: 0, ratio_z: -0.75 }))).toBe("accumulation");
  });

  it("falls back to 'unusual' when both signals fire at once", () => {
    // macro's precedence: contradictory evidence is unusual, never a coin-flip direction.
    expect(darkPoolLean(baseRow({ trend_pp: 5, ratio_z: -1 }))).toBe("unusual");
    expect(darkPoolLean(baseRow({ trend_pp: -5, ratio_z: 2 }))).toBe("unusual");
  });
});

describe("dark-pool secondary reads", () => {
  it("bands oe_z the way macro's _norm_label does", () => {
    expect(darkPoolNorm(baseRow({ oe_z: 2.5 }))).toBe("far");
    expect(darkPoolNorm(baseRow({ oe_z: 1.5 }))).toBe("well");
    expect(darkPoolNorm(baseRow({ oe_z: 0.5 }))).toBe("above");
    expect(darkPoolNorm(baseRow({ oe_z: 0.49 }))).toBe("at");
    expect(darkPoolNorm(baseRow({ oe_z: null }))).toBeNull();
  });

  it("leans on the CHANGE before the level, as macro's _short_label does", () => {
    expect(darkPoolShortRead(baseRow({ trend_pp: 6.05 }))).toEqual({ key: "building", pp: 6.05 });
    expect(darkPoolShortRead(baseRow({ trend_pp: -6.63 }))).toEqual({ key: "fading", pp: 6.63 });
    // The trend is inside its band, so the level-based read takes over.
    expect(darkPoolShortRead(baseRow({ trend_pp: 1, ratio_z: -1 }))?.key).toBe("light");
    expect(darkPoolShortRead(baseRow({ trend_pp: 1, ratio_z: 1.2 }))?.key).toBe("heavy");
    expect(darkPoolShortRead(baseRow({ trend_pp: 1, ratio_z: 0 }))?.key).toBe("normal");
    expect(darkPoolShortRead(baseRow({ trend_pp: null, ratio_z: null }))).toBeNull();
  });
});

// ─── 4. Absent states never collapse ──────────────────────────────────────────

describe("dark-pool absent states stay distinguishable", () => {
  it("distinguishes an uncovered ticker from a missing artifact", async () => {
    const dp = await loadJson<DarkPoolEodPayload>("darkpool_fixture.json");
    // Covered universe, ticker absent → row null but the payload is real.
    const uncovered = darkPoolRead(dp, "NOSUCHTICKER");
    expect(uncovered.row).toBeNull();
    expect(dp.universe!.length).toBeGreaterThan(0);
    // No artifact at all → also row null, but the CALLER can tell them apart because the
    // payload itself is empty. The panel branches on exactly this.
    const missing = darkPoolRead({ schema: "darkpool_eod.v1", universe: [] }, "NVDA");
    expect(missing.row).toBeNull();
  });

  it("a covered-but-quiet row is a populated read with a null lean", () => {
    const read = darkPoolRead(
      { universe: [baseRow({ ticker: "QUIET", oe_z: 0.4, oe_share: 0.42 })] },
      "quiet"
    );
    expect(read.row).not.toBeNull();     // there IS an answer
    expect(read.lean).toBeNull();        // …and the answer is "nothing unusual"
    expect(read.oeSharePct).toBeCloseTo(42, 6);
  });

  it("matches the root case-insensitively", () => {
    const uni = { universe: [baseRow({ ticker: "NVDA" })] };
    expect(pickDarkPoolRow(uni, "nvda")?.ticker).toBe("NVDA");
    expect(pickDarkPoolRow(uni, " NVDA ")?.ticker).toBe("NVDA");
  });

  it("survives a malformed payload without throwing", () => {
    expect(darkPoolRead(null, "NVDA").row).toBeNull();
    expect(darkPoolRead(undefined, "NVDA").row).toBeNull();
    expect(pickDarkPoolRow({ universe: undefined }, "NVDA")).toBeNull();
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

// ─── W3S: the expMove cell carries the producer's band statement ─────────────
describe("expMove band statement (W3S)", () => {
  const moves = {
    asof: "2026-07-23",
    expected_move: { pct: 1.9618, lo: 723.6982, hi: 752.6618, band_mult: 1.96, horizon_days: 1 },
  };

  it("expMove cell carries the band multiple, horizon and clock labelled method not stated", () => {
    const em = buildStructureCells({ gexState: null, gex: null, root: "SPY", moves })
      .find((c) => c.key === "expMove")!;
    expect(em.value).toBe("±2.0%");
    expect(em.detail).toBe("723.7 – 752.7");
    // The producer's OWN numbers ride beside the band, keyed as data — the belt
    // renderer localizes the line, and the wording names the method honestly.
    expect(em.method).toEqual({ bandMult: 1.96, horizonDays: 1 });
    expect(em.vintage).toBe("2026-07-23");
    expect(getEodStr("en", "cellExpMoveMethodBand")).toContain("band ×{m}");
    expect(getEodStr("zh", "cellExpMoveMethodBand")).toBe("区间 ×{m}");
    expect(getEodStr("en", "cellExpMoveMethodHorizon")).toContain("{n}d horizon");
    expect(getEodStr("zh", "cellExpMoveMethodHorizon")).toBe("{n}日");
    expect(getEodStr("en", "cellExpMoveMethodUnstated")).toBe("method not stated by source");
    expect(getEodStr("zh", "cellExpMoveMethodUnstated")).toBe("来源未说明方法");
  });

  it("expMove cell shows no band line and no number when the moves payload is absent", () => {
    const absent = buildStructureCells({ gexState: null, gex: null, root: "SPY" })
      .find((c) => c.key === "expMove")!;
    expect(absent.value).toBeNull();
    expect(absent.detail).toBeNull();
    expect(absent.method ?? null).toBeNull();
    // A payload that never published a band is the same absence — not a zero.
    const bare = buildStructureCells({ gexState: null, gex: null, root: "SPY", moves: { asof: "2026-07-23" } })
      .find((c) => c.key === "expMove")!;
    expect(bare.value).toBeNull();
    expect(bare.method ?? null).toBeNull();
    // Each part of the statement is present only when its own field is finite.
    const partial = buildStructureCells({
      gexState: null, gex: null, root: "SPY",
      moves: { asof: "2026-07-23", expected_move: { pct: 1.9, lo: 100, hi: 104, band_mult: 1.5 } },
    }).find((c) => c.key === "expMove")!;
    expect(partial.value).toBe("±1.9%");
    expect(partial.method).toEqual({ bandMult: 1.5, horizonDays: null });
  });
});
