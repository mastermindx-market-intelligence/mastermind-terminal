/**
 * flowScoreBoundary.test.ts — the proprietary scorer cannot reach the browser (F-5).
 *
 * `lib/flowSource.ts` declared "SERVER-ONLY" in a header comment and was the only importer of
 * `lib/flowScore.ts`. But a comment binds only the file it is written in: nothing stopped a future
 * client component from importing `@/lib/flowScore` directly, and the whole flow_score_v1 weight
 * table would have shipped in the client bundle with no error, no warning, and no test failing.
 *
 * Two fences now stand behind that boundary:
 *
 *   1. `import "server-only"` in flowScore.ts itself — Next.js resolves it to a throwing module
 *      outside the `react-server` condition, so a client import is a BUILD ERROR. That is the
 *      real enforcement and it is the one an attacker-by-accident hits first.
 *   2. This test — a static walk of the client import graph. It fails in seconds with the exact
 *      offending chain instead of a bundler stack trace, and it also catches a regression where
 *      someone "fixes the build" by deleting the marker.
 *
 * The third guarantee — that the shipped bundle contains no scoring implementation — is verified
 * against a real `next build` and recorded in the PR, because building here would add minutes to
 * every CI run for a property fence 1 already makes unrepresentable.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const SCORER = path.join(ROOT, "lib", "flowScore.ts");

const SOURCE_EXT = [".ts", ".tsx"];
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__", "e2e", "test-results", "public"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_EXT.includes(path.extname(full))) out.push(full);
  }
  return out;
}

const ALL_SOURCES = ["app", "lib", "components"].flatMap((d) => walk(path.join(ROOT, d)));

const read = (f: string) => readFileSync(f, "utf8");

/** Resolve an import specifier to a file inside this project, or null if it leaves the project. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // bare package — not ours
  for (const cand of [
    base, `${base}.ts`, `${base}.tsx`,
    path.join(base, "index.ts"), path.join(base, "index.tsx"),
  ]) {
    try { if (statSync(cand).isFile()) return cand; } catch { /* keep trying */ }
  }
  return null;
}

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

function importsOf(file: string): string[] {
  const src = read(file);
  const specs: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2] || m[3];
    if (spec) specs.push(spec);
  }
  return specs;
}

/** Files carrying the "use client" directive — every browser-bundle entry point. */
const CLIENT_ENTRIES = ALL_SOURCES.filter((f) => /^\s*["']use client["']/m.test(read(f)));

describe("flowScore is unreachable from the client bundle", () => {
  it("finds client entry points to walk (guards against a vacuous pass)", () => {
    // If the discovery ever broke, every assertion below would pass by finding nothing.
    expect(CLIENT_ENTRIES.length).toBeGreaterThan(20);
  });

  it("no 'use client' module reaches lib/flowScore.ts, directly or transitively", () => {
    const offenders: string[] = [];

    for (const entry of CLIENT_ENTRIES) {
      // BFS from this entry, recording the chain so a failure names the actual path.
      const seen = new Set<string>([entry]);
      const queue: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [entry] }];
      while (queue.length) {
        const { file, chain } = queue.shift()!;
        for (const spec of importsOf(file)) {
          const target = resolveSpecifier(file, spec);
          if (!target || seen.has(target)) continue;
          if (target === SCORER) {
            offenders.push(chain.concat(target).map((f) => path.relative(ROOT, f)).join("\n      -> "));
            queue.length = 0;
            break;
          }
          seen.add(target);
          queue.push({ file: target, chain: chain.concat(target) });
        }
      }
    }

    expect(offenders, `client modules reaching the proprietary scorer:\n    ${offenders.join("\n\n    ")}`)
      .toEqual([]);
  });

  it("keeps the build-time marker in the implementation, not only in its consumer", () => {
    // Deleting this line to "make the build pass" is the regression this asserts against.
    expect(read(SCORER)).toMatch(/^import ["']server-only["'];$/m);
  });

  it("the scorer is imported by the server data path only", () => {
    const importers = ALL_SOURCES.filter(
      (f) => f !== SCORER && importsOf(f).some((s) => resolveSpecifier(f, s) === SCORER),
    ).map((f) => path.relative(ROOT, f));
    expect(importers).toEqual(["lib/flowSource.ts"]);
  });
});
