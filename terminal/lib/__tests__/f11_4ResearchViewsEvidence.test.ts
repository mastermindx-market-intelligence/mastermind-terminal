// Round-4 review of PR #546 (B-F11-4), Meta-CEO B seat ruling R9.
//
// The round-3 body described the EVIDENCE.yml layout lock as if something
// re-verified it; nothing did. This packet now ships the same lock the
// b-f12-5 packet ships (terminal/lib/__tests__/f12_5AccountPolishEvidence.test.ts,
// added there as a Review MAJOR on PR #539 round 3): the sha256 of every layout
// source the crops depend on is hard-coded HERE, from EVIDENCE.yml, so changing
// a layout file without a recapture turns this file RED under `npm test`.
//
// capturedAtHead stays informational — a required CI shard checks out a single
// commit, so a check that asks whether a named SHA is an ancestor of HEAD is RED
// there and green only in a full-history worktree. That is not a CI test.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f11-4-research-views");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");

// Spec 2.10's list, plus the workspace stylesheet added by ruling R4 of round 3.
const LAYOUT_FILES = [
  "terminal/components/workspaces/ThesisWorkspace.tsx",
  "terminal/components/workspaces/ThesisWorkspace.module.css",
  "terminal/lib/rmsViews.ts",
  "terminal/lib/savedViews.ts",
  "terminal/lib/plainLabels.ts",
  "terminal/lib/i18n.tsx",
];

// 4 surfaces x EN/ZH x 1440/390, plus the one pair ruling R3e adds: the combined
// view-plus-subject empty state, at 1440 only, in both languages.
const CROP_FILES = [
  "empty-1440.png",
  "empty-1440-zh.png",
  "empty-390.png",
  "empty-390-zh.png",
  "named-views-1440.png",
  "named-views-1440-zh.png",
  "named-views-390.png",
  "named-views-390-zh.png",
  "save-flow-1440.png",
  "save-flow-1440-zh.png",
  "save-flow-390.png",
  "save-flow-390-zh.png",
  "window-closed-1440.png",
  "window-closed-1440-zh.png",
  "window-closed-390.png",
  "window-closed-390-zh.png",
  "view-subject-empty-1440.png",
  "view-subject-empty-1440-zh.png",
];

function evidenceText(): string {
  return readFileSync(EVIDENCE, "utf8");
}

function capturedAtHead(yml: string): string {
  const m = yml.match(/^(?:# )?capturedAtHead: ([0-9a-f]{40})$/m);
  if (!m) throw new Error("EVIDENCE.yml is missing a 40-char capturedAtHead");
  return m[1];
}

function layoutFileMap(yml: string): Record<string, string> {
  const marker = "layoutFiles:\n";
  const at = yml.indexOf(marker);
  if (at < 0) throw new Error("EVIDENCE.yml is missing layoutFiles");
  const map: Record<string, string> = {};
  for (const line of yml.slice(at + marker.length).split("\n")) {
    if (!line.startsWith("  ")) break;
    const m = line.match(/^ {2}(\S+): "?([0-9a-f]{64})"?$/);
    if (!m) throw new Error(`layoutFiles row is not path: sha256: ${line}`);
    map[m[1]] = m[2];
  }
  if (Object.keys(map).length === 0) throw new Error("EVIDENCE.yml layoutFiles is empty");
  return map;
}

function manifestFiles(yml: string): string[] {
  const marker = "\nfiles:\n";
  const at = yml.indexOf(marker);
  if (at < 0) throw new Error("EVIDENCE.yml is missing a files manifest");
  const out: string[] = [];
  for (const line of yml.slice(at + marker.length).split("\n")) {
    const m = line.match(/^ {2}- (\S+)$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

describe("B-F11-4 evidence lock is the sha256 of the layout sources", () => {
  it("capturedAtHead remains recorded as an informational field", () => {
    expect(capturedAtHead(evidenceText())).toMatch(/^[0-9a-f]{40}$/);
  });

  it("every layout source this surface depends on is under the lock", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel], `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(Object.keys(recorded).sort()).toEqual([...LAYOUT_FILES].sort());
  });

  it("layout file sha256 matches EVIDENCE.yml (RED when a layout file changes without a recapture)", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const [rel, expected] of Object.entries(recorded)) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(true);
      expect(sha256Of(abs), `${rel} changed without a recapture`).toBe(expected);
    }
  });

  it("the manifest lists exactly the committed crops, and every crop is on disk", () => {
    expect(manifestFiles(evidenceText()).sort()).toEqual([...CROP_FILES].sort());
    for (const file of CROP_FILES) {
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
    }
  });

  it("EN/ZH twins are present for every crop", () => {
    for (const file of CROP_FILES) {
      if (file.endsWith("-zh.png")) continue;
      const zh = file.replace(/\.png$/, "-zh.png");
      expect(CROP_FILES, `${file} is missing its ZH twin in the lock`).toContain(zh);
      expect(existsSync(join(CROP_DIR, zh)), zh).toBe(true);
    }
  });

  it("the manifest records the dark-only, both-language, two-viewport matrix", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/^theme: dark$/m);
    expect(yml).toMatch(/^languages: \[en, zh\]$/m);
    expect(yml).toMatch(/width: 1440/);
    expect(yml).toMatch(/width: 390/);
    expect(yml).toMatch(/^capture_flag: TERMINAL_E2E_FIXTURE$/m);
  });
});
