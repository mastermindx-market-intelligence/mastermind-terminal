/**
 * noMacroPagesFallback.test.ts — no Terminal read path may fall back to the macro
 * repo's anonymous GitHub Pages/raw mirror (DEC:B1-MACRO-PRIVATE-CUTOVER).
 *
 * The canonical Macro repo (`mastermindx-market-intelligence/macro`, formerly hosted
 * under the pre-rename owner alias `chriswong6031-creator`) is flipping from public to
 * private. Before that flip, every Terminal read path must stop depending on that
 * repo's public GitHub Pages deploy or raw-file mirror as a last-resort source: once
 * the repo is private those hosts either 404 or never had live content to begin with,
 * and reading them anonymously is exactly the dependency this guard exists to forbid
 * (see the retired `flow_idx` Pages fallback formerly in lib/flowSource.ts, and the
 * precedent DEC:B1-PROPHET-PUBLIC-SPLIT retirement of the `prophet_idx` R2 fallback).
 *
 * This walks the real production source tree (terminal/app, terminal/lib — excluding
 * __tests__ directories, which are test code, not a read path) and fails if any file
 * references either macro-owned GitHub Pages host or a macro-owned raw.githubusercontent
 * path. `lib/originNav.ts`'s generic `*.github.io` referrer-matching predicate is exempt
 * BY CONSTRUCTION: it is a bare-suffix check with no owner name in it — this guard only
 * ever matches an OWNER-QUALIFIED host, which that file never spells out.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "lib"];

/** The two GitHub owners behind the macro repo, pre- and post-rename. */
const MACRO_OWNERS = ["mastermindx-market-intelligence", "chriswong6031-creator"];

/** Owner-qualified Pages / raw hosts — never a bare "github.io" substring. */
const FORBIDDEN_PATTERNS: RegExp[] = MACRO_OWNERS.flatMap((owner) => [
  new RegExp(`${owner}\\.github\\.io`),
  new RegExp(`raw\\.githubusercontent\\.com/${owner}`),
]);

/** Returns the first forbidden pattern found in `content`, or null. */
function findMacroPagesReference(content: string): RegExp | null {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) return pattern;
  }
  return null;
}

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function listFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = path.join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...listFiles(full));
    } else if (CODE_EXTENSIONS.has(path.extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

describe("no production read path falls back to the macro repo's Pages/raw mirror", () => {
  it("terminal/app and terminal/lib contain zero owner-qualified github.io / raw.githubusercontent references", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listFiles(path.join(ROOT, dir))) {
        const content = readFileSync(file, "utf8");
        const hit = findMacroPagesReference(content);
        if (hit) offenders.push(`${path.relative(ROOT, file)} matches ${hit}`);
      }
    }
    expect(
      offenders,
      "A Terminal read path references the macro repo's anonymous GitHub Pages/raw " +
        "mirror. That dependency is retired under DEC:B1-MACRO-PRIVATE-CUTOVER — fail " +
        "closed (null / 503 / stale cache) instead of reading an anonymous public copy.",
    ).toEqual([]);
  });

  it("the detector is non-vacuous: it flags the exact URL that was removed from flowSource.ts", () => {
    // Built via concatenation so this fixture string itself never appears as a
    // contiguous literal in this source file (which is itself scanned by the test
    // above, since it lives under terminal/lib).
    const owner = "mastermindx" + "-market-intelligence";
    const removedUrl = `https://${owner}.github.io/macro/flow/index.json`;
    const syntheticSource = `
      export async function oldFallback() {
        return fetchWithUA("${removedUrl}");
      }
    `;
    expect(findMacroPagesReference(syntheticSource)).not.toBeNull();

    // And a sibling check for the pre-rename owner alias named in the retirement.
    const aliasOwner = "chriswong6031" + "-creator";
    const aliasUrl = `https://${aliasOwner}.github.io/macro/flow/index.json`;
    expect(findMacroPagesReference(`fetch("${aliasUrl}")`)).not.toBeNull();

    // Sanity: an unrelated github.io reference (no macro owner) must NOT trip the guard —
    // otherwise the guard would be over-broad rather than proving the specific check works.
    expect(findMacroPagesReference('host.endsWith(".github.io")')).toBeNull();
  });
});
