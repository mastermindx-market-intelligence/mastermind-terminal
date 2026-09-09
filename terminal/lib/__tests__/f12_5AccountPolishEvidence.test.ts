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
// The deviation comment is REQUIRED only when the recorded sha256 for a layout
// file differs from that file's sha256 at capturedAtHead. Tests never shell out
// to git. When capturedAtHead is the original capture below, the test compares
// the recorded digest to the baked sha256 of that committed blob (ordinary
// file reads of EVIDENCE.yml plus the constant). When capturedAtHead is a later
// recapture, the blob cannot be read without git, so the test derives the
// condition from the comment's own SHA field being different from
// capturedAtHead. A later recapture that sets capturedAtHead to the depicted
// head and drops the comment therefore passes. Two fixtures prove both
// branches; the live file uses the same helper.
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
    const m = line.match(/^  (\S+): "?([0-9a-f]{64})"?\s*(#.*)?$/);
    if (!m) throw new Error(`layoutFiles row is not path: sha256: ${line}`);
    map[m[1]] = m[2];
  }
  if (Object.keys(map).length === 0) throw new Error("EVIDENCE.yml layoutFiles is empty");
  return map;
}

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

/** Original B-F12-5 capture. Baked so the lock can compare without git. */
const ORIGINAL_CAPTURED_AT_HEAD = "e73e5bdc8d9ba55887b9d35a8936ac4966ade80b";
const SHA256_AT_ORIGINAL_CAPTURE: Record<string, string> = {
  "terminal/components/settings/SectionAccount.tsx":
    "c52efebbd06b1bc924c9d94c6ac22dab777b3416bc17e55c5ea0179d9ae51e62",
  "terminal/app/settings.css":
    "3189163136d943431cbf52e4b5d241c105b695ba5af94c4c2e29151d537b5ef5",
};

const DEVIATION_COMMENT =
  /# no visual change in this file \(no JSX, class or string edit\); crops unchanged from ([0-9a-f]{7,40})/;

function layoutRow(yml: string, rel: string): string {
  const line = yml.split("\n").find((l) => l.startsWith("  ") && l.includes(`${rel}:`));
  if (!line) throw new Error(`layoutFiles row missing for ${rel}`);
  return line;
}

function depictedShaFromComment(line: string): string | null {
  const m = line.match(DEVIATION_COMMENT);
  return m ? m[1] : null;
}

/**
 * Deviation comment required only when recorded sha256 differs from the file's
 * sha256 at capturedAtHead. See the file-level docstring for which method is
 * used (baked original-capture digest vs comment SHA field).
 */
function deviationCommentRequired(yml: string, rel: string): boolean {
  const recorded = layoutFileMap(yml)[rel];
  const captured = capturedAtHead(yml);
  if (captured === ORIGINAL_CAPTURED_AT_HEAD) {
    const atCapture = SHA256_AT_ORIGINAL_CAPTURE[rel];
    if (atCapture) return recorded !== atCapture;
  }
  // Blob at capturedAtHead cannot be read without git: derive from the
  // comment's own SHA field being different from capturedAtHead.
  const depicted = depictedShaFromComment(layoutRow(yml, rel));
  if (!depicted) return false;
  return depicted !== captured && !captured.startsWith(depicted);
}

function assertDeviationComment(yml: string, rel: string) {
  const line = layoutRow(yml, rel);
  if (deviationCommentRequired(yml, rel)) {
    expect(
      line.match(DEVIATION_COMMENT),
      `hash differs from capturedAtHead; the R3 deviation comment is required on ${rel}`,
    ).toBeTruthy();
  }
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

  it("the live lock requires the deviation comment only when the SectionAccount hash differs from capturedAtHead", () => {
    assertDeviationComment(evidenceText(), "terminal/components/settings/SectionAccount.tsx");
  });

  it("fixture: recorded sha256 differs from capturedAtHead → deviation comment required", () => {
    const yml = [
      `# capturedAtHead: ${ORIGINAL_CAPTURED_AT_HEAD}`,
      "layoutFiles:",
      `  terminal/components/settings/SectionAccount.tsx: "${"ab".repeat(32)}"  # no visual change in this file (no JSX, class or string edit); crops unchanged from e73e5bdc`,
      `  terminal/app/settings.css: "${SHA256_AT_ORIGINAL_CAPTURE["terminal/app/settings.css"]}"`,
    ].join("\n");
    expect(deviationCommentRequired(yml, "terminal/components/settings/SectionAccount.tsx")).toBe(true);
    assertDeviationComment(yml, "terminal/components/settings/SectionAccount.tsx");
  });

  it("fixture: a later recapture that sets capturedAtHead to the depicted head and drops the comment passes", () => {
    const recaptureHead = "dddddddddddddddddddddddddddddddddddddddd";
    const yml = [
      `# capturedAtHead: ${recaptureHead}`,
      "layoutFiles:",
      `  terminal/components/settings/SectionAccount.tsx: "${"ef".repeat(32)}"`,
      `  terminal/app/settings.css: "${"cd".repeat(32)}"`,
    ].join("\n");
    expect(deviationCommentRequired(yml, "terminal/components/settings/SectionAccount.tsx")).toBe(false);
    expect(() => assertDeviationComment(yml, "terminal/components/settings/SectionAccount.tsx")).not.toThrow();
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
