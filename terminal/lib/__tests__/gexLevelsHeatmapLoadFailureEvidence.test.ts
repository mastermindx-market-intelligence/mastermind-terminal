// Git-free evidence lock for the GEX desk, Levels and Heatmap failure-state packet.
// The lock is the sha256 of the layout sources the crops depend on, recorded in
// EVIDENCE.yml layoutFiles. capturedAtHead stays informational.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/gex-levels-heatmap-load-failure");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
// The sources e2e/tools/capture_gex_levels_heatmap_load_failure.cjs stamps (its LAYOUT_FILES).
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/components/gexdesk/GexDeskView.tsx",
  "terminal/components/gexdesk/HeatSeekerCard.tsx",
  "terminal/components/gexdesk/MarketStateCard.tsx",
  "terminal/components/gexdesk/StrikeLadder.tsx",
  "terminal/components/gexdesk/gexStrings.ts",
  "terminal/components/heatmap/HeatmapView.tsx",
  "terminal/components/levels/LevelsView.tsx",
  "terminal/components/levels/levelsLabels.ts",
  "terminal/lib/heatmapStrings.ts",
];
const STATES = [
  "gex-ladder-unavailable",
  "gex-ladder-retried",
  "gex-ladder-absent",
  "gex-rail-unavailable",
  "gex-rail-retried",
  "gex-state-refresh-failed",
  "levels-unavailable",
  "levels-retried",
  "levels-absent",
  "levels-refresh-failed",
  "heatmap-unavailable",
  "heatmap-retried",
  "heatmap-absent",
];
const CROPS = STATES.flatMap((state) =>
  [1440, 820, 390].flatMap((width) => [`${state}-${width}.png`, `${state}-${width}-zh.png`]),
);

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

describe("GEX, Levels and Heatmap load-failure evidence lock is the sha256 of the layout sources", () => {
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

  it("all dark crops exist, are non-empty and are listed in EVIDENCE.yml files", () => {
    expect(CROPS).toHaveLength(78);
    const yml = evidenceText();
    for (const file of CROPS) {
      const abs = join(CROP_DIR, file);
      expect(existsSync(abs), file).toBe(true);
      expect(statSync(abs).size, file).toBeGreaterThan(0);
      expect(yml, `files is missing ${file}`).toContain(`\n  - ${file}\n`);
    }
  });

  it("EVIDENCE.yml declares the capture flag, the dark-only and dev-indicator laws and the three viewports", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/capture_flag:\s*TERMINAL_E2E_FIXTURE/);
    expect(yml).toMatch(/DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06/);
    expect(yml).toMatch(/DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR/);
    expect(yml).toMatch(/^theme:\s*dark$/m);
    expect(yml).toMatch(/capturedAtHead is informational\. The lock is layoutFiles\./);
    for (const [name, width, height] of [
      ["desktop", 1440, 900],
      ["tablet", 820, 1180],
      ["mobile", 390, 844],
    ] as const) {
      expect(yml).toMatch(new RegExp(`name:\\s*${name},\\s*width:\\s*${width},\\s*height:\\s*${height}`));
    }
  });
});
