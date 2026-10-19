// E02 — the nightly producer (scripts/gen_fundamental_scan.ts) over a real temp data dir:
// manifest → per-symbol fund.json → one validated scan/fundamental.json + receipt. Asserts the
// universe partition, the adoption guard, atomic publication and the byte-stable wire form.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFundamentalScan, classifyFundamental } from "@/lib/fundamentalScan";
import { projectFundamental } from "@/lib/fundamentalScanProducer";
import {
  buildFundamentalScan,
  classifySymbol,
  compactObservation,
  encode,
  parseArgs,
  parseNow,
  publish,
  RECEIPT_FILENAME,
  runFundamentalScan,
  SCAN_DIRNAME,
  SCAN_FILENAME,
  validateFundamentalScan,
} from "@/scripts/gen_fundamental_scan";
import { fundDoc, JUNCO_ANNUAL, SEPCO_ANNUAL } from "./fixtures/fundamentalScan/fundDoc";

const NOW = Date.parse("2026-10-11T00:00:00Z") / 1000;
let dir = "";

function seed(d: string): void {
  writeFileSync(join(d, "manifest.json"), JSON.stringify({
    as_of: "2026-10-09",
    symbols: {
      SEPCO: { sec: "Equities" },
      JUNCO: { sec: "Equities" },
      "BTC-USD": { sec: "Crypto" },
      NOFILE: { sec: "Equities" },
      BADJSON: { sec: "Equities" },
      WRONGTICK: { sec: "Equities" },
      LEGACY: {},
    },
  }));
  writeFileSync(join(d, "SEPCO.fund.json"), JSON.stringify(fundDoc("SEPCO", { pe: 25.5, annual: SEPCO_ANNUAL })));
  writeFileSync(join(d, "JUNCO.fund.json"), JSON.stringify(fundDoc("JUNCO", { pe: 14, annual: JUNCO_ANNUAL })));
  writeFileSync(join(d, "BADJSON.fund.json"), "{not json");
  writeFileSync(join(d, "WRONGTICK.fund.json"), JSON.stringify(fundDoc("OTHER", { annual: SEPCO_ANNUAL })));
  writeFileSync(join(d, "LEGACY.fund.json"), JSON.stringify(fundDoc("LEGACY", { annual: null, pe: 11 })));
  // A crypto symbol with a stray fund file is still out of scope (design-level reason first).
  writeFileSync(join(d, "BTC-USD.fund.json"), JSON.stringify(fundDoc("BTC-USD", { annual: SEPCO_ANNUAL })));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "e02-fundscan-"));
  seed(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const scanPath = () => join(dir, SCAN_DIRNAME, SCAN_FILENAME);
const receiptOf = () => JSON.parse(readFileSync(join(dir, SCAN_DIRNAME, RECEIPT_FILENAME), "utf8"));

describe("classifySymbol — one row per manifest key, reason order is contract", () => {
  it.each([
    ["BTC-USD", { sec: "Crypto" }, { status: "unsupported", reason: "asset_class_not_covered" }],
    ["NOFILE", { sec: "Equities" }, { status: "unavailable", reason: "fund_absent" }],
    ["BADJSON", { sec: "Equities" }, { status: "unavailable", reason: "fund_unreadable" }],
    ["WRONGTICK", { sec: "Equities" }, { status: "unavailable", reason: "fund_malformed" }],
    ["../manifest", { sec: "Equities" }, { status: "unavailable", reason: "fund_absent" }],
  ])("%s → %o", (sym, row, expected) => {
    expect(classifySymbol(dir, sym, row)).toEqual(expected);
  });

  it("an equity row is exactly the shared projector's observation", () => {
    const raw = JSON.parse(readFileSync(join(dir, "SEPCO.fund.json"), "utf8"));
    expect(classifySymbol(dir, "SEPCO", { sec: "Equities" })).toEqual(projectFundamental("SEPCO", raw).observation);
  });
});

describe("buildFundamentalScan", () => {
  it("emits sorted rows covering the whole manifest; the consumer accepts it", () => {
    const doc = buildFundamentalScan(dir, NOW);
    expect(doc.rows.map((r) => r.sym)).toEqual(["BADJSON", "BTC-USD", "JUNCO", "LEGACY", "NOFILE", "SEPCO", "WRONGTICK"]);
    expect(doc).toMatchObject({ generation: NOW, generated_at: "2026-10-11T00:00:00Z", complete: true, universe: { source: "manifest", as_of: "2026-10-09", count: 7 } });
    expect(validateFundamentalScan(doc)).toBeNull();
    const legacy = doc.rows.find((r) => r.sym === "LEGACY");
    // no annual statements: P/E still valued, fiscal-year fields withheld — not filled from TTM
    expect(legacy).toMatchObject({ status: "observed", f: { "fund.pe_ttm": { v: 11 }, "fund.net_margin_fy": { s: "unavailable", r: "no_annual_statements" } } });
    expect(legacy && "fy" in legacy).toBe(false); // compact wire form omits a null fiscal year
  });

  it("a --limit run marks the rest not_processed and publishes complete:false", () => {
    const doc = buildFundamentalScan(dir, NOW, { limit: 3 });
    expect(doc.complete).toBe(false);
    expect(doc.rows.slice(3).every((r) => r.status === "unavailable" && r.reason === "not_processed")).toBe(true);
    expect(doc.rows).toHaveLength(7);
    expect(validateFundamentalScan(doc)).toBeNull();
  });

  it("a budget overrun stops classifying but still emits every row", () => {
    let t = 0;
    const doc = buildFundamentalScan(dir, NOW, { budgetSeconds: 1, clock: () => (t += 0.6) });
    expect(doc.complete).toBe(false);
    expect(doc.rows.filter((r) => r.reason === "not_processed").length).toBeGreaterThan(0);
    expect(doc.rows).toHaveLength(7);
  });

  it("the compact wire form parses to the same observation as the uncompacted projection", () => {
    const raw = JSON.parse(readFileSync(join(dir, "SEPCO.fund.json"), "utf8"));
    const full = { sym: "SEPCO", ...projectFundamental("SEPCO", raw).observation };
    const compact = { sym: "SEPCO", ...compactObservation(projectFundamental("SEPCO", raw).observation) };
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length);
    const wrap = (row: unknown) => parseFundamentalScan({ ...buildFundamentalScan(dir, NOW), universe: { source: "manifest", as_of: "2026-10-09", count: 1 }, rows: [row] });
    const a = wrap(full);
    const b = wrap(compact);
    if (!a.ok || !b.ok) throw new Error("parse failed");
    expect(b.value.rows.get("SEPCO")).toEqual(a.value.rows.get("SEPCO"));
  });
});

describe("publish — adoption guard, atomic write, receipt", () => {
  it("first publish writes the scan and a receipt whose sha256 is the file's", () => {
    const r = publish(dir, buildFundamentalScan(dir, NOW));
    expect(r).toMatchObject({ decision: "first", published: true, error: null, held_generation: null });
    const bytes = readFileSync(scanPath());
    expect(r.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(r.live_sha256).toBe(r.sha256);
    expect(receiptOf()).toMatchObject({ decision: "first", published: true, by_status: { observed: 3, unsupported: 1, unavailable: 3 } });
    // no temp file is left behind in the hardlinked data dir
    expect(readdirSync(join(dir, SCAN_DIRNAME)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("never replaces a held generation with the same or an older one", () => {
    publish(dir, buildFundamentalScan(dir, NOW));
    const before = readFileSync(scanPath());
    expect(publish(dir, buildFundamentalScan(dir, NOW)).decision).toBe("not_newer");
    expect(publish(dir, buildFundamentalScan(dir, NOW - 86_400)).decision).toBe("not_newer");
    expect(readFileSync(scanPath()).equals(before)).toBe(true);
  });

  it("an incomplete run never replaces a complete generation; a newer complete one does", () => {
    publish(dir, buildFundamentalScan(dir, NOW));
    const before = readFileSync(scanPath());
    const partial = publish(dir, buildFundamentalScan(dir, NOW + 60, { limit: 2 }));
    expect(partial).toMatchObject({ decision: "incomplete_over_complete", published: false });
    expect(partial.live_generation).toEqual({ generation: NOW, complete: true });
    expect(readFileSync(scanPath()).equals(before)).toBe(true);
    expect(publish(dir, buildFundamentalScan(dir, NOW + 120)).decision).toBe("newer_complete");
  });

  it("an invalid document is refused, never written", () => {
    const doc = buildFundamentalScan(dir, NOW);
    doc.rows[0] = { ...doc.rows[0], reason: "scan_absent" } as typeof doc.rows[0];
    const r = publish(dir, doc);
    expect(r).toMatchObject({ decision: "invalid_incoming", published: false, error: "row_malformed:reason_reserved" });
    expect(existsSync(scanPath())).toBe(false);
  });
});

describe("runFundamentalScan / CLI", () => {
  it("exit 0 on a published run; the scan screens through the consumer end-to-end", () => {
    const res = runFundamentalScan({ dataDir: dir, now: NOW });
    expect(res.code).toBe(0);
    expect(res.line).toMatch(/rows=7 observed=3 unsupported=1 unavailable=3 decision=first published=true/);
    const parsed = parseFundamentalScan(JSON.parse(readFileSync(scanPath(), "utf8")));
    if (!parsed.ok) throw new Error(parsed.error);
    const c = classifyFundamental({ kind: "ready", scan: parsed.value }, "JUNCO", "fund.revenue_growth_fy", NOW * 1000);
    expect(c.value).toBe(-0.1);
    expect(c.row?.fy).toMatchObject({ label: "FY2025", end: "2025-06-30", src: "10-K", filed: "2025-08-19", restated: true });
    expect(c.row?.prior).toEqual({ label: "FY2024", end: "2024-06-30" });
  });

  it("exit 2 with an aborted receipt when the manifest is unreadable; the held scan survives", () => {
    runFundamentalScan({ dataDir: dir, now: NOW });
    const before = readFileSync(scanPath());
    writeFileSync(join(dir, "manifest.json"), "{");
    const res = runFundamentalScan({ dataDir: dir, now: NOW + 60 });
    expect(res.code).toBe(2);
    expect(res.receipt).toMatchObject({ decision: "invalid_incoming", published: false, error: "aborted:SyntaxError" });
    expect(readFileSync(scanPath()).equals(before)).toBe(true);
  });

  it("a not_newer rerun is exit 0 — nothing wrong, nothing new, the held scan stays live", () => {
    runFundamentalScan({ dataDir: dir, now: NOW });
    const again = runFundamentalScan({ dataDir: dir, now: NOW });
    expect(again.code).toBe(0);
    expect(again.receipt).toMatchObject({ decision: "not_newer", published: false, live_generation: { generation: NOW, complete: true } });
  });

  it("parses flags and --now forms", () => {
    expect(parseArgs(["--data-dir", dir, "--limit=5", "--budget-seconds", "600", "--now", "2026-10-11T00:00:00Z"]))
      .toEqual({ dataDir: dir, limit: 5, budgetSeconds: 600, now: NOW });
    expect(() => parseArgs(["--limit", "-1"])).toThrow(/non-negative/);
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown argument/);
    expect(parseNow(String(NOW))).toBe(NOW);
    expect(parseNow("2026-10-11T00:00:00")).toBe(NOW);
    expect(() => parseNow("tomorrow")).toThrow(/--now/);
  });

  it("encode is byte-stable regardless of key insertion order", () => {
    expect(encode({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }).toString()).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}\n');
  });
});

describe("golden wire fixture", () => {
  it("the producer's bytes for the fixed dataset match fixtures/fundamentalScan/scan.golden.json", () => {
    const golden = join(__dirname, "fixtures", "fundamentalScan", "scan.golden.json");
    const bytes = encode(buildFundamentalScan(dir, NOW));
    if (process.env.UPDATE_FUNDAMENTAL_GOLDEN === "1") {
      mkdirSync(join(__dirname, "fixtures", "fundamentalScan"), { recursive: true });
      writeFileSync(golden, bytes);
    }
    expect(bytes.toString("utf8")).toBe(readFileSync(golden, "utf8"));
  });
});
