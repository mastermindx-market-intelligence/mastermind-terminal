// Git-free evidence lock for the conductor-fit-badge-zh capture packet (the rail's zh fit chip).
// The lock is the sha256 of the sources the rail crops draw from, recorded in EVIDENCE.yml
// layoutFiles. capturedAtHead stays informational. chipText records what each crop's chips said
// and must still be what fitBadgeText renders from today's LEX, so a chip string changed under a
// re-pinned i18n.tsx row fails here too.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LEX } from "@/lib/i18n";
import { fitBadgeText } from "@/lib/conductorState";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/conductor-fit-badge-zh");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const BEFORE = join(CROP_DIR, "before", "BEFORE.yml");
// The sources e2e/tools/capture_conductor_fit_badge_zh.cjs stamps (its LAYOUT_FILES).
const LAYOUT_FILES = [
  "terminal/app/dev/theater/page.tsx",
  "terminal/app/globals.css",
  "terminal/components/ChartConductor.tsx",
  "terminal/lib/chartBus.ts",
  "terminal/lib/conductorState.ts",
  "terminal/lib/i18n.tsx",
];
const CROPS = [
  "rail-1440.png",
  "rail-1440-zh.png",
  "rail-820.png",
  "rail-820-zh.png",
  "rail-390.png",
  "rail-390-zh.png",
];

// Stand-in for useT(): the same LEX lookup the hook does, pinned to one language.
const tFor = (col: 0 | 1) => (key: string, fallback?: string) => {
  const e = LEX[key];
  return e ? e[col] : (fallback ?? key);
};

function text(path: string): string {
  return readFileSync(path, "utf8");
}

// The two-space-indented rows under `key:` up to the next top-level line.
function block(yml: string, key: string): string[] {
  const marker = `\n${key}:\n`;
  const at = yml.indexOf(marker);
  if (at < 0) throw new Error(`missing ${key}`);
  const rows: string[] = [];
  for (const line of yml.slice(at + marker.length).split("\n")) {
    if (!line.startsWith("  ")) break;
    rows.push(line);
  }
  if (rows.length === 0) throw new Error(`${key} is empty`);
  return rows;
}

function layoutFileMap(yml: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of block(yml, "layoutFiles")) {
    const match = line.match(/^  (\S+): "?([0-9a-f]{64})"?$/);
    if (!match) throw new Error(`layoutFiles row is not path: sha256: ${line}`);
    map[match[1]] = match[2];
  }
  return map;
}

function chipTextMap(yml: string): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const line of block(yml, "chipText")) {
    const match = line.match(/^  (\S+\.png): (\[.*\])$/);
    if (!match) throw new Error(`chipText row is not file: [chips]: ${line}`);
    map[match[1]] = JSON.parse(match[2]) as string[];
  }
  return map;
}

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

const isZh = (file: string) => file.endsWith("-zh.png");

describe("conductor-fit-badge-zh evidence lock is the sha256 of the rail's sources", () => {
  it("EVIDENCE.yml records a sha256 for every source the capture script stamps", () => {
    const recorded = layoutFileMap(text(EVIDENCE));
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel] ?? "", `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("each layoutFiles sha256 matches the file on disk", () => {
    const recorded = layoutFileMap(text(EVIDENCE));
    for (const [rel, expected] of Object.entries(recorded)) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(true);
      expect(sha256Of(abs), `${rel} changed without a recapture`).toBe(expected);
    }
  });

  it("every crop exists and is non-empty, after and before", () => {
    for (const file of CROPS) {
      for (const dir of [CROP_DIR, join(CROP_DIR, "before")]) {
        const abs = join(dir, file);
        expect(existsSync(abs), abs).toBe(true);
        expect(statSync(abs).size, abs).toBeGreaterThan(0);
      }
    }
  });

  it("EVIDENCE.yml declares the capture flag, the dark-only and dev-indicator laws and the three viewports", () => {
    const yml = text(EVIDENCE);
    expect(yml).toMatch(/capture_flag:\s*TERMINAL_E2E_FIXTURE/);
    expect(yml).toMatch(/DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06/);
    expect(yml).toMatch(/DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR/);
    expect(yml).toMatch(/^theme:\s*dark$/m);
    expect(yml).toMatch(/capturedAtHead is informational\. The lock is layoutFiles\./);
    for (const [name, width, height] of [["desktop", 1440, 900], ["tablet", 820, 1180], ["mobile", 390, 844]] as const) {
      expect(yml).toMatch(new RegExp(`name:\\s*${name},\\s*width:\\s*${width},\\s*height:\\s*${height}`));
    }
  });
});

describe("conductor-fit-badge-zh chipText", () => {
  it("covers every crop with the demo's three chips, and zh carries no English beyond ATR", () => {
    const chips = chipTextMap(text(EVIDENCE));
    expect(Object.keys(chips).sort()).toEqual([...CROPS].sort());
    for (const [file, list] of Object.entries(chips)) {
      expect(list, file).toHaveLength(3); // ai_tl_1 (step 2), ai_tl_2, ai_zone_1
      for (const chip of list) {
        if (isZh(file)) {
          expect(chip, file).toContain("触及");
          expect(chip.replace(/ATR/g, ""), file).not.toMatch(/[A-Za-z]/);
        } else {
          expect(chip, file).not.toMatch(/[㐀-鿿]/);
        }
      }
    }
  });

  it("is still what fitBadgeText renders from today's LEX", () => {
    const chips = chipTextMap(text(EVIDENCE));
    for (const [file, list] of Object.entries(chips)) {
      const t = tFor(isZh(file) ? 1 : 0);
      for (const chip of list) {
        const nums = (chip.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
        expect(nums, `${file}: ${chip}`).toHaveLength(2);
        expect(fitBadgeText({ touches: nums[0], max_dev_atr: nums[1] }, t), file).toBe(chip);
      }
    }
  });

  it("before/ is the defect: the same chips, in the English template in zh too", () => {
    const after = chipTextMap(text(EVIDENCE));
    const before = chipTextMap(text(BEFORE));
    expect(text(BEFORE)).toMatch(/^base: [0-9a-f]{40}$/m);
    expect(Object.keys(before).sort()).toEqual([...CROPS].sort());
    for (const file of CROPS) {
      const en = file.replace(/-zh\.png$/, ".png");
      expect(before[file], file).toEqual(after[en]);
    }
  });
});
