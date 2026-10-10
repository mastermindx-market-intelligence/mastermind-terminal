// Git-free evidence lock for the EOD belt / Flow Desk chain heat / Heatmap flow layer
// load-failure capture packet. The lock is the sha256 of the layout sources the crops depend
// on, recorded in EVIDENCE.yml layoutFiles. capturedAtHead stays informational.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/eod-heatmap-flowdesk-load-failure");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
// The sources e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs stamps (its LAYOUT_FILES).
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/components/eodcontext/DarkPoolMini.tsx",
  "terminal/components/eodcontext/EodContextBelt.tsx",
  "terminal/components/eodcontext/StructureStrip.tsx",
  "terminal/components/eodcontext/eodStrings.ts",
  "terminal/components/flowdesk/FlowDeskView.tsx",
  "terminal/components/gexdesk/GexDeskView.tsx",
  "terminal/components/heatmap/HeatmapView.tsx",
  "terminal/lib/eodContext.ts",
  "terminal/lib/flowdeskStrings.ts",
  "terminal/lib/heatmapStrings.ts",
];
const STATES = [
  "eod-darkpool-unavailable",
  "eod-darkpool-retried",
  "eod-darkpool-absent",
  "eod-structure-partial",
  "eod-structure-retried",
  "eod-structure-unavailable",
  "eod-structure-absent",
  "chainheat-unavailable",
  "chainheat-retried",
  "chainheat-absent",
  "chainheat-refresh-failed",
  "heatmap-flow-unavailable",
  "heatmap-flow-retried",
  "heatmap-flow-absent",
  "heatmap-flow-auth",
  "heatmap-flow-refresh-failed",
  "heatmap-live-failed",
  "heatmap-no-match",
];
const CROPS = STATES.flatMap((state) =>
  ["1440", "820", "390"].flatMap((width) => [`${state}-${width}.png`, `${state}-${width}-zh.png`])
);
// The defect, recorded against base b7a3357b before the fix (Playwright failure screenshots).
const BEFORE = ["belt-503", "chainheat-503", "chainheat-refused", "chainheat-404", "heatmap-flow-503", "heatmap-flow-403", "heatmap-quotes-failed", "heatmap-no-match"]
  .flatMap((state) => ["desktop", "tablet", "mobile"].map((project) => `before/${state}-${project}.png`));

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

describe("EOD / heatmap / flow desk load-failure evidence lock is the sha256 of the layout sources", () => {
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

  it("every state has a dark crop at 1440, 820 and 390 in en and zh, listed in EVIDENCE.yml", () => {
    const yml = evidenceText();
    expect(CROPS).toHaveLength(108);
    for (const file of CROPS) {
      const abs = join(CROP_DIR, file);
      expect(existsSync(abs), file).toBe(true);
      expect(statSync(abs).size, file).toBeGreaterThan(0);
      expect(yml, `${file} is not listed in EVIDENCE.yml`).toContain(`  - ${file}\n`);
    }
  });

  it("the before-fix record covers every failing state at all three projects", () => {
    const before = readFileSync(join(CROP_DIR, "before", "BEFORE.yml"), "utf8");
    expect(before).toMatch(/^base: b7a3357b06847f560022a829b8fd6c4fea3d4d47$/m);
    for (const file of BEFORE) {
      const abs = join(CROP_DIR, file);
      expect(existsSync(abs), file).toBe(true);
      expect(statSync(abs).size, file).toBeGreaterThan(0);
      expect(before, `${file} is not described in BEFORE.yml`).toContain(`  ${file.slice("before/".length)}:`);
    }
  });

  it("EVIDENCE.yml declares the capture flag, the dark-only and dev-indicator laws and the three viewports", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/capture_flag:\s*TERMINAL_E2E_FIXTURE/);
    expect(yml).toMatch(/DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06/);
    expect(yml).toMatch(/DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR/);
    expect(yml).toMatch(/^theme:\s*dark$/m);
    expect(yml).toMatch(/^languages:\s*\[en, zh\]$/m);
    expect(yml).toMatch(/capturedAtHead is informational\. The lock is layoutFiles\./);
    for (const [name, width, height] of [["desktop", 1440, 900], ["tablet", 820, 1180], ["mobile", 390, 844]] as const) {
      expect(yml).toMatch(new RegExp(`name:\\s*${name},\\s*width:\\s*${width},\\s*height:\\s*${height}`));
    }
  });
});
