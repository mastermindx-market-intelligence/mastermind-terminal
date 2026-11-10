/**
 * sectorDepthFlows.test.ts — contract tests for the sector-ETF fund-flow
 * matrix readers (Sector Intelligence depth, lane 7).
 *
 * The flow payload the Macro generation publishes is NOT yet carried by the
 * captured generation fixture, so these tests run against the clearly
 * synthetic contract fixture (sectorDepthFlowsContract.v1.json, top-level
 * "note" marks it as not a real generation) in two shapes:
 * - depth 8: history still accruing — 2w/1m cap at 8 trading days and the
 *   wider windows coincide where measured (incumbent siFlowsNote law);
 * - depth 79: the live incumbent's full-history shape (as-of 2026-11-05),
 *   where 2w and 1m are distinct again.
 *
 * Incumbent semantics pinned here: ΔShares × NAV in US$ millions, positive =
 * money in; null is NO READING and 0 is a measured number, never conflated;
 * per-window heat scale over the 11 ETF rows ONLY (net excluded); windows
 * 1d/3d/1w/2w/1m = 1/3/5/10/21 trading days in that fixed order; "−" is
 * U+2212 MINUS SIGN, never a hyphen.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CARRIED_FLOW_LABELS,
  cellIntensity,
  effectiveWindowDays,
  FLOW_FUND_MAX,
  FLOW_WINDOW_LABEL,
  FLOW_WINDOWS,
  flowsFromCarriedBlock,
  fmtMoneyMn,
  heatScale,
  MISSING_GLYPH,
  MINUS_SIGN,
  participation,
  phoneModel,
  rowCoverage,
  tableModel,
  windowHeaderOf,
  WINDOW_DAYS,
  type FlowsData,
  type FlowRow,
} from "../sectorDepthFlows";
import { SECTOR_DEPTH_LEX } from "../sectorDepthLex";

const FIXTURE_PATH = join(
  __dirname,
  "fixtures",
  "sectorDepthFlowsContract.v1.json",
);
const fixtureFile = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
  note: string;
  cases: { depth8: FlowsData; depth79: FlowsData };
};

/** The v1.1 carried etf_flows typed block (wire §3, macro #10929):
 * realFull = the committed producer's own run over data/flows; realAccruing14
 * = a LANE-AUTHORED TEST INPUT (review N5) — the same real series truncated
 * to 14 sessions by lane 7, with the full_window:false flag authored by the
 * lane. The fixture's own "note" is the label of record. */
const CARRIED_PATH = join(
  __dirname,
  "fixtures",
  "sectorDepthFlowsCarried.v1.json",
);
const carriedFile = JSON.parse(readFileSync(CARRIED_PATH, "utf8")) as {
  note: string;
  cases: { realFull: unknown; realAccruing14: unknown };
};
const FX8 = fixtureFile.cases.depth8;
const FX79 = fixtureFile.cases.depth79;
const CASES: [string, FlowsData][] = [
  ["depth8", FX8],
  ["depth79", FX79],
];

/** The 11 sector SPDRs in the fixture's (and the source's) fixed order. */
const SPDR_ORDER = [
  "XLB",
  "XLE",
  "XLF",
  "XLI",
  "XLK",
  "XLV",
  "XLU",
  "XLY",
  "XLP",
  "XLC",
  "XLRE",
];

const ALL_NULL_ROW: FlowRow = {
  ticker: "XXX",
  name: "All Null",
  values: { "1d": null, "3d": null, "1w": null, "2w": null, "1m": null },
};

describe("fmtMoneyMn — incumbent money formatting", () => {
  it("formats the boundary table exactly", () => {
    expect(fmtMoneyMn(null)).toBe("—");
    expect(fmtMoneyMn(0)).toBe("+$0M");
    expect(fmtMoneyMn(1)).toBe("+$1M");
    expect(fmtMoneyMn(412.6)).toBe("+$413M"); // M branch rounds to 0 decimals
    expect(fmtMoneyMn(999)).toBe("+$999M");
    // 999.5 stays in the M branch (|v| < 1000 is tested BEFORE rounding), and
    // rounds up to a grouped 1,000 — the rule-consistent reading of the spec.
    expect(fmtMoneyMn(999.5)).toBe("+$1,000M");
    expect(fmtMoneyMn(1000)).toBe("+$1.0B");
    expect(fmtMoneyMn(2500)).toBe("+$2.5B");
    expect(fmtMoneyMn(-286.3)).toBe("−$286M");
    expect(fmtMoneyMn(-1538)).toBe("−$1.5B");
    expect(fmtMoneyMn(-1150.7)).toBe("−$1.2B");
    // A sub-half negative still rounds to a measured-looking −$0M: the sign
    // carries the direction, and the magnitude is honestly ~0.
    expect(fmtMoneyMn(-0.4)).toBe("−$0M");
    expect(fmtMoneyMn(0.4)).toBe("+$0M");
  });

  it("uses U+2212 MINUS SIGN — assert the codepoint, not a lookalike", () => {
    const out = fmtMoneyMn(-1538);
    expect(out).toBe("−$1.5B");
    expect(out.charCodeAt(0)).toBe(0x2212);
    expect(MINUS_SIGN.charCodeAt(0)).toBe(0x2212);
    expect(out.includes("-")).toBe(false); // never an ASCII hyphen
    // The missing glyph is U+2014 EM DASH.
    expect(fmtMoneyMn(null).charCodeAt(0)).toBe(0x2014);
    expect(MISSING_GLYPH.charCodeAt(0)).toBe(0x2014);
  });

  it("treats non-finite input as a missing reading, never an invented number", () => {
    expect(fmtMoneyMn(Number.NaN)).toBe("—");
    expect(fmtMoneyMn(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("effectiveWindowDays — windows cap at collected history", () => {
  it("full history (depth 21+) leaves every window at full length", () => {
    for (const w of FLOW_WINDOWS) {
      expect(effectiveWindowDays(w, 21)).toBe(WINDOW_DAYS[w]);
      expect(effectiveWindowDays(w, 79)).toBe(WINDOW_DAYS[w]);
    }
  });

  it("depth 4 caps 1w/2w/1m at 4 while 1d and 3d stay full", () => {
    expect(effectiveWindowDays("1d", 4)).toBe(1);
    expect(effectiveWindowDays("3d", 4)).toBe(3);
    expect(effectiveWindowDays("1w", 4)).toBe(4);
    expect(effectiveWindowDays("2w", 4)).toBe(4);
    expect(effectiveWindowDays("1m", 4)).toBe(4);
  });

  it("depth 8 caps only 2w and 1m (the fixture's accruing case)", () => {
    expect(effectiveWindowDays("1d", 8)).toBe(1);
    expect(effectiveWindowDays("3d", 8)).toBe(3);
    expect(effectiveWindowDays("1w", 8)).toBe(5);
    expect(effectiveWindowDays("2w", 8)).toBe(8);
    expect(effectiveWindowDays("1m", 8)).toBe(8);
  });

  it("never returns a negative window", () => {
    for (const w of FLOW_WINDOWS) expect(effectiveWindowDays(w, 0)).toBe(0);
  });
});

describe("heatScale — per-window scale over the ETF rows ONLY", () => {
  it("excludes the net row even when its magnitude dwarfs every row", () => {
    const flows: FlowsData = {
      asof: "2026-01-02",
      depth: 21,
      rows: [
        {
          ticker: "A",
          name: "A",
          values: { "1d": 120, "3d": null, "1w": 0, "2w": 0, "1m": 0 },
        },
        {
          ticker: "B",
          name: "B",
          values: { "1d": -80, "3d": 0, "1w": 0, "2w": 0, "1m": 0 },
        },
      ],
      net: { "1d": -99999, "3d": null, "1w": 0, "2w": 0, "1m": 0 },
    };
    const scale = heatScale(flows);
    expect(scale["1d"]).toBe(120); // max |row|, not the net's 99999
    expect(scale["3d"]).toBe(0); // all-null window scales to 0
    expect(scale["1w"]).toBe(0); // all-zero window also scales to 0
  });

  it("on both fixture cases equals the max |row| per window, net excluded", () => {
    for (const [name, fx] of CASES) {
      const scale = heatScale(fx);
      for (const w of FLOW_WINDOWS) {
        const expected = fx.rows.reduce(
          (m, r) => {
            const v = r.values[w];
            return typeof v === "number" && Math.abs(v) > m ? Math.abs(v) : m;
          },
          0,
        );
        expect(scale[w], `${name} ${w}`).toBe(expected);
      }
    }
    // Direct incumbent-law witness on the depth8 case: the 2w net (3147.2) and
    // 1m net (4297.9) far exceed their scales — the scale stays the max ROW value.
    expect(FX8.net["2w"]).toBeGreaterThan(FX8.rows[4].values["2w"]!);
    expect(heatScale(FX8)["2w"]).toBe(FX8.rows[4].values["2w"]);
    expect(FX8.net["1m"]).toBeGreaterThan(FX8.rows[4].values["1m"]!);
    expect(heatScale(FX8)["1m"]).toBe(FX8.rows[4].values["1m"]);
  });
});

describe("cellIntensity — tint in [0,1], never tinting nothing into something", () => {
  it("returns 0 for missing readings, non-finite values and 0-scale windows", () => {
    expect(cellIntensity(null, 100)).toBe(0);
    expect(cellIntensity(Number.NaN, 100)).toBe(0);
    expect(cellIntensity(50, 0)).toBe(0);
    expect(cellIntensity(0, 100)).toBe(0); // measured 0: no tint
  });

  it("maps |v|/scale and clamps to 1", () => {
    expect(cellIntensity(50, 100)).toBe(0.5);
    expect(cellIntensity(-50, 100)).toBe(0.5);
    expect(cellIntensity(100, 100)).toBe(1);
    expect(cellIntensity(250, 100)).toBe(1);
  });
});

describe("participation — row share of the complex net, guarded", () => {
  it("is undefined for net 0, net null, row null or non-finite inputs", () => {
    expect(participation(50, 0)).toBeUndefined(); // never Infinity
    expect(participation(50, null)).toBeUndefined();
    expect(participation(null, 50)).toBeUndefined();
    expect(participation(Number.NaN, 50)).toBeUndefined();
    expect(participation(50, Number.NaN)).toBeUndefined();
    expect(participation(0, 0)).toBeUndefined();
  });

  it("rounds to 1 decimal and keeps sign (money out is a negative share)", () => {
    expect(participation(30, 120)).toBe(25);
    expect(participation(1, 3)).toBe(33.3);
    expect(participation(-100, 200)).toBe(-50);
    expect(participation(0, 200)).toBe(0); // measured zero share IS defined
    expect(participation(412.6, 369.2)).toBe(111.8); // can exceed 100%
  });
});

describe("rowCoverage — measured windows out of five", () => {
  it("scores an all-null row 0 of 5 (the row still renders, elsewhere)", () => {
    expect(rowCoverage(ALL_NULL_ROW)).toBe(0);
    const model = tableModel({
      asof: "2026-01-02",
      depth: 21,
      rows: [ALL_NULL_ROW],
      net: { "1d": 5, "3d": null, "1w": null, "2w": null, "1m": null },
    });
    expect(model.rows).toHaveLength(1); // not dropped
    expect(model.rows[0].coverage).toBe(0);
    expect(model.rows[0].cells.every((c) => c.missing && c.value === null)).toBe(
      true,
    );
  });

  it("counts a mixed row and ignores non-finite entries", () => {
    const row: FlowRow = {
      ticker: "M",
      name: "Mixed",
      values: { "1d": 1, "3d": null, "1w": 0, "2w": -2, "1m": Number.NaN },
    };
    expect(rowCoverage(row)).toBe(3);
    expect(rowCoverage(FX8.rows[1])).toBe(4); // XLE: 1m withheld
    expect(rowCoverage(FX8.rows[10])).toBe(3); // XLRE: 3d/1w withheld
  });
});

describe("synthetic contract fixture — shape and representative content", () => {
  it("declares itself synthetic and carries well-formed reading dates", () => {
    expect(fixtureFile.note).toBe(
      "synthetic contract-shape fixture for tests; not a real generation",
    );
    expect(FX8.asof).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(FX79.asof).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(FX79.asof).toBe("2026-11-05");
  });

  it("carries the 11 SPDRs in fixed order with all five windows each", () => {
    for (const [, fx] of CASES) {
      expect(fx.rows.map((r) => r.ticker)).toEqual(SPDR_ORDER);
      expect(fx.rows).toHaveLength(11);
      for (const r of fx.rows) {
        for (const w of FLOW_WINDOWS) expect(r.values).toHaveProperty(w);
      }
      for (const w of FLOW_WINDOWS) expect(fx.net).toHaveProperty(w);
    }
  });

  it("depth 8 caps 2w/1m; depth 79 is the full-history incumbent shape", () => {
    expect(FX8.depth).toBe(8);
    expect(FX79.depth).toBe(79);
    // Under the cap, a fully measured row's 2w and 1m coincide (same 8 days).
    expect(FX8.rows[0].values["2w"]).toBe(FX8.rows[0].values["1m"]);
    // At full depth they are distinct again.
    expect(FX79.rows[4].values["2w"]).not.toBe(FX79.rows[4].values["1m"]);
  });

  it("contains at least one null, one exact 0, one ≥1000 and one negative", () => {
    for (const [, fx] of CASES) {
      const vals: (number | null)[] = [];
      for (const r of fx.rows) for (const w of FLOW_WINDOWS) vals.push(r.values[w]);
      expect(vals.some((v) => v === null)).toBe(true);
      expect(vals.some((v) => v === 0)).toBe(true);
      expect(vals.some((v) => typeof v === "number" && v >= 1000)).toBe(true);
      expect(vals.some((v) => typeof v === "number" && v < 0)).toBe(true);
    }
    expect(FX8.net["1w"]).toBeNull(); // withheld net → participation undefined
  });
});

describe("tableModel — heat ↔ exact-value table equivalence", () => {
  it("fixes the window order 1d,3d,1w,2w,1m everywhere and keeps source row order", () => {
    expect([...FLOW_WINDOWS]).toEqual(["1d", "3d", "1w", "2w", "1m"]);
    expect(WINDOW_DAYS).toEqual({
      "1d": 1,
      "3d": 3,
      "1w": 5,
      "2w": 10,
      "1m": 21,
    });
    for (const [name, fx] of CASES) {
      const model = tableModel(fx);
      expect(model.windows).toEqual([...FLOW_WINDOWS]);
      expect(model.rows.map((r) => r.ticker)).toEqual(fx.rows.map((r) => r.ticker));
      for (const row of model.rows) {
        expect(row.cells.map((c) => c.window)).toEqual([...FLOW_WINDOWS]);
      }
      expect(model.net.cells.map((c) => c.window)).toEqual([...FLOW_WINDOWS]);
      expect(model.asof, name).toBe(fx.asof);
    }
  });

  it("carries every heat value as the identical formatted string, and every null as missing", () => {
    for (const [name, fx] of CASES) {
      const model = tableModel(fx);
      fx.rows.forEach((src, i) => {
        const row = model.rows[i];
        expect(row.ticker).toBe(src.ticker);
        for (const w of FLOW_WINDOWS) {
          const cell = row.cells[FLOW_WINDOWS.indexOf(w)];
          const raw = src.values[w];
          if (raw === null) {
            // null → siFlowsCellMissing territory: flagged missing in BOTH views
            expect(cell.missing, `${name} ${src.ticker} ${w}`).toBe(true);
            expect(cell.value).toBeNull();
            expect(cell.text).toBe("—");
            expect(cell.sign).toBeNull();
          } else {
            expect(cell.missing, `${name} ${src.ticker} ${w}`).toBe(false);
            expect(cell.value).toBe(raw); // exact number, no coercion
            expect(cell.text).toBe(fmtMoneyMn(raw));
            expect(cell.zero).toBe(raw === 0);
            expect(cell.sign).toBe(raw >= 0 ? "up" : "down");
          }
        }
        expect(row.coverage).toBe(rowCoverage(src));
      });
      // The net row follows the same law.
      for (const w of FLOW_WINDOWS) {
        const cell = model.net.cells[FLOW_WINDOWS.indexOf(w)];
        const raw = fx.net[w];
        if (raw === null) {
          expect(cell.missing).toBe(true);
          expect(cell.text).toBe("—");
        } else {
          expect(cell.text).toBe(fmtMoneyMn(raw));
          expect(cell.value).toBe(raw);
        }
      }
      expect(model.net.coverage).toBe(
        FLOW_WINDOWS.filter((w) => typeof fx.net[w] === "number").length,
      );
    }
  });

  it("marks capped windows and their effective day counts", () => {
    const m8 = tableModel(FX8);
    for (const row of [...m8.rows, m8.net]) {
      const byWin = new Map(row.cells.map((c) => [c.window, c]));
      expect(byWin.get("1d")!.capped).toBe(false);
      expect(byWin.get("1d")!.days).toBe(1);
      expect(byWin.get("3d")!.capped).toBe(false);
      expect(byWin.get("1w")!.capped).toBe(false);
      expect(byWin.get("1w")!.days).toBe(5);
      expect(byWin.get("2w")!.capped).toBe(true); // capped at depth 8
      expect(byWin.get("2w")!.days).toBe(8);
      expect(byWin.get("1m")!.capped).toBe(true);
      expect(byWin.get("1m")!.days).toBe(8);
    }
    const m79 = tableModel(FX79);
    for (const cell of m79.rows[0].cells) {
      expect(cell.capped).toBe(false);
      expect(cell.days).toBe(WINDOW_DAYS[cell.window]);
    }
  });

  it("exposes the ETF-only heat scale alongside the cells", () => {
    for (const [, fx] of CASES) {
      expect(tableModel(fx).scale).toEqual(heatScale(fx));
    }
  });
});

describe("phoneModel — selected ETF with all five exact windows", () => {
  it("defaults to the first ETF and falls back to it for an unknown ticker", () => {
    const def = phoneModel(FX8);
    expect(def?.selectedTicker).toBe("XLB");
    expect(def?.selectedName).toBe("Materials");
    expect(phoneModel(FX8, "ZZZ")?.selectedTicker).toBe("XLB");
    expect(phoneModel(FX8, "XLK")?.selectedTicker).toBe("XLK");
    expect(phoneModel(FX79, "XLRE")?.selectedTicker).toBe("XLRE");
  });

  it("shows all five windows as exact values with units, in fixed order", () => {
    const pm = phoneModel(FX8, "XLK")!;
    expect(pm.windows.map((w) => w.window)).toEqual([...FLOW_WINDOWS]);
    const src = FX8.rows.find((r) => r.ticker === "XLK")!;
    for (const w of FLOW_WINDOWS) {
      const entry = pm.windows[FLOW_WINDOWS.indexOf(w)];
      expect(entry.text).toBe(fmtMoneyMn(src.values[w]));
      expect(entry.value).toBe(src.values[w]);
      expect(entry.unitsKey).toBe("siFlowsUnitsMn");
    }
    expect(pm.coverage).toBe(5);
    expect(pm.asof).toBe(FX8.asof);
    expect(pm.depth).toBe(FX8.depth); // source clock parts
    expect(pm.pickers.map((p) => p.ticker)).toEqual(SPDR_ORDER);
  });

  it("derives participation only where the net is measured and non-zero", () => {
    const xlk = phoneModel(FX8, "XLK")!.windows;
    const byWin = new Map(xlk.map((w) => [w.window, w]));
    expect(byWin.get("1d")!.participationPct).toBe(111.8); // 412.6 / 369.2
    expect(byWin.get("1w")!.participationPct).toBeUndefined(); // net 1w null
    expect(byWin.get("2w")!.participationPct).toBeCloseTo(
      (2210.5 / 3147.2) * 100,
      0,
    );
    // XLU's measured-0 1d flow over a live net is a defined 0.0%.
    const xlu = phoneModel(FX8, "XLU")!.windows;
    expect(xlu[0].zero).toBe(true);
    expect(xlu[0].participationPct).toBe(0);
    // XLC's missing 1d flow has no participation line at all.
    const xlc = phoneModel(FX8, "XLC")!.windows;
    expect(xlc[0].missing).toBe(true);
    expect(xlc[0].participationPct).toBeUndefined();
    // At full depth every net window is measured.
    const full = phoneModel(FX79, "XLB")!.windows;
    expect(full.every((w) => w.participationPct !== undefined)).toBe(true);
  });

  it("keeps capped-window days visible and returns null for an empty payload", () => {
    const pm = phoneModel(FX8, "XLB")!;
    const byWin = new Map(pm.windows.map((w) => [w.window, w]));
    expect(byWin.get("1w")!.capped).toBe(false);
    expect(byWin.get("1m")!.capped).toBe(true);
    expect(byWin.get("1m")!.days).toBe(8);
    expect(phoneModel({ ...FX8, rows: [] })).toBeNull();
  });
});

describe("lane lexicon — every key the component references exists EN+ZH", () => {
  const USED_KEYS = [
    "siDepthDisplayOnly",
    "siFlowsTitle",
    "siFlowsSub",
    "siFlowsNetRow",
    "siFlowsChart",
    "siFlowsTable",
    "siFlowsNote",
    "siFlowsUnitsMn",
    "siFlowsWindowDays",
    "siFlowsSourceClock",
    "siFlowsCellMissing",
    "siFlowsCellZero",
    "siFlowsRowCoverage",
    "siFlowsSelectedEtf",
    "siFlowsParticipation",
    "siFlowsColCoverage",
    "siFlowsMatrixHint",
    "siFlowsReadout",
    "siFlowsDirIn",
    "siFlowsDirOut",
  ];

  it("each referenced key is a non-empty [en, zh] pair", () => {
    for (const key of USED_KEYS) {
      const pair = SECTOR_DEPTH_LEX[key];
      expect(pair, key).toBeDefined();
      expect(Array.isArray(pair)).toBe(true);
      expect(pair).toHaveLength(2);
      expect(pair[0].trim().length, `${key} en`).toBeGreaterThan(0);
      expect(pair[1].trim().length, `${key} zh`).toBeGreaterThan(0);
      // A pure interpolation template (e.g. "{ticker} · {name}") may be
      // identical across locales; anything with real words must differ.
      const words = (s: string) =>
        s
          .replace(/\{[^}]+\}/g, "")
          .replace(/[^\p{L}\p{N}]/gu, "");
      if (words(pair[0]).length > 0 && words(pair[1]).length > 0) {
        expect(pair[0], key).not.toBe(pair[1]);
      }
    }
  });

  it("interpolated keys carry the placeholders the component passes", () => {
    const en = (k: string) => SECTOR_DEPTH_LEX[k][0];
    expect(en("siFlowsWindowDays")).toContain("{n}");
    expect(en("siFlowsSourceClock")).toContain("{asof}");
    expect(en("siFlowsSourceClock")).toContain("{depth}");
    expect(en("siFlowsNote")).toContain("{depth}");
    expect(en("siFlowsRowCoverage")).toContain("{measured}");
    expect(en("siFlowsRowCoverage")).toContain("{windows}");
    expect(en("siFlowsSelectedEtf")).toContain("{ticker}");
    expect(en("siFlowsSelectedEtf")).toContain("{name}");
    expect(en("siFlowsParticipation")).toContain("{pct}");
    expect(en("siFlowsParticipation")).toContain("{window}");
    for (const k of [
      "siFlowsWindowDays",
      "siFlowsSourceClock",
      "siFlowsNote",
      "siFlowsRowCoverage",
      "siFlowsSelectedEtf",
      "siFlowsParticipation",
    ]) {
      expect(SECTOR_DEPTH_LEX[k][1], `${k} zh`).toContain("{");
    }
  });

  it("keeps the missing reading and the measured zero distinct in both locales", () => {
    expect(SECTOR_DEPTH_LEX.siFlowsCellMissing[0]).not.toBe(
      SECTOR_DEPTH_LEX.siFlowsCellZero[0],
    );
    expect(SECTOR_DEPTH_LEX.siFlowsCellMissing[1]).not.toBe(
      SECTOR_DEPTH_LEX.siFlowsCellZero[1],
    );
    // The coverage column header key landed at integration (was a documented
    // gap while the lexicon was a concurrently-edited shared file).
    expect(SECTOR_DEPTH_LEX.siFlowsColCoverage[0]).toBe("Coverage");
  });

  it("carries the integration readout keys with their placeholders (F03)", () => {
    const en = (k: string) => SECTOR_DEPTH_LEX[k][0];
    expect(en("siFlowsReadout")).toContain("{etf}");
    expect(en("siFlowsReadout")).toContain("{window}");
    expect(en("siFlowsReadout")).toContain("{days}");
    expect(en("siFlowsReadout")).toContain("{asof}");
    expect(en("siFlowsReadout")).toContain("{value}");
    expect(en("siFlowsReadout")).toContain("{dir}");
    expect(SECTOR_DEPTH_LEX.siFlowsReadout[1]).toContain("{etf}");
    expect(SECTOR_DEPTH_LEX.siFlowsDirIn[0]).toMatch(/net creations/);
    expect(SECTOR_DEPTH_LEX.siFlowsDirOut[0]).toMatch(/net redemptions/);
  });
});

describe("carried etf_flows block (wire v1.1 §3) — real producer run", () => {
  const realFull = flowsFromCarriedBlock(carriedFile.cases.realFull);
  const realAccruing = flowsFromCarriedBlock(carriedFile.cases.realAccruing14);

  it("fixture declares itself and carries the real run's clock", () => {
    expect(carriedFile.note).toContain("REAL");
    expect(realFull).not.toBeNull();
    expect(realFull!.asof).toBe("2026-11-05");
    expect(realFull!.depth).toBe(79);
    expect(realFull!.rows).toHaveLength(11);
    expect(realFull!.source).toBe("collectors.sponsors.sector_flow_periods");
  });

  it("maps the uppercase window labels onto the five windows with no invention", () => {
    // XLB's carried 1D reading equals the committed flow_desk etf_tile's own
    // flow_1d for XLB (−6.928394282532362) — real-bytes corroboration that
    // the producer run and the legacy tile read the same daily series.
    const xlb = realFull!.rows[0];
    expect(xlb.ticker).toBe("XLB");
    expect(xlb.values["1d"]).toBeCloseTo(-6.928394282532362, 12);
    expect(xlb.values["3d"]).toBeCloseTo(124.80809690669628, 12);
    expect(xlb.values["1m"]).toBeCloseTo(-125.29515086265286, 12);
    // Net maps by label too.
    expect(realFull!.net["1d"]).toBeCloseTo(833.2875680238036, 12);
    expect(realFull!.net["1m"]).toBeCloseTo(6786.514158473594, 12);
  });

  it("carries tickers only — the name line stays absent, never invented", () => {
    for (const r of realFull!.rows) {
      expect(r.name).toBeUndefined();
      expect(r.name_zh).toBeUndefined();
    }
    // The phone model falls back to the ticker as the display identity.
    const pm = phoneModel(realFull!, "XLB")!;
    expect(pm.selectedName).toBe("XLB");
    expect(pm.selectedNameZh).toBeUndefined();
  });

  it("renders every window full at depth 79; the owner's full_window flag is the law", () => {
    expect(realFull!.windowMeta).toEqual({
      "1d": { trading_days: 1, full_window: true },
      "3d": { trading_days: 3, full_window: true },
      "1w": { trading_days: 5, full_window: true },
      "2w": { trading_days: 10, full_window: true },
      "1m": { trading_days: 21, full_window: true },
    });
    const model = tableModel(realFull!);
    for (const row of [...model.rows, model.net]) {
      for (const cell of row.cells) {
        expect(cell.capped, `${row === model.net ? "net" : ""} ${cell.window}`).toBe(false);
        expect(cell.days).toBe(WINDOW_DAYS[cell.window]);
      }
    }
    // Headers agree with cells by construction (same windowHeaderOf law).
    for (const w of FLOW_WINDOWS) {
      const h = windowHeaderOf(w, realFull!);
      expect(h.capped).toBe(false);
      expect(h.days).toBe(WINDOW_DAYS[w]);
    }
  });

  it("marks 1M partial at depth 14 from the owner's own full_window:false", () => {
    expect(realAccruing).not.toBeNull();
    expect(realAccruing!.depth).toBe(14);
    expect(realAccruing!.windowMeta!["1m"]).toEqual({
      trading_days: 21,
      full_window: false,
    });
    const model = tableModel(realAccruing!);
    for (const row of [...model.rows, model.net]) {
      const byWin = new Map(row.cells.map((c) => [c.window, c]));
      expect(byWin.get("2w")!.capped).toBe(false); // min(10, 14) = 10, full
      expect(byWin.get("2w")!.days).toBe(10);
      expect(byWin.get("1m")!.capped).toBe(true); // owner-stated partial
      expect(byWin.get("1m")!.days).toBe(14); // min(21, 14)
    }
    const h = windowHeaderOf("1m", realAccruing!);
    expect(h.capped).toBe(true);
    expect(h.days).toBe(14);
    expect(h.full).toBe(21);
  });

  it("display labels are exactly the carried block's closed label set", () => {
    const display = FLOW_WINDOWS.map((w) => FLOW_WINDOW_LABEL[w]);
    expect(display).toEqual(["1D", "3D", "1W", "2W", "1M"]);
    expect([...display].sort()).toEqual([...CARRIED_FLOW_LABELS].sort());
    // Round trip: carried label → window id → display label is the identity.
    for (const label of CARRIED_FLOW_LABELS) {
      const w = FLOW_WINDOWS.find((x) => FLOW_WINDOW_LABEL[x] === label);
      expect(w, label).toBeDefined();
    }
  });

  it("rejects every malformed block as unusable — unavailable state, never a partial read", () => {
    const base = JSON.parse(JSON.stringify(carriedFile.cases.realFull)) as Record<string, unknown>;
    const variant = (mutate: (b: Record<string, unknown>) => void): unknown => {
      const b = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      mutate(b);
      return b;
    };
    // Not an object / null.
    expect(flowsFromCarriedBlock(null)).toBeNull();
    expect(flowsFromCarriedBlock("etf_flows")).toBeNull();
    expect(flowsFromCarriedBlock(42)).toBeNull();
    // Wrong unit — never silently re-united.
    expect(flowsFromCarriedBlock(variant((b) => { b.unit = "usd_bn"; }))).toBeNull();
    // Missing envelope fields.
    expect(flowsFromCarriedBlock(variant((b) => { delete b.source; }))).toBeNull();
    expect(flowsFromCarriedBlock(variant((b) => { delete b.measure; }))).toBeNull();
    expect(flowsFromCarriedBlock(variant((b) => { delete b.as_of; }))).toBeNull();
    expect(flowsFromCarriedBlock(variant((b) => { b.as_of = "2026/11/05"; }))).toBeNull();
    // Window set violations: unknown label, duplicate, missing one, bad flags.
    expect(
      flowsFromCarriedBlock(variant((b) => {
        (b.windows as { label: string }[])[0].label = "2M";
      })),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(variant((b) => {
        (b.windows as { label: string }[])[1].label = "1D";
      })),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(variant((b) => {
        (b.windows as unknown[]).splice(4, 1);
      })),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(variant((b) => {
        (b.windows as { full_window: boolean }[])[4].full_window = 1 as unknown as boolean;
      })),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(variant((b) => {
        (b.windows as { trading_days: number }[])[2].trading_days = Number.NaN;
      })),
    ).toBeNull();
    // Fund shape violations.
    expect(
      flowsFromCarriedBlock(variant((b) => {
        delete (b.funds as { ticker?: string }[])[2].ticker;
      })),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(variant((b) => {
        (b.funds as { flow_mn: unknown }[])[0].flow_mn = null;
      })),
    ).toBeNull();
    // Net row shape violation.
    expect(
      flowsFromCarriedBlock(variant((b) => { delete b.net_flow_mn; })),
    ).toBeNull();
  });

  it("treats an absent window key inside flow_mn as NO READING, never zero", () => {
    const b = JSON.parse(JSON.stringify(carriedFile.cases.realFull)) as {
      funds: {
        ticker: string;
        flow_mn: Record<string, number | null | undefined>;
      }[];
    };
    delete b.funds[0].flow_mn["1W"];
    const out = flowsFromCarriedBlock(b)!;
    expect(out.rows[0].values["1w"]).toBeNull();
    expect(out.rows[0].values["1d"]).toBeCloseTo(-6.928394282532362, 12);
    expect(out.rows[0].values["1m"]).toBeCloseTo(-125.29515086265286, 12);
    // An explicitly-null reading is the same no-reading state.
    b.funds[0].flow_mn["1M"] = null;
    const out2 = flowsFromCarriedBlock(b)!;
    expect(out2.rows[0].values["1m"]).toBeNull();
  });
});

describe("S3/S4 — carried-block strictness (reviewer probe, made permanent)", () => {
  const base = JSON.parse(JSON.stringify(carriedFile.cases.realFull)) as Record<string, unknown>;
  const variant = (mutate: (b: Record<string, unknown>) => void): unknown => {
    const b = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    mutate(b);
    return b;
  };
  const fund = (b: Record<string, unknown>, i: number) =>
    (b.funds as { ticker: string; flow_mn: Record<string, unknown> }[])[i]!;

  it("S3 — a PRESENT wrong-typed value in flow_mn makes the whole block null", () => {
    expect(
      flowsFromCarriedBlock(variant((b) => { fund(b, 0).flow_mn["1D"] = "81"; })),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(variant((b) => { fund(b, 0).flow_mn["1D"] = [81]; })),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(variant((b) => { fund(b, 0).flow_mn["1D"] = { v: 81 }; })),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(variant((b) => { fund(b, 0).flow_mn["1D"] = true; })),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(variant((b) => { fund(b, 3).flow_mn["1W"] = Number.NaN; })),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(variant((b) => { fund(b, 3).flow_mn["1W"] = "null"; })),
    ).toBeNull();
  });

  it("S3 — a non-object flow_mn (array/scalar) or non-object net_flow_mn is malformed", () => {
    expect(
      flowsFromCarriedBlock(
        variant((b) => {
          fund(b, 1).flow_mn = [["1D", 5]] as unknown as Record<string, unknown>;
        }),
      ),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(
        variant((b) => {
          fund(b, 1).flow_mn = "1D=5" as unknown as Record<string, unknown>;
        }),
      ),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(variant((b) => { b.net_flow_mn = [["1D", 5]] as unknown; })),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(variant((b) => { b.net_flow_mn = "1D=5" as unknown; })),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(variant((b) => { b.net_flow_mn = null; })),
    ).toBeNull();
  });

  it("S3 — a row whose flow_mn carries ONLY unknown window keys is malformed, not empty", () => {
    expect(
      flowsFromCarriedBlock(
        variant((b) => { fund(b, 2).flow_mn = { "2M": 5, "6M": 6 }; }),
      ),
    ).toBeNull();
    // A known label plus an unknown one is equally malformed.
    expect(
      flowsFromCarriedBlock(
        variant((b) => { fund(b, 2).flow_mn = { "1D": 5, "2M": 6 }; }),
      ),
    ).toBeNull();
  });

  it("S3 — duplicate tickers make the block null (identity must be unique)", () => {
    expect(
      flowsFromCarriedBlock(variant((b) => { fund(b, 5).ticker = fund(b, 0).ticker; })),
    ).toBeNull();
  });

  it("S3 — funds: [] is a collection failure (null), not a measured-empty matrix", () => {
    // The producer always carries the full collected fund set; an empty array
    // means collection failed — the surface renders unavailable, never an
    // empty matrix that would read as "measured zero everywhere".
    expect(
      flowsFromCarriedBlock(variant((b) => { b.funds = []; })),
    ).toBeNull();
  });

  it("S3 — more than FLOW_FUND_MAX (64) funds is malformed; the bound is stated, never a truncation", () => {
    expect(FLOW_FUND_MAX).toBe(64);
    const many = variant((b) => {
      const first = fund(b, 0);
      b.funds = Array.from({ length: FLOW_FUND_MAX + 1 }, (_, i) => ({
        ticker: `F${i}`,
        flow_mn: { ...first.flow_mn },
      }));
    });
    expect(flowsFromCarriedBlock(many)).toBeNull();
    // Exactly at the bound is fine (11 real funds, far below it).
    const atBound = variant((b) => {
      const first = fund(b, 0);
      b.funds = Array.from({ length: FLOW_FUND_MAX }, (_, i) => ({
        ticker: `F${i}`,
        flow_mn: { ...first.flow_mn },
      }));
    });
    expect(flowsFromCarriedBlock(atBound)).not.toBeNull();
    expect(flowsFromCarriedBlock(atBound)!.rows).toHaveLength(FLOW_FUND_MAX);
  });

  it("S4 — the label must match the trading-day count exactly (1/3/5/10/21)", () => {
    // 1M labelled with 5 days — mismatch, malformed.
    expect(
      flowsFromCarriedBlock(
        variant((b) => { (b.windows as { label: string; trading_days: number }[])[4].trading_days = 5; }),
      ),
    ).toBeNull();
    // 1D labelled with 2 days — off-by-one, malformed.
    expect(
      flowsFromCarriedBlock(
        variant((b) => { (b.windows as { label: string; trading_days: number }[])[0].trading_days = 2; }),
      ),
    ).toBeNull();
    // Non-integer counts are malformed even when the integer part matches.
    expect(
      flowsFromCarriedBlock(
        variant((b) => { (b.windows as { label: string; trading_days: number }[])[4].trading_days = 21.5; }),
      ),
    ).toBeNull();
    expect(
      flowsFromCarriedBlock(
        variant((b) => { (b.windows as { label: string; trading_days: number }[])[2].trading_days = 2.5; }),
      ),
    ).toBeNull();
    // A string count is malformed.
    expect(
      flowsFromCarriedBlock(
        variant((b) => { (b.windows as { label: string; trading_days: unknown }[])[3].trading_days = "10"; }),
      ),
    ).toBeNull();
    // Labels are the closed UPPERCASE set — lowercase is unknown.
    expect(
      flowsFromCarriedBlock(
        variant((b) => { (b.windows as { label: string }[])[0].label = "1d"; }),
      ),
    ).toBeNull();
    // The unmutated contract table itself is exact (guard the guard).
    const windowsOf =
      (carriedFile.cases.realFull as { windows?: { label: string; trading_days: number }[] })
        .windows ?? [];
    expect(windowsOf).toHaveLength(5);
    for (const w of windowsOf) {
      expect(Number.isInteger(w.trading_days)).toBe(true);
    }
  });
});

describe("r2 — prototype-named keys, empty flow_mn, and real calendar dates", () => {
  const base = JSON.parse(JSON.stringify(carriedFile.cases.realFull)) as Record<string, unknown>;
  const variant = (mutate: (b: Record<string, unknown>) => void): unknown => {
    const b = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    mutate(b);
    return b;
  };
  const fund = (b: Record<string, unknown>, i: number) =>
    (b.funds as { ticker: string; flow_mn: Record<string, unknown> }[])[i]!;

  it("R2-N1 — prototype-named keys in flow_mn/net_flow_mn are NOT labels: the block is null", () => {
    for (const bad of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      // Own key on a plain object (JSON.parse would produce an own "__proto__").
      expect(
        flowsFromCarriedBlock(
          variant((b) => {
            fund(b, 0).flow_mn = { [bad]: 9 };
          }),
        ),
        bad,
      ).toBeNull();
      expect(
        flowsFromCarriedBlock(
          variant((b) => {
            b.net_flow_mn = { [bad]: 1 };
          }),
        ),
        `net ${bad}`,
      ).toBeNull();
    }
    // A window-label "constructor" in the windows array is equally refused.
    expect(
      flowsFromCarriedBlock(
        variant((b) => {
          (b.windows as { label: string }[])[0].label = "constructor";
        }),
      ),
    ).toBeNull();
  });

  it("S3 — flow_mn: [] is malformed (pins the non-object/array check: an empty array has no unknown keys)", () => {
    // With the Array.isArray check removed this exact input would be ACCEPTED
    // as an all-no-reading row — the [] case is the only pin for it.
    expect(
      flowsFromCarriedBlock(
        variant((b) => {
          fund(b, 2).flow_mn = [] as unknown as Record<string, unknown>;
        }),
      ),
    ).toBeNull();
  });

  it("R2-N5 — as_of must be a real calendar date, not ten digits with dashes", () => {
    for (const bad of [
      "2026-13-45", // both fields impossible
      "2026-13-01", // month 13
      "2026-00-10", // month 0
      "2026-02-30", // February 30
      "2026-02-29", // 2026 is not a leap year
      "2026-11-00", // day 0
      "2026-11-31", // November has 30 days
    ]) {
      expect(
        flowsFromCarriedBlock(variant((b) => { b.as_of = bad; })),
        bad,
      ).toBeNull();
    }
    // Real dates still pass, leap day included on a leap year.
    for (const good of ["2026-11-05", "2024-02-29", "2026-02-28"]) {
      expect(
        flowsFromCarriedBlock(variant((b) => { b.as_of = good; }))?.asof,
        good,
      ).toBe(good);
    }
  });
});
