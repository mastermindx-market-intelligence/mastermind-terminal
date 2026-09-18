import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/terminal-visual-intelligence");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function mapSection(text: string, name: string): Record<string, string> {
  const marker = `${name}:\n`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  const out: Record<string, string> = {};
  for (const line of text.slice(start + marker.length).split("\n")) {
    if (!line.startsWith("  ")) break;
    const match = line.match(/^  (\S+): "([0-9a-f]{64})"$/);
    if (!match) throw new Error(`invalid ${name} row: ${line}`);
    out[match[1]] = match[2];
  }
  return out;
}

function pngDimensions(path: string): [number, number] {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe("Terminal Visual Intelligence browser evidence", () => {
  const text = readFileSync(EVIDENCE, "utf8");

  it("locks the source files that determine the captured chart-context surface", () => {
    const recorded = mapSection(text, "layoutFiles");
    expect(Object.keys(recorded).length).toBeGreaterThanOrEqual(9);
    for (const [relative, expected] of Object.entries(recorded)) {
      const absolute = join(REPO, relative);
      expect(existsSync(absolute), relative).toBe(true);
      expect(sha256(absolute), `${relative} changed without a recapture`).toBe(expected);
    }
  });

  it("locks six real EN/ZH responsive browser crops", () => {
    const recorded = mapSection(text, "cropFiles");
    expect(Object.keys(recorded).sort()).toEqual([
      "desktop-context-zh.png", "desktop-context.png",
      "mobile-context-zh.png", "mobile-context.png",
      "tablet-context-zh.png", "tablet-context.png",
    ]);
    const expectedSize: Record<string, [number, number]> = {
      desktop: [1440, 900], tablet: [820, 1180], mobile: [390, 844],
    };
    for (const [file, expectedHash] of Object.entries(recorded)) {
      const absolute = join(CROP_DIR, file);
      expect(existsSync(absolute), file).toBe(true);
      expect(readFileSync(absolute).byteLength, `${file} is not a substantive crop`).toBeGreaterThan(50_000);
      expect(sha256(absolute), `${file} changed without updating evidence`).toBe(expectedHash);
      const viewport = file.split("-")[0];
      expect(pngDimensions(absolute), file).toEqual(expectedSize[viewport]);
    }
  });

  it("records dark theme, bilingual coverage, three viewports, and the exact local gate receipt", () => {
    expect(text).toContain("theme: dark");
    expect(text).toContain("languages: [en, zh]");
    expect(text).toContain("desktop: 10/10 passed");
    expect(text).toContain("tablet: 10/10 passed");
    expect(text).toContain("mobile: 10/10 passed");
    expect(text).toContain("mobileCrosshairRegression: 1/1 passed");
    expect(text).toContain("vitest: 337 files passed; 5573 tests passed; 4 todo");
  });
});
