// terminal/lib/__tests__/plainLanguageGuardCi.test.ts
//
// Locks the CI WIRING of the plain-language guard (packet B-PLAT-B5-1).
//
// The guard itself (terminal/scripts/check_plain_language.mjs, packet B-PL-5)
// is covered by plainLanguageGuard.test.ts. Until this packet it was advisory:
// nothing in .github/workflows/ci.yml, no npm script and no job ran it, so a
// PR could add a raw state enum to a user-visible position and every required
// check stayed green. This suite is the enforcer's own enforcer — it asserts
// that the two guard steps really are in the `terminal-unit` job (the job that
// feeds the required "Terminal typecheck + tests" aggregate check), that they
// run with the forward-only semantics, and that the guard's exit codes still
// say "red" for a violation this diff ADDED and "green" for a pre-existing one.
//
// The workflow is read as TEXT, not parsed: terminal/package.json declares no
// YAML dependency, and the only js-yaml on this tree is a transitive hoist of
// eslint's own dependency, which would make this suite break the day eslint
// changed its tree. The repo's YAML-semantic checks live in
// tests/test_merge_on_green.py, which has PyYAML for real (PyYAML is not
// reachable from vitest). To keep the text reading honest, the assertions
// below slice out one job (jobBlock) or one step (stepBlock) first, so a claim
// about the enforce step cannot be satisfied by matching text somewhere else
// in the file.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(__dirname, "../../..");
const scriptPath = join(repoRoot, "terminal/scripts/check_plain_language.mjs");
const workflowPath = join(repoRoot, ".github/workflows/ci.yml");

function run(scriptFile: string, args: string[]) {
  const r = spawnSync(process.execPath, [scriptFile, ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// Returns the text of ONE top-level job block (`  <name>:` at exactly two
// spaces of indent, up to the next key at that same indent). Slicing the job
// out first is what makes "the guard runs in terminal-unit" a real assertion:
// a bare substring search over the whole file would also be satisfied by the
// guard sitting in some other job that no required check depends on.
function jobBlock(text: string, name: string): string {
  const start = text.indexOf(`\n  ${name}:\n`);
  expect(start, `job '${name}' not found in ci.yml`).toBeGreaterThan(-1);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

// Returns the text of ONE step, from its `- name:` line to the marker that
// starts the next step (a `- ` list item, or the `#` comment block that
// introduces it) at the same six-space indent. Narrowing to a single step is
// what makes "this step fails closed" a real assertion: `set -euo pipefail`
// or `HEAD^1` anywhere else in the job would satisfy a bare substring search.
function stepBlock(jobText: string, stepName: string): string {
  const start = jobText.indexOf(`- name: ${stepName}`);
  expect(start, `step '${stepName}' not found in the job`).toBeGreaterThan(-1);
  const rest = jobText.slice(start);
  const next = rest.slice(1).search(/\n {6}[-#]/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const ENFORCE_STEP = "Plain-language guard (forward-only, added lines block)";
const SELF_CHECK_STEP = "Plain-language guard self-check";
const DISCLOSE_STEP = "Disclose quarantined e2e journeys";

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "plg-ci-"));
  mkdirSync(join(root, "terminal/components"), { recursive: true });
  mkdirSync(join(root, "terminal/lib"), { recursive: true });
  return root;
}

// Minimal unified diff marking `addedLineNumbers` (1-based) as added lines.
function unifiedDiffFor(relPath: string, content: string, addedLineNumbers: number[]) {
  const lines = content.split("\n");
  let body = "";
  lines.forEach((l, i) => {
    body += (addedLineNumbers.includes(i + 1) ? "+" : " ") + l + "\n";
  });
  return `diff --git a/${relPath} b/${relPath}\n--- a/${relPath}\n+++ b/${relPath}\n@@ -1,0 +1,${lines.length} @@\n${body}`;
}

describe("plain-language guard — CI wiring", () => {
  it("A1. the terminal-unit job runs the guard's self-check", () => {
    const unit = jobBlock(readFileSync(workflowPath, "utf8"), "terminal-unit");
    expect(unit).toContain("scripts/check_plain_language.mjs --self-check");
  });

  it("A2. on pull_request the enforce step's base is the merge commit's FIRST PARENT, not a freshly fetched base branch", () => {
    const unit = jobBlock(readFileSync(workflowPath, "utf8"), "terminal-unit");
    const enforce = stepBlock(unit, ENFORCE_STEP);

    // THE RACE THIS CLOSES. On `pull_request`, HEAD is the merge commit M
    // GitHub built at trigger time: this branch merged into the base tip AS
    // IT WAS THEN. Re-fetching refs/heads/master at STEP time reads master AS
    // IT IS NOW, and if master advanced during the run, every line those newer
    // commits changed still stands in M in its older form — so
    // `git diff master@now M` emits it as `+`. Legacy findings in files this
    // PR never opened would count as ADDED and turn the check red. M's first
    // parent IS that base tip and cannot drift, because M is fixed.
    expect(enforce).toMatch(/\[ "\$\{GITHUB_EVENT_NAME\}" = "pull_request" \]/);
    expect(enforce).toMatch(/BASE=\$\(git rev-parse HEAD\^1\)/);

    // Fail CLOSED. An unresolvable HEAD^1 (a checkout too shallow to hold it)
    // must kill the step loudly rather than leave BASE empty, diff against
    // nothing, and pass green having checked nothing.
    expect(enforce).toContain("set -euo pipefail");

    // Off `pull_request` there is no merge commit, so the base branch tip is
    // fetched explicitly — a shallow checkout does not contain it, and
    // without the fetch $BASE cannot resolve at all. This step always calls
    // the guard with --diff-file (never --since), so an unresolved $BASE does
    // not fail open: `git diff --unified=0 "$BASE" HEAD` fails under
    // `set -euo pipefail` and the step dies loudly, having invoked nothing.
    // The fetch is what lets $BASE resolve, not a guard against a silent pass.
    expect(enforce).toContain("git fetch --no-tags --depth=1 origin");
    expect(enforce).toContain('"+refs/heads/${BASE_REF}:refs/remotes/origin/${BASE_REF}"');
    // Read through an env var, never interpolated straight into the shell:
    // a branch name is attacker-controllable text.
    expect(unit).toContain("BASE_REF: ${{ github.base_ref || 'master' }}");

    // Forward-only mode, fed the diff that base resolution just made possible.
    expect(enforce).toMatch(/git diff --unified=0 "\$BASE" HEAD -- ':\/terminal'/);
    expect(enforce).toContain("--mode enforce-added");
    expect(enforce).toMatch(/check_plain_language\.mjs --mode enforce-added --diff-file/);
  });

  it("A2b. terminal-unit — and only terminal-unit — checks out deep enough for HEAD^1 to resolve", () => {
    const text = readFileSync(workflowPath, "utf8");
    const unit = jobBlock(text, "terminal-unit");
    // actions/checkout defaults to depth 1, which holds the merge commit and
    // none of its parents. Depth 2 brings the first parent down. checkout does
    // the deepening itself, against the exact ref it checks out
    // (refs/pull/N/merge); a later `git fetch --deepen=1 origin` would not
    // reliably help, because checkout leaves remote.origin.fetch pointing at
    // refs/heads/* and the merge commit sits on no branch.
    expect(unit).toMatch(/- uses: actions\/checkout@v4\n\s+with:\n\s+fetch-depth: 2\n/);
    // No other job pays for the extra objects — scoped by slicing terminal-unit
    // out of the file first (jobBlock, same helper the rest of the suite
    // uses) and asserting the REMAINDER never mentions fetch-depth, rather
    // than asserting a file-wide occurrence COUNT. A legitimate future job
    // adding its own fetch-depth for an unrelated reason still fails this
    // (that is the point — it does not belong to terminal-unit), but the
    // failure now shows the offending text instead of a bare "1 !== 2".
    const outsideUnit = text.replace(unit, "");
    expect(outsideUnit, "fetch-depth found outside the terminal-unit job").not.toContain(
      "fetch-depth:",
    );
  });

  it("A3. both guard steps run LAST — after npm test and after the quarantine disclosure — inside the job that feeds the required check", () => {
    const text = readFileSync(workflowPath, "utf8");
    const unit = jobBlock(text, "terminal-unit");
    const testStep = unit.indexOf("- run: npm test");
    const disclose = unit.indexOf(`- name: ${DISCLOSE_STEP}`);
    const selfCheck = unit.indexOf(`- name: ${SELF_CHECK_STEP}`);
    const enforce = unit.indexOf(`- name: ${ENFORCE_STEP}`);
    expect(testStep).toBeGreaterThan(-1);
    expect(disclose).toBeGreaterThan(testStep);
    // The disclosure step's own comment promises it runs on EVERY run, but it
    // carries no `if: always()`. A guard step placed BEFORE it would, the first
    // time it found a blocking line, skip the disclosure outright and quietly
    // retract that promise — a green matrix would stop being annotated with
    // the journeys it does not cover. The guard goes last.
    expect(selfCheck).toBeGreaterThan(disclose);
    expect(enforce).toBeGreaterThan(selfCheck);

    // The aggregate job's name is what master's branch protection keys on, and
    // it must still depend on terminal-unit — otherwise a red guard step would
    // never reach the required check.
    const aggregate = jobBlock(text, "terminal");
    expect(aggregate).toContain("name: Terminal typecheck + tests");
    expect(aggregate).toContain("needs: [terminal-unit, terminal-e2e]");
  });

  it("A4. the guard is not wired anywhere else in the workflow", () => {
    // Exactly two INVOCATIONS (self-check, then enforce), both in the job
    // above. A third copy in e.g. terminal-e2e would double the cost and
    // could disagree with this one. Counting `node scripts/...` rather than
    // the bare filename keeps prose mentions of the script in the comments
    // out of the count.
    const text = readFileSync(workflowPath, "utf8");
    const unit = jobBlock(text, "terminal-unit");
    expect(unit.split("node scripts/check_plain_language.mjs").length - 1).toBe(2);
    // Scoped like A2b: slice terminal-unit out (jobBlock) and assert the
    // REMAINDER of the file never mentions the guard, instead of asserting a
    // file-wide count of 2 — the two checks together still pin "exactly two,
    // both inside terminal-unit," but a failure here names the job as
    // outside terminal-unit rather than an opaque total mismatch.
    const outsideUnit = text.replace(unit, "");
    expect(
      outsideUnit,
      "guard invocation found outside the terminal-unit job",
    ).not.toContain("node scripts/check_plain_language.mjs");
  });
});

describe("plain-language guard — self-check is a real gate", () => {
  it("B1. --self-check exits 0 and reports every rule as detected on an intact guard", () => {
    const res = run(scriptPath, ["--self-check"]);
    expect(res.status).toBe(0);
    for (const rule of ["R1", "R2", "R3", "R4", "R5a", "R5b"]) {
      expect(res.stdout).toContain(`${rule} detected`);
    }
    expect(res.stdout).not.toContain("NOT detected");
  });

  it("B2. --self-check exits 2 (the fail-closed infrastructure-fault code) when a rule stops detecting its own violation", () => {
    // Mutation test: a self-check that always exits 0 is a decoration, not a
    // gate — the CI step would stay green with every rule dead. Run a copy of
    // the real script whose R1 fixture expects a rule name that can never
    // fire, and require the process to fail CLOSED with exit 2 specifically —
    // not merely non-zero. Docs §4's exit table and §7 both publish 2 (never
    // 1) as the contract for "the guard itself is broken": exit 1 means "a
    // real blocking finding," and a regression that made a dead rule exit 1
    // would make a broken guard indistinguishable from a real finding — the
    // exact confusion the distinct code exists to prevent.
    //
    // The copy lives in an OS temp dir, never inside the tracked tree: a run
    // killed between mkdtemp and the finally block used to strand a
    // `terminal/.plg-selfcheck-*` directory holding a mutated copy of the
    // guard, one `git add` away from being committed. `import ts from
    // "typescript"` still resolves because node walks parent directories
    // looking for `node_modules`, and the temp dir is handed a symlink to
    // terminal/node_modules. (NODE_PATH is not an option here — ESM
    // resolution ignores it.)
    const dir = mkdtempSync(join(tmpdir(), "plg-selfcheck-"));
    try {
      symlinkSync(join(repoRoot, "terminal", "node_modules"), join(dir, "node_modules"), "dir");
      const source = readFileSync(scriptPath, "utf8");
      const intact = 'R1: { relPath: "fixture.tsx", code: "const x = <span>BOTTOM_WATCH</span>;", rule: "raw_state_enum" }';
      // Fails loudly if the fixture table is ever refactored, rather than
      // silently mutating nothing and "passing".
      expect(source).toContain(intact);
      const broken = source.replace(intact, intact.replace('"raw_state_enum"', '"rule_that_can_never_fire"'));
      const brokenPath = join(dir, "broken.mjs");
      writeFileSync(brokenPath, broken);

      const res = run(brokenPath, ["--self-check"]);
      expect(res.stdout).toContain("R1 NOT detected");
      expect(res.status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("plain-language guard — exit codes the CI step depends on", () => {
  it("C1. a raw state enum added on an added line exits 1", () => {
    const root = fixtureRoot();
    try {
      const relPath = "terminal/components/CiAdded.tsx";
      const content = ["export function CiAdded() {", "  return <b>BOTTOM_WATCH</b>;", "}", ""].join("\n");
      writeFileSync(join(root, relPath), content);
      const diffFile = join(root, "diff.patch");
      writeFileSync(diffFile, unifiedDiffFor(relPath, content, [2]));
      const res = run(scriptPath, ["--mode", "enforce-added", "--root", root, "--diff-file", diffFile]);
      expect(res.status).toBe(1);
      expect(res.stdout).toContain("::error title=plain-language::");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("C2. an untranslated stat token added on an added line exits 1", () => {
    const root = fixtureRoot();
    try {
      const relPath = "terminal/components/CiStat.tsx";
      const content = ["export function CiStat() {", "  return <span>iv_rank</span>;", "}", ""].join("\n");
      writeFileSync(join(root, relPath), content);
      const diffFile = join(root, "diff.patch");
      writeFileSync(diffFile, unifiedDiffFor(relPath, content, [2]));
      const res = run(scriptPath, ["--mode", "enforce-added", "--root", root, "--diff-file", diffFile]);
      expect(res.status).toBe(1);
      expect(res.stdout).toContain("untranslated_stat_token");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("C3. the SAME violation on a pre-existing line exits 0 and prints the legacy census", () => {
    // The forward-only promise the CI step has to keep: an untouched legacy
    // file is reported, never red.
    const root = fixtureRoot();
    try {
      const legacyPath = "terminal/components/CiLegacy.tsx";
      const legacy = ["export function CiLegacy() {", "  return <b>BOTTOM_WATCH</b>;", "}", ""].join("\n");
      writeFileSync(join(root, legacyPath), legacy);
      // The diff touches a different, clean file: nothing in CiLegacy.tsx is
      // an added line, so its finding can only be legacy.
      const touchedPath = "terminal/components/CiTouched.tsx";
      const touched = ["export function CiTouched() {", "  return <div />;", "}", ""].join("\n");
      writeFileSync(join(root, touchedPath), touched);
      const diffFile = join(root, "diff.patch");
      writeFileSync(diffFile, unifiedDiffFor(touchedPath, touched, [2]));
      const res = run(scriptPath, ["--mode", "enforce-added", "--root", root, "--diff-file", diffFile]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("legacy (pre-existing, not blocking)");
      expect(res.stdout).toContain(legacyPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
