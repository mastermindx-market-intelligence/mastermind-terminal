// terminal/lib/__tests__/plainLanguageGuard.test.ts
//
// Vitest suite = CI host + fixtures + receipt printer for
// terminal/scripts/check_plain_language.mjs (packet B-PL-5).
//
// The suite SPAWNS the checker (execFileSync) rather than importing it —
// terminal/tsconfig.json does not include .mjs, so importing an untyped
// .mjs from a .ts suite under moduleResolution: "bundler" risks TS2307.
// Precedent for __dirname in these suites: terminal/lib/__tests__/plainLabelsCallSites.test.ts.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Defuses the checker's own `::error`/`::warning`/`::notice` GitHub
// workflow-command syntax before replaying it into THIS (successful)
// test's stdout. GitHub mints a run-level annotation from ANY
// `::error`/`::warning` line that starts a step's log, regardless of that
// step's own exit code (see this repo's own convention, "GitHub
// annotations must START the line") -- an unmodified replay of the
// checker's receipt (test 8 below) mints a phantom failing annotation
// naming a fixture path that does not exist in the repo, from a PASSING
// `npm test` step. Indenting each line defeats the "starts the line"
// requirement while keeping every character legible in the receipt.
function redactAnnotations(s: string): string {
  return s.replace(/^(::(?:error|warning|notice))/gm, "  $1");
}

const scriptPath = join(__dirname, "../../scripts/check_plain_language.mjs");

// stdout and stderr are captured SEPARATELY, on both the success and the
// failure (non-zero exit) path — per the ruling, `--json` mode prints ONLY
// the JSON document on stdout (every notice/diagnostic goes to stderr), so
// a caller can `JSON.parse(res.stdout.trim())` directly, with no need to
// search for the JSON line among other text. `stdout` is what test
// assertions below parse; `stderr` is available for the handful of
// non-JSON tests that still want to see the human-readable notices.
// spawnSync (not execFileSync) is used deliberately: execFileSync's return
// value on a SUCCESSFUL (exit 0) run carries stdout only — there is no way
// to recover that run's stderr from it — which would blind test 24 to the
// overlay-absent notice on exactly the success path it needs to check.
function run(args: string[], opts: { input?: string } = {}) {
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    input: opts.input,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// Parses a `--json` run's stdout WHOLE (no `.split("\n").pop()` line
// scavenging) — stdout must be exactly one JSON document, per the ruling.
function parseJson(res: { stdout: string }) {
  return JSON.parse(res.stdout.trim());
}

function makeFixtureRoot() {
  const root = mktempRoot();
  mkdirSync(join(root, "terminal/components"), { recursive: true });
  mkdirSync(join(root, "terminal/lib"), { recursive: true });
  return root;
}

function mktempRoot() {
  return mkdtempSync(join(tmpdir(), "plg-"));
}

function unifiedDiffFor(relPath: string, content: string, addedLineNumbers: number[]) {
  const lines = content.split("\n");
  const hunkStart = addedLineNumbers.length ? Math.min(...addedLineNumbers) : 1;
  const count = lines.length;
  let body = "";
  lines.forEach((l, i) => {
    const lineNo = i + 1;
    body += (addedLineNumbers.includes(lineNo) ? "+" : " ") + l + "\n";
  });
  return `diff --git a/${relPath} b/${relPath}\n--- a/${relPath}\n+++ b/${relPath}\n@@ -${hunkStart},0 +1,${count} @@\n${body}`;
}

describe("check_plain_language.mjs", () => {
  it("1. flags a synthetic bad string on added lines", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/Bad.tsx";
    const content = [
      "export function Bad({ row }: any) {",
      "  return (",
      "    <div>",
      "      <b>BOTTOM_WATCH</b>",
      "      <span>{row.regime}</span>",
      "    </div>",
      "  );",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [4, 5]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);

    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(1);
    const parsed = parseJson(res);
    expect(parsed.counts.blocking).toBeGreaterThanOrEqual(2);
    for (const f of parsed.findings.filter((x: any) => x.blocking)) {
      expect(typeof f.path).toBe("string");
      expect(Number.isInteger(f.line)).toBe(true);
      expect(typeof f.rule).toBe("string");
      expect(f.suggestion).toBeTruthy();
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("2. passes a synthetic good string", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/Good.tsx";
    const content = [
      "export function Good({ row, t, lang }: any) {",
      "  return (",
      "    <div>",
      "      <span>{regimeLabel(t, row.regime, lang)}</span>",
      '      <span>{t("marketCalm")}</span>',
      "    </div>",
      "  );",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [4, 5]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);

    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(0);
    const parsed = parseJson(res);
    expect(parsed.counts.blocking).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("3. reports a legacy (untouched) offending line without failing the run", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/Legacy.tsx";
    const content = [
      "export function Legacy() {",
      "  return <div><b>BOTTOM_WATCH</b></div>;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    // Diff touches the file (so it's scanned) but does NOT mark the offending line as added.
    const diff = unifiedDiffFor(relPath, content, [1]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);

    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("legacy (pre-existing, not blocking)");
    rmSync(root, { recursive: true, force: true });
  });

  it("3b. reports an offending line in a file the diff never touches at all (full census)", () => {
    const root = makeFixtureRoot();
    // Untouched.tsx never appears in the diff in any form — no +++ header,
    // no hunk. A scanner keyed off the diff's own touched-file list would
    // never open it, and would report zero legacy findings.
    const untouchedRelPath = "terminal/components/Untouched.tsx";
    const untouchedContent = [
      "export function Untouched() {",
      "  return <div><b>BOTTOM_WATCH</b></div>;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, untouchedRelPath), untouchedContent);

    // The diff touches a completely different file.
    const otherRelPath = "terminal/components/Other.tsx";
    const otherContent = ["export function Other() {", "  return <div />;", "}", ""].join("\n");
    writeFileSync(join(root, otherRelPath), otherContent);
    const diff = unifiedDiffFor(otherRelPath, otherContent, [1]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);

    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(0);
    const parsed = parseJson(res);
    expect(parsed.scannedFiles).toBeGreaterThanOrEqual(2);
    // Legacy (pre-existing, non-blocking) findings live in the separate
    // `legacy` bucket, never mixed into `findings` — see minor 1 of the
    // PR #530 round-3 review.
    expect(parsed.findings.some((f: any) => f.path === untouchedRelPath)).toBe(false);
    const legacyHit = parsed.legacy.find(
      (f: any) => f.path === untouchedRelPath && f.rule === "raw_state_enum" && !f.blocking
    );
    expect(legacyHit).toBeTruthy();
    rmSync(root, { recursive: true, force: true });
  });

  it("4. EN/ZH parity: missing zh in LEX entry and unrouted English literal both block", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/lib/i18n.tsx";
    const content = [
      "export const LEX: Record<string, [string, string]> = {",
      '  newThing: ["Market is calm"],',
      "};",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff1 = unifiedDiffFor(relPath, content, [2]);
    const diffFile1 = join(root, "diff1.patch");
    writeFileSync(diffFile1, diff1);
    const res1 = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile1, "--json"]);
    expect(res1.status).toBe(1);
    const parsed1 = parseJson(res1);
    expect(parsed1.findings.some((f: any) => f.rule === "missing_zh" && f.blocking)).toBe(true);

    const relPath2 = "terminal/components/Literal.tsx";
    const content2 = ["export function L() {", "  return <h2>Market is calm today</h2>;", "}", ""].join("\n");
    writeFileSync(join(root, relPath2), content2);
    const diff2 = unifiedDiffFor(relPath2, content2, [2]);
    const diffFile2 = join(root, "diff2.patch");
    writeFileSync(diffFile2, diff2);
    const res2 = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile2, "--json"]);
    expect(res2.status).toBe(1);
    const parsed2 = parseJson(res2);
    expect(parsed2.findings.some((f: any) => f.rule === "missing_zh" && f.blocking)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("5. --self-check proves each rule detects its own violation", () => {
    const root = makeFixtureRoot();
    const res = run(["--self-check", "--root", root]);
    expect(res.status).toBe(0);
    for (const rule of ["R1", "R2", "R3", "R4", "R5a", "R5b"]) {
      expect(res.stdout).toContain(`${rule} detected`);
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("6. unreadable --diff-file fails CLOSED", () => {
    const root = makeFixtureRoot();
    const res = run(["--root", root, "--diff-file", join(root, "does-not-exist.patch")]);
    expect(res.status).toBe(2);
    expect(res.stdout).toContain("::error title=plain-language::");
    rmSync(root, { recursive: true, force: true });
  });

  it("7. unresolvable base fails OPEN and discloses it", () => {
    const root = makeFixtureRoot();
    const res = run(["--root", root, "--since", "no/such/ref"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("::warning title=plain-language::");
    expect(res.stdout).toContain("nothing can block");
    rmSync(root, { recursive: true, force: true });
  });

  it("8. receipt printer: prints the checker's full human block for bad + legacy fixtures", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/Bad.tsx";
    const content = ["export function Bad() {", "  return <b>BOTTOM_WATCH</b>;", "}", ""].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile]);
    process.stdout.write("\n--- plain-language guard receipt: flagged fixture ---\n");
    process.stdout.write(redactAnnotations(res.stdout));
    process.stdout.write("\n--- end receipt ---\n");
    expect(res.stdout).toContain("BOTTOM_WATCH");

    const relPath2 = "terminal/components/Legacy2.tsx";
    const content2 = ["export function Legacy2() {", "  return <b>BOTTOM_WATCH</b>;", "}", ""].join("\n");
    writeFileSync(join(root, relPath2), content2);
    const diff2 = unifiedDiffFor(relPath2, content2, [1]);
    const diffFile2 = join(root, "diff2.patch");
    writeFileSync(diffFile2, diff2);
    const res2 = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile2]);
    process.stdout.write("\n--- plain-language guard receipt: legacy fixture ---\n");
    process.stdout.write(redactAnnotations(res2.stdout));
    process.stdout.write("\n--- end receipt ---\n");
    expect(res2.stdout).toContain("legacy (pre-existing, not blocking)");
    rmSync(root, { recursive: true, force: true });
  });

  it("10. a bare substring match on a helper name (.sort(/useEffect() does not defeat R3/R5b", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/Sneaky.tsx";
    const content = [
      "export function Sneaky({ rows }: any) {",
      "  return <div>{rows.sort((a: any, b: any) => a - b) && <h2>Market is calm today</h2>}</div>;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(1);
    const parsed = parseJson(res);
    expect(parsed.counts.blocking).toBeGreaterThan(0);
    rmSync(root, { recursive: true, force: true });

    const root2 = makeFixtureRoot();
    const relPath2 = "terminal/components/Sneaky2.tsx";
    const content2 = [
      "export function Sneaky2({ row }: any) {",
      "  return <div>{useEffect(() => {})}<span>{row.regime}</span></div>;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root2, relPath2), content2);
    const diff2 = unifiedDiffFor(relPath2, content2, [2]);
    const diffFile2 = join(root2, "diff.patch");
    writeFileSync(diffFile2, diff2);
    const res2 = run(["--mode", "enforce-added", "--root", root2, "--diff-file", diffFile2, "--json"]);
    expect(res2.status).toBe(1);
    const parsed2 = parseJson(res2);
    expect(parsed2.findings.some((f: any) => f.rule === "raw_slug_interpolation" && f.blocking)).toBe(true);
    rmSync(root2, { recursive: true, force: true });
  });

  it("11. AST visibility: `=>`, `<=`, and an enum comparison in code never fire raw_state_enum", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/CodeOnly.tsx";
    // Every line below was constructed to defeat the OLD `>[^<>]*<` substring
    // heuristic (an arrow function and a `<=` comparison, each sharing a
    // line with real angle-bracket JSX) and the old line-level `visible`
    // gate (an UPPER_SNAKE token used as a style/prop value and as a bare
    // string comparison, neither of which is a JsxText/string-JSX-child/
    // title-aria-placeholder-alt attribute value). None of these are a
    // genuine user-visible position, so R1 must never fire on any of them.
    const content = [
      "export function CodeOnly({ rows, row }: any) {",
      "  const filtered = rows.filter((r: any) => r.value <= THRESHOLD_MAX);",
      "  if (row.status === \"BOTTOM_WATCH\") { /* internal branch, not rendered */ }",
      "  return <div style={{ color: LEGEND_ITEM }}>{filtered.length}</div>;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2, 3, 4]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);

    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    const parsed = parseJson(res);
    const enumFindings = parsed.findings.filter((f: any) => f.rule === "raw_state_enum");
    expect(enumFindings).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("12. AST visibility: a true positive in JsxText still blocks raw_state_enum", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/TruePositive.tsx";
    const content = [
      "export function TruePositive() {",
      "  return (",
      "    <div>",
      "      <span>BOTTOM_WATCH</span>",
      "    </div>",
      "  );",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [4]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);

    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(1);
    const parsed = parseJson(res);
    const hit = parsed.findings.find(
      (f: any) => f.rule === "raw_state_enum" && f.token === "BOTTOM_WATCH" && f.blocking
    );
    expect(hit).toBeTruthy();
    rmSync(root, { recursive: true, force: true });
  });

  it("9. --json contract shape is stable", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/Good.tsx";
    const content = ["export function Good() {", '  return <span>{t("hi")}</span>;', "}", ""].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--root", root, "--diff-file", diffFile, "--json"]);
    const parsed = parseJson(res);
    expect(Object.keys(parsed).sort()).toEqual(
      ["version", "mode", "base", "baseResolved", "vocabulary", "scannedFiles", "findings", "legacy", "counts", "nulls"].sort()
    );
    expect(typeof parsed.vocabulary.overlayPresent).toBe("boolean");
    expect(Array.isArray(parsed.nulls)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("13. overlay-harvested bare label KEYS are whole-word matches, not substrings (PR #530 review BLOCKER 1)", () => {
    const root = makeFixtureRoot();
    writeFileSync(
      join(root, "terminal/lib/plainLabels.ts"),
      [
        'export const TRUST_TIER_LABEL: Record<string, [string, string]> = {',
        '  pro: ["Pro", "专业版"],',
        '  free: ["Free", "免费"],',
        "};",
        "export function regimeLabel(t: any, v: string) { return v; }",
        "",
      ].join("\n")
    );
    const relPath = "terminal/components/Probe.tsx";
    const content = [
      "export function Probe({ row }: any) {",
      '  return <div className="profile-card">{row.regime}</div>;',
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    const parsed = parseJson(res);
    expect(parsed.vocabulary.overlayPresent).toBe(true);
    // "profile-card" contains the harvested overlay key "pro" as a bare
    // substring — the guard must NOT treat that as a plain-helper routing
    // for the untranslated `row.regime` interpolation on the same line.
    expect(
      parsed.findings.some((f: any) => f.rule === "raw_slug_interpolation" && f.token === "regime" && f.blocking)
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("14. R2 internal_study_slug matches whole words only, not English words containing a slug (PR #530 review MAJOR)", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/G.tsx";
    const content = ["export function G() {", "  return <span>Globe</span>;", "}", ""].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(0);
    const parsed = parseJson(res);
    // "Globe" contains the study slug "lobe" as a bare substring — plain
    // English must never be flagged as an internal_study_slug.
    expect(parsed.findings.length).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("15. LEX arity check is comma-in-string-safe and multi-line-safe (PR #530 review BLOCKER 2)", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/lib/i18n.tsx";
    const content = [
      "export const LEX: Record<string, [string, string]> = {",
      '  commaEn: ["Hello, world"],',
      "  multi: [",
      '    "Only english",',
      "  ],",
      "};",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2, 3, 4, 5]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(1);
    const parsed = parseJson(res);
    const missingZh = parsed.findings.filter((f: any) => f.rule === "missing_zh" && f.blocking);
    // Both the comma-containing single-line entry AND the multi-line entry
    // must be caught — the old naive `.split(",")` + single-line regex
    // caught neither.
    expect(missingZh.length).toBe(2);
    // No false null: the file DID have new user-visible strings added.
    expect(parsed.nulls.find((n: any) => n.path === relPath)).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });

  it("16. copy-dict spans cover VALUES, never object KEYS or import specifiers (PR #530 round-2 review BLOCKER 1)", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/__p2/Dict.tsx";
    mkdirSync(join(root, "terminal/components/__p2"), { recursive: true });
    // Exact reviewer-constructed probe: a *_COPY object whose KEY is a raw
    // state enum (the enum being mapped FROM, never display text) and whose
    // VALUE is a URL containing an unrelated UPPER_SNAKE path segment.
    const content = [
      'import { helper } from "./ASSET_MAP_helper";',
      "export const MARKET_COPY = {",
      '  "BOTTOM_WATCH": "Watching for a bottom",',
      '  "chart_url": "https://cdn.example.com/ASSET_MAP/v1.png",',
      "};",
      "void helper;",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [1, 2, 3, 4, 5, 6]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    const parsed = parseJson(res);
    // The KEY "BOTTOM_WATCH" must never be flagged — it is the object's KEY
    // (the raw enum being translated FROM), not a copy-dict VALUE. Before
    // this fix every string literal in a *_COPY file was swept in,
    // including quoted keys.
    expect(parsed.findings.some((f: any) => f.token === "BOTTOM_WATCH")).toBe(false);
    // The import module specifier must never be scanned as copy either,
    // even though it textually contains "ASSET_MAP_helper".
    expect(parsed.findings.some((f: any) => f.path === relPath && f.line === 1)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("17. a .ts (not .tsx) file under terminal/lib/ matching *copy* is actually scanned (PR #530 round-2 review BLOCKER 2)", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/lib/marketCopy.ts";
    const content = ['export const MARKET_COPY = { a: "BOTTOM_WATCH" };', ""].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [1]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(1);
    const parsed = parseJson(res);
    // Before this fix, listScanFiles() never opened a plain .ts file at
    // all (walk() only pushes .tsx), so this file's raw enum VALUE was
    // silently invisible to the guard — scannedFiles never included it.
    const hit = parsed.findings.find(
      (f: any) => f.path === relPath && f.rule === "raw_state_enum" && f.token === "BOTTOM_WATCH" && f.blocking
    );
    expect(hit).toBeTruthy();
    rmSync(root, { recursive: true, force: true });
  });

  // Round-2 review fixture set: the three React idioms the review named
  // (ternary, logical-and, attribute literal) must each be flagged now that
  // computeVisibleSpans recurses through conditional/logical wrapping to
  // find a literal leaf; a className string, a bare property-access
  // interpolation, and a template literal inside a `throw` must each stay
  // unflagged — none of them is ever a genuine visible-text position.

  it("18. ternary idiom: a string literal behind `cond ? a : b` as a JSX child is flagged", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/Ternary.tsx";
    const content = [
      "export function Ternary({ active }: any) {",
      '  return <span>{active ? "BOTTOM_WATCH" : "ok"}</span>;',
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(1);
    const parsed = parseJson(res);
    expect(
      parsed.findings.some(
        (f: any) => f.rule === "raw_state_enum" && f.token === "BOTTOM_WATCH" && f.blocking
      )
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("19. logical-and idiom: a string literal behind `cond && value` as a JSX child is flagged", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/LogicalAnd.tsx";
    const content = [
      "export function LogicalAnd({ show }: any) {",
      '  return <span>{show && "iv_rank"}</span>;',
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(1);
    const parsed = parseJson(res);
    expect(
      parsed.findings.some(
        (f: any) => f.rule === "untranslated_stat_token" && f.token === "iv_rank" && f.blocking
      )
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("20. attribute-literal idiom: a ternary behind title={...} is flagged", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/AttrLiteral.tsx";
    const content = [
      "export function AttrLiteral({ active }: any) {",
      '  return <button title={active ? "BOTTOM_WATCH" : "OK"}>Go</button>;',
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(1);
    const parsed = parseJson(res);
    expect(
      parsed.findings.some(
        (f: any) => f.rule === "raw_state_enum" && f.token === "BOTTOM_WATCH" && f.blocking
      )
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("21. NOT flagged: className is not a visible attribute, even behind the same ternary", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/ClassName.tsx";
    const content = [
      "export function ClassNameCase({ active }: any) {",
      '  return <div className={active ? "BOTTOM_WATCH" : "ok"}>Text</div>;',
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(0);
    const parsed = parseJson(res);
    expect(parsed.findings.length).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("22. NOT flagged: a bare property access (`trade.dte`) as a JSX child is never rendered TEXT", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/Dte.tsx";
    const content = [
      "export function Dte({ trade }: any) {",
      "  return <span>{trade.dte}</span>;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(0);
    const parsed = parseJson(res);
    expect(parsed.findings.length).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("23. NOT flagged: a template literal inside a `throw` is not a JSX position at all", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/Thrower.tsx";
    const content = [
      "export function Thrower({ value }: any) {",
      "  if (value == null) {",
      "    throw new Error(`Unsupported dte value: ${value}`);",
      "  }",
      "  return <div>OK</div>;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [3]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(0);
    const parsed = parseJson(res);
    expect(parsed.findings.length).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("24. --json prints ONLY the JSON document on stdout; stderr carries the overlay-absent notice", () => {
    const root = makeFixtureRoot();
    const relPath = "terminal/components/Good2.tsx";
    const content = ["export function Good2() {", '  return <span>{t("hi")}</span>;', "}", ""].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--root", root, "--diff-file", diffFile, "--json"]);
    // Whole-stdout parse must succeed with no trimming/splitting beyond one
    // trailing newline — a leaked notice line before/after the JSON would
    // make this throw.
    expect(() => JSON.parse(res.stdout.trim())).not.toThrow();
    expect(res.stderr).toContain("vocabulary overlay ABSENT");
    rmSync(root, { recursive: true, force: true });
  });

  it("25. R3 fires on the interpolation's OWN span, never on a sibling span sharing the line (PR #530 round-3 review MAJOR)", () => {
    // Three RED-first fixtures named by the binding round-3 ruling. Before
    // this fix, R3 gated on `lineIsVisible` — true whenever ANY span (text
    // OR expr) overlapped the physical line — so fixture (a) below wrongly
    // fired: `bar` is not a VISIBLE_ATTR_NAMES member, so `{cfg.type}` gets
    // no span of its own, but the sibling `title="Hello"` literal's span
    // shares the line and used to be enough to flip `visible` true. The
    // fix requires the interpolation match's OWN [start,end) range to be
    // CONTAINED in a span (span-range containment, not line overlap).

    // (a) NOT flagged: `{cfg.type}` sits in a non-visible attribute (`bar`)
    // even though a genuinely visible `title="Hello"` attribute is on the
    // same physical line.
    const rootA = makeFixtureRoot();
    const relPathA = "terminal/components/SiblingSpan.tsx";
    const contentA = [
      "export function SiblingSpan({ cfg }: any) {",
      '  return <Foo bar={cfg.type} title="Hello" />;',
      "}",
      "",
    ].join("\n");
    writeFileSync(join(rootA, relPathA), contentA);
    const diffA = unifiedDiffFor(relPathA, contentA, [2]);
    const diffFileA = join(rootA, "diff.patch");
    writeFileSync(diffFileA, diffA);
    const resA = run(["--mode", "enforce-added", "--root", rootA, "--diff-file", diffFileA, "--json"]);
    expect(resA.status).toBe(0);
    const parsedA = parseJson(resA);
    expect(parsedA.findings.some((f: any) => f.rule === "raw_slug_interpolation")).toBe(false);
    rmSync(rootA, { recursive: true, force: true });

    // (b) Flagged: `{cfg.type}` IS the value of a visible attribute
    // (`title`), so its own range lies inside that attribute's expr span.
    const rootB = makeFixtureRoot();
    const relPathB = "terminal/components/VisibleAttrInterp.tsx";
    const contentB = [
      "export function VisibleAttrInterp({ cfg }: any) {",
      "  return <Foo title={cfg.type} />;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(rootB, relPathB), contentB);
    const diffB = unifiedDiffFor(relPathB, contentB, [2]);
    const diffFileB = join(rootB, "diff.patch");
    writeFileSync(diffFileB, diffB);
    const resB = run(["--mode", "enforce-added", "--root", rootB, "--diff-file", diffFileB, "--json"]);
    expect(resB.status).toBe(1);
    const parsedB = parseJson(resB);
    expect(
      parsedB.findings.some(
        (f: any) => f.rule === "raw_slug_interpolation" && f.token === "type" && f.blocking
      )
    ).toBe(true);
    rmSync(rootB, { recursive: true, force: true });

    // (c) Flagged: `{cfg.type}` is a direct JSX child, so its own range
    // lies inside that JsxExpression's expr span.
    const rootC = makeFixtureRoot();
    const relPathC = "terminal/components/JsxChildInterp.tsx";
    const contentC = [
      "export function JsxChildInterp({ cfg }: any) {",
      "  return <p>{cfg.type}</p>;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(rootC, relPathC), contentC);
    const diffC = unifiedDiffFor(relPathC, contentC, [2]);
    const diffFileC = join(rootC, "diff.patch");
    writeFileSync(diffFileC, diffC);
    const resC = run(["--mode", "enforce-added", "--root", rootC, "--diff-file", diffFileC, "--json"]);
    expect(resC.status).toBe(1);
    const parsedC = parseJson(resC);
    expect(
      parsedC.findings.some(
        (f: any) => f.rule === "raw_slug_interpolation" && f.token === "type" && f.blocking
      )
    ).toBe(true);
    rmSync(rootC, { recursive: true, force: true });
  });

  it("26. dedup: two occurrences of the same token on one line produce ONE finding (PR #530 round-3 review minor 2)", () => {
    // MEASURED pre-fix on OptionsHubView.tsx: `:3676 tok=oi` x3, `:3646
    // tok=oi` x2 — R4 walks every regex match per visible span with no
    // dedup, so a repeated token inside one JsxText span produced one
    // finding PER OCCURRENCE instead of one per (path, line, rule, token).
    const root = makeFixtureRoot();
    const relPath = "terminal/components/RepeatedToken.tsx";
    const content = [
      "export function RepeatedToken() {",
      "  return <span>oi versus oi contracts</span>;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(1);
    const parsed = parseJson(res);
    const oiHits = parsed.findings.filter(
      (f: any) => f.rule === "untranslated_stat_token" && f.token === "oi"
    );
    expect(oiHits.length).toBe(1);
    expect(oiHits[0].blocking).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("27. terminal/app/dev/** dev-only harness pages are excluded from scanning (PR #530 round-3 review minor 3)", () => {
    // 9 of the first 10 `missing_zh` hits on the real repo were
    // terminal/app/dev/settings/page.tsx / terminal/app/dev/theater/page.tsx
    // — both self-described "Production-gated" (NODE_ENV === "production"
    // -> notFound()) developer harnesses no real user ever sees.
    const root = makeFixtureRoot();
    const relPath = "terminal/app/dev/settings/page.tsx";
    mkdirSync(join(root, "terminal/app/dev/settings"), { recursive: true });
    const content = [
      "export default function DevSettingsPage() {",
      "  return <div><b>BOTTOM_WATCH</b></div>;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, relPath), content);
    const diff = unifiedDiffFor(relPath, content, [2]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);
    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(0);
    const parsed = parseJson(res);
    expect(parsed.findings.some((f: any) => f.path === relPath)).toBe(false);
    expect(parsed.legacy.some((f: any) => f.path === relPath)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("28. R3 examines EVERY `{...field}` match on a line, not just the first (PR #530 round-4 review MAJOR)", () => {
    // RED-first regression from the round-3 containment fix: a non-global
    // `interpRe.exec(rawLine)` returns only the FIRST match on the line —
    // once that first match failed containment, a LATER match on the same
    // line (for the same field) was never even examined, silently dropping
    // a true positive. Both fixtures below carry a first match that is
    // NOT contained (a non-visible attribute / a non-visible style prop)
    // followed by a second match that IS contained (a visible `title={...}`
    // attribute; a bare JSX-child interpolation).

    // (a) `bar={cfg.type}` (bar is not VISIBLE_ATTR_NAMES, no span) is
    // followed on the SAME line by `title={row.type}` (title IS visible) —
    // must still be flagged for field "type".
    const rootA = makeFixtureRoot();
    const relPathA = "terminal/components/TwoInterpAttr.tsx";
    const contentA = [
      "export function TwoInterpAttr({ cfg, row }: any) {",
      "  return <Foo bar={cfg.type} title={row.type} />;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(rootA, relPathA), contentA);
    const diffA = unifiedDiffFor(relPathA, contentA, [2]);
    const diffFileA = join(rootA, "diff.patch");
    writeFileSync(diffFileA, diffA);
    const resA = run(["--mode", "enforce-added", "--root", rootA, "--diff-file", diffFileA, "--json"]);
    expect(resA.status).toBe(1);
    const parsedA = parseJson(resA);
    expect(
      parsedA.findings.some(
        (f: any) => f.rule === "raw_slug_interpolation" && f.token === "type" && f.blocking
      )
    ).toBe(true);
    rmSync(rootA, { recursive: true, force: true });

    // (b) `style={cfg.kind}` (style is not VISIBLE_ATTR_NAMES, no span) is
    // followed on the SAME line by a bare JSX-child `{row.kind}` — must
    // still be flagged for field "kind".
    const rootB = makeFixtureRoot();
    const relPathB = "terminal/components/TwoInterpChild.tsx";
    const contentB = [
      "export function TwoInterpChild({ cfg, row }: any) {",
      "  return <div style={cfg.kind}>{row.kind}</div>;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(rootB, relPathB), contentB);
    const diffB = unifiedDiffFor(relPathB, contentB, [2]);
    const diffFileB = join(rootB, "diff.patch");
    writeFileSync(diffFileB, diffB);
    const resB = run(["--mode", "enforce-added", "--root", rootB, "--diff-file", diffFileB, "--json"]);
    expect(resB.status).toBe(1);
    const parsedB = parseJson(resB);
    expect(
      parsedB.findings.some(
        (f: any) => f.rule === "raw_slug_interpolation" && f.token === "kind" && f.blocking
      )
    ).toBe(true);
    rmSync(rootB, { recursive: true, force: true });
  });

  it("29. --json output survives a piped read past the 64 KiB pipe-buffer boundary (PR #530 round-4 review MAJOR)", () => {
    // RED-first: MEASURED pre-fix, a real `--json` run's stdout was 94339
    // bytes written to a FILE (valid) but exactly 65536 bytes
    // (JSONDecodeError: Unterminated string) when the SAME command's
    // stdout was a PIPE instead — `console.log(...)` immediately followed
    // by `process.exit(n)` tore the process down before Node's async pipe
    // write finished draining. `spawnSync` (what `run()` uses) reads the
    // child's stdout as a pipe, so this test reproduces the exact failure
    // mode: a large enough `legacy[]` array must come back as COMPLETE,
    // valid JSON, not truncated at any fixed byte boundary.
    const root = makeFixtureRoot();
    const relPath = "terminal/components/HugeLegacy.tsx";
    const N = 400;
    const lines = ["export function HugeLegacy() {", "  return (", "    <div>"];
    for (let i = 0; i < N; i++) {
      const token = `TOKEN_${String(i).padStart(4, "0")}`;
      lines.push(`      <span>${token}</span>`);
    }
    lines.push("    </div>", "  );", "}", "");
    const content = lines.join("\n");
    writeFileSync(join(root, relPath), content);

    // The diff touches a DIFFERENT, harmless file — HugeLegacy.tsx is never
    // marked as touched, so every one of its N violations reports as
    // `legacy`, not `blocking` (full census still scans it regardless).
    const otherRelPath = "terminal/components/HugeOther.tsx";
    const otherContent = ["export function HugeOther() {", "  return <div />;", "}", ""].join("\n");
    writeFileSync(join(root, otherRelPath), otherContent);
    const diff = unifiedDiffFor(otherRelPath, otherContent, [1]);
    const diffFile = join(root, "diff.patch");
    writeFileSync(diffFile, diff);

    const res = run(["--mode", "enforce-added", "--root", root, "--diff-file", diffFile, "--json"]);
    expect(res.status).toBe(0); // legacy only, nothing blocking
    expect(res.stdout.length).toBeGreaterThan(65536);
    // Must parse as ONE complete, valid JSON document — this throws on the
    // pre-fix truncated tail ("Unterminated string ...").
    const parsed = parseJson(res);
    const legacyHits = parsed.legacy.filter(
      (f: any) => f.rule === "raw_state_enum" && f.path === relPath
    );
    expect(legacyHits.length).toBe(N);
    rmSync(root, { recursive: true, force: true });
  });
});
