/**
 * suiteRegistrySplit.test.ts — the metadata/compute split has ONE identity and no leak (B7).
 *
 * `lib/suites/registry.ts` used to import all 31 module implementations and expose identity AND
 * computation through one graph, so reading a suite's label pulled its compute: ~562 KB of
 * premium-suite computation entered /terminal before a single suite was switched on.
 *
 * Splitting a registry is the kind of refactor that silently forks a definition. Two fences here:
 *
 *   1. IDENTITY — the metadata graph and the runtime graph must describe the same suites and the
 *      same modules, in the same order, with identical keys, labels, tags, tiers, defaultOn,
 *      fields and defaults. Module order is not cosmetic: it drives sub-pane creation, legend
 *      rows and z-order. `deep-equal on every metadata field` is the assertion because a drifted
 *      tier sells a pro module cheap and a drifted default silently rewrites a user's settings.
 *
 *   2. REACHABILITY — nothing statically reachable from the metadata graph may import an
 *      implementation. That is the invariant the byte count is a consequence of; a size snapshot
 *      would rot, this does not.
 *
 * The math itself is fenced by suiteModules.test.ts (264 cases over the real computes), which now
 * reads the runtime defs directly.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { SUITE_ORDER, SUITE_DEFS as SUITE_META, suiteDefaults } from "@/lib/suites/registry";
import { STRUCTURE_SUITE } from "@/lib/suites/runtime/structure";
import { TREND_SUITE } from "@/lib/suites/runtime/trend";
import { PULSE_SUITE } from "@/lib/suites/runtime/pulse";
import { RSIX_SUITE } from "@/lib/suites/runtime/rsix";
import { MACDX_SUITE } from "@/lib/suites/runtime/macdx";
import type { SuiteDef } from "@/lib/indicator-canvas/types";

const RUNTIME: Record<string, SuiteDef> = {
  structure: STRUCTURE_SUITE,
  trend: TREND_SUITE,
  pulse: PULSE_SUITE,
  rsix: RSIX_SUITE,
  macdx: MACDX_SUITE,
};

const ROOT = path.resolve(__dirname, "../..");

describe("one canonical identity: metadata and runtime describe the same suites", () => {
  it("covers exactly the same suite keys", () => {
    expect(Object.keys(RUNTIME).sort()).toEqual([...SUITE_ORDER].sort());
    expect(Object.keys(SUITE_META).sort()).toEqual([...SUITE_ORDER].sort());
  });

  for (const key of ["structure", "trend", "pulse", "rsix", "macdx"]) {
    it(`${key}: suite-level fields are identical`, () => {
      const meta = SUITE_META[key];
      const runtime = RUNTIME[key];
      expect(runtime.key).toBe(meta.key);
      expect(runtime.label).toBe(meta.label);
      expect(runtime.tag).toBe(meta.tag);
      expect(runtime.tkey).toBe(meta.tkey);
      expect(runtime.kind).toBe(meta.kind);
      // The pane range and its guide lines are what every drawn value is asserted against.
      expect(runtime.pane).toEqual(meta.pane);
    });

    it(`${key}: module ORDER and every metadata field are identical`, () => {
      const meta = SUITE_META[key];
      const runtime = RUNTIME[key];
      expect(runtime.modules.map((m) => m.key)).toEqual(meta.modules.map((m) => m.key));
      for (let i = 0; i < meta.modules.length; i += 1) {
        const a = meta.modules[i];
        const b = runtime.modules[i];
        expect({ key: b.key, label: b.label, tag: b.tag, tier: b.tier, defaultOn: b.defaultOn })
          .toEqual({ key: a.key, label: a.label, tag: a.tag, tier: a.tier, defaultOn: a.defaultOn });
        expect(b.defaults).toEqual(a.defaults);
        expect(b.fields).toEqual(a.fields);
      }
    });

    it(`${key}: every runtime module carries a callable compute, and metadata carries none`, () => {
      for (const m of RUNTIME[key].modules) expect(typeof m.compute).toBe("function");
      for (const m of SUITE_META[key].modules) {
        expect((m as { compute?: unknown }).compute).toBeUndefined();
      }
    });

    it(`${key}: the metadata literal is the SAME object the runtime spreads`, () => {
      // Spread, not copy-paste: a runtime module's metadata values must be the metadata's own.
      const meta = SUITE_META[key];
      const runtime = RUNTIME[key];
      for (let i = 0; i < meta.modules.length; i += 1) {
        expect(runtime.modules[i].fields).toBe(meta.modules[i].fields);
        expect(runtime.modules[i].defaults).toBe(meta.modules[i].defaults);
      }
    });
  }

  it("suiteDefaults() answers the same blob it did before the split", () => {
    // Seeds indParams on first activation: a change here silently rewrites saved settings.
    for (const key of SUITE_ORDER) {
      const fromMeta = suiteDefaults(key);
      const expected: Record<string, unknown> = {};
      for (const m of RUNTIME[key].modules) {
        expected[`${m.key}.on`] = m.defaultOn;
        for (const [k, v] of Object.entries(m.defaults)) expected[`${m.key}.${k}`] = v;
      }
      expect(fromMeta).toEqual(expected);
    }
  });
});

// ── reachability ────────────────────────────────────────────────────────────────────────────

const EXTENSIONS = [".ts", ".tsx"];

function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  else return null;
  for (const ext of ["", ...EXTENSIONS]) {
    const candidate = base + ext;
    if (existsSync(candidate) && candidate.endsWith(".ts")) return path.relative(ROOT, candidate);
  }
  for (const ext of EXTENSIONS) {
    const candidate = path.join(base, "index" + ext);
    if (existsSync(candidate)) return path.relative(ROOT, candidate);
  }
  return null;
}

/** STATIC specifiers only — `import()` is the boundary under test, `import type` is erased. */
function staticImports(source: string): string[] {
  const out: string[] = [];
  const statement = /^\s*(?:import|export)\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (const m of source.matchAll(statement)) out.push(m[1]);
  return out;
}

function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let src: string;
    try { src = readFileSync(path.join(ROOT, file), "utf8"); } catch { continue; }
    for (const spec of staticImports(src)) {
      const resolved = resolveSpecifier(spec, file);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

/** Every module IMPLEMENTATION file (the ones carrying a `compute`). */
function implementationFiles(): string[] {
  const dir = path.join(ROOT, "lib/suites");
  const out: string[] = [];
  for (const suite of readdirSync(dir)) {
    if (suite === "shared" || suite === "runtime" || suite.endsWith(".ts")) continue;
    for (const f of readdirSync(path.join(dir, suite))) {
      if (!f.endsWith(".ts") || f.endsWith(".meta.ts")) continue;
      out.push(`lib/suites/${suite}/${f}`);
    }
  }
  return out;
}

describe("the boot graph cannot reach suite computation", () => {
  const impls = implementationFiles();

  it("finds the implementation files it is asserting about", () => {
    expect(impls.length).toBeGreaterThanOrEqual(29);
  });

  for (const entry of ["lib/suites/meta.ts", "lib/suites/registry.ts", "lib/suites/catalog.ts", "lib/suites/presets.ts"]) {
    it(`${entry} reaches no module implementation`, () => {
      const graph = reachable(entry);
      const leaked = impls.filter((f) => graph.has(f));
      expect(
        leaked,
        `${entry} statically imports ${leaked.length} module implementation(s) — the eager suite `
        + "graph is back and /terminal ships the compute again",
      ).toEqual([]);
    });
  }

  it("lib/suites/compute.ts holds the ONLY route to the runtime, and only through import()", () => {
    const src = readFileSync(path.join(ROOT, "lib/suites/compute.ts"), "utf8");
    for (const key of SUITE_ORDER) {
      expect(src).toContain(`import("./runtime/${key}")`);
    }
    // A static import here would defeat the whole split.
    expect(staticImports(src).some((s) => s.includes("runtime/"))).toBe(false);
  });

  it("every runtime entry reaches its own implementations (the split did not orphan compute)", () => {
    for (const key of SUITE_ORDER) {
      const graph = reachable(`lib/suites/runtime/${key}.ts`);
      const hits = impls.filter((f) => graph.has(f));
      expect(hits.length, `${key}: runtime entry reaches no implementation`).toBeGreaterThan(0);
    }
  });
});
