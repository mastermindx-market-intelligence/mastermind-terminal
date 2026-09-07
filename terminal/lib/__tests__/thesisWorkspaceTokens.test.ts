import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// F11 Thesis Object review fix (Meta-CEO B, round 3): UnsupportedAnalysisRoute.tsx shipped two
// inline styles referencing `--border` / `--text-muted`, tokens that do not exist anywhere in
// `app/globals.css` (the real names are `--line` and `--muted`). No CSS-module or type check
// catches an undefined custom property — the browser just silently renders `unset`/transparent.
// This test greps every component/CSS file this PR touches for `var(--...)` references and
// fails if any referenced token has no definition in globals.css, so the drift cannot recur.
const THESIS_PR_FILES = [
  "components/workspaces/UnsupportedAnalysisRoute.tsx",
  "components/workspaces/ThesisWorkspace.tsx",
  "components/workspaces/ThesisWorkspace.module.css",
  "components/mounts/ThesisWorkspaceMount.tsx",
  "app/(shell)/analysis/page.tsx",
];

function definedTokens(): Set<string> {
  const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");
  const tokens = new Set<string>();
  // Matches a custom-property DECLARATION ("--name:"), not a var(--name) reference.
  const re = /(^|[\s{;])(--[a-zA-Z0-9_-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) tokens.add(m[2]);
  return tokens;
}

function tokenRefs(source: string): string[] {
  const refs: string[] = [];
  const re = /var\((--[a-zA-Z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) refs.push(m[1]);
  return refs;
}

describe("thesis workspace CSS custom-property references", () => {
  const defined = definedTokens();

  it("app/globals.css actually defines a nonempty token set (sanity check on the extractor)", () => {
    expect(defined.size).toBeGreaterThan(50);
    expect(defined.has("--line")).toBe(true);
    expect(defined.has("--muted")).toBe(true);
  });

  for (const rel of THESIS_PR_FILES) {
    it(`every var(--token) in ${rel} resolves in app/globals.css`, () => {
      const abs = join(__dirname, "..", "..", rel);
      const source = readFileSync(abs, "utf8");
      const refs = tokenRefs(source);
      const undefinedRefs = refs.filter((t) => !defined.has(t));
      expect(undefinedRefs, `undefined tokens in ${rel}: ${undefinedRefs.join(", ")}`).toEqual([]);
    });
  }
});
