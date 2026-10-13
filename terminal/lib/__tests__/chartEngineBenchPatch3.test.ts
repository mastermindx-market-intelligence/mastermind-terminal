// @vitest-environment jsdom
/**
 * chartEngineBenchPatch3.test.ts — PATCH3B review pins for ce-bench-rev3-1013.
 *
 * Each describe block is one review finding (F1 P1, F2 P2, ..., F7 P2).
 * Each block first pins the defect at H2 (RED) or confirms it was already
 * fixed at H2 (RESOLVED), with a deliberate mutant receipt quoted in
 * RESULT.md EVIDENCE.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  BUDGETS,
  METRIC_NAMES,
  buildReceipt,
  computeViolations,
  loadReceiptSchema,
  schemaBudgetMaxima,
  validateReceipt,
  type ReceiptMetrics,
} from "../chart-engine/bench/receipt";
import {
  DAILY_40K,
  buildDailyCorpus,
  frameDeltas,
  median,
  p95,
} from "../chart-engine/bench/corpus";

const TERMINAL_ROOT = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(TERMINAL_ROOT, "..");
const RECEIPTS_DIR = path.join(REPO_ROOT, "docs", "chart-engine-completion", "receipts");
const SCHEMA_PATH = path.join(REPO_ROOT, "docs", "chart-engine-completion", "performance-receipt.schema.json");

/** Filename ratchet (F4) — receipt-<impl>-<commit>-<host>.json, the schema carries no impl. */
const RECEIPT_NAME_RE = /^receipt-(mm|lwc)-[0-9a-f]{40}-[a-z0-9][a-z0-9-]*\.json$/;

/** UNMEASURED sentinel proposed by F1. Far above every budget, never zero. */
const UNMEASURED = 1e9;

const GREEN_METRICS: ReceiptMetrics = {
  first_paint_ms: 100,
  pan_frame_p95_ms: 16,
  zoom_frame_p95_ms: 16,
  live_commit_ms: 2,
  screenshot_ms: 20,
  heap_mb: 40,
};

function greenReceipt(overrides: Record<string, unknown> = {}) {
  return {
    commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    generated_at: "2026-10-13T00:00:00.000Z",
    host: { os: "linux test", cpu: "test cpu", dpr: 2 },
    corpus: { name: "daily-40k", bars: 40000 },
    metrics: { ...GREEN_METRICS },
    budget_ok: true,
    violations: [],
    ...overrides,
  };
}

// -------------------------------------------------------------------- F1 P1

describe("F1 P1 — unmeasured / refused metrics are recorded as UNMEASURED, never as a best-possible epsilon", () => {
  it("UNMEASURED sentinel is greater than every budget (so an unmeasured metric is always a violation)", () => {
    expect(UNMEASURED).toBeGreaterThan(Math.max(...Object.values(BUDGETS)));
  });

  it("p95([]) and median([]) are NOT the best-possible epsilon — they are an explicit UNMEASURED sentinel above every budget", () => {
    expect(p95([])).toBe(UNMEASURED);
    expect(median([])).toBe(UNMEASURED);
    expect(p95([])).toBeGreaterThan(BUDGETS.pan_frame_p95_ms);
    expect(p95([])).toBeGreaterThan(BUDGETS.zoom_frame_p95_ms);
    expect(p95([])).toBeGreaterThan(BUDGETS.live_commit_ms);
  });

  it("a run that measured nothing is NOT budget_ok and names every unmeasured metric", () => {
    const receipt = buildReceipt({
      commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      generated_at: "2026-10-13T00:00:00.000Z",
      host: { os: "linux", cpu: "cpu", dpr: 2 },
      metrics: {
        first_paint_ms: 120,
        pan_frame_p95_ms: p95(frameDeltas([])),
        zoom_frame_p95_ms: p95(frameDeltas([])),
        live_commit_ms: p95([]),
        screenshot_ms: p95([]),
        heap_mb: UNMEASURED,
      },
    });
    expect(receipt.budget_ok).toBe(false);
    expect(receipt.violations.map((v) => v.metric).sort()).toEqual(
      ["heap_mb", "live_commit_ms", "pan_frame_p95_ms", "screenshot_ms", "zoom_frame_p95_ms"],
    );
    // Schema-compatible: UNMEASURED is a finite positive number on a known metric name.
    expect(validateReceipt(receipt)).toEqual({ ok: true });
  });
});

// -------------------------------------------------------------------- F2 P2

describe("F2 P2 — a throwing rAF paint must NOT be recorded as a WORKING frame", () => {
  // F2 falsifier: a frame whose paint threw did no work. Counting it as work
  // would price a failure as a fast frame. The review reported that at H2 the
  // mount hook records the frame unconditionally.
  //
  // We assert via the SOURCE contract: the rAF wrapper in mount.ts must guard
  // `records.push` so a throwing callback never lands a record. We exercise
  // the wrapper logic directly (no real rAF) to avoid uncaught exceptions in
  // jsdom.

  it("the rAF wrapper source guards records.push on paint success (mount.ts source pin)", () => {
    const mountSrc = readFileSync(
      path.join(TERMINAL_ROOT, "lib", "chart-engine", "bench", "mount.ts"),
      "utf8",
    );
    // The wrapper currently looks like:
    //   const start = performance.now();
    //   invoke();
    //   const end = performance.now();
    //   records.push({ frameTs, start, end });
    // After the fix it must guard the push on paint success. We assert the
    // SOURCE: a line `if (painted) records.push(...)` (or with whitespace)
    // must appear in mount.ts.
    expect(
      /\bif\s*\(\s*painted\s*\)\s*records\.push\s*\(\s*\{\s*frameTs\s*,\s*start\s*,\s*end\s*\}\s*\)/.test(mountSrc),
      "mount.ts must contain `if (painted) records.push({ frameTs, start, end })` so a throwing paint is not recorded as work",
    ).toBe(true);
  });

  it("a paint that throws does not produce a frame record (logic-level falsifier)", () => {
    // Reproduce the wrapper logic from mount.ts:109-139 — the POST-FIX
    // shape — so we can pin the contract end-to-end. The mount.ts source
    // pin above pins the same property against the real source.
    type FrameRec = { frameTs: number; start: number; end: number };
    const records: FrameRec[] = [];
    let paintRefusalCount = 0;
    const refLog: string[] = [];
    const refuse = (m: string) => refLog.push(`refused:${m}`);

    // === FIXED wrapper logic (matches mount.ts:111-139) ===
    const wrapper = (cb: () => void): void => {
      const invoke = (): boolean => {
        try {
          cb();
          return true;
        } catch (err) {
          paintRefusalCount++;
          if (paintRefusalCount === 1) refuse("paint");
          return false;
        }
      };
      const start = 0;
      const painted = invoke();
      const end = 0;
      if (painted) records.push({ frameTs: 0, start, end });
    };
    // ===========================================================

    // Two throwing + one success.
    wrapper(() => {
      throw new RangeError("Maximum call stack size exceeded");
    });
    wrapper(() => {
      throw new RangeError("Maximum call stack size exceeded");
    });
    wrapper(() => {
      // success
    });

    // Pin the FIXED contract: one record (the success), exactly one
    // refused:paint line (the latch), and the counter says 2.
    expect(records, "frames whose paint threw must NOT be recorded as WORKING").toHaveLength(1);
    expect(refLog.filter((l) => l.startsWith("refused:paint")), "exactly one refused:paint line for the run (the latch)").toHaveLength(1);
    expect(paintRefusalCount, "the counter reflects every throwing paint").toBe(2);
  });
});

// -------------------------------------------------------------------- F3 P2

describe("F3 P2 — the mm zoom-anchor drift assertion is a no-op when no pointer/wheel handler is attached", () => {
  // F3 falsifier: a no-op engine cannot pass the "<=1 CSS px" law. At H2,
  // the mm engine has no wheel handler wired, so 60 wheel pulses produce 0
  // drift, and the assertion `<= 1` passes trivially. The receipt carries
  // the (vacuous) drift as a number the gate does not see.
  //
  // We pin the contract at three layers: (1) the MmBenchHook must expose
  // visibleLogicalRange(); (2) the bench spec must read it and assert the
  // span changed after wheel; (3) the helper that compares spans returns
  // false on identical spans, so the assertion is observable not vacuous.

  it("mount.ts exposes visibleLogicalRange() on the MmBenchHook (source pin)", () => {
    const mountSrc = readFileSync(
      path.join(TERMINAL_ROOT, "lib", "chart-engine", "bench", "mount.ts"),
      "utf8",
    );
    // The hook type must declare visibleLogicalRange returning { from, to } | null.
    expect(
      /visibleLogicalRange\s*\(\s*\)\s*:\s*\{\s*from:\s*number;\s*to:\s*number[;\s]*\}\s*\|\s*null/.test(mountSrc),
      "mount.ts must declare visibleLogicalRange(): { from: number; to: number } | null on the MmBenchHook",
    ).toBe(true);
    // And the implementation must read timeScale().getVisibleLogicalRange().
    expect(mountSrc).toMatch(/getVisibleLogicalRange\s*\(\s*\)/);
  });

  it("bench spec reads visibleLogicalRange before and after wheel zoom (source pin)", () => {
    const benchSrc = readFileSync(
      path.join(TERMINAL_ROOT, "bench", "chart-engine.bench.ts"),
      "utf8",
    );
    // After the fix, the bench spec must read the visible logical range
    // around the wheel loop and assert it actually changed.
    expect(benchSrc).toMatch(/rangeBeforeZoom/);
    expect(benchSrc).toMatch(/rangeAfterZoom/);
    expect(benchSrc).toMatch(/zoomChangedSpan\s*\(\s*rangeBeforeZoom\s*,\s*rangeAfterZoom\s*\)/);
  });

  it("helper compares visible logical ranges by whitespace-free span delta", () => {
    type VisRange = { from: number; to: number } | null;
    const rangeBeforeZoom: VisRange = { from: 0, to: 100 };
    // No-op engine: identical span after the wheel pulses.
    const rangeAfterZoom: VisRange = { from: 0, to: 100 };
    const spanChanged = (a: VisRange, b: VisRange): boolean => {
      if (a == null || b == null) return false;
      return Math.abs((a.to - a.from) - (b.to - b.from)) > 1e-6;
    };
    expect(spanChanged(rangeBeforeZoom, rangeAfterZoom)).toBe(false);
    // And a real change passes the helper.
    expect(spanChanged({ from: 0, to: 100 }, { from: 5, to: 90 })).toBe(true);
  });
});

// -------------------------------------------------------------------- F4 P2

describe("F4 P2 — a committed receipt must match the (impl-commit-host) filename contract", () => {
  // F4 falsifier: schema has no impl field, so the only impl identity is
  // the filename. A misnamed receipt (lwc saved as receipt-mm-…) would
  // pass the A3 gate as a green mm receipt.

  it("the A3 gate in chartEngineBench.test.ts cross-checks the filename contract (source pin)", () => {
    // The fix lives in the existing A3 gate — the gate must read each
    // filename through the contract regex before declaring it green. This
    // pin is RED at H2 (the gate keys off file.startsWith("receipt-mm-")
    // alone) and GREEN after the fix.
    const testSrc = readFileSync(
      path.join(TERMINAL_ROOT, "lib", "__tests__", "chartEngineBench.test.ts"),
      "utf8",
    );
    expect(testSrc).toMatch(/RECEIPT_NAME_RE/);
    expect(testSrc).toMatch(/misnamed/);
  });

  it("every committed receipt filename matches receipt-<mm|lwc>-<40-hex>-<host>.json", () => {
    expect(existsSync(RECEIPTS_DIR), "docs/chart-engine-completion/receipts/ must exist").toBe(true);
    const files = readdirSync(RECEIPTS_DIR).filter((f) => f.endsWith(".json")).sort();
    const misnamed: string[] = [];
    for (const file of files) {
      if (!RECEIPT_NAME_RE.test(file)) misnamed.push(file);
    }
    expect(misnamed, `receipt filenames must match the contract:\n${misnamed.join("\n")}`).toEqual([]);
  });

  it("an unknown impl is NOT schema-rejectable today (the filename is the only impl identity)", () => {
    // The schema does not include `impl` in required/properties, so an
    // arbitrary `corpus.name` cannot be rejected as an unknown impl. The
    // stopgap is the filename ratchet above.
    const receipt = greenReceipt({ corpus: { name: "wat", bars: 1 } });
    const result = validateReceipt(receipt);
    expect(result.ok).toBe(true);
  });

  it("demonstrates the A3 key check at H2 is lax (proves the filename ratchet is needed)", () => {
    // A lwc-shaped receipt named receipt-mm-… passes the existing A3 gate
    // because the gate keys only off `file.startsWith("receipt-mm-")`.
    const lwcShape = {
      commit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      generated_at: "2026-10-13T00:00:00.000Z",
      host: { os: "linux test", cpu: "test cpu", dpr: 2 },
      corpus: { name: "daily-40k", bars: 40000 },
      metrics: GREEN_METRICS,
      budget_ok: true,
      violations: [],
    };
    // Pin: the A3 key check at H2 is `file.startsWith("receipt-mm-")`
    // (string match, no contract). The new gate keys on the contract regex.
    expect("receipt-mm-deadbeefdeadbeefdeadbeefdeadbeefdeadbeef-host.json".startsWith("receipt-mm-")).toBe(true);
    // But the same name MUST also pass the strict regex.
    expect(
      RECEIPT_NAME_RE.test("receipt-mm-deadbeefdeadbeefdeadbeefdeadbeefdeadbeef-host.json"),
      "the contract regex admits the canonical form",
    ).toBe(true);
    // A bad name (40-hex missing or impl wrong) MUST fail the strict regex.
    expect(RECEIPT_NAME_RE.test("receipt-mm-deadbeefhost.json")).toBe(false);
    expect(RECEIPT_NAME_RE.test("receipt-wat-deadbeefdeadbeefdeadbeefdeadbeefdeadbeef-host.json")).toBe(false);
  });
});

// -------------------------------------------------------------------- F5 P2

describe("F5 P2 — the harness must assert devicePixelRatio = 2 (B5 dimensions depend on it)", () => {
  // F5 falsifier: at H2 the bench spec launches a context with
  // deviceScaleFactor: 2 but never asserts that the PAGE actually sees
  // devicePixelRatio === 2. A misconfigured host would still produce a
  // schema-valid receipt with screenshot_ms measured on a quarter of the
  // expected pixels.

  it("the bench config pins deviceScaleFactor: 2 (sanity)", () => {
    // The fix lives in the bench spec; this test pins the source-of-truth
    // contract so a future edit cannot silently drop the dpr.
    const cfgPath = path.join(TERMINAL_ROOT, "playwright.bench.config.ts");
    expect(existsSync(cfgPath)).toBe(true);
    const text = readFileSync(cfgPath, "utf8");
    expect(text).toMatch(/deviceScaleFactor:\s*2/);
  });

  it("the bench spec asserts window.devicePixelRatio === 2 in the page (source pin)", () => {
    // After the fix, the bench spec reads window.devicePixelRatio and
    // expects 2 — so a dpr-1 run reddens. Strip line comments so a comment
    // cannot hide the assertion from the regex (F5 mutant test would
    // otherwise pass after dropping the .toBe(2) in favour of
    // .toBeGreaterThan(0)).
    const raw = readFileSync(
      path.join(TERMINAL_ROOT, "bench", "chart-engine.bench.ts"),
      "utf8",
    );
    const benchSrc = raw
      .split("\n")
      .map((line) => {
        const i = line.indexOf("//");
        return i >= 0 ? line.slice(0, i) : line;
      })
      .join("\n");
    expect(benchSrc).toMatch(/window\.devicePixelRatio/);
    expect(benchSrc).toMatch(/expect\(\s*dpr\s*,\s*`deviceScaleFactor must reach the page/);
    expect(benchSrc).toMatch(/\.toBe\(2\)/);
  });

  it("a dpr-1 source would be flagged by the new bench-side assertion (logic)", () => {
    // Standalone check on the assertion semantics.
    const seenDpr: number = 1; // simulated dpr-1 page
    const ok: boolean = seenDpr === 2;
    expect(ok, "a dpr-1 page must fail the new bench-side assertion").toBe(false);
  });
});

// -------------------------------------------------------------------- F6 P2

describe("F6 P2 — bench.md 'promote ajv to devDependencies' is wrong; ajv is a real runtime dep of /api/flow", () => {
  it("ajv and ajv-formats are listed in terminal/package.json dependencies (NOT devDependencies)", () => {
    const pkgPath = path.join(TERMINAL_ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    // Pin: ajv + ajv-formats live in dependencies.
    expect(pkg.dependencies?.["ajv"]).toMatch(/^\^?8\./);
    expect(pkg.dependencies?.["ajv-formats"]).toMatch(/^\^?/);
    // Pin: NOT in devDependencies (moving them would break `/api/flow`).
    expect(pkg.devDependencies?.["ajv"]).toBeUndefined();
    expect(pkg.devDependencies?.["ajv-formats"]).toBeUndefined();
  });

  it("/api/flow's runtime path imports ajv via lib/optionsAlphaCandidatePair.ts", () => {
    const flow = readFileSync(path.join(TERMINAL_ROOT, "app", "api", "flow", "route.ts"), "utf8");
    expect(flow).toMatch(/optionsAlphaCandidatePair/);
    const lib = readFileSync(
      path.join(TERMINAL_ROOT, "lib", "optionsAlphaCandidatePair.ts"),
      "utf8",
    );
    expect(lib).toMatch(/ajv\/dist\/2020/);
    expect(lib).toMatch(/ajv-formats/);
  });

  it("bench.md does NOT instruct readers to move ajv to devDependencies (source pin)", () => {
    // The fix rewrites bench.md so the follow-up no longer tells the next
    // wave to break a production route. After the fix, the doc explains
    // ajv is a real runtime dependency and MUST stay in dependencies.
    const docSrc = readFileSync(
      path.join(REPO_ROOT, "docs", "chart-engine-completion", "bench.md"),
      "utf8",
    );
    expect(docSrc).toMatch(/Do NOT move them to `devDependencies`/);
    // And the literal "promote them to `devDependencies`" line is gone.
    expect(docSrc).not.toMatch(/promote them to\s*\n?\s*`devDependencies`/);
  });
});

// -------------------------------------------------------------------- F7 P2

describe("F7 P2 — one 12-minute test must split into independent impls × RUNS measurements with a tunable soak", () => {
  it("the bench spec timeout is computed from IMPLS × RUNS × per-run minutes, not pinned to 12 minutes", () => {
    // The fix scales the timeout with the work. Today, the timeout is
    // `12 * 60 * 1000` regardless of how many impls/runs are queued. Pin
    // that an impls * runs * perRunMinutes * 60s formula exists in the
    // source so a future edit cannot silently drop the cap.
    const cfgPath = path.join(TERMINAL_ROOT, "playwright.bench.config.ts");
    const text = readFileSync(cfgPath, "utf8");
    expect(text).toMatch(/timeout:\s*impls\s*\*\s*runs\s*\*\s*PER_RUN_MINUTES\s*\*\s*60\s*\*\s*1000/);
  });

  it("the bench spec reads BENCH_SOAK (default 50) instead of hardcoding the loop count", () => {
    const benchPath = path.join(TERMINAL_ROOT, "bench", "chart-engine.bench.ts");
    const text = readFileSync(benchPath, "utf8");
    expect(text).toMatch(/SOAK_SWITCHES\s*=\s*Math\.max\(\s*2\s*,\s*Number\(process\.env\.BENCH_SOAK\s*\?\?\s*50\s*\)\)/);
    expect(text).toMatch(/for\s*\(\s*let\s+i\s*=\s*1\s*;\s*i\s*<=\s*SOAK_SWITCHES\s*;\s*i\+\+\)/);
  });
});