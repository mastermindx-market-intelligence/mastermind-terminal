// Git-free evidence lock for the B-PL-6 batch 3 capture packet.
// The lock is the sha256 of the layout sources the crops depend on, recorded in
// EVIDENCE.yml layoutFiles. capturedAtHead stays informational.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-pl-6-batch-3");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
// The sources e2e/tools/capture_pl6_batch3.cjs stamps (its LAYOUT_FILES).
const LAYOUT_FILES = [
  "terminal/components/options/OptionsFlowBoardView.tsx",
  "terminal/components/flowdesk/FiltersPanel.tsx",
  "terminal/components/flowdesk/FlowCard.tsx",
  "terminal/components/alerts/AlertDetail.tsx",
  "terminal/components/alerts/alerts.module.css",
  "terminal/components/heatmap/HeatmapView.tsx",
  "terminal/components/heatmap/Treemap.tsx",
  "terminal/lib/heatmapStrings.ts",
  "terminal/lib/flowdeskStrings.ts",
  "terminal/lib/plainLabels.ts",
  "terminal/lib/i18n.tsx",
  "terminal/components/PineEditor.tsx",
];
const CROPS = [
  "AlertDetail-1440.png",
  "AlertDetail-1440-zh.png",
  "AlertDetail-390.png",
  "AlertDetail-390-zh.png",
  "FlowDesk-1440.png",
  "FlowDesk-1440-zh.png",
  "FlowDesk-390.png",
  "FlowDesk-390-zh.png",
  "HeatmapTreemap-1440.png",
  "HeatmapTreemap-1440-zh.png",
  "HeatmapTreemap-390.png",
  "HeatmapTreemap-390-zh.png",
  "OptionsFlowBoard-1440.png",
  "OptionsFlowBoard-1440-zh.png",
  "OptionsFlowBoard-390.png",
  "OptionsFlowBoard-390-zh.png",
  "PineLibrary-1440.png",
  "PineLibrary-1440-zh.png",
  "PineLibrary-390.png",
  "PineLibrary-390-zh.png",
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

describe("B-PL-6 batch 3 evidence lock is the sha256 of the layout sources", () => {
  it("EVIDENCE.yml records a sha256 for every source the capture script stamps", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel] ?? "", `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("each layoutFiles sha256 matches the file on disk", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const [rel, expected] of Object.entries(recorded)) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(true);
      expect(sha256Of(abs), `${rel} changed without a recapture`).toBe(expected);
    }
  });

  it("all dark crops exist and are non-empty", () => {
    for (const file of CROPS) {
      const abs = join(CROP_DIR, file);
      expect(existsSync(abs), file).toBe(true);
      expect(statSync(abs).size, file).toBeGreaterThan(0);
    }
  });

  it("EVIDENCE.yml declares the capture flag, the dark-only and dev-indicator laws and the two viewports", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/capture_flag:\s*TERMINAL_E2E_FIXTURE/);
    expect(yml).toMatch(/DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06/);
    expect(yml).toMatch(/DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR/);
    expect(yml).toMatch(/^theme:\s*dark$/m);
    expect(yml).toMatch(/capturedAtHead is informational\. The lock is layoutFiles\./);
    for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
      expect(yml).toMatch(new RegExp(`name:\\s*${name},\\s*width:\\s*${width},\\s*height:\\s*${height}`));
    }
  });
});
