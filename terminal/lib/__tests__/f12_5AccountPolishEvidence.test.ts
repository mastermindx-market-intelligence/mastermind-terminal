// Review MAJOR (PR #539 round 3): the evidence lock used to name a commit
// and ask whether it was an ancestor of HEAD. The required CI shard checks
// out a single commit, so that named SHA is absent and the check is RED
// there while the same file is GREEN in a full-history worktree. A check
// that only passes with full history is not a CI test.
//
// The lock is now the sha256 of the account layout sources the crops
// depend on, recorded in EVIDENCE.yml layoutFiles. capturedAtHead stays
// as an informational field. Changing a layout file without a recapture
// turns this file RED.
//
// Review MINOR: overview rows reported confirmClass/confirmBg of a control
// whose .acs-form is display:none until .acs-row.editing. Overview
// measurements must not describe that hidden confirm.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f12-5-account-polish");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const LAYOUT_FILES = [
  "terminal/components/settings/SectionAccount.tsx",
  "terminal/app/settings.css",
];
const OVERVIEW_FILES = [
  "desktop-en-overview.png",
  "desktop-zh-overview.png",
  "mobile-en-overview.png",
  "mobile-zh-overview.png",
];
const DELETE_FORM_FILES = [
  "desktop-en-delete-form.png",
  "desktop-zh-delete-form.png",
  "mobile-en-delete-form.png",
  "mobile-zh-delete-form.png",
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function measurement(yml: string, file: string): Record<string, string> {
  const re = new RegExp(`^  ${escapeRegExp(file)}: \\{(.+)\\}$`, "m");
  const m = yml.match(re);
  if (!m) throw new Error(`EVIDENCE.yml is missing measurements for ${file}`);
  const fields: Record<string, string> = {};
  for (const part of m[1].split(",")) {
    const kv = part.trim().match(/^(\w+): (.+)$/);
    if (!kv) continue;
    fields[kv[1]] = kv[2].replace(/^"|"$/g, "");
  }
  return fields;
}

describe("B-F12-5 evidence lock is the sha256 of the layout sources", () => {
  it("capturedAtHead remains recorded as an informational field", () => {
    expect(capturedAtHead(evidenceText())).toMatch(/^[0-9a-f]{40}$/);
  });

  it("layout file sha256 matches EVIDENCE.yml (RED when a layout file changes without a recapture)", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel], `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const [rel, expected] of Object.entries(recorded)) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(true);
      expect(
        sha256Of(abs),
        `${rel} changed without a recapture`,
      ).toBe(expected);
    }
  });

  it("overview measurements do not report the hidden delete confirm", () => {
    const yml = evidenceText();
    for (const file of OVERVIEW_FILES) {
      const row = measurement(yml, file);
      expect(row.confirmClass, file).toBe("");
      expect(row.confirmBg, file).toBe("");
    }
  });

  it("delete-form measurements still record the visible danger confirm", () => {
    const yml = evidenceText();
    for (const file of DELETE_FORM_FILES) {
      const row = measurement(yml, file);
      expect(row.confirmClass, file).toMatch(/\bbtn-danger\b/);
      expect(row.confirmBg, file).not.toBe("");
      expect(row.confirmBg, file).not.toBe("rgb(41, 98, 255)");
      expect(row.confirmBg, file).not.toBe("rgb(77, 130, 255)");
    }
  });

  it("EN/ZH twins are present for every crop", () => {
    const listed = [...OVERVIEW_FILES, ...DELETE_FORM_FILES];
    for (const file of listed) {
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
      if (file.includes("-en-")) {
        const zh = file.replace("-en-", "-zh-");
        expect(listed, `${file} is missing its ZH twin in the lock`).toContain(zh);
        expect(existsSync(join(CROP_DIR, zh)), zh).toBe(true);
      }
    }
  });

  it("measurement finds a row whose file key contains regex metacharacters", () => {
    const file = "a+b (1).png";
    const yml = `measurements:\n  ${file}: {confirmClass: "found", confirmBg: ""}\n`;
    const row = measurement(yml, file);
    expect(row.confirmClass).toBe("found");
    expect(row.confirmBg).toBe("");
  });
});
