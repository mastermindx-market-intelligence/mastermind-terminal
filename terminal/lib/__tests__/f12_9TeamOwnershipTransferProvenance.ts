import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

/** Lowercase 40-char Git object name. Data-line parsers reject any other shape. */
export const FORTY_HEX = /^[0-9a-f]{40}$/;
export const SIXTY_FOUR_HEX = /^[0-9a-f]{64}$/;

export type GitBlobSource = {
  commitExists(sha: string): boolean;
  isAncestorOrEqual(sha: string): boolean;
  blobHash(sha: string, rel: string): string | null;
};

export type GitOps = GitBlobSource & {
  fetchCommitOnce(sha: string): void;
  blobAt(sha: string, rel: string): Buffer | null;
};

export type ProvenanceOk = {
  ok: true;
  ancestryRole: "landedAtHead" | "capturedAtHead";
  ancestrySha: string;
};

export type ProvenanceErr = {
  ok: false;
  code:
    | "bogus-captured-commit"
    | "bogus-landed-commit"
    | "missing-captured-commit"
    | "missing-landed-commit"
    | "missing-source-carrier-pr"
    | "disconnected-landed-commit"
    | "captured-not-ancestor"
    | "capture-hash-mismatch"
    | "landed-hash-mismatch";
  message: string;
};

export type ProvenanceResult = ProvenanceOk | ProvenanceErr;

function dataLines(yml: string, key: string): string[] {
  return yml.split("\n").filter((line) => line.startsWith(`${key}:`));
}

function parseRequiredFortyHexDataLine(yml: string, key: string, missing: string): string {
  const lines = dataLines(yml, key);
  if (lines.length === 0) throw new Error(missing);
  if (lines.length !== 1) {
    throw new Error(`EVIDENCE.yml has more than one ${key} data line`);
  }
  const m = lines[0].match(new RegExp(`^${key}: ([0-9a-f]{40})$`));
  if (!m) {
    throw new Error(`EVIDENCE.yml ${key} is present but is not a 40-char lowercase hex commit`);
  }
  return m[1];
}

export function parseCapturedAtHead(yml: string): string {
  return parseRequiredFortyHexDataLine(
    yml,
    "capturedAtHead",
    "EVIDENCE.yml is missing a 40-char capturedAtHead",
  );
}

/**
 * Explicit squash-landed master commit. Comment-only `# landedAtHead:` lines are
 * ignored. Absence returns null and the caller must keep direct capturedAtHead
 * ancestry. A present but non-forty-hex data line is rejected.
 */
export function parseLandedAtHead(yml: string): string | null {
  const lines = dataLines(yml, "landedAtHead");
  if (lines.length === 0) return null;
  if (lines.length !== 1) {
    throw new Error("EVIDENCE.yml has more than one landedAtHead data line");
  }
  const m = lines[0].match(/^landedAtHead: ([0-9a-f]{40})$/);
  if (!m) {
    throw new Error(
      "EVIDENCE.yml landedAtHead is present but is not a 40-char lowercase hex commit",
    );
  }
  return m[1];
}

/**
 * Source-carrier pull number (GitHub PR). Comment-only lines are ignored.
 * Absence returns null. A present but non-positive-integer data line is rejected.
 */
export function parseSourceCarrierPR(yml: string): number | null {
  const lines = dataLines(yml, "sourceCarrierPR");
  if (lines.length === 0) return null;
  if (lines.length !== 1) {
    throw new Error("EVIDENCE.yml has more than one sourceCarrierPR data line");
  }
  const m = lines[0].match(/^sourceCarrierPR: ([1-9][0-9]*)$/);
  if (!m) {
    throw new Error("EVIDENCE.yml sourceCarrierPR is present but is not a positive integer");
  }
  return Number(m[1]);
}

export function parseLayoutFileMap(yml: string): Record<string, string> {
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

export function sha256Buf(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Parent-adjudicated squash-source admission:
 * - landedAtHead present: capture blobs and landed blobs must each equal every
 *   declared layout hash; HEAD ancestry is checked on landedAtHead only.
 * - landedAtHead absent: original rule — capturedAtHead must be ancestor-or-equal
 *   of HEAD, and capture blobs must equal the declared layout hashes.
 * Equal-byte commits that are disconnected from HEAD are rejected unless they
 * are the explicit landedAtHead and that landed commit is ancestor-or-equal of HEAD.
 */
export function evaluateCropProvenance(input: {
  capturedSha: string;
  landedSha: string | null;
  sourceCarrierPR: number | null;
  recorded: Record<string, string>;
  git: GitBlobSource;
}): ProvenanceResult {
  const { capturedSha, landedSha, sourceCarrierPR, recorded, git } = input;

  if (!FORTY_HEX.test(capturedSha)) {
    return {
      ok: false,
      code: "bogus-captured-commit",
      message: `capturedAtHead ${capturedSha} is not a 40-char lowercase hex commit`,
    };
  }
  if (!git.commitExists(capturedSha)) {
    return {
      ok: false,
      code: "missing-captured-commit",
      message: `capturedAtHead ${capturedSha} is not a commit reachable from origin — recapture and record the real code commit`,
    };
  }

  if (landedSha !== null) {
    if (!FORTY_HEX.test(landedSha)) {
      return {
        ok: false,
        code: "bogus-landed-commit",
        message: `landedAtHead ${landedSha} is not a 40-char lowercase hex commit`,
      };
    }
    if (sourceCarrierPR === null) {
      return {
        ok: false,
        code: "missing-source-carrier-pr",
        message: `landedAtHead ${landedSha} requires sourceCarrierPR metadata`,
      };
    }
    if (!git.commitExists(landedSha)) {
      return {
        ok: false,
        code: "missing-landed-commit",
        message: `landedAtHead ${landedSha} is missing`,
      };
    }
    if (!git.isAncestorOrEqual(landedSha)) {
      return {
        ok: false,
        code: "disconnected-landed-commit",
        message: `landedAtHead ${landedSha} is not an ancestor-or-equal of HEAD`,
      };
    }
    for (const [rel, expected] of Object.entries(recorded)) {
      const cap = git.blobHash(capturedSha, rel);
      if (cap === null || cap !== expected) {
        return {
          ok: false,
          code: "capture-hash-mismatch",
          message:
            cap === null
              ? `git cannot read ${rel} at capturedAtHead ${capturedSha}`
              : `${rel} hash does not match the file bytes at capturedAtHead ${capturedSha}`,
        };
      }
      const land = git.blobHash(landedSha, rel);
      if (land === null || land !== expected) {
        return {
          ok: false,
          code: "landed-hash-mismatch",
          message:
            land === null
              ? `git cannot read ${rel} at landedAtHead ${landedSha}`
              : `${rel} hash does not match the file bytes at landedAtHead ${landedSha}`,
        };
      }
    }
    return { ok: true, ancestryRole: "landedAtHead", ancestrySha: landedSha };
  }

  if (!git.isAncestorOrEqual(capturedSha)) {
    return {
      ok: false,
      code: "captured-not-ancestor",
      message: `capturedAtHead ${capturedSha} is not an ancestor-or-equal of HEAD`,
    };
  }
  for (const [rel, expected] of Object.entries(recorded)) {
    const cap = git.blobHash(capturedSha, rel);
    if (cap === null || cap !== expected) {
      return {
        ok: false,
        code: "capture-hash-mismatch",
        message:
          cap === null
            ? `git cannot read ${rel} at capturedAtHead ${capturedSha}`
            : `${rel} hash does not match the file bytes at capturedAtHead ${capturedSha}`,
      };
    }
  }
  return { ok: true, ancestryRole: "capturedAtHead", ancestrySha: capturedSha };
}

export function inGitCheckout(cwd: string): boolean {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    timeout: 5_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return (r.status ?? 1) === 0 && r.stdout.toString("utf8").trim() === "true";
}

/**
 * Real-checkout git ops. Ancestry uses merge-base, then a six-hop commit-header
 * walk (parent SHAs named in objects we already have), then one bounded
 * `fetch --deepen=64 origin`. No polling loop.
 */
export function createGitOps(cwd: string, options?: { allowFetch?: boolean }): GitOps {
  const allowFetch = options?.allowFetch !== false;

  function run(args: string[], timeout = 30_000): { ok: boolean; stdout: Buffer } {
    const r = spawnSync("git", args, {
      cwd,
      maxBuffer: 20_000_000,
      timeout,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return { ok: (r.status ?? 1) === 0, stdout: (r.stdout as Buffer) || Buffer.alloc(0) };
  }

  function commitExists(sha: string): boolean {
    return run(["cat-file", "-e", `${sha}^{commit}`]).ok;
  }

  function fetchCommitOnce(sha: string): void {
    if (!allowFetch) return;
    run(["fetch", "--depth=1", "origin", sha]);
  }

  function commitParents(sha: string): string[] {
    const r = run(["cat-file", "-p", sha]);
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
    if (run(["merge-base", "--is-ancestor", sha, "HEAD"]).ok) return true;
    const head = run(["rev-parse", "HEAD"]);
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
    if (allowFetch) {
      run(["fetch", "--deepen=64", "origin"]);
      return run(["merge-base", "--is-ancestor", sha, "HEAD"]).ok;
    }
    return false;
  }

  function blobAt(sha: string, rel: string): Buffer | null {
    const r = run(["cat-file", "-p", `${sha}:${rel}`]);
    return r.ok ? r.stdout : null;
  }

  function blobHash(sha: string, rel: string): string | null {
    const blob = blobAt(sha, rel);
    return blob ? sha256Buf(blob) : null;
  }

  return { commitExists, fetchCommitOnce, isAncestorOrEqual, blobAt, blobHash };
}
