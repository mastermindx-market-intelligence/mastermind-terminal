// The Screener's technical controls → the frozen TechnicalScreen contract (E01).
// Pins that the UI encodes ONLY contract-valid predicates (each round-trips through
// parseTechnicalScreen), that every control maps to a published state field verbatim, and that
// the coverage strip's numbers obey the AC-E01-02 sum invariant over the requested universe.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COVERAGE_STATUSES, passes } from "../screenerScan";
import {
  evaluateTechnicalScreen,
  parseTechnicalScan,
  parseTechnicalScreen,
  type TechnicalScanSource,
} from "../technicalScan";
import {
  TECH_BUYSIDE,
  TECH_CHIP_IDS,
  TECH_DEFAULT_CONTROLS,
  TECH_DEFAULT_TF,
  TECH_SIGNAL_PICKS,
  techControlsActive,
  technicalCoverageSummary,
  technicalScreenOf,
  toggleTechChip,
  type TechControls,
} from "../technicalScreenControls";

const FIXTURE = path.join(__dirname, "fixtures/screenerScan/technical.producer.json");
const NOW = Date.parse("2026-10-11T12:00:00Z");
function source(): TechnicalScanSource {
  const r = parseTechnicalScan(JSON.parse(readFileSync(FIXTURE, "utf8")));
  if (!r.ok) throw new Error(`producer fixture rejected: ${r.error}`);
  return { kind: "ready", scan: r.value };
}
const ALL = (): string[] => {
  const s = source();
  if (s.kind !== "ready") throw new Error("not ready");
  return [...s.scan.rows.keys()];
};
const ctl = (p: Partial<TechControls>): TechControls => ({ ...TECH_DEFAULT_CONTROLS, ...p });

describe("technicalScreenOf — controls → TechnicalScreen", () => {
  it("defaults screen nothing at the 3D scan timeframe", () => {
    expect(TECH_DEFAULT_TF).toBe("3D");
    expect(technicalScreenOf(TECH_DEFAULT_CONTROLS)).toEqual({ tf: "3D", predicates: [] });
    expect(techControlsActive(TECH_DEFAULT_CONTROLS)).toBe(false);
    // the timeframe and the unknown policy alone are not a screen
    expect(techControlsActive(ctl({ tf: "W", includeUnknown: true }))).toBe(false);
  });

  it("maps each control to one source field, verbatim", () => {
    expect(technicalScreenOf(ctl({ position: "long" })).predicates).toEqual([{ field: "tech.position", op: "in", values: ["long"] }]);
    expect(technicalScreenOf(ctl({ signal: "SELL" })).predicates).toEqual([{ field: "tech.lastSignal", op: "in", values: ["SELL"] }]);
    expect(technicalScreenOf(ctl({ signal: "buyside" })).predicates).toEqual([{ field: "tech.lastSignal", op: "in", values: [...TECH_BUYSIDE] }]);
    expect(technicalScreenOf(ctl({ barsMax: 10 })).predicates).toEqual([{ field: "tech.barsSinceSignal", op: "range", lte: 10 }]);
    expect(technicalScreenOf(ctl({ chips: ["notOverbought"] })).predicates).toEqual([{ field: "tech.overbought", op: "is", value: false }]);
    expect(technicalScreenOf(ctl({ chips: ["barClosed"] })).predicates).toEqual([{ field: "tech.barClosed", op: "is", value: true }]);
    for (const p of [ctl({ position: "flat" }), ctl({ signal: "BUY" }), ctl({ barsMax: 3 }), ctl({ chips: ["above200"] })]) {
      expect(techControlsActive(p)).toBe(true);
    }
  });

  it("carries the include-unknown opt-in on EVERY predicate, and never by default", () => {
    const all = ctl({ position: "long", signal: "buyside", barsMax: 20, chips: [...TECH_CHIP_IDS] });
    expect(technicalScreenOf(all).predicates.every((p) => !("includeUnknown" in p))).toBe(true);
    const inc = technicalScreenOf({ ...all, includeUnknown: true });
    expect(inc.predicates.length).toBe(3 + TECH_CHIP_IDS.length);
    expect(inc.predicates.every((p) => "includeUnknown" in p && p.includeUnknown === true)).toBe(true);
  });

  it("every screen the controls can express is a contract-valid screen (round-trips the parser)", () => {
    for (const signal of TECH_SIGNAL_PICKS) {
      for (const position of ["any", "long", "flat"] as const) {
        for (const barsMax of [0, 3, 10, 20] as const) {
          for (const includeUnknown of [false, true]) {
            const screen = technicalScreenOf(ctl({ signal, position, barsMax, includeUnknown, chips: [...TECH_CHIP_IDS] }));
            const parsed = parseTechnicalScreen(JSON.parse(JSON.stringify(screen)));
            expect(parsed).toEqual({ ok: true, value: screen });
          }
        }
      }
    }
  });

  it("toggleTechChip adds and removes without duplicates", () => {
    expect(toggleTechChip([], "weeklyBull")).toEqual(["weeklyBull"]);
    expect(toggleTechChip(["weeklyBull", "above200"], "weeklyBull")).toEqual(["above200"]);
  });
});

describe("technical screen over the producer's own document", () => {
  const verdicts = (c: TechControls) => {
    const s = source();
    const screen = technicalScreenOf(c);
    return Object.fromEntries(ALL().map((sym) => [sym, evaluateTechnicalScreen(s, sym, screen, NOW).match]));
  };

  it("a known value passes or fails; a name not evaluated is UNKNOWN, never a negative", () => {
    const v = verdicts(ctl({ signal: "buyside" }));
    expect(v.NVDA).toBe("pass");          // BUY
    expect(v.AAPL).toBe("fail");          // SELL — a known contradiction
    expect(v["0700.HK"]).toBe("unknown"); // evaluated, but the engine published no signal
    expect(v.OLDERA).toBe("unknown");     // stale (engine_mismatch) — never filtered as current
    expect(v.FLAGSHIP_LIVE).toBe("unknown");
    expect(v.GHOST).toBe("unknown");
    expect(ALL().filter((s) => passes(v[s]))).toEqual(["NVDA"]);
  });

  it("include-unknown lets the not-evaluated names through but keeps the known failure out", () => {
    const v = verdicts(ctl({ signal: "buyside", includeUnknown: true }));
    expect(v.AAPL).toBe("fail");
    expect(v.NVDA).toBe("pass");
    expect(v.OLDERA).toBe("pass");
    expect(v.GHOST).toBe("pass");
  });

  it("the completed-bar chip reads the producer's bar_closed, so a forming-bar name fails", () => {
    const v = verdicts(ctl({ chips: ["barClosed"] }));
    expect(v.NVDA).toBe("pass");
    expect(v["0700.HK"]).toBe("fail"); // bar_closed === false is a published fact
  });
});

describe("technicalCoverageSummary — AC-E01-02", () => {
  it("evaluated + stale + unsupported + unavailable === requested, names absent from the scan included", () => {
    const requested = [...ALL(), "NOT_IN_SCAN_1", "NOT_IN_SCAN_2", "NVDA" /* duplicate */];
    const { account, forming } = technicalCoverageSummary(requested, source(), "3D", NOW);
    expect(account.total).toBe(ALL().length + 2);
    expect(COVERAGE_STATUSES.reduce((n, st) => n + account[st], 0)).toBe(account.total);
    expect(account.evaluated).toBe(3); // NVDA, AAPL, 0700.HK
    expect(account.stale).toBe(1);     // OLDERA
    expect(account.byReason.unavailable.not_in_scan).toBe(2);
    for (const st of COVERAGE_STATUSES) {
      expect(Object.values(account.byReason[st]).reduce((a, b) => a + b, 0)).toBe(account[st]);
    }
    expect(forming).toBe(1); // 0700.HK: producer-published bar_closed === false
  });

  it("a timeframe the scan did not produce makes every requested name unsupported — nothing is inferred", () => {
    const { account, forming } = technicalCoverageSummary(ALL(), source(), "W", NOW);
    expect(account.unsupported).toBe(account.total);
    expect(account.byReason.unsupported).toEqual({ timeframe_not_produced: account.total });
    expect(forming).toBe(0);
  });

  it("an absent or unreadable scan accounts every name as unavailable", () => {
    expect(technicalCoverageSummary(["A", "B"], { kind: "absent" }, "3D", NOW).account.byReason.unavailable).toEqual({ scan_absent: 2 });
    expect(technicalCoverageSummary(["A"], { kind: "error", error: "x" }, "3D", NOW).account.byReason.unavailable).toEqual({ scan_unavailable: 1 });
  });
});
