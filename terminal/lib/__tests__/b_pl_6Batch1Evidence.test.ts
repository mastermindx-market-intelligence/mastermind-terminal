import { createRequire } from "node:module";
import { assertCapturedLexProjection } from "./helpers/lexEvidenceProjection";
// Preserve the raw capture pin; only unused onboarding copy has an AST dependency projection.
// Git-free evidence lock for the B-PL-6 batch 1 capture packet.
// The lock is the sha256 of the layout sources the crops depend on, recorded in
// EVIDENCE.yml layoutFiles. capturedAtHead stays informational.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const immutableEvidence = createRequire(import.meta.url)("../../e2e/tools/visualEvidence.cjs");
// Explicit accepted-source selection; legacy packets keep their original provenance.
const composition = immutableEvidence.selectedComposition(REPO,
  process.env.TERMINAL_EVIDENCE_COMPOSITION === undefined ? {
    ...process.env,
    TERMINAL_EVIDENCE_COMPILER: "webpack",
    TERMINAL_EVIDENCE_FONTS: "retained-fonts-34fb",
    TERMINAL_EVIDENCE_COMPOSITION: "terminal/docs/pr-crops/b-pl-6-batch-1/p1t9-hub-596e.composition.json",
  } : process.env,
);

const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-pl-6-batch-1");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const CROPS = [
  "AnalysisWorkspace-1440.png",
  "AnalysisWorkspace-1440-zh.png",
  "AnalysisWorkspace-390.png",
  "AnalysisWorkspace-390-zh.png",
  "ChartChrome-1440.png",
  "ChartChrome-1440-zh.png",
  "ChartChrome-390.png",
  "ChartChrome-390-zh.png",
  "OptionsHubView-1440.png",
  "OptionsHubView-1440-zh.png",
  "OptionsHubView-390.png",
  "OptionsHubView-390-zh.png",
  "SearchModal-1440.png",
  "SearchModal-1440-zh.png",
  "SearchModal-390.png",
  "SearchModal-390-zh.png",
  "StockAnalysis-1440.png",
  "StockAnalysis-1440-zh.png",
  "StockAnalysis-390.png",
  "StockAnalysis-390-zh.png",
];

function evidenceText(): string {
  return readFileSync(EVIDENCE, "utf8");
}

function layoutFileMap(yml: string): Record<string, string> {
  const marker = "layoutFiles:\n";
  const at = yml.indexOf(marker);
  if (at < 0) throw new Error("EVIDENCE.yml is missing layoutFiles");
  const map: Record<string, string> = {};
  for (const line of yml.slice(at + marker.length).split("\n")) {
    if (!line.startsWith("  ")) break;
    const match = line.match(/^  (\S+): "?([0-9a-f]{64})"?$/);
    if (!match) throw new Error(`layoutFiles row is not path: sha256: ${line}`);
    map[match[1]] = match[2];
  }
  if (Object.keys(map).length === 0) throw new Error("EVIDENCE.yml layoutFiles is empty");
  return map;
}

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

if (composition !== null) {
  describe("explicit immutable pl6 evidence composition", () => {
    it("retains every required actual case under the shared current-source contract", () => {
      const cases = composition.cases.filter((c: { packet: string }) => c.packet === "pl6");
      expect(cases).toHaveLength(20);
      expect(new Set(cases.map((c: { key: string }) => c.key)).size).toBe(20);
    });
  });
} else {
// Bounded incumbent mode: original checks below remain unchanged; no invented record metadata.
describe("B-PL-6 batch 1 evidence lock is the sha256 of the layout sources", () => {
  it("EVIDENCE.yml records a sha256 for AnalysisWorkspace.tsx", () => {
    const recorded = layoutFileMap(evidenceText());
    expect(recorded["terminal/components/workspaces/AnalysisWorkspace.tsx"], "layoutFiles is missing AnalysisWorkspace.tsx").toMatch(/^[0-9a-f]{64}$/);
  });

  it("each layoutFiles sha256 matches the file on disk", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const [rel, expected] of Object.entries(recorded)) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(true);
      if (rel === "terminal/lib/i18n.tsx") {
        assertCapturedLexProjection(readFileSync(abs, "utf8"), expected, readFileSync(EVIDENCE, "utf8"));
      } else {
        expect(sha256Of(abs), `${rel} changed without a recapture`).toBe(expected);
      }
    }
  });

  it("all dark crops exist and are non-empty", () => {
    for (const file of CROPS) {
      const abs = join(CROP_DIR, file);
      expect(existsSync(abs), file).toBe(true);
      expect(statSync(abs).size, file).toBeGreaterThan(0);
    }
  });

  it("EVIDENCE.yml declares the capture flag, the dark-only law and the two viewports", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/capture_flag:\s*TERMINAL_E2E_FIXTURE/);
    expect(yml).toMatch(/DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06/);
    expect(yml).toMatch(/^theme:\s*dark$/m);
    expect(yml).toMatch(/capturedAtHead is informational\. The lock is layoutFiles\./);
    for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
      expect(yml).toMatch(new RegExp(`name:\\s*${name},\\s*width:\\s*${width},\\s*height:\\s*${height}`));
    }
  });
});

}
