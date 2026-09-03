/**
 * guestBundleBoundary.test.ts — the guest route graph must not REACH the workspace (B6).
 *
 * Every gated route is a server component that returns a gate for a visitor who cannot enter the
 * surface. That is correct for auth, and it was wrong for bundles: Next puts every client
 * component reachable from a route's module graph into that route's client manifest, so the gate
 * shipped the desk with it. A signed-out `/analysis` load decoded ~2.1 MB of a workspace the
 * visitor is not allowed to open, and the same shape cost ~5 MB more across the other five.
 *
 * WHY A STATIC-GRAPH TEST rather than a bundle-size assertion: bundle weight can only be measured
 * against a production build, which CI does not run, and a number in a snapshot rots. The
 * REACHABILITY is the invariant — the byte count is a consequence of it. This test walks the
 * actual static import graph from each page and fails the moment a workspace becomes reachable
 * again, which is exactly the edit that would silently re-add the megabytes.
 *
 * Dynamic `import()` is deliberately NOT followed: that is the boundary under test. `import type`
 * is not followed either, because TypeScript erases it entirely.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** route page → the workspace implementation that must stay out of its guest graph. */
const GATED_ROUTES: Array<{ page: string; workspace: string; mount: string }> = [
  { page: "app/(shell)/analysis/page.tsx", workspace: "components/workspaces/AnalysisWorkspace.tsx", mount: "components/mounts/AnalysisWorkspaceMount.tsx" },
  { page: "app/(shell)/analysis/page.tsx", workspace: "components/workspaces/ThesisWorkspace.tsx", mount: "components/mounts/ThesisWorkspaceMount.tsx" },
  { page: "app/(shell)/discover/page.tsx", workspace: "components/workspaces/DiscoverWorkspace.tsx", mount: "components/mounts/DiscoverWorkspaceMount.tsx" },
  { page: "app/(shell)/options/page.tsx", workspace: "components/workspaces/OptionsWorkspace.tsx", mount: "components/mounts/OptionsWorkspaceMount.tsx" },
  { page: "app/(shell)/alerts/page.tsx", workspace: "components/AlertsView.tsx", mount: "components/mounts/AlertsViewMount.tsx" },
  { page: "app/(shell)/portfolio/page.tsx", workspace: "components/PortfolioView.tsx", mount: "components/mounts/PortfolioViewMount.tsx" },
  { page: "app/(shell)/scripts/page.tsx", workspace: "components/PineEditor.tsx", mount: "components/mounts/PineEditorMount.tsx" },
];

/** Heavy client modules a guest must never pull in through ANY gated route. */
const WORKSPACE_ONLY_MODULES = [
  "components/ScreenerView.tsx",
  "components/OptionsHubView.tsx",
  "components/heatmap/HeatmapPageRoot.tsx",
];

const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  else return null;                                  // node_modules — not our graph
  for (const ext of ["", ...EXTENSIONS]) {
    const candidate = base + ext;
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      try { if (readFileSync(candidate).length >= 0) return path.relative(ROOT, candidate); } catch { /* dir */ }
    }
  }
  for (const ext of EXTENSIONS) {
    const candidate = path.join(base, "index" + ext);
    if (existsSync(candidate)) return path.relative(ROOT, candidate);
  }
  return null;
}

/**
 * STATIC specifiers only. `import type` is erased by TypeScript, and `import(...)` is the
 * boundary itself — following either would make this test assert nothing.
 */
function staticImports(source: string): string[] {
  const specs: string[] = [];
  const statement = /^\s*(?:import|export)\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (const match of source.matchAll(statement)) specs.push(match[1]);
  return specs;
}

/** Every file statically reachable from `entry`. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let source: string;
    try { source = readFileSync(path.join(ROOT, file), "utf8"); } catch { continue; }
    for (const spec of staticImports(source)) {
      const resolved = resolveSpecifier(spec, file);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

describe("gated routes cannot statically reach their workspace", () => {
  for (const { page, workspace, mount } of GATED_ROUTES) {
    it(`${page} does not reach ${workspace}`, () => {
      const graph = reachable(page);
      expect(graph.has(mount), `${page} must render the workspace through ${mount}`).toBe(true);
      expect(
        graph.has(workspace),
        `${workspace} is statically reachable from ${page} — a signed-out visitor downloads the `
        + "whole workspace to look at a sign-up gate. Route it through the mount instead.",
      ).toBe(false);
    });
  }

  it("no gated route reaches the heavy workspace-only modules", () => {
    const offenders: string[] = [];
    for (const { page } of GATED_ROUTES) {
      const graph = reachable(page);
      for (const heavy of WORKSPACE_ONLY_MODULES) if (graph.has(heavy)) offenders.push(`${page} -> ${heavy}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("the mounts are real boundaries, not decorative wrappers", () => {
  for (const { workspace, mount } of GATED_ROUTES) {
    it(`${mount} loads its workspace dynamically and never statically`, () => {
      const source = readFileSync(path.join(ROOT, mount), "utf8");
      expect(source.startsWith('"use client"'), `${mount} must be a client module`).toBe(true);
      expect(/dynamic\(\s*\(\)\s*=>\s*import\(/.test(source), `${mount} must use next/dynamic`).toBe(true);

      // The value graph must not contain the workspace: only `import type` may name it.
      const specs = staticImports(source).map((s) => resolveSpecifier(s, mount));
      expect(specs).not.toContain(workspace);
    });

    it(`${mount} keeps SSR on, so the member path is unchanged`, () => {
      const source = readFileSync(path.join(ROOT, mount), "utf8");
      // `ssr: false` would turn the authenticated workspace into a client-only render — a blank
      // first paint and a hydration shape the responsive suite does not describe.
      expect(/ssr\s*:\s*false/.test(source)).toBe(false);
    });
  }
});
