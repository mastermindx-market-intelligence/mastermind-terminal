// Evidence lock for the B4 company theme-context empty state (mi-g10-b4t).
// The lock is the sha256 of the layout sources the crops depend on, recorded in
// EVIDENCE.yml layoutFiles. capturedAtHead stays informational.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-mi-g10-b4t-theme-empty");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const CAPTURE_LOG = join(CROP_DIR, "capture-log.json");
const LAYOUT_FILES = [
  "terminal/components/fin/CompanyThemeContextCard.tsx",
  "terminal/app/company-intelligence.css",
];
const CROPS = [
  "1440x900-en-dark-theme-empty.png",
  "1440x900-zh-dark-theme-empty.png",
  "390x844-en-dark-theme-empty.png",
  "390x844-zh-dark-theme-empty.png",
];
const HARNESS_URL = "/analysis?symbol=NVDA&page=intelligence";
const HARNESS_STATE = "theme-context-not-found-empty";

type CaptureLog = {
  darkLightIdentical: Record<string, { identical: boolean; darkSha: string; lightSha: string }>;
};

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
    if (!m) throw new Error("layoutFiles row is not path: sha256: " + line);
    map[m[1]] = m[2];
  }
  if (Object.keys(map).length === 0) throw new Error("EVIDENCE.yml layoutFiles is empty");
  return map;
}

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function cropKey(file: string): string {
  // "1440x900-en-dark-theme-empty.png" -> "1440x900-en"
  return file.split("-").slice(0, 2).join("-");
}

describe("B4 theme-context empty-state evidence lock is the sha256 of the layout sources", () => {
  it("EVIDENCE.yml records a sha256 for exactly the layout files the crops depend on", () => {
    const recorded = layoutFileMap(evidenceText());
    expect(Object.keys(recorded).sort()).toEqual([...LAYOUT_FILES].sort());
    for (const rel of LAYOUT_FILES) expect(recorded[rel]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("each layoutFiles sha256 matches the file on disk", () => {
    for (const [rel, expected] of Object.entries(layoutFileMap(evidenceText()))) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), rel + " is missing").toBe(true);
      expect(sha256Of(abs), rel + " changed without a recapture").toBe(expected);
    }
  });

  it("all four dark crops (desktop/mobile x en/zh) exist and are non-empty", () => {
    expect(CROPS).toHaveLength(4);
    for (const file of CROPS) {
      const abs = join(CROP_DIR, file);
      expect(existsSync(abs), file + " is missing").toBe(true);
      expect(statSync(abs).size).toBeGreaterThan(0);
    }
  });

  it("capture-log.json describes the committed crops and records the light gap", () => {
    const log = JSON.parse(readFileSync(CAPTURE_LOG, "utf8")) as CaptureLog;
    for (const file of CROPS) {
      const row = log.darkLightIdentical[cropKey(file)];
      expect(row, cropKey(file) + " is missing from capture-log.json").toBeDefined();
      expect(row.darkSha, file + " is not the crop the log describes").toBe(sha256Of(join(CROP_DIR, file)));
      // Dark-only shell: the light capture is the same bytes, an honest gap.
      expect(row.identical).toBe(true);
      expect(row.lightSha).toBe(row.darkSha);
    }
  });

  it("EVIDENCE.yml declares the capture flag, the dark-only law, the light gap and the two viewports", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/capture_flag:\s*TERMINAL_E2E_FIXTURE/);
    expect(yml).toContain("DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06");
    expect(yml).toMatch(/^theme:\s*dark$/m);
    expect(yml).toMatch(/^light_gap:/m);
    expect(yml).toMatch(/capturedAtHead is informational\. The lock is layoutFiles\./);
    for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
      expect(yml).toMatch(new RegExp("name:\\s*" + name + ",\\s*width:\\s*" + width + ",\\s*height:\\s*" + height));
    }
  });

  it("each crop names the exact harness URL, language and state so it reproduces", () => {
    const yml = evidenceText();
    for (const file of CROPS) {
      const lang = file.includes("-zh-") ? "zh" : "en";
      const row = yml.split("\n").find((line) => line.startsWith("  " + file + ":"));
      expect(row, "harness row for " + file).toBeDefined();
      expect(row).toContain('url: "' + HARNESS_URL + '"');
      expect(row).toContain("lang: " + lang);
      expect(row).toContain("state: " + HARNESS_STATE);
    }
  });
});
