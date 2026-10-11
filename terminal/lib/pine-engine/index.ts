// Public surface for the Pine v6 engine.
//
//   compile(source)             → parse ONCE → { ok, errors[], ast }  (the AST is reusable across runs)
//   runCompiled(ast, bars, opts)→ execute a pre-parsed AST bar-by-bar (no re-parse)
//   runPine(source, bars, opts) → convenience: compile + run (parses exactly ONCE — see below)
//   compilePine(source)         → parse-only check (real syntax errors with line/col), for the editor
//
// SINGLE-PARSE CONTRACT: historically runPine() parsed the source, then run() parsed it AGAIN. That
// double parse is gone — runPine() now compiles once (parse → AST) and hands the AST to run(), and
// the worker/host layer (host.ts) caches the compiled AST per source hash so data-only re-runs
// (replay ticks, live splices, param edits) never re-parse.
//
// SCOPE (this is a focused, single-timeframe interpreter, not a 100% Pine clone):
//   ✓ indicator()/strategy(), input.int/float/bool/string/timeframe/source
//   ✓ ta.macd/rsi/stoch/ema/sma/rma/wma/crossover/crossunder/highest/lowest/change/barssince/atr/…
//   ✓ math.*, color.* (new/rgb + named), str.tostring/format, arithmetic/compare/ternary/logical
//   ✓ series semantics — bar-by-bar, `[n]` history, `var`, `:=`, user functions (single/multi-line, tuples)
//   ✓ plot (→ line/histogram/area/circles), plotshape/plotchar (→ markers), hline (→ price line)
//   ✓ request.security: a COARSER timeframe is truly resampled — the chart bars are grouped up to the
//     requested TF and the whole script re-runs on those HTF bars. The requested expression is
//     evaluated inside that re-run at its own call site (ta.*, barstate, `[n]` history and user
//     functions all run on the HTF timeline) and the chart pass only reads the recorded HTF values.
//     Admitted contexts, each with an explicit publication rule (runtime.ts planHtf/resampleBars):
//       daily → 1W (ISO week), daily → 1M/3M/12M (calendar month/quarter/year), monthly chart →
//       a coarser 1M/3M/12M multiple, daily → nD (lib/sessionBars grid phased by RunOpts.sessionAnchor,
//       the published session_anchor; without a usable one, the feed-phase fallback, disclosed by a
//       warning that names why).
//     Historical (isrealtime=false) default lookahead_off shows a period's value from the session
//     that confirms it — a calendar period's last session when a later session in a later period
//     exists; a session group's mult-th session — and otherwise carries the previous confirmed value
//     (gaps_off); gaps_on returns na except at that confirmation. Expression `[n]` indexes HTF bars.
//     lookahead_on is the documented future read; lookahead_on + expr[1] projects the prior period
//     at period start. An unconfirmed final period (no later session; RunOpts has no period-closed
//     witness) is not confirmed merely because it is the last array item. Prefix vs full history:
//     the only difference at an observation cutoff is that one documented correction (the session
//     that closes a calendar period is known to close it only once a later session loads).
//     Everything else coarser — multi-week (2W, 3W…), 2M/5M…, intraday units, W/2W/nD charts,
//     unsorted or non-date bar times, a call inside a for loop (also through a user function), a
//     call site the requested pass did not reach on every HTF bar up to the one shown (conditional
//     scope: its history would be thinned), a different unit of equal length (7D on W, 30D on M,
//     1440/24H on D) — returns na with a warning naming the reason. Nothing falls back to bucket mapping.
//     Conflict named: flagship secScalar uses `_src[1]` + lookahead_off intending “confirmed on every
//     intra-period bar”; that matched the old leaky bucket mapping. Vendor historical lookahead_off
//     publishes unshifted `close` at period end; `[1]` is then one published HTF bar earlier.
//     Same TF evaluates in place. Empty-string symbol argument (positional or named) means current
//     chart context — Pine same-chart convention (named assumption) — and uses the existing
//     same-context series without an unsupported-symbol warning. A different/missing/ambiguous
//     symbol returns na with an explicit unsupported-symbol warning — chart bars are never a
//     cross-symbol data plane (no alias guessing, no exchange-prefix stripping). A timeframe FINER
//     than the effective current context (chart TF outside a request; requested TF inside one)
//     returns na with an explicit unsupported-finer-timeframe warning — never chart-TF substituted
//     values (finer bars cannot be rebuilt from chart-TF bars). Nested coarser than that context
//     is na + diagnostic (admitted single HTF hop). Empty timeframe ≡ effective current context
//     (chart TF on the chart pass — Pine same-chart convention, named assumption). Unknown/
//     unparseable/zero-second timeframes refuse rather than being treated as valid.
//     timeframe.period/multiplier/isdaily/isweekly/ismonthly/isintraday inside request.security
//     read the requested TF (the expression runs in the pass whose timeframe IS that TF);
//     chart-context outputs outside request are unchanged. Separate chart-level coarser requests
//     each get their own re-run and share one run budget.
//   ✗ tables/labels/lines/boxes/fill/bgcolor/alertcondition: parsed and treated as no-ops (they don't
//     produce chart series). The flagship's MTF dashboard table is therefore not drawn here — its
//     validated BUY/SELL/CUT/RE-BUY signals keep coming from the precomputed Python oracle path.
import { parse, type ParseResult } from "./parser";
import { PineSyntaxError } from "./lexer";
import { run, type Bar, type RunResult } from "./runtime";
import type { SessionAnchor } from "../sessionBars";

export type { Bar, RunResult, PinePlot, PinePlotPoint, PineShape, PineHline, PineInput, PineMeta } from "./runtime";
export { PineRuntimeError } from "./runtime";
export type { ParseResult } from "./parser";

export interface PineError { line: number; col: number; message: string; phase: "parse" | "runtime"; }
export interface CompileResult { ok: boolean; errors: PineError[]; }
export interface PineRunOutput { ok: boolean; errors: PineError[]; result: RunResult | null; }
// compile() result: on success `ast` carries the parsed program (a ParseResult) that runCompiled()
// consumes without re-parsing; callCount/histCount are exposed so a host can cheaply key/inspect it.
export interface CompiledScript extends CompileResult { ast: ParseResult | null; callCount: number; histCount: number; }

// sessionAnchor: the symbol's published session_anchor ({ v, date, index, basis }, lib/sessionBars),
// which phases nD requests the way the chart's own nD bars are phased. Validated by the engine.
export type RunOpts = { timeframe?: string; symbol?: string; params?: Record<string, any>; budgetMs?: number; sessionAnchor?: SessionAnchor | null };

// Parse ONCE and hand back the AST for reuse. This is the compile half of the split: the editor and
// the worker call it, cache the AST by source hash, and feed it to runCompiled() for every data change.
export function compile(source: string): CompiledScript {
  try {
    const ast = parse(source);
    return { ok: true, errors: [], ast, callCount: ast.callCount, histCount: ast.histCount };
  } catch (e) {
    return { ok: false, errors: [toError(e, "parse")], ast: null, callCount: 0, histCount: 0 };
  }
}

// Execute an already-compiled AST — no re-parse. Errors here are runtime (budget, etc.).
export function runCompiled(ast: ParseResult, bars: Bar[], opts: RunOpts = {}): PineRunOutput {
  try { return { ok: true, errors: [], result: run(ast, bars, opts) }; }
  catch (e) { return { ok: false, errors: [toError(e, "runtime")], result: null }; }
}

// Parse-only check for the editor (back-compat wrapper over compile()).
export function compilePine(source: string): CompileResult {
  const c = compile(source);
  return { ok: c.ok, errors: c.errors };
}

// Convenience: compile + run in one call. opts.budgetMs caps the WHOLE run (wall-clock, default
// 3000ms in runtime.ts) — a runaway script throws PineRuntimeError, caught below and returned as a
// normal runtime error in errors[]. Parses exactly once (compile → runCompiled), no double parse.
export function runPine(source: string, bars: Bar[], opts: RunOpts = {}): PineRunOutput {
  const c = compile(source);
  if (!c.ok || !c.ast) return { ok: false, errors: c.errors, result: null };
  return runCompiled(c.ast, bars, opts);
}

function toError(e: unknown, phase: "parse" | "runtime"): PineError {
  if (e instanceof PineSyntaxError) return { line: e.line, col: e.col, message: e.message, phase: "parse" };
  const msg = e instanceof Error ? e.message : String(e);
  return { line: 0, col: 0, message: msg, phase };
}
