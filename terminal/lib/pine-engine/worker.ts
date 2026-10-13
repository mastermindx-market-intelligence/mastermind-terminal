// Pine engine Web Worker — runs compile + execute OFF the main thread so a heavy script (or a
// hostile runaway) never freezes the UI. The host (host.ts) owns the real cancellation/budget: it
// worker.terminate()s on a wall-budget breach or a superseded run and respawns a fresh worker, so
// this file stays simple — it parses once, caches the AST per source hash, and executes on request.
//
// PROTOCOL (see host.ts for the typed contract):
//   → { kind: "compile", reqId, source }
//        ← { kind: "compiled", reqId, ok, errors, astId }         (astId = source hash, AST cached here)
//   → { kind: "run", reqId, astId?, source?, bars, inputs, opts }
//        ← { kind: "ran", reqId, ok, errors, result }             (result = RunResult | null)
//   → { kind: "evict", astId }                                    (drop one cached AST)
//   → { kind: "clear" }                                           (drop the whole AST cache)
//
// bars arrive columnar (Float64Array time/o/h/l/c/v + an ISO-time string[] for the engine's date
// math) — transferable-friendly, so the host can hand ownership of the numeric columns to the worker.
import { compile, runCompiled, type ParseResult, type Bar, type RunOpts } from "./index";
import { hashSource, type ColumnarBars, columnsToBars } from "./host-shared";

// AST cache keyed by source hash — a data-only re-run (replay tick, param edit, live splice) reuses
// the compiled AST and never re-parses. Bounded so a session that edits many scripts can't grow it
// without limit; the host also evicts explicitly on script delete.
const AST_CACHE = new Map<string, ParseResult>();
const AST_CACHE_MAX = 64;
function cacheAst(id: string, ast: ParseResult) {
  AST_CACHE.set(id, ast);
  if (AST_CACHE.size > AST_CACHE_MAX) { const first = AST_CACHE.keys().next().value; if (first !== undefined) AST_CACHE.delete(first); }
}

type InMsg =
  | { kind: "compile"; reqId: number; source: string }
  | { kind: "run"; reqId: number; astId?: string; source?: string; bars: ColumnarBars; inputs?: Record<string, any>; opts?: { timeframe?: string; symbol?: string; budgetMs?: number; sessionAnchor?: RunOpts["sessionAnchor"] } }
  | { kind: "evict"; astId: string }
  | { kind: "clear" };

// `self` is the DedicatedWorkerGlobalScope; typed loosely so this compiles under the app's `dom`
// lib (no `webworker` lib) without a tsconfig change.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<InMsg>) => void) | null;
  postMessage: (msg: any) => void;
};

ctx.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    if (msg.kind === "clear") { AST_CACHE.clear(); return; }
    if (msg.kind === "evict") { AST_CACHE.delete(msg.astId); return; }
    if (msg.kind === "compile") {
      const astId = hashSource(msg.source);
      let c = { ok: true as boolean, errors: [] as any[] };
      if (!AST_CACHE.has(astId)) {
        const r = compile(msg.source);
        c = { ok: r.ok, errors: r.errors };
        if (r.ok && r.ast) cacheAst(astId, r.ast);
      }
      ctx.postMessage({ kind: "compiled", reqId: msg.reqId, ok: c.ok, errors: c.errors, astId: c.ok ? astId : null });
      return;
    }
    if (msg.kind === "run") {
      // Resolve the AST: prefer the cache (astId), else compile the inline source once (and cache it).
      let ast: ParseResult | null = null;
      let compileErrors: any[] = [];
      if (msg.astId && AST_CACHE.has(msg.astId)) ast = AST_CACHE.get(msg.astId)!;
      else if (msg.source != null) {
        const id = msg.astId || hashSource(msg.source);
        const r = compile(msg.source);
        if (r.ok && r.ast) { ast = r.ast; cacheAst(id, r.ast); }
        else compileErrors = r.errors;
      }
      if (!ast) {
        ctx.postMessage({ kind: "ran", reqId: msg.reqId, ok: false, errors: compileErrors.length ? compileErrors : [{ line: 0, col: 0, message: "unknown astId (recompile needed)", phase: "runtime" }], result: null });
        return;
      }
      const bars: Bar[] = columnsToBars(msg.bars);
      const out = runCompiled(ast, bars, { ...(msg.opts || {}), params: msg.inputs || {} });
      ctx.postMessage({ kind: "ran", reqId: msg.reqId, ok: out.ok, errors: out.errors, result: out.result });
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ kind: "ran", reqId: (msg as any).reqId ?? -1, ok: false, errors: [{ line: 0, col: 0, message, phase: "runtime" }], result: null });
  }
};
