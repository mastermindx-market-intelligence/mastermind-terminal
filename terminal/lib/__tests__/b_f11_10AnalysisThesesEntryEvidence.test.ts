// Git-free evidence lock for the B-F11-10a packet (Analysis context-bar theses entry).
// The lock is the sha256 of the layout sources the crops depend on, recorded in
// EVIDENCE.yml layoutFiles. capturedAtHead stays informational.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f11-10-analysis-theses-entry");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const LAYOUT_FILES = [
  "terminal/components/workspaces/AnalysisWorkspace.tsx",
  "terminal/app/company-intelligence.css",
  "terminal/lib/i18n.tsx",
];
const CROPS = ["desktop-en.png", "desktop-zh.png", "tablet-en.png", "tablet-zh.png", "mobile-en.png", "mobile-zh.png"];

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
    const m = line.match(/^  (\S+): "?([0-9a-f]{64})"?$/);
    if (!m) throw new Error(`layoutFiles row is not path: sha256: ${line}`);
    map[m[1]] = m[2];
  }
  if (Object.keys(map).length === 0) throw new Error("EVIDENCE.yml layoutFiles is empty");
  return map;
}

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

describe("B-F11-10a evidence lock is the sha256 of the layout sources", () => {
  it("EVIDENCE.yml records a sha256 for every layout file the crops depend on", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel], `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
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

  it("all six dark crops (desktop/tablet/mobile × en/zh) exist and are non-empty", () => {
    expect(CROPS).toHaveLength(6);
    for (const file of CROPS) {
      const abs = join(CROP_DIR, file);
      expect(existsSync(abs), file).toBe(true);
      expect(statSync(abs).size, file).toBeGreaterThan(0);
    }
  });

  it("EVIDENCE.yml declares the capture flag, the dark-only law and the three viewports", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/capture_flag:\s*TERMINAL_E2E_FIXTURE/);
    expect(yml).toMatch(/DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06/);
    expect(yml).toMatch(/^theme:\s*dark$/m);
    expect(yml).toMatch(/capturedAtHead is informational\. The lock is layoutFiles\./);
    for (const [name, width, height] of [["desktop", 1440, 900], ["tablet", 820, 1180], ["mobile", 390, 844]] as const) {
      expect(yml).toMatch(new RegExp(`name:\\s*${name},\\s*width:\\s*${width},\\s*height:\\s*${height}`));
    }
  });

  it("each crop names the exact harness URL and state so it reproduces", () => {
    const yml = evidenceText();
    for (const file of CROPS) {
      const lang = file.includes("-zh") ? "zh" : "en";
      const url = `/analysis?symbol=NVDA&lang=${lang}`;
      const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(yml, file).toMatch(new RegExp(`${escaped(file)}:\\s*\\{[^}]*url:\\s*"${escaped(url)}"`));
      expect(yml, file).toMatch(new RegExp(`${escaped(file)}:\\s*\\{[^}]*state:\\s*context-bar-with-theses-control`));
    }
  });
});
