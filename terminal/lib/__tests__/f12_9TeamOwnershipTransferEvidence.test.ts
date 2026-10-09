import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

function git(args: string[]): { ok: boolean; status: number | null; stdout: Buffer; failure: string } {
  const r = spawnSync("git", args, { cwd: REPO, maxBuffer: 20_000_000, timeout: 30_000 });
  const ok = (r.status ?? 1) === 0;
  const stderr = ((r.stderr as Buffer) || Buffer.alloc(0)).toString("utf8").trim().replace(/\s*\n\s*/g, " | ");
  // r.error reads "spawnSync git ETIMEDOUT" when the 30s timeout kills git.
  const failure = ok ? "" : r.error ? r.error.message : `exit ${r.status ?? r.signal}: ${stderr}`;
  return { ok, status: r.status, stdout: (r.stdout as Buffer) || Buffer.alloc(0), failure };
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

function commitTime(sha: string): number | null {
  const r = git(["show", "-s", "--format=%ct", sha]);
  const t = Number(r.stdout.toString("utf8").trim());
  return r.ok && Number.isSafeInteger(t) && t > 0 ? t : null;
}

type Cut = { sha: string; time: number };

// Shallow boundaries that cut HEAD's own history. A full clone has none, even
// after fetchCommitOnce grafts a commit that HEAD never reaches.
function headCuts(): Cut[] | null {
  const at = git(["rev-parse", "--git-path", "shallow"]);
  if (!at.ok) return null;
  const file = resolve(REPO, at.stdout.toString("utf8").trim());
  if (!existsSync(file)) return [];
  const cuts: Cut[] = [];
  for (const sha of readFileSync(file, "utf8").split("\n")) {
    if (!/^[0-9a-f]{40}$/.test(sha) || !git(["merge-base", "--is-ancestor", sha, "HEAD"]).ok) continue;
    const time = commitTime(sha);
    if (time === null) return null;
    cuts.push({ sha, time });
  }
  return cuts;
}

const DAY = 86_400;

function iso(t: number): string {
  return new Date(t * 1000).toISOString();
}

type Ancestry = { verdict: "ancestor" | "not-ancestor" | "unknown"; detail: string };

function ancestryOf(sha: string): Ancestry {
  const first = git(["merge-base", "--is-ancestor", sha, "HEAD"]);
  if (first.ok) return { verdict: "ancestor", detail: "merge-base" };
  // GitHub's pull_request checkout is fetch-depth 2 of the merge commit
  // (HEAD = merge, parents = base + PR tip). capturedAtHead is the PR
  // tip's parent by the B1 crops-follow-code flow, so it sits behind
  // .git/shallow: merge-base cannot walk the PR tip's parent even after
  // the ruled `git fetch --depth=1 origin <sha>` brings the object in
  // disconnected. Parent SHAs in commit headers of objects we do have
  // still name that hop. Walk those headers (no second fetch). A sha
  // that is not on HEAD's parent chain still fails.
  const head = git(["rev-parse", "HEAD"]);
  if (!head.ok) return { verdict: "unknown", detail: `git rev-parse HEAD: ${head.failure}` };
  const headSha = head.stdout.toString("utf8").trim();
  if (headSha === sha) return { verdict: "ancestor", detail: "HEAD itself" };
  const walked: Ancestry = { verdict: "ancestor", detail: "a parent line in HEAD's commit headers" };
  const seen = new Set<string>();
  let frontier = [headSha];
  for (let hops = 0; hops < 6 && frontier.length > 0; hops += 1) {
    const next: string[] = [];
    for (const c of frontier) {
      if (seen.has(c)) continue;
      seen.add(c);
      if (c === sha) return walked;
      for (const p of commitParents(c)) {
        if (p === sha) return walked;
        if (!seen.has(p) && commitExists(p)) next.push(p);
      }
    }
    frontier = next;
  }
  if (first.status !== 1) return { verdict: "unknown", detail: `git merge-base: ${first.failure}` };
  // A squash merge lands the packet's bytes on a brand-new master commit, so
  // capturedAtHead can sit more than two hops behind HEAD, beyond a
  // fetch-depth 2 checkout. An ancestor cannot hide behind a shallow cut more
  // than a day older than itself (a day of committer clock skew), so
  // merge-base's "no" stands when every cut under HEAD is that old; a full
  // clone has none. Otherwise fetch HEAD's parents back to two days before
  // capturedAtHead and ask again. Never a bare `git fetch --deepen=N origin`:
  // in CI that follows the `+refs/heads/*` refspec into every remote branch
  // (~385) and hit the 30s timeout. A fetch that fails is "unknown", never
  // "not an ancestor".
  const shaTime = commitTime(sha);
  const cuts = headCuts();
  if (shaTime === null || cuts === null) return { verdict: "unknown", detail: "git cannot date the shallow cuts under HEAD" };
  if (cuts.every((c) => c.time < shaTime - DAY)) {
    const local = cuts.length === 0 ? "HEAD's whole history is local" : `HEAD's history is unbroken back to ${iso(Math.max(...cuts.map((c) => c.time)))}`;
    return { verdict: "not-ancestor", detail: local };
  }
  const since = shaTime - 2 * DAY;
  const present = commitParents(headSha).filter(commitExists);
  const wants = present.length > 0 ? present : [headSha];
  // --shallow-since also cuts: every commit on its horizon becomes a shallow
  // boundary. Fetch only if no local history under a want already reaches
  // past that horizon, so the fetch can only add history. A want that is
  // itself a cut (CI's fetch-depth 2) has no local history under it.
  for (const w of wants) {
    if (cuts.some((c) => c.sha === w)) continue;
    const older = git(["rev-list", "-1", `--before=${since}`, w]);
    if (!older.ok || older.stdout.length > 0) {
      return { verdict: "unknown", detail: `local history under ${w} reaches past ${iso(since)}; a --shallow-since fetch would cut it` };
    }
  }
  const fetched = git(["fetch", "--no-tags", `--shallow-since=${since}`, "origin", ...wants]);
  if (!fetched.ok) {
    return { verdict: "unknown", detail: `git fetch --shallow-since=${since} origin ${wants.join(" ")}: ${fetched.failure}` };
  }
  const again = git(["merge-base", "--is-ancestor", sha, "HEAD"]);
  if (again.ok) return { verdict: "ancestor", detail: `merge-base after fetching back to ${iso(since)}` };
  if (again.status !== 1) return { verdict: "unknown", detail: `git merge-base: ${again.failure}` };
  // The horizon is not a clean line: a merge whose other parent predates it
  // is cut whole, mainline parent included.
  const after = headCuts();
  if (after === null) return { verdict: "unknown", detail: "git cannot date the shallow cuts under HEAD" };
  const hiding = after.find((c) => c.time >= shaTime - DAY);
  if (hiding) return { verdict: "unknown", detail: `HEAD's history is still cut at ${hiding.sha} (${iso(hiding.time)})` };
  return { verdict: "not-ancestor", detail: `not on HEAD's history back to ${iso(since)}` };
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
    const ancestry = ancestryOf(sha);
    expect(
      ancestry.verdict,
      ancestry.verdict === "unknown"
        ? `cannot tell whether capturedAtHead ${sha} is an ancestor-or-equal of HEAD: ${ancestry.detail}`
        : `capturedAtHead ${sha} is not an ancestor-or-equal of HEAD (${ancestry.detail})`,
    ).toBe("ancestor");
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
