import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f12-9-team-ownership-transfer");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const LAYOUT_FILES = [
  "terminal/components/settings/SectionTeam.tsx",
  "terminal/components/settings/SectionTeam.module.css",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/app/settings.css",
  "terminal/lib/i18n.tsx",
];
const BUTTON_FILES = [
  "desktop-en-transfer-button.png",
  "desktop-zh-transfer-button.png",
  "mobile-en-transfer-button.png",
  "mobile-zh-transfer-button.png",
];
const CONFIRM_FILES = [
  "desktop-en-transfer-confirm.png",
  "desktop-zh-transfer-confirm.png",
  "mobile-en-transfer-confirm.png",
  "mobile-zh-transfer-confirm.png",
];

function evidenceText(): string {
  return readFileSync(EVIDENCE, "utf8");
}

function capturedAtHead(yml: string): string {
  // Data line only. A `/m` regex with an optional "# " prefix returns the
  // comment on line 4 and would let a bogus data-line SHA pass.
  const m = yml.match(/^capturedAtHead: ([0-9a-f]{40})$/m);
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
    if (map[m[1]]) throw new Error(`layoutFiles repeats ${m[1]}`);
    map[m[1]] = m[2];
  }
  if (Object.keys(map).length === 0) throw new Error("EVIDENCE.yml layoutFiles is empty");
  return map;
}

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function sha256Buf(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function git(args: string[]): { ok: boolean; stdout: Buffer } {
  const r = spawnSync("git", args, { cwd: REPO, maxBuffer: 20_000_000, timeout: 30_000 });
  return { ok: (r.status ?? 1) === 0, stdout: (r.stdout as Buffer) || Buffer.alloc(0) };
}

function commitExists(sha: string): boolean {
  return git(["cat-file", "-e", `${sha}^{commit}`]).ok;
}

function fetchCommitOnce(sha: string): void {
  git(["fetch", "--depth=1", "origin", sha]);
}

function blobAt(sha: string, rel: string): Buffer | null {
  const r = git(["cat-file", "-p", `${sha}:${rel}`]);
  return r.ok ? r.stdout : null;
}

function requireCapturedLayoutBytes(
  yml: string,
  readBlob: (sha: string, rel: string) => Buffer | null,
): Record<string, string> {
  const sha = capturedAtHead(yml);
  const recorded = layoutFileMap(yml);
  for (const rel of LAYOUT_FILES) {
    if (!recorded[rel]) throw new Error(`layoutFiles is missing ${rel}`);
  }
  for (const [rel, expected] of Object.entries(recorded)) {
    const blob = readBlob(sha, rel);
    if (!blob) throw new Error(`git cannot read ${rel} at capturedAtHead ${sha}`);
    if (sha256Buf(blob) !== expected) {
      throw new Error(`${rel} hash does not match the file bytes at capturedAtHead ${sha}`);
    }
  }
  return recorded;
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

describe("B-F12-9 evidence lock is the sha256 of the layout sources", () => {
  it("capturedAtHead names the exact layout bytes, including after a squash merge", () => {
    // Seat ruling B1(ii): capturedAtHead is no longer informational. RED on 75916e59
    // because EVIDENCE.yml still names 144fbbd7 while layoutFiles hashes were restamped
    // to this head's SectionTeam.tsx bytes (99/22 after the stacked-base merge).
    const yml = evidenceText();
    const sha = capturedAtHead(yml);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    if (!commitExists(sha)) {
      fetchCommitOnce(sha);
    }
    expect(
      commitExists(sha),
      `capturedAtHead ${sha} is not a commit reachable from origin — recapture and record the real code commit`,
    ).toBe(true);
    // Squash merges preserve the captured source bytes but replace branch ancestry.
    // Keep B1(ii)'s capture-commit binding: every recorded hash must match that
    // actual commit AND the checked-out source. A new HEAD or a restamped hash
    // cannot substitute for the code that generated the retained crops.
    const recorded = requireCapturedLayoutBytes(yml, blobAt);
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel], `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const [rel, expected] of Object.entries(recorded)) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(true);
      expect(sha256Of(abs), `${rel} changed without a recapture`).toBe(expected);
    }
  });

  it("layout file sha256 matches EVIDENCE.yml (RED when a layout file changes without a recapture)", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel], `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const [rel, expected] of Object.entries(recorded)) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(true);
      expect(sha256Of(abs), `${rel} changed without a recapture`).toBe(expected);
    }
  });

  it("button crops record the transfer control; confirm crops record the consequence sentence", () => {
    const yml = evidenceText();
    for (const file of BUTTON_FILES) {
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
      const row = measurement(yml, file);
      expect(row.transferButtonText, file).toBeTruthy();
    }
    for (const file of CONFIRM_FILES) {
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
      const row = measurement(yml, file);
      expect(row.dialogPresent, file).toBe("true");
      expect(row.consequenceText, file).toBeTruthy();
      if (file.includes("-zh-")) {
        expect(row.consequenceText, file).toBe(
          "你将成为管理员，对方将成为团队所有者。之后对方可以随时转回给你。",
        );
        expect(row.confirmTitle, file).toMatch(/将所有权转移给/);
      } else {
        expect(row.consequenceText, file).toBe(
          "You will become an administrator. They will become the team owner. The new owner can transfer it back to you later.",
        );
        expect(row.confirmTitle, file).toMatch(/^Transfer ownership to /);
      }
    }
  });

  it("crops name the invitations group and never paint the invited person as a Member role badge", () => {
    // Seat ruling B1(iii): RED on 75916e59 because measurements still start
    // roleBadgeText with Member and have no inviteBadgeText (the committed
    // PNGs still show pending@example.com as a Member/成员 badge).
    const yml = evidenceText();
    for (const file of [...BUTTON_FILES, ...CONFIRM_FILES]) {
      const row = measurement(yml, file);
      expect(row.inviteGroupTitle, file).toBeTruthy();
      expect(row.inviteBadgeText, file).toBeTruthy();
      expect(row.roleBadgeText, file).toMatch(/^(Owner|所有者) \|/);
      expect(row.roleBadgeText, file).not.toMatch(/^(Member|成员)(\s|$)/);
      if (file.includes("-zh-")) {
        expect(row.inviteGroupTitle, file).toBe("尚未接受的邀请");
        expect(row.inviteBadgeText, file).toBe("已邀请，尚未接受");
      } else {
        expect(row.inviteGroupTitle, file).toBe("Invitations not yet accepted");
        expect(row.inviteBadgeText, file).toBe("Invited — not yet accepted");
      }
    }
  });

  it("EN/ZH twins are present for every crop both in the lock and on disk", () => {
    const listed = [...BUTTON_FILES, ...CONFIRM_FILES];
    for (const file of listed) {
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
      if (file.includes("-en-")) {
        const zh = file.replace("-en-", "-zh-");
        expect(listed, `${file} is missing its ZH twin in the lock`).toContain(zh);
        expect(existsSync(join(CROP_DIR, zh)), zh).toBe(true);
      }
    }
  });
});

describe("B-F12-9 capture-commit binding negative controls", () => {
  const sha = "1".repeat(40);
  const blobs = new Map(LAYOUT_FILES.map((rel) => [rel, Buffer.from(`captured:${rel}`)]));
  const rows = LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256Buf(blobs.get(rel)!)}"`);
  const yml = `# capturedAtHead: ${sha}\ncapturedAtHead: ${sha}\nlayoutFiles:\n${rows.join("\n")}\n`;
  const readCaptured = (ref: string, rel: string) => ref === sha ? blobs.get(rel) ?? null : null;

  it("accepts byte-bound captured source without consulting current branch ancestry", () => {
    expect(Object.keys(requireCapturedLayoutBytes(yml, readCaptured))).toEqual(LAYOUT_FILES);
  });

  it("does not let a valid comment mask a false data-line capture SHA", () => {
    const tampered = yml.replace(/^capturedAtHead: .+$/m, `capturedAtHead: ${"2".repeat(40)}`);
    expect(() => requireCapturedLayoutBytes(tampered, readCaptured)).toThrow(/git cannot read/);
    expect(() => requireCapturedLayoutBytes(yml.replace(/^capturedAtHead: .+\n/m, ""), readCaptured))
      .toThrow(/missing a 40-char capturedAtHead/);
  });

  it("rejects hashes restamped to bytes absent from the actual capture commit", () => {
    const tampered = yml.replace(sha256Buf(blobs.get(LAYOUT_FILES[0])!), sha256Buf(Buffer.from("later source")));
    expect(() => requireCapturedLayoutBytes(tampered, readCaptured)).toThrow(/hash does not match/);
  });

  it("rejects omitted or duplicate required layout rows", () => {
    expect(() => requireCapturedLayoutBytes(yml.replace(`${rows[0]}\n`, ""), readCaptured))
      .toThrow(/layoutFiles is missing/);
    expect(() => requireCapturedLayoutBytes(`${yml}${rows[0]}\n`, readCaptured))
      .toThrow(/layoutFiles repeats/);
  });

  it("rejects a missing captured blob even when the manifest hash is valid", () => {
    expect(() => requireCapturedLayoutBytes(yml, (ref, rel) => rel === LAYOUT_FILES[0] ? null : readCaptured(ref, rel)))
      .toThrow(/git cannot read/);
  });
});
