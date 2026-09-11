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

function commitParents(sha: string): string[] {
  const r = git(["cat-file", "-p", sha]);
  if (!r.ok) return [];
  const parents: string[] = [];
  for (const line of r.stdout.toString("utf8").split("\n")) {
    if (line === "") break;
    const m = line.match(/^parent ([0-9a-f]{40})$/);
    if (m) parents.push(m[1]);
  }
  return parents;
}

function isAncestorOrEqual(sha: string): boolean {
  if (git(["merge-base", "--is-ancestor", sha, "HEAD"]).ok) return true;
  // GitHub's pull_request checkout is fetch-depth 2 of the merge commit
  // (HEAD = merge, parents = base + PR tip). capturedAtHead is the PR
  // tip's parent by the B1 crops-follow-code flow, so it sits behind
  // .git/shallow: merge-base cannot walk the PR tip's parent even after
  // the ruled `git fetch --depth=1 origin <sha>` brings the object in
  // disconnected. Parent SHAs in commit headers of objects we do have
  // still name that hop. Walk those headers (no second fetch). A sha
  // that is not on HEAD's parent chain still fails.
  const head = git(["rev-parse", "HEAD"]);
  if (!head.ok) return false;
  const headSha = head.stdout.toString("utf8").trim();
  if (headSha === sha) return true;
  const seen = new Set<string>();
  let frontier = [headSha];
  for (let hops = 0; hops < 6 && frontier.length > 0; hops += 1) {
    const next: string[] = [];
    for (const c of frontier) {
      if (seen.has(c)) continue;
      seen.add(c);
      if (c === sha) return true;
      for (const p of commitParents(c)) {
        if (p === sha) return true;
        if (!seen.has(p) && commitExists(p)) next.push(p);
      }
    }
    frontier = next;
  }
  return false;
}

function blobAt(sha: string, rel: string): Buffer | null {
  const r = git(["cat-file", "-p", `${sha}:${rel}`]);
  return r.ok ? r.stdout : null;
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
  it("capturedAtHead is an ancestor-or-equal of HEAD and layoutFiles hashes match the bytes at that commit", () => {
    // Seat ruling B1(ii): capturedAtHead is no longer informational. RED on 75916e59
    // because EVIDENCE.yml still names 144fbbd7 while layoutFiles hashes were restamped
    // to this head's SectionTeam.tsx bytes (99/22 after the stacked-base merge).
    const yml = evidenceText();
    const sha = capturedAtHead(yml);
    const recorded = layoutFileMap(yml);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    if (!commitExists(sha)) {
      fetchCommitOnce(sha);
    }
    expect(
      commitExists(sha),
      `capturedAtHead ${sha} is not a commit reachable from origin — recapture and record the real code commit`,
    ).toBe(true);
    expect(isAncestorOrEqual(sha), `capturedAtHead ${sha} is not an ancestor-or-equal of HEAD`).toBe(true);
    for (const [rel, expected] of Object.entries(recorded)) {
      const blob = blobAt(sha, rel);
      expect(blob, `git cannot read ${rel} at capturedAtHead ${sha}`).not.toBeNull();
      expect(sha256Buf(blob!), `${rel} hash does not match the file bytes at capturedAtHead ${sha}`).toBe(expected);
    }
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
