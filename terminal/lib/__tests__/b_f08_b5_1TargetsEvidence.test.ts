// Git-free evidence lock for the B-F08-B5-1 portfolio construction targets packet.
// The lock is the sha256 of the layout sources the crops depend on, recorded in
// EVIDENCE.yml layoutFiles. capturedAtHead stays informational.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f08-b5-1-targets");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
// The sources e2e/tools/capture_b_f08_b5_1_targets.cjs stamps (its LAYOUT_FILES).
const LAYOUT_FILES = [
  "terminal/lib/portfolioMoney.ts",
  "terminal/lib/portfolioWorkspace.ts",
  "terminal/lib/i18n.tsx",
  "terminal/components/PortfolioWorkspace.tsx",
  "terminal/components/PortfolioWorkspace.module.css",
  "terminal/components/PortfolioRoleEditor.tsx",
  "terminal/app/globals.css",
  "terminal/components/PortfolioView.tsx",
  "terminal/lib/portfolioTargets.ts",
  "terminal/components/PortfolioTargets.module.css",
];
const STATES = [
  "empty",
  "populated-within-band",
  "populated-outside-band",
  "orphaned-target-disclosed",
  "orphaned-empty-book",
  "unweighable",
  "cleared",
  "unavailable",
];
const CROPS = STATES.flatMap((state) =>
  [1440, 390].flatMap((width) => [
    `PortfolioTargets-${state}-${width}.png`,
    `PortfolioTargets-${state}-${width}-zh.png`,
  ]),
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
    if (Object.hasOwn(map, match[1])) throw new Error(`Duplicate layout source: ${match[1]}`);
    map[match[1]] = match[2];
  }
  if (Object.keys(map).length === 0) throw new Error("EVIDENCE.yml layoutFiles is empty");
  return map;
}

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

describe("B-F08-B5-1 targets evidence lock is the sha256 of the layout sources", () => {
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
    expect(CROPS).toHaveLength(32);
    for (const file of CROPS) {
      const abs = join(CROP_DIR, file);
      expect(existsSync(abs), file).toBe(true);
      expect(statSync(abs).size, file).toBeGreaterThan(0);
    }
  });

  it("lists exactly the complete matrix without duplicate filenames", () => {
    const rows = evidenceText().match(/^files:\n((?:  - [^\n]+\n)+)/m)?.[1];
    expect(rows).toBeDefined();
    const files = rows!.trimEnd().split("\n").map(line => {
      const match = line.match(/^  - ([A-Za-z0-9-]+\.png)$/);
      expect(match, line).not.toBeNull(); return match![1];
    });
    expect(new Set(files).size).toBe(CROPS.length);
    expect(files.sort()).toEqual([...CROPS].sort());
  });

  it("binds every actual PNG to its unique capture hash", () => {
    const rows = evidenceText().match(/^captureFiles:\n((?:  [^\n]*\n)+)/m)?.[1];
    expect(rows, "missing actual capture image hashes").toBeDefined();
    const entries = rows!.trimEnd().split("\n").map(line => {
      const match = line.match(/^  ([A-Za-z0-9-]+\.png): "([0-9a-f]{64})"$/);
      expect(match, line).not.toBeNull(); return [match![1], match![2]] as const;
    });
    expect(entries).toHaveLength(CROPS.length);
    expect(new Set(entries.map(([file]) => file)).size).toBe(CROPS.length);
    expect(entries.map(([file]) => file).sort()).toEqual([...CROPS].sort());
    for (const [file, hash] of entries) {
      const bytes = readFileSync(join(CROP_DIR, file));
      expect(bytes.subarray(0, 8).toString("hex"), file).toBe("89504e470d0a1a0a");
      expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(hash);
    }
  });

  it("records truthful complete native crop geometry for every matrix cell", () => {
    const receipt = JSON.parse(readFileSync(join(CROP_DIR, "CROP_GEOMETRY.json"), "utf8")) as {
      crops: Array<{ file: string; requestedViewport: { width: number; height: number }; captureViewport: { width: number; height: number };
        cropRectCss: { width: number; height: number }; clippedBy: unknown[]; captureMethod: string; scale: string }>;
    };
    expect(receipt.crops).toHaveLength(CROPS.length);
    expect(receipt.crops.map(row => row.file).sort()).toEqual([...CROPS].sort());
    for (const row of receipt.crops) {
      const width = row.file.includes("-1440") ? 1440 : 390;
      expect(row.requestedViewport).toEqual({ width, height: width === 390 ? 844 : 900 });
      expect(row.captureViewport.width).toBe(width);
      expect(row.captureViewport.height).toBeGreaterThanOrEqual(row.requestedViewport.height);
      expect(row.captureViewport.height).toBeLessThanOrEqual(8192);
      expect(row.clippedBy).toEqual([]);
      expect(row.captureMethod).toBe("native-full-page-document-clip"); expect(row.scale).toBe("css");
      const bytes = readFileSync(join(CROP_DIR, row.file));
      expect(bytes.readUInt32BE(16)).toBe(row.cropRectCss.width);
      expect(bytes.readUInt32BE(20)).toBe(row.cropRectCss.height);
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
