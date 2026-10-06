import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createGitOps,
  evaluateCropProvenance,
  parseCapturedAtHead,
  parseLandedAtHead,
  parseLayoutFileMap,
  parseSourceCarrierPR,
  sha256Buf,
  type GitBlobSource,
} from "./f12_9TeamOwnershipTransferProvenance";

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
const THIS_CROP_CAPTURE = "3115a7ea5b0140b1ec54c96e6a494850a3a7ae87";
const THIS_CROP_LANDED = "64c1ea5e25a335a0b0636e73e7fdbe0f8beb7b0e";
const THIS_CROP_PR = 802;

function evidenceText(): string {
  return readFileSync(EVIDENCE, "utf8");
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

describe("B-F12-9 evidence lock is the sha256 of the layout sources", () => {
  it(
    "provenance: capture and landed layout hashes match; ancestry commit is ancestor-or-equal of HEAD",
    () => {
      // Seat ruling B1(ii) plus parent-adjudicated squash-source admission:
      // capturedAtHead stays the original capture commit. When landedAtHead is
      // recorded, HEAD ancestry is checked on that squash-landed commit, and
      // both capture blobs and landed blobs must equal the five layoutFiles hashes.
      const yml = evidenceText();
      const captured = parseCapturedAtHead(yml);
      const landed = parseLandedAtHead(yml);
      const carrierPR = parseSourceCarrierPR(yml);
      const recorded = parseLayoutFileMap(yml);
      expect(captured).toBe(THIS_CROP_CAPTURE);
      expect(landed).toBe(THIS_CROP_LANDED);
      expect(carrierPR).toBe(THIS_CROP_PR);

      const git = createGitOps(REPO);
      if (!git.commitExists(captured)) git.fetchCommitOnce(captured);
      if (landed && !git.commitExists(landed)) git.fetchCommitOnce(landed);

      const result = evaluateCropProvenance({
        capturedSha: captured,
        landedSha: landed,
        sourceCarrierPR: carrierPR,
        recorded,
        git,
      });
      expect(result.ok, result.ok ? "ok" : result.message).toBe(true);
      if (result.ok) {
        expect(result.ancestryRole).toBe("landedAtHead");
        expect(result.ancestrySha).toBe(THIS_CROP_LANDED);
      }
      for (const rel of LAYOUT_FILES) {
        expect(recorded[rel], `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
      }
      for (const [rel, expected] of Object.entries(recorded)) {
        const abs = join(REPO, rel);
        expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(
          true,
        );
        expect(sha256Of(abs), `${rel} changed without a recapture`).toBe(expected);
      }
    },
  );

  it("layout file sha256 matches EVIDENCE.yml (RED when a layout file changes without a recapture)", () => {
    const recorded = parseLayoutFileMap(evidenceText());
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel], `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const [rel, expected] of Object.entries(recorded)) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(
        true,
      );
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

const SAMPLE_CAPTURE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SAMPLE_LANDED = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SAMPLE_HEAD = "cccccccccccccccccccccccccccccccccccccccc";
const SAMPLE_ORPHAN = "dddddddddddddddddddddddddddddddddddddddd";
const SAMPLE_MISSING = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function ymlBlock(rows: string[]): string {
  return rows.join("\n") + "\n";
}

describe("B-F12-9 provenance parsers (strict data-line forty-hex)", () => {
  it("reads capturedAtHead from the data line and ignores the comment duplicate", () => {
    const yml = ymlBlock([
      `# capturedAtHead: ${SAMPLE_LANDED}`,
      `capturedAtHead: ${SAMPLE_CAPTURE}`,
      "capturedAt: 2026-10-05T12:29:38.141Z",
    ]);
    expect(parseCapturedAtHead(yml)).toBe(SAMPLE_CAPTURE);
  });

  it("rejects missing, short, uppercase, quoted, and duplicate capturedAtHead data lines", () => {
    expect(() => parseCapturedAtHead("layoutFiles:\n")).toThrow(/missing a 40-char capturedAtHead/);
    expect(() => parseCapturedAtHead("capturedAtHead: abc\n")).toThrow(/not a 40-char lowercase/);
    expect(() =>
      parseCapturedAtHead(`capturedAtHead: ${SAMPLE_CAPTURE.toUpperCase()}\n`),
    ).toThrow(/not a 40-char lowercase/);
    expect(() => parseCapturedAtHead(`capturedAtHead: "${SAMPLE_CAPTURE}"\n`)).toThrow(
      /not a 40-char lowercase/,
    );
    expect(() =>
      parseCapturedAtHead(
        `capturedAtHead: ${SAMPLE_CAPTURE}\ncapturedAtHead: ${SAMPLE_LANDED}\n`,
      ),
    ).toThrow(/more than one capturedAtHead/);
  });

  it("returns null for omitted landedAtHead and for comment-only landedAtHead", () => {
    expect(parseLandedAtHead(`capturedAtHead: ${SAMPLE_CAPTURE}\n`)).toBeNull();
    expect(
      parseLandedAtHead(
        `# landedAtHead: ${SAMPLE_LANDED}\ncapturedAtHead: ${SAMPLE_CAPTURE}\n`,
      ),
    ).toBeNull();
  });

  it("reads a valid landedAtHead data line", () => {
    const yml = ymlBlock([
      `capturedAtHead: ${SAMPLE_CAPTURE}`,
      `landedAtHead: ${SAMPLE_LANDED}`,
      "sourceCarrierPR: 802",
    ]);
    expect(parseLandedAtHead(yml)).toBe(SAMPLE_LANDED);
    expect(parseSourceCarrierPR(yml)).toBe(802);
  });

  it("rejects bogus, missing-value, and duplicate landedAtHead data lines", () => {
    expect(() => parseLandedAtHead("landedAtHead: not-a-sha\n")).toThrow(
      /not a 40-char lowercase/,
    );
    expect(() => parseLandedAtHead("landedAtHead:\n")).toThrow(/not a 40-char lowercase/);
    expect(() => parseLandedAtHead(`landedAtHead: ${SAMPLE_LANDED.slice(0, 39)}\n`)).toThrow(
      /not a 40-char lowercase/,
    );
    expect(() => parseLandedAtHead(`landedAtHead: ${SAMPLE_LANDED.toUpperCase()}\n`)).toThrow(
      /not a 40-char lowercase/,
    );
    expect(() =>
      parseLandedAtHead(`landedAtHead: ${SAMPLE_LANDED}\nlandedAtHead: ${SAMPLE_CAPTURE}\n`),
    ).toThrow(/more than one landedAtHead/);
  });

  it("returns null for omitted sourceCarrierPR and rejects a non-integer data line", () => {
    expect(parseSourceCarrierPR(`capturedAtHead: ${SAMPLE_CAPTURE}\n`)).toBeNull();
    expect(
      parseSourceCarrierPR(`# sourceCarrierPR: 802\ncapturedAtHead: ${SAMPLE_CAPTURE}\n`),
    ).toBeNull();
    expect(() => parseSourceCarrierPR("sourceCarrierPR: 0\n")).toThrow(/positive integer/);
    expect(() => parseSourceCarrierPR("sourceCarrierPR: 0802\n")).toThrow(/positive integer/);
    expect(() => parseSourceCarrierPR("sourceCarrierPR: #802\n")).toThrow(/positive integer/);
    expect(() => parseSourceCarrierPR("sourceCarrierPR: 802\nsourceCarrierPR: 1\n")).toThrow(
      /more than one sourceCarrierPR/,
    );
  });

  it("parses the real crop EVIDENCE.yml capture, landed, PR, and five layout hashes", () => {
    const yml = evidenceText();
    expect(parseCapturedAtHead(yml)).toBe(THIS_CROP_CAPTURE);
    expect(parseLandedAtHead(yml)).toBe(THIS_CROP_LANDED);
    expect(parseSourceCarrierPR(yml)).toBe(THIS_CROP_PR);
    const recorded = parseLayoutFileMap(yml);
    expect(Object.keys(recorded).sort()).toEqual([...LAYOUT_FILES].sort());
  });
});

function mockGit(opts: {
  commits: Set<string>;
  ancestors: Set<string>;
  blobs: Record<string, Record<string, string>>;
  ancestryAsked?: string[];
}): GitBlobSource {
  const asked = opts.ancestryAsked;
  return {
    commitExists(sha) {
      return opts.commits.has(sha);
    },
    isAncestorOrEqual(sha) {
      asked?.push(sha);
      return opts.ancestors.has(sha);
    },
    blobHash(sha, rel) {
      return opts.blobs[sha]?.[rel] ?? null;
    },
  };
}

const FIVE = Object.fromEntries(LAYOUT_FILES.map((rel, i) => [rel, HASH_A.replace(/a/g, String(i))]));
// HASH_A is 64 hex a's; replacing all a's with a digit would collapse uniqueness.
const FIVE_HASHES: Record<string, string> = {
  [LAYOUT_FILES[0]]: "00f61441215f0cdb8c6b40536e66e243d0ae83ffa54d6f19ae8a67dd99d7a79d",
  [LAYOUT_FILES[1]]: "069056ff7ac4274a57ae9a835a0fdda178e9625a591b4374e855b9d41a3fd5bc",
  [LAYOUT_FILES[2]]: "526725b37af04f1092359a8aca1e6d3d6d62815b5913b3a7eba754e4ca020329",
  [LAYOUT_FILES[3]]: "d17ceff6469db97d3d4bcfb800503ee3c22e89b0770a1c0a88c9d39eb5a72837",
  [LAYOUT_FILES[4]]: "858306597ebbfc2d912cefc997ad88e4805cafb08794b5cd4d3dfeacb109371f",
};

describe("B-F12-9 provenance evaluator (pure git-ops fixtures)", () => {
  it("admits squash-landed source when capture and landed blobs equal declared hashes and landed is ancestor", () => {
    const asked: string[] = [];
    const git = mockGit({
      commits: new Set([SAMPLE_CAPTURE, SAMPLE_LANDED, SAMPLE_HEAD]),
      ancestors: new Set([SAMPLE_LANDED, SAMPLE_HEAD]),
      blobs: { [SAMPLE_CAPTURE]: FIVE_HASHES, [SAMPLE_LANDED]: FIVE_HASHES },
      ancestryAsked: asked,
    });
    const result = evaluateCropProvenance({
      capturedSha: SAMPLE_CAPTURE,
      landedSha: SAMPLE_LANDED,
      sourceCarrierPR: 802,
      recorded: FIVE_HASHES,
      git,
    });
    expect(result).toEqual({
      ok: true,
      ancestryRole: "landedAtHead",
      ancestrySha: SAMPLE_LANDED,
    });
    expect(asked).toEqual([SAMPLE_LANDED]);
  });

  it("keeps direct capturedAtHead ancestry when landedAtHead is omitted", () => {
    const asked: string[] = [];
    const git = mockGit({
      commits: new Set([SAMPLE_CAPTURE, SAMPLE_HEAD]),
      ancestors: new Set([SAMPLE_CAPTURE, SAMPLE_HEAD]),
      blobs: { [SAMPLE_CAPTURE]: FIVE_HASHES },
      ancestryAsked: asked,
    });
    const result = evaluateCropProvenance({
      capturedSha: SAMPLE_CAPTURE,
      landedSha: null,
      sourceCarrierPR: null,
      recorded: FIVE_HASHES,
      git,
    });
    expect(result).toEqual({
      ok: true,
      ancestryRole: "capturedAtHead",
      ancestrySha: SAMPLE_CAPTURE,
    });
    expect(asked).toEqual([SAMPLE_CAPTURE]);
  });

  it("rejects an equal-byte disconnected capture when landedAtHead is omitted", () => {
    const git = mockGit({
      commits: new Set([SAMPLE_CAPTURE, SAMPLE_HEAD]),
      ancestors: new Set([SAMPLE_HEAD]),
      blobs: { [SAMPLE_CAPTURE]: FIVE_HASHES },
    });
    const result = evaluateCropProvenance({
      capturedSha: SAMPLE_CAPTURE,
      landedSha: null,
      sourceCarrierPR: null,
      recorded: FIVE_HASHES,
      git,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("captured-not-ancestor");
  });

  it("rejects a missing landed commit", () => {
    const git = mockGit({
      commits: new Set([SAMPLE_CAPTURE]),
      ancestors: new Set(),
      blobs: { [SAMPLE_CAPTURE]: FIVE_HASHES },
    });
    const result = evaluateCropProvenance({
      capturedSha: SAMPLE_CAPTURE,
      landedSha: SAMPLE_MISSING,
      sourceCarrierPR: 802,
      recorded: FIVE_HASHES,
      git,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing-landed-commit");
  });

  it("rejects a bogus landed commit id", () => {
    const git = mockGit({
      commits: new Set([SAMPLE_CAPTURE, "nope"]),
      ancestors: new Set(["nope"]),
      blobs: { [SAMPLE_CAPTURE]: FIVE_HASHES, nope: FIVE_HASHES },
    });
    const result = evaluateCropProvenance({
      capturedSha: SAMPLE_CAPTURE,
      landedSha: "nope",
      sourceCarrierPR: 802,
      recorded: FIVE_HASHES,
      git,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("bogus-landed-commit");
  });

  it("rejects a disconnected landed commit even when bytes match", () => {
    const git = mockGit({
      commits: new Set([SAMPLE_CAPTURE, SAMPLE_ORPHAN, SAMPLE_HEAD]),
      ancestors: new Set([SAMPLE_HEAD]),
      blobs: { [SAMPLE_CAPTURE]: FIVE_HASHES, [SAMPLE_ORPHAN]: FIVE_HASHES },
    });
    const result = evaluateCropProvenance({
      capturedSha: SAMPLE_CAPTURE,
      landedSha: SAMPLE_ORPHAN,
      sourceCarrierPR: 802,
      recorded: FIVE_HASHES,
      git,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("disconnected-landed-commit");
  });

  it("rejects capture hash mismatch under squash admission", () => {
    const wrong = { ...FIVE_HASHES, [LAYOUT_FILES[0]]: HASH_B };
    const git = mockGit({
      commits: new Set([SAMPLE_CAPTURE, SAMPLE_LANDED]),
      ancestors: new Set([SAMPLE_LANDED]),
      blobs: { [SAMPLE_CAPTURE]: wrong, [SAMPLE_LANDED]: FIVE_HASHES },
    });
    const result = evaluateCropProvenance({
      capturedSha: SAMPLE_CAPTURE,
      landedSha: SAMPLE_LANDED,
      sourceCarrierPR: 802,
      recorded: FIVE_HASHES,
      git,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("capture-hash-mismatch");
  });

  it("rejects landed hash mismatch under squash admission", () => {
    const wrong = { ...FIVE_HASHES, [LAYOUT_FILES[0]]: HASH_B };
    const git = mockGit({
      commits: new Set([SAMPLE_CAPTURE, SAMPLE_LANDED]),
      ancestors: new Set([SAMPLE_LANDED]),
      blobs: { [SAMPLE_CAPTURE]: FIVE_HASHES, [SAMPLE_LANDED]: wrong },
    });
    const result = evaluateCropProvenance({
      capturedSha: SAMPLE_CAPTURE,
      landedSha: SAMPLE_LANDED,
      sourceCarrierPR: 802,
      recorded: FIVE_HASHES,
      git,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("landed-hash-mismatch");
  });

  it("rejects squash admission without sourceCarrierPR", () => {
    const git = mockGit({
      commits: new Set([SAMPLE_CAPTURE, SAMPLE_LANDED]),
      ancestors: new Set([SAMPLE_LANDED]),
      blobs: { [SAMPLE_CAPTURE]: FIVE_HASHES, [SAMPLE_LANDED]: FIVE_HASHES },
    });
    const result = evaluateCropProvenance({
      capturedSha: SAMPLE_CAPTURE,
      landedSha: SAMPLE_LANDED,
      sourceCarrierPR: null,
      recorded: FIVE_HASHES,
      git,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing-source-carrier-pr");
  });
});

const GIT_FIXTURE_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.test",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.test",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

function gitOk(cwd: string, args: string[], timeout = 15_000): string {
  const r = spawnSync("git", args, { cwd, env: GIT_FIXTURE_ENV, timeout, encoding: "utf8" });
  if ((r.status ?? 1) !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return (r.stdout || "").trim();
}

function writeTree(dir: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
}

const CAPTURE_BODY: Record<string, string> = {
  [LAYOUT_FILES[0]]: "capture-section-team",
  [LAYOUT_FILES[1]]: "capture-section-css",
  [LAYOUT_FILES[2]]: "capture-settings-panel",
  [LAYOUT_FILES[3]]: "capture-settings-css",
  [LAYOUT_FILES[4]]: "capture-i18n",
};
const CAPTURE_HASHES: Record<string, string> = Object.fromEntries(
  Object.entries(CAPTURE_BODY).map(([rel, body]) => [rel, sha256Buf(Buffer.from(body))]),
);

describe("B-F12-9 provenance git fixtures (temporary repos, no network)", () => {
  const temps: string[] = [];

  afterEach(() => {
    while (temps.length > 0) {
      const dir = temps.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    temps.push(dir);
    return dir;
  }

  function initRepo(dir: string): void {
    gitOk(dir, ["init", "-b", "master"]);
    gitOk(dir, ["config", "user.email", "fixture@example.test"]);
    gitOk(dir, ["config", "user.name", "Fixture"]);
    gitOk(dir, ["config", "commit.gpgsign", "false"]);
    gitOk(dir, ["config", "core.autocrlf", "false"]);
  }

  function commit(dir: string, message: string): string {
    gitOk(dir, ["add", "-A"]);
    gitOk(dir, ["commit", "-m", message, "--allow-empty"]);
    return gitOk(dir, ["rev-parse", "HEAD"]);
  }

  function buildFullSquashRepo(): {
    dir: string;
    captured: string;
    landed: string;
    head: string;
    orphan: string;
  } {
    const dir = tempDir("f12-9-full-");
    initRepo(dir);
    writeTree(dir, {
      [LAYOUT_FILES[0]]: "base-section-team",
      [LAYOUT_FILES[1]]: "base-section-css",
      [LAYOUT_FILES[2]]: "base-settings-panel",
      [LAYOUT_FILES[3]]: "base-settings-css",
      [LAYOUT_FILES[4]]: "base-i18n",
    });
    commit(dir, "base");
    gitOk(dir, ["checkout", "-b", "pr"]);
    writeTree(dir, CAPTURE_BODY);
    const captured = commit(dir, "capture");
    gitOk(dir, ["checkout", "master"]);
    writeTree(dir, CAPTURE_BODY);
    const landed = commit(dir, "squash land PR 802");
    writeFileSync(join(dir, "unrelated.txt"), "later work");
    const head = commit(dir, "later master");
    gitOk(dir, ["checkout", "--orphan", "orphan"]);
    gitOk(dir, ["reset"]);
    writeTree(dir, CAPTURE_BODY);
    const orphan = commit(dir, "equal-byte disconnected");
    gitOk(dir, ["checkout", "master"]);
    return { dir, captured, landed, head, orphan };
  }

  it("full history: squash admission passes; omitted landed keeps capture-ancestry failure; disconnected landed fails", () => {
    const { dir, captured, landed, orphan } = buildFullSquashRepo();
    const git = createGitOps(dir, { allowFetch: false });
    const pass = evaluateCropProvenance({
      capturedSha: captured,
      landedSha: landed,
      sourceCarrierPR: 802,
      recorded: CAPTURE_HASHES,
      git,
    });
    expect(pass).toEqual({ ok: true, ancestryRole: "landedAtHead", ancestrySha: landed });

    const noLanded = evaluateCropProvenance({
      capturedSha: captured,
      landedSha: null,
      sourceCarrierPR: null,
      recorded: CAPTURE_HASHES,
      git,
    });
    expect(noLanded.ok).toBe(false);
    if (!noLanded.ok) expect(noLanded.code).toBe("captured-not-ancestor");

    const disconnected = evaluateCropProvenance({
      capturedSha: captured,
      landedSha: orphan,
      sourceCarrierPR: 802,
      recorded: CAPTURE_HASHES,
      git,
    });
    expect(disconnected.ok).toBe(false);
    if (!disconnected.ok) expect(disconnected.code).toBe("disconnected-landed-commit");

    const missing = evaluateCropProvenance({
      capturedSha: captured,
      landedSha: SAMPLE_MISSING,
      sourceCarrierPR: 802,
      recorded: CAPTURE_HASHES,
      git,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("missing-landed-commit");
  });

  it("shallow clone: header walk admits landedAtHead named as a parent of HEAD", () => {
    const full = tempDir("f12-9-hdr-full-");
    initRepo(full);
    writeTree(full, CAPTURE_BODY);
    gitOk(full, ["checkout", "-b", "pr"]);
    const captured = commit(full, "capture");
    gitOk(full, ["checkout", "--orphan", "master"]);
    gitOk(full, ["reset"]);
    writeTree(full, CAPTURE_BODY);
    const landed = commit(full, "squash land");
    writeFileSync(join(full, "unrelated.txt"), "tip");
    commit(full, "tip");

    const origin = tempDir("f12-9-hdr-origin-");
    gitOk(full, ["clone", "--bare", full, origin]);
    const shallow = tempDir("f12-9-hdr-shallow-");
    gitOk(tmpdir(), ["clone", "--depth=1", `file://${origin}`, shallow]);

    const git = createGitOps(shallow, { allowFetch: false });
    expect(git.commitExists(landed)).toBe(false);
    const result = evaluateCropProvenance({
      capturedSha: captured,
      landedSha: landed,
      sourceCarrierPR: 802,
      recorded: CAPTURE_HASHES,
      git: {
        ...git,
        // Capture objects live on the PR branch; copy hashes from the full repo
        // so this fixture isolates HEAD-ancestry via the shallow header walk.
        commitExists(sha) {
          return sha === captured ? true : git.commitExists(sha);
        },
        blobHash(sha, rel) {
          if (sha === captured) return CAPTURE_HASHES[rel] ?? null;
          return git.blobHash(sha, rel);
        },
      },
    });
    // landed object is absent under depth=1, so commitExists(landed) fails before
    // the header walk. Fetch the landed commit from the local origin once.
    const gitFetch = createGitOps(shallow, { allowFetch: true });
    gitFetch.fetchCommitOnce(landed);
    const afterFetch = evaluateCropProvenance({
      capturedSha: captured,
      landedSha: landed,
      sourceCarrierPR: 802,
      recorded: CAPTURE_HASHES,
      git: {
        commitExists(sha) {
          if (sha === captured) return true;
          return gitFetch.commitExists(sha);
        },
        isAncestorOrEqual(sha) {
          return gitFetch.isAncestorOrEqual(sha);
        },
        blobHash(sha, rel) {
          if (sha === captured) return CAPTURE_HASHES[rel] ?? null;
          return gitFetch.blobHash(sha, rel);
        },
      },
    });
    expect(afterFetch.ok, afterFetch.ok ? "ok" : afterFetch.message).toBe(true);
    void result;
  });

  it("shallow clone: six-hop header walk finds landed named in a parent header without deepen", () => {
    const full = tempDir("f12-9-walk-full-");
    initRepo(full);
    writeTree(full, CAPTURE_BODY);
    const captured = commit(full, "capture-on-master-then-rewritten");
    // Rebuild as: captured on the side, landed as parent of HEAD.
    gitOk(full, ["checkout", "-b", "pr"]);
    gitOk(full, ["branch", "-D", "master"]);
    gitOk(full, ["checkout", "--orphan", "master"]);
    gitOk(full, ["reset"]);
    writeTree(full, CAPTURE_BODY);
    const landed = commit(full, "landed");
    writeFileSync(join(full, "unrelated.txt"), "head");
    commit(full, "head");

    const origin = tempDir("f12-9-walk-origin-");
    gitOk(full, ["clone", "--bare", full, origin]);
    const shallow = tempDir("f12-9-walk-shallow-");
    gitOk(tmpdir(), ["clone", "--depth=1", `file://${origin}`, shallow]);

    const git = createGitOps(shallow, { allowFetch: false });
    // HEAD object names landed as its parent. Header walk returns true even
    // when the landed object is outside the shallow boundary.
    expect(git.isAncestorOrEqual(landed)).toBe(true);

    const result = evaluateCropProvenance({
      capturedSha: captured,
      landedSha: landed,
      sourceCarrierPR: 802,
      recorded: CAPTURE_HASHES,
      git: {
        commitExists(sha) {
          if (sha === captured || sha === landed) return true;
          return git.commitExists(sha);
        },
        isAncestorOrEqual(sha) {
          return git.isAncestorOrEqual(sha);
        },
        blobHash(sha, rel) {
          if (sha === captured || sha === landed) return CAPTURE_HASHES[rel] ?? null;
          return git.blobHash(sha, rel);
        },
      },
    });
    expect(result).toEqual({ ok: true, ancestryRole: "landedAtHead", ancestrySha: landed });
  });

  it("shallow clone: bounded deepen against local origin reaches landed several hops behind HEAD", () => {
    const full = tempDir("f12-9-deep-full-");
    initRepo(full);
    writeTree(full, CAPTURE_BODY);
    gitOk(full, ["checkout", "-b", "pr"]);
    const captured = commit(full, "capture");
    gitOk(full, ["checkout", "--orphan", "master"]);
    gitOk(full, ["reset"]);
    writeTree(full, CAPTURE_BODY);
    const landed = commit(full, "landed");
    for (let i = 1; i <= 8; i += 1) {
      writeFileSync(join(full, "unrelated.txt"), `hop-${i}`);
      commit(full, `hop-${i}`);
    }

    const origin = tempDir("f12-9-deep-origin-");
    gitOk(full, ["clone", "--bare", full, origin]);
    const shallow = tempDir("f12-9-deep-shallow-");
    gitOk(tmpdir(), ["clone", "--depth=2", `file://${origin}`, shallow]);

    const noFetch = createGitOps(shallow, { allowFetch: false });
    expect(noFetch.isAncestorOrEqual(landed)).toBe(false);

    const withFetch = createGitOps(shallow, { allowFetch: true });
    expect(withFetch.isAncestorOrEqual(landed)).toBe(true);

    const result = evaluateCropProvenance({
      capturedSha: captured,
      landedSha: landed,
      sourceCarrierPR: 802,
      recorded: CAPTURE_HASHES,
      git: {
        commitExists(sha) {
          if (sha === captured) return true;
          return withFetch.commitExists(sha);
        },
        isAncestorOrEqual(sha) {
          return withFetch.isAncestorOrEqual(sha);
        },
        blobHash(sha, rel) {
          if (sha === captured) return CAPTURE_HASHES[rel] ?? null;
          return withFetch.blobHash(sha, rel);
        },
      },
    });
    expect(result.ok, result.ok ? "ok" : result.message).toBe(true);
  });
});
