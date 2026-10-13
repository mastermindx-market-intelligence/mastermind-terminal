// Git-free evidence lock for the pine-boot-pending-state capture packet (a user script's legend row
// and editor console while the Pine engine never boots, then Retry). The lock is the sha256 of the
// sources the crops draw from, recorded in EVIDENCE.yml layoutFiles. capturedAtHead stays
// informational. stateText records what each crop's state said and must still be today's
// PINE_RUN_LEX string, so copy changed under a re-pinned pineRunLex.ts row fails here too.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PINE_RUN_LEX } from "@/lib/pineRunLex";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/pine-boot-pending-state");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
// The sources e2e/tools/capture_pine_boot_pending.cjs stamps (its LAYOUT_FILES).
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/components/ChartOverlays.module.css",
  "terminal/components/ChartOverlays.tsx",
  "terminal/components/PineEditor.tsx",
  "terminal/lib/pineChartRun.ts",
  "terminal/lib/pineRunLex.ts",
];
const SURFACES = ["legend-wait", "legend-failed", "legend-retried", "editor-checking", "editor-unavailable"] as const;
type Surface = (typeof SURFACES)[number];
const CROPS = SURFACES.flatMap((s) => [1440, 820, 390].flatMap((w) => [`${s}-${w}.png`, `${s}-${w}-zh.png`]));
const SCRIPT_NAME = "My Momentum"; // lib/scriptsFixtureDb.ts `${key}-mine`

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

function stateTextMap(yml: string): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const line of block(yml, "stateText")) {
    const match = line.match(/^  (\S+\.png): (\[.*\])$/);
    if (!match) throw new Error(`stateText row is not file: [text]: ${line}`);
    map[match[1]] = JSON.parse(match[2]) as string[];
  }
  return map;
}

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

const isZh = (file: string) => file.endsWith("-zh.png");
const surfaceOf = (file: string) => file.replace(/-\d+(?:-zh)?\.png$/, "") as Surface;

// What each surface says, in reading order, from today's words.
function expected(surface: Surface, col: 0 | 1): string[] {
  const w = (k: string) => {
    const e = PINE_RUN_LEX[k];
    if (!e) throw new Error(`PINE_RUN_LEX has no ${k}`);
    return e[col];
  };
  switch (surface) {
    case "legend-wait": return [w("pineEngineWait")];
    case "legend-failed": return [w("pineEngineFail"), w("pineRetry")];
    case "legend-retried": return [];
    case "editor-checking": return [w("peChecking").split("{name}").join(SCRIPT_NAME)];
    case "editor-unavailable": return [w("peEngineUnavailable"), w("peRetryCheck")];
  }
}

describe("pine-boot-pending-state evidence lock is the sha256 of the crops' sources", () => {
  it("EVIDENCE.yml records a sha256 for every source the capture script stamps", () => {
    const recorded = layoutFileMap(text(EVIDENCE));
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel] ?? "", `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("each layoutFiles sha256 matches the file on disk", () => {
    const recorded = layoutFileMap(text(EVIDENCE));
    for (const [rel, want] of Object.entries(recorded)) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(true);
      expect(sha256Of(abs), `${rel} changed without a recapture`).toBe(want);
    }
  });

  it("every crop exists and is non-empty", () => {
    for (const file of CROPS) {
      const abs = join(CROP_DIR, file);
      expect(existsSync(abs), abs).toBe(true);
      expect(statSync(abs).size, abs).toBeGreaterThan(0);
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

describe("pine-boot-pending-state stateText", () => {
  it("covers every crop, and each language's words stay in that language", () => {
    const said = stateTextMap(text(EVIDENCE));
    expect(Object.keys(said).sort()).toEqual([...CROPS].sort());
    for (const [file, list] of Object.entries(said)) {
      for (const s of list) {
        const own = s.split(SCRIPT_NAME).join(""); // the script's name is the user's, not ours
        if (isZh(file)) expect(own, file).not.toMatch(/[A-Za-z]/);
        else expect(own, file).not.toMatch(/[㐀-鿿]/);
      }
    }
  });

  it("is still what today's PINE_RUN_LEX says for each state", () => {
    const said = stateTextMap(text(EVIDENCE));
    for (const [file, list] of Object.entries(said)) {
      expect(list, file).toEqual(expected(surfaceOf(file), isZh(file) ? 1 : 0));
    }
  });
});
