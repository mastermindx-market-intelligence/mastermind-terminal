// Git-free evidence lock for the W9T_F13_9 team-rollup (no cross-team rank) capture packet.
// The lock is the sha256 of the layout sources the crops depend on, recorded in
// EVIDENCE.yml layoutFiles. capturedAtHead stays informational.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/w9t_f13_9-team-rollup-no-rank");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
// The sources e2e/tools/capture_w9t_f13_9_team_rollup.cjs stamps (its LAYOUT_FILES).
const LAYOUT_FILES = [
  "terminal/app/api/teams/[id]/accuracy/rollup/route.ts",
  "terminal/app/dev/settings/page.tsx",
  "terminal/app/dev/settings/teamRollupFixtures.ts",
  "terminal/components/settings/SectionAccuracy.tsx",
  "terminal/components/settings/SectionAccuracy.module.css",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/lib/i18n.tsx",
  "terminal/lib/personalAccuracyStore.ts",
  "terminal/lib/teamRollup.ts",
  "terminal/lib/__tests__/teamRollup.test.ts",
  "terminal/lib/__tests__/teamAccuracyRollupRoute.test.ts",
];
const CROPS = [
  "desktop-en-ok.png",
  "desktop-zh-ok.png",
  "desktop-en-no-rows.png",
  "desktop-zh-no-rows.png",
  "desktop-en-empty-members.png",
  "desktop-zh-empty-members.png",
  "mobile-en-ok.png",
  "mobile-zh-ok.png",
  "mobile-en-no-rows.png",
  "mobile-zh-no-rows.png",
  "mobile-en-empty-members.png",
  "mobile-zh-empty-members.png",
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

describe("W9T_F13_9 team rollup evidence lock is the sha256 of the layout sources", () => {
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
    expect(yml).toMatch(/The lock is layoutFiles\./);
    for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
      expect(yml).toMatch(new RegExp(`name:\\s*${name},\\s*width:\\s*${width},\\s*height:\\s*${height}`));
    }
  });
});
