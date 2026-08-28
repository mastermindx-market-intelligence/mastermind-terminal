// Lazy access to suite COMPUTATION.
//
// The metadata registry (lib/suites/meta.ts) describes every suite and module without importing a
// single line of implementation. This file is the other side of that boundary: it hands out the
// full runtime `SuiteDef` — metadata plus each module's `compute` — and it pulls the
// implementation graph in through a dynamic import, so a suite's code is fetched only once that
// suite is actually active on the chart.
//
// WHY IT MATTERS: `registry.ts` used to import all 31 module implementations eagerly, so
// /terminal shipped ~562 KB of suite computation before a single premium suite was switched on.
// TerminalShell only ever needed identity and defaults.
//
// USAGE CONTRACT — the render path stays SYNCHRONOUS. A caller preloads on activation and reads
// through `peekSuiteRuntime` inside the render pass:
//
//     useEffect(() => { for (const k of activeSuites) void ensureSuiteRuntime(k).then(rerender); },
//              [activeSuites]);
//     const def = peekSuiteRuntime(key);   // null while the chunk is in flight
//     if (!def) continue;                  // …this pass draws nothing for that suite
//
// Never `await` inside a render or a chart callback: the passes run on an animation schedule and
// an await there reorders drawing against live data. Preload, then peek.

import type { SuiteDef } from "@/lib/indicator-canvas/types";
import { SUITE_ORDER } from "./meta";

/**
 * One import() per suite — NOT one per module.
 *
 * Modules inside a suite share compute (the RSI engine's series feeds Signals, Divergence and
 * Channels through `ctx.suite`), so splitting finer would either duplicate that work or fetch
 * the siblings anyway on the first satellite. The suite is the real unit.
 *
 * The specifiers are static string literals so the bundler can see and split them; a computed
 * `import(\`./runtime/${k}\`)` defeats that in some bundler configurations and is deliberately
 * not used here.
 */
const LOADERS: Record<string, () => Promise<{ default: SuiteDef }>> = {
  structure: () => import("./runtime/structure"),
  trend: () => import("./runtime/trend"),
  pulse: () => import("./runtime/pulse"),
  rsix: () => import("./runtime/rsix"),
  macdx: () => import("./runtime/macdx"),
};

const loaded = new Map<string, SuiteDef>();
const inflight = new Map<string, Promise<SuiteDef | null>>();

/** Synchronous read for the render path. `null` = not loaded yet (or not a suite key). */
export function peekSuiteRuntime(key: string): SuiteDef | null {
  return loaded.get(key) ?? null;
}

/** True once this suite's computation is resident and `peekSuiteRuntime` will answer. */
export function isSuiteRuntimeLoaded(key: string): boolean {
  return loaded.has(key);
}

/**
 * Fetch a suite's computation. Idempotent and deduplicated: concurrent callers share one import,
 * and a resolved suite answers from memory forever after.
 *
 * A failed chunk fetch resolves `null` rather than throwing — a flaky network must degrade to
 * "this suite is not drawn yet", never to a broken chart — and it does NOT poison the entry, so
 * the next activation retries.
 */
export function ensureSuiteRuntime(key: string): Promise<SuiteDef | null> {
  const already = loaded.get(key);
  if (already) return Promise.resolve(already);
  const pending = inflight.get(key);
  if (pending) return pending;
  const load = LOADERS[key];
  if (!load) return Promise.resolve(null);

  const promise = load()
    .then((mod) => {
      const def = mod.default;
      if (def) loaded.set(key, def);
      return def ?? null;
    })
    .catch(() => null)
    .finally(() => { inflight.delete(key); });
  inflight.set(key, promise);
  return promise;
}

/** Warm several suites at once — what a consumer calls when the active set changes. */
export function ensureSuiteRuntimes(keys: Iterable<string>): Promise<Array<SuiteDef | null>> {
  return Promise.all([...keys].map(ensureSuiteRuntime));
}

/**
 * Every suite's computation, awaited. For NON-BROWSER consumers (the alerts cron bundle, tests)
 * where there is no bundle to protect and the convenience of one call is worth more.
 */
export async function loadAllSuiteRuntimes(): Promise<Record<string, SuiteDef>> {
  const out: Record<string, SuiteDef> = {};
  for (const key of SUITE_ORDER) {
    const def = await ensureSuiteRuntime(key);
    if (def) out[key] = def;
  }
  return out;
}

/** Test hook — drop the resident computation so a spec can observe a cold load. */
export function _resetSuiteRuntime(): void {
  loaded.clear();
  inflight.clear();
}
