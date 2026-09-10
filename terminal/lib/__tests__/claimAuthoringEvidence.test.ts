// Git-free evidence lock. The required CI shard checks out a single commit, so
// a named SHA ancestry assertion is RED there while the same file is GREEN in a
// full-history worktree. The lock is the sha256 of the layout sources the crops
// depend on, recorded in EVIDENCE.yml layoutFiles. capturedAtHead stays as an
// informational field.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f13-6-claim-form");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const LAYOUT_FILES = [
  "terminal/components/workspaces/ClaimAuthoringForm.tsx",
  "terminal/components/workspaces/ClaimAuthoringForm.module.css",
  "terminal/lib/claimAuthoring.ts",
  "terminal/components/workspaces/ThesisWorkspace.tsx",
];
const CROPS = [
  "desktop-en-empty.png",
  "desktop-zh-empty.png",
  "mobile-en-empty.png",
  "mobile-zh-empty.png",
  "desktop-en-filled.png",
  "desktop-zh-filled.png",
  "mobile-en-filled.png",
  "mobile-zh-filled.png",
  "desktop-en-entry.png",
  "desktop-zh-entry.png",
  "mobile-en-entry.png",
  "mobile-zh-entry.png",
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

describe("B-F13-6 evidence lock is the sha256 of the layout sources", () => {
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

  it("all twelve dark crops exist and are non-empty", () => {
    expect(CROPS).toHaveLength(12);
    for (const file of CROPS) {
      const abs = join(CROP_DIR, file);
      expect(existsSync(abs), file).toBe(true);
      expect(statSync(abs).size, file).toBeGreaterThan(0);
    }
  });

  it("EVIDENCE.yml declares the capture flag and the dark-only law", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/capture_flag:\s*TERMINAL_E2E_FIXTURE/);
    expect(yml).toMatch(/DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06/);
    expect(yml).toMatch(/^theme:\s*dark$/m);
    expect(yml).toMatch(/capturedAtHead is informational\. The lock is layoutFiles\./);
  });
});
