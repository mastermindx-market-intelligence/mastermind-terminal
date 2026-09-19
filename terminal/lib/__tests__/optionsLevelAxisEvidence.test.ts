import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TERMINAL = join(__dirname, "../..");
const EVIDENCE_DIR = join(TERMINAL, "docs/pr-crops/options-level-axis-labels");
const MANIFEST = JSON.parse(readFileSync(join(EVIDENCE_DIR, "manifest.json"), "utf8")) as {
  schema: string;
  sourceHead: string;
  classification: string;
  expectedLinePrices: number[];
  sourceFiles: Record<string, string>;
  captures: Array<{
    name: string;
    width: number;
    height: number;
    screenshot: string;
    sha256: string;
    consoleErrors: string[];
    pageErrors: string[];
    httpErrors: Array<{ status: number; url: string }>;
    proof: {
      exactLines: boolean;
      nativeAxisLabelsSuppressed: boolean;
      visibleOptionTagCount: number;
      overlaps: string[];
      labels: { timerOwner: string | null; optionTags: Array<{ key: string; price: number }> };
    };
  }>;
};
type AuditSummary = {
  schema: string;
  source_index_asof: string;
  counts: Record<string, number | Record<string, number>>;
  derived_counts: Record<string, number>;
  gex_200_no_oi_shell_rescue_roots: string[];
  reported_watchlist_sample: Record<string, { in_state_universe: boolean }>;
  ruling: { no_fabrication: string };
};
const AUDIT = JSON.parse(readFileSync(join(EVIDENCE_DIR, "coverage-audit-summary.json"), "utf8")) as AuditSummary;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function pngDimensions(path: string): [number, number] {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe("Options-level coverage and axis-label browser evidence", () => {
  it("binds the exact implementation files used by the five browser captures", () => {
    expect(MANIFEST.schema).toBe("mastermind.options_level_axis_evidence/v1");
    expect(MANIFEST.sourceHead).toMatch(/^[0-9a-f]{40}$/);
    expect(MANIFEST.classification).toBe(
      "LOCAL_BROWSER_WITH_INTERCEPTED_OPTIONS_CONTRACT_PAYLOADS_NOT_PRODUCTION_DATA",
    );
    expect(Object.keys(MANIFEST.sourceFiles).sort()).toEqual([
      "components/ChartPanel.tsx",
      "lib/optionsLevels.ts",
      "lib/priceTagPlacement.ts",
    ]);
    for (const [relative, expected] of Object.entries(MANIFEST.sourceFiles)) {
      const absolute = join(TERMINAL, relative);
      expect(existsSync(absolute), relative).toBe(true);
      expect(sha256(absolute), `${relative} changed without recapturing browser evidence`).toBe(expected);
    }
  });

  it("locks five substantive, clean captures with exact lines and collision-free badges", () => {
    expect(MANIFEST.expectedLinePrices).toEqual([192.42, 192.44, 192.46, 192.52, 192.58, 192.60]);
    expect(MANIFEST.captures.map((capture) => capture.name)).toEqual([
      "desktop", "tablet", "mobile", "desktop-left-percentage", "desktop-compact",
    ]);
    for (const capture of MANIFEST.captures) {
      const absolute = join(EVIDENCE_DIR, capture.screenshot);
      expect(existsSync(absolute), capture.screenshot).toBe(true);
      expect(readFileSync(absolute).byteLength, capture.screenshot).toBeGreaterThan(50_000);
      expect(sha256(absolute), capture.screenshot).toBe(capture.sha256);
      expect(pngDimensions(absolute), capture.screenshot).toEqual([capture.width, capture.height]);
      expect(capture.consoleErrors, capture.name).toEqual([]);
      expect(capture.pageErrors, capture.name).toEqual([]);
      expect(capture.httpErrors, capture.name).toEqual([]);
      expect(capture.proof).toMatchObject({
        exactLines: true,
        nativeAxisLabelsSuppressed: true,
        visibleOptionTagCount: 6,
        overlaps: [],
        labels: { timerOwner: "extended" },
      });
      expect(capture.proof.labels.optionTags.map((tag) => tag.key).sort()).toEqual([
        "abs_gamma", "call_wall", "em_hi", "em_lo", "gamma_flip", "put_wall",
      ]);
    }
  });

  it("records a complete 662-root census and keeps unsupported roots honestly absent", () => {
    expect(AUDIT.schema).toBe("mastermind.options_level_coverage_audit_summary/v1");
    expect(AUDIT.source_index_asof).toBe("2026-09-16T16:00:00-04:00");
    expect(AUDIT.counts).toMatchObject({
      roots: 662,
      gex_200: 350,
      gex_404: 312,
      moves_200: 349,
      moves_404: 313,
      any_signed_fillable_from_state: 343,
      all_signed_missing_but_any_state_fill: 319,
      em_valid: 349,
      em_missing: 313,
    });
    expect(AUDIT.derived_counts).toEqual({
      complete_signed_level_rescues: 319,
      gex_200_no_oi_shell_rescues: 7,
      missing_field_not_available_in_state: 34,
      partial_signed_level_rescues: 24,
    });
    expect(AUDIT.gex_200_no_oi_shell_rescue_roots).toEqual([
      "BABA", "GOOG", "INTC", "NFLX", "SPCX", "UBER", "WBS",
    ]);
    expect(AUDIT.reported_watchlist_sample.TSM).toEqual({ in_state_universe: false });
    expect(AUDIT.ruling.no_fabrication).toContain("remains absent");
  });
});
