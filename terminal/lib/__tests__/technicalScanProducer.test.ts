// The PRODUCER's own output through the reader (E01). `technical.producer.json` is written by
// ingest/gen_technical_scan.py over a hand-built data dir (tests/test_technical_scan_producer.py
// regenerates it and fails if it drifts), so this file pins that the two halves of the
// contract agree: every row the producer can emit parses, keeps its reason, and the four
// coverage populations sum to the requested universe.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TECHNICAL_PRODUCER_REASONS,
  accountTechnicalCoverage,
  classifyTechnical,
  parseTechnicalScan,
  technicalCellOf,
  type TechnicalScanSource,
} from "../technicalScan";

const FIXTURE = path.join(__dirname, "fixtures/screenerScan/technical.producer.json");
const raw = (): Record<string, unknown> & { rows: { sym: string }[] } => JSON.parse(readFileSync(FIXTURE, "utf8"));
// One day after the fixture's cutoff sessions (2026-10-09), ten hours after its generation.
const NOW = Date.parse("2026-10-11T12:00:00Z");

function source(): TechnicalScanSource {
  const r = parseTechnicalScan(raw());
  if (!r.ok) throw new Error(`producer fixture rejected: ${r.error}`);
  return { kind: "ready", scan: r.value };
}

// The producer's reason for each fixture name, and what the reader must report for it.
const EXPECTED: Record<string, [string, string]> = {
  NVDA: ["evaluated", "ok"],
  AAPL: ["evaluated", "ok"],
  "0700.HK": ["evaluated", "ok"],
  OLDERA: ["stale", "engine_mismatch"],          // a pre-fence slice is never pooled as current
  FLAGSHIP_LIVE: ["unsupported", "cutoff_unqualified"],
  LEGACY: ["unsupported", "cutoff_unqualified"],
  INVERTED: ["unsupported", "cutoff_unqualified"],
  LEAKY: ["unsupported", "not_leakfree"],
  "^TNX": ["unsupported", "rate_series"],
  DFII10: ["unsupported", "single_value_series"],
  NEWIPO: ["unavailable", "insufficient_history"],
  UNRUN: ["unavailable", "no_slice"],
  OPPONLY: ["unavailable", "no_slice"],
  GHOST: ["unavailable", "no_ohlc"],
  CORRUPT: ["unavailable", "slice_unreadable"],
  WRONGSYM: ["unavailable", "slice_unreadable"],
  BADSTATE: ["unavailable", "slice_unreadable"],
};

describe("technicalScan — the producer's own document", () => {
  it("parses whole, with no malformed row", () => {
    const s = source();
    if (s.kind !== "ready") throw new Error("not ready");
    expect(s.scan.universe.count).toBe(Object.keys(EXPECTED).length);
    expect(s.scan.rows.size).toBe(s.scan.universe.count);
    expect([...s.scan.rows.values()].filter((r) => r.kind === "malformed")).toEqual([]);
    expect(Object.keys(s.scan.timeframes)).toEqual(["3D"]);
  });

  it("classifies every name under the reason the producer gave it", () => {
    const s = source();
    for (const [sym, [status, reason]] of Object.entries(EXPECTED)) {
      expect(classifyTechnical(s, sym, "3D", NOW).coverage, sym).toEqual({ status, reason });
    }
  });

  it("emits every producer reason, and each sums into the requested universe", () => {
    const s = source();
    const acct = accountTechnicalCoverage(raw().rows.map((r) => r.sym), s, "3D", NOW);
    expect(acct.total).toBe(Object.keys(EXPECTED).length);
    expect(acct.evaluated + acct.stale + acct.unsupported + acct.unavailable).toBe(acct.total);
    const reasons = (st: "unsupported" | "unavailable") => Object.keys(acct.byReason[st]).sort();
    expect(reasons("unsupported")).toEqual([...TECHNICAL_PRODUCER_REASONS.unsupported].sort());
    // not_processed only appears in an incomplete generation; this one is complete
    expect(reasons("unavailable")).toEqual(
      TECHNICAL_PRODUCER_REASONS.unavailable.filter((r) => r !== "not_processed").sort());
  });

  it("carries the forming phase verbatim and a null field as field-unknown, not false", () => {
    const s = source();
    const hk = classifyTechnical(s, "0700.HK", "3D", NOW);
    expect(hk.observation?.cutoff).toEqual({ session: "2026-10-09", bar_open: "2026-10-09", bar_closed: false });
    expect(technicalCellOf(hk, "tech.barClosed")).toEqual({ known: true, value: false });
    expect(technicalCellOf(hk, "tech.lastSignal")).toEqual({ known: false, status: "evaluated", reason: "field_null" });
    const nv = classifyTechnical(s, "NVDA", "3D", NOW);
    expect(technicalCellOf(nv, "tech.barClosed")).toEqual({ known: true, value: true });
  });

  it("an unqualified slice yields no value to filter on", () => {
    const s = source();
    for (const sym of ["FLAGSHIP_LIVE", "LEGACY", "INVERTED"]) {
      const c = classifyTechnical(s, sym, "3D", NOW);
      expect(c.observation, sym).toBeNull();
      expect(technicalCellOf(c, "tech.position"), sym).toEqual({ known: false, status: "unsupported", reason: "cutoff_unqualified" });
    }
  });
});
