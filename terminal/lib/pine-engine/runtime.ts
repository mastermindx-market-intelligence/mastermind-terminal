// Pine v6 interpreter — executes the parsed AST bar-by-bar over an OHLC series, the way Pine
// actually runs. Series live as per-bar arrays; `var` persists across bars; `expr[n]` reads
// history; `ta.*` calls keep per-call-site state. User functions bind their params as ALIASES
// to the caller's series (so `_src[1]` inside a function reads the real history of the argument).
//
// Deliberately tolerant: any unimplemented namespace call (table.*, label.*, fill, bgcolor, …)
// is a no-op returning `na` rather than throwing, so a large real-world script still runs and
// plots whatever it can. See index.ts for the public surface and what's deferred (tables).
//
// request.security: a coarser timeframe is RESAMPLED for real — the chart bars are grouped up to
// the requested timeframe, the whole script is re-run on those higher-timeframe bars, and the
// requested expression reads that higher-timeframe series. The expression keeps its own `[n]` indexing
// off the *published* HTF bar. Daily→1W historical (barstate.isrealtime=false) default lookahead_off
// releases the current HTF value at the last actual session of a *closed* ISO-week group (ChartPanel
// resampleTf keys each W group by that last session; there is no universal Friday rule) and otherwise
// carries the previous confirmed value (gaps_off); gaps_on returns na except at that confirmation.
// lookahead_on + expr[1] projects the prior confirmed bar at period start. An uncertified final tail
// (no successor bar in a later ISO week; RunOpts has no period-closed/calendar witness) is not
// confirmed merely because it is Friday, a weekday, or the last array item. See callNs() below.
//
// request.security refusal boundary (A01 r2/r3/r4/r9 — unsupported symbol / finer TF / empty-string symbol
// / requested-context timeframe metadata):
// symbol and timeframe args are read BEFORE the expression is evaluated. Only the canonical exact
// chart symbol (syminfo.tickerid / syminfo.ticker / an explicit identical string) OR an empty-string
// symbol argument (Pine same-chart convention: "" means current context) may evaluate on chart bars —
// a different, missing, or ambiguous symbol returns na with a deduplicated unsupported-symbol warning
// (no cross-symbol data plane, no alias guessing). Unsupported/unresolved symbol-producing members
// and functions (unknown syminfo.*, unimplemented str.*) return na, never an empty-string stub that
// would be accepted as current-context. A timeframe FINER than the *effective current context*
// (chart TF outside a request; the requested TF inside an inline HTF expression or whole-script HTF
// pass) cannot be rebuilt: it returns na with a deduplicated unsupported-finer-TF warning — never
// chart-TF / same-context substituted values. Nested coarser requests from an HTF context are
// likewise na + diagnostic (admitted depth is a single hop; no extra producer). Empty timeframe
// preserves the Pine same-chart convention (named assumption: "" ≡ effective current context;
// on the chart pass that is the chart TF). Unknown/unparseable/zero-second timeframes refuse.
// Valid same/coarser arithmetic on the chart pass is unchanged. Daily→1W historical lookahead/gaps
// publication is applied in callNs() using closed-group last-actual-session availability (not a
// UTC-Friday constant). Other calendar/session/intraday units keep bucket mapping and do not claim
// those merge flags supported. timeframe.period/multiplier/isdaily/isweekly/ismonthly/isintraday
// inside a request expression read the requested TF carried on HtfBinding (not lexical chartTf).
import { Node, Stmt, Arg, parse, type ParseResult } from "./parser";
import { PineSyntaxError } from "./lexer";
import { NA, NS_CONST, toCss, fmtNum, tfSeconds } from "./builtins";

export interface Bar { time: string; o: number; h: number; l: number; c: number; v: number; }

// Thrown when a script blows the global run budget (wall-clock or total loop iterations).
// runPine() in index.ts catches it like any runtime error → errors[], so a runaway script
// surfaces as a visible script error instead of freezing the UI thread.
export class PineRuntimeError extends Error {}

// ── global per-run budget — ONE deadline + run-level counters shared by the chart pass and
// every request.security HTF re-run, so nesting/recursion can't multiply past the caps ──
const DEFAULT_BUDGET_MS = 3000;          // wall-clock cap for a whole run() call
const MAX_TOTAL_LOOP_ITERS = 4_000_000;  // for-loop iterations, totalled across loops, nesting AND bars
const STMT_DEADLINE_INTERVAL = 10_000;   // poll Date.now() every N executed statements

export type PlotKind = "line" | "histogram" | "columns" | "area" | "circles" | "cross" | "stepline";
// A plot point is EITHER a valued point ({ time, value, color? }) OR a whitespace/gap point
// ({ time } with no `value`) emitted for na/non-finite bars on line-family series so
// Lightweight-Charts BREAKS the line at the gap instead of drawing a segment across it.
export interface PinePlotPoint { time: string; value?: number; color?: string }
export interface PinePlot { id: number; title: string; kind: PlotKind; overlay: boolean; linewidth: number; color: string; data: PinePlotPoint[]; }
export interface PineShape { time: string; position: "aboveBar" | "belowBar" | "inBar"; shape: "arrowUp" | "arrowDown" | "circle" | "square"; color: string; text?: string; overlay: boolean; }
export interface PineHline { price: number; color: string; title: string; style: string; overlay: boolean; }
export interface PineInput { title: string; type: string; value: any; }
export interface PineMeta { title: string; shorttitle?: string; overlay: boolean; }
export interface RunResult { meta: PineMeta; plots: PinePlot[]; shapes: PineShape[]; hlines: PineHline[]; inputs: PineInput[]; warnings: string[]; barCount: number; }

const isNa = (x: any) => x == null || (typeof x === "number" && isNaN(x));
const truthy = (x: any): boolean => { if (isNa(x)) return false; if (typeof x === "boolean") return x; if (typeof x === "number") return x !== 0; if (typeof x === "string") return x.length > 0; return !!x; };
const num = (x: any): number => (typeof x === "number" ? x : typeof x === "boolean" ? (x ? 1 : 0) : NA);

const NOOP_NS = new Set(["table", "array", "matrix", "map", "label", "line", "box", "linefill", "polyline", "strategy", "alert", "log", "chart", "ticker", "runtime", "request", "input_enum"]);
const NAMESPACES = new Set(["ta", "math", "input", "color", "str", "request", "timeframe", "barstate", "syminfo", "plot", "shape", "location", "size", "hline", "line", "barmerge", "display", "format", "position", "xloc", "yloc", "extend", "text", "scale", "math", "dayofweek", "currency", "table", "array", "matrix", "map", "label", "box", "strategy", "alert", "log", "chart", "ticker", "runtime", "session", "adjustment"]);
// The one honest sentence for every deferred builtin (NOOP_NS calls + fill/bgcolor/barcolor/
// alertcondition/alert). `what` is `"<ns>.<fn>"` for a namespace call, `"<fn>"` for a global one.
// Kept module-level so the wording can never drift between the two call paths.
export const unsupportedMsg = (what: string) => `${what}() is not supported yet — its output is suppressed`;
const MARKER_SHAPE: Record<string, PineShape["shape"]> = { triangleup: "arrowUp", arrowup: "arrowUp", labelup: "arrowUp", flag: "arrowUp", triangledown: "arrowDown", arrowdown: "arrowDown", labeldown: "arrowDown", circle: "circle", xcross: "square", cross: "square", square: "square", diamond: "square" };
// Continuous series kinds where a na bar must render as a whitespace GAP (LWC breaks the line),
// vs discrete kinds (histogram/columns/cross) where a na bar is correctly just absent.
const GAP_KINDS = new Set<PlotKind>(["line", "area", "stepline", "circles"]);

// ── built-in price/time series (module-level so the HTF resampler can read them off any bar array) ──
const BUILTIN_SERIES = new Set(["close", "open", "high", "low", "volume", "hl2", "hlc3", "ohlc4", "hlcc4", "bar_index", "last_bar_index", "time", "time_close"]);
function builtinSeriesAt(name: string, B: Bar[], NB: number, j: number): any {
  if (j < 0 || j >= NB) return NA;
  const b = B[j];
  switch (name) {
    case "close": return b.c; case "open": return b.o; case "high": return b.h; case "low": return b.l; case "volume": return b.v;
    case "hl2": return (b.h + b.l) / 2; case "hlc3": return (b.h + b.l + b.c) / 3; case "ohlc4": return (b.o + b.h + b.l + b.c) / 4;
    case "hlcc4": return (b.h + b.l + b.c + b.c) / 4; case "bar_index": return j; case "last_bar_index": return NB - 1;
    case "time": case "time_close": return Date.parse(b.time + "T00:00:00Z");
    default: return undefined;
  }
}

// ── higher-timeframe resampling ──────────────────────────────────────────────────────────────
// Group already-resampled chart bars UP to a coarser timeframe (we only ever have chart-TF bars,
// so a finer TF can't be reconstructed — callNs() refuses finer-than-chart requests with na +
// an unsupported-finer-timeframe warning rather than silently substituting chart-TF values).
// Returns the HTF bars plus, for each chart bar, the index of the HTF bar it belongs to (groupOf[i]).
function htfBucketKey(time: string, n: number, unit: string): string {
  if (unit === "W") { const dt = new Date(time + "T00:00:00Z"); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day); return "W" + dt.toISOString().slice(0, 10); }   // ISO week (Mon-anchored) — matches ChartPanel.resampleTf
  if (unit === "M") { const y = parseInt(time.slice(0, 4), 10), mo = parseInt(time.slice(5, 7), 10); return "M" + Math.floor((y * 12 + (mo - 1)) / n); }  // 1M→month, 3M→quarter, 12M→year
  if (unit === "D") { const days = Math.floor(Date.parse(time + "T00:00:00Z") / 86400000); return "D" + Math.floor(days / n); }                          // N-day grid aligned to the epoch
  const secs = tfSeconds(`${n}${unit}`) || 86400; return "S" + Math.floor(Date.parse(time + "T00:00:00Z") / 1000 / secs);                                // intraday fallback (unused on daily data)
}
// Daily→1W confirmation is the last actual session of a historically closed ISO-week group
// (a later chart bar belongs to a later ISO week), matching ChartPanel.resampleTf (Mon-anchored
// ISO key; group timestamp = last session). No UTC-Friday constant, no market inferred from
// symbol/weekdays-only/wallclock/array-end. The final ISO-week group stays uncertified:
// RunOpts has no period-closed/calendar witness, so array end is not HTF period close.
function isOneWeekTf(tf: string): boolean {
  const m = tf.trim().toUpperCase().match(/^(\d*)W$/);
  if (!m) return false;
  const n = m[1] === "" ? 1 : parseInt(m[1], 10);
  return n === 1;
}
function resampleBars(src: Bar[], tf: string): { bars: Bar[]; groupOf: number[]; confirmChartIdx: number[] } {
  const m = tf.trim().toUpperCase().match(/^(\d*)([A-Z]*)$/);
  const n = m && m[1] ? parseInt(m[1], 10) : 1;
  const unit = m ? m[2] : "D";
  const weeklyClose = unit === "W" && n === 1;
  const out: Bar[] = []; const groupOf = new Array<number>(src.length).fill(-1);
  const confirmChartIdx: number[] = [];
  let cur: Bar | null = null; let key: string | null = null; let gi = -1;
  let groupLast = -1;
  for (let i = 0; i < src.length; i++) {
    const r = src[i]; const k = htfBucketKey(r.time, n, unit);
    if (k !== key) {
      if (cur) {
        out.push(cur);
        // Successor ISO-week bar exists → previous group's membership is complete in this series.
        if (weeklyClose) confirmChartIdx[gi] = groupLast;
      }
      key = k; gi++; cur = { ...r };
      groupLast = i;
      confirmChartIdx[gi] = -1; // uncertified until a later group appears
    } else {
      cur!.h = Math.max(cur!.h, r.h); cur!.l = Math.min(cur!.l, r.l); cur!.c = r.c; cur!.time = r.time; cur!.v += r.v;
      groupLast = i;
    }
    groupOf[i] = gi;
  }
  if (cur) out.push(cur);
  // Final group remains confirmChartIdx=-1 (array end ≠ period close).
  return { bars: out, groupOf, confirmChartIdx };
}

// seconds-per-bar for a Pine timeframe string — STRICT parse for the request.security refusal
// boundary. Returns null for empty input and for anything unknown/unparseable/zero-second
// (unlike builtins.tfSeconds, which falls back to 86400 for unknown units — that fallback must
// not be mistaken for a valid finer/same TF when deciding whether to refuse).
function parseTfSecStrict(tf: string): number | null {
  const s = String(tf).trim().toUpperCase();
  if (s === "") return null;
  const m = s.match(/^(\d*)([A-Z]*)$/);
  if (!m) return null;
  const n = m[1] === "" ? 1 : parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;   // "0D"/"0"/… — never zero-second valid
  const unit = m[2];
  if (unit === "" || unit === "MIN") return n * 60;
  if (unit === "S") return n;
  if (unit === "H") return n * 3600;
  if (unit === "D") return n * 86400;
  if (unit === "W") return n * 604800;
  if (unit === "M") return n * 2592000;             // calendar month ≈ 30d, same as tfSeconds
  return null;                                      // unknown unit (e.g. "FOO", "1X") → refuse
}
function isDailyTf(tf: string): boolean {
  return parseTfSecStrict(tf) === 86400;
}

interface Frame { path: string; params: Map<string, ParamBinding>; localNames: Set<string>; }
// a param binds to either an alias of the caller's series (bare-id arg) or a per-call history
// buffer (expression arg, so `_src[1]` still reads real history)
interface ParamBinding { alias?: { name: string; frame: Frame | null }; buf?: string; }
// When `htf` is set, series reads come from a higher-timeframe execution instead of this run's
// stores, indexed by the HTF bar (so the same AST expression resolves on the resampled timeline).
// `timeframe` is the requested TF for this binding — evalMember/callNs use it as the effective
// current context so inline expressions agree with the whole-script HTF pass (no extra data plane).
interface HtfBinding { globals: Map<string, any[]>; localStore: Map<string, any[]>; bars: Bar[]; N: number; barIdx: number; timeframe: string; }
interface Ctx { i: number; frame: Frame | null; scalars: Map<string, number> | null; depth: number; htf?: HtfBinding | null; }
// what an exec() pass exposes to a parent run so request.security can read its resampled series
interface ExecOut { result: RunResult; globals: Map<string, any[]>; localStore: Map<string, any[]>; }

// run() executes an already-parsed program. Pass a `ParseResult` (from parse()/compile()) to skip
// re-parsing — the ONLY caller that still hands a raw string is the back-compat runPine() in index.ts,
// which parses once and forwards the AST here, so a single run never lexes+parses twice.
export function run(source: string | ParseResult, bars: Bar[], opts: { timeframe?: string; symbol?: string; params?: Record<string, any>; budgetMs?: number } = {}): RunResult {
  // capture the deadline the moment the run starts — checked between statements and inside loops
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  let totalStmts = 0;      // every executed statement, across ALL exec() passes (chart + HTF)
  let totalLoopIters = 0;  // every for-loop iteration, across ALL loops/nesting/bars
  const checkDeadline = () => { if (Date.now() > deadline) throw new PineRuntimeError(`script exceeded ${budgetMs} ms`); };

  const { body } = typeof source === "string" ? parse(source) : source;

  // ── hoist user function definitions (shared across the chart run and every HTF re-run) ──
  const funcs = new Map<string, { params: string[]; body: Stmt[]; localNames: Set<string> }>();
  const collectLocals = (stmts: Stmt[], acc: Set<string>) => {
    for (const s of stmts) {
      if (s.t === "assign" && s.op === "=") { if (typeof s.target === "string") acc.add(s.target); else s.target.forEach((n) => acc.add(n)); }
      else if (s.t === "seq") collectLocals(s.items, acc);
      else if (s.t === "expr") collectLocalsNode(s.e, acc);
    }
  };
  const collectLocalsNode = (n: Node, acc: Set<string>) => {
    // NB: a for-iterator is a loop-body-scoped scalar (handled via ctx.scalars), NOT a local series — don't hoist it
    if (n.t === "for") { collectLocals(n.body, acc); }
    else if (n.t === "if") { collectLocals(n.then, acc); n.elifs.forEach((e) => collectLocals(e.body, acc)); if (n.els) collectLocals(n.els, acc); }
  };
  for (const s of body) if (s.t === "func") { const ln = new Set<string>(); collectLocals(s.body, ln); funcs.set(s.name, { params: s.params, body: s.body, localNames: ln }); }

  // run the chart timeframe; HTF re-runs are spawned lazily from inside exec()
  return exec(bars, opts.timeframe || "1D", opts.symbol || "SYM", opts.params || {}, 0).result;

  // One full bar-by-bar execution over `bars` at `chartTf`. htfDepth>0 marks a re-run spawned by a
  // request.security() call (such runs don't resample again — a single HTF hop is enough and avoids
  // recursion; nested coarser from that pass is na + diagnostic). Returns the result plus the raw
  // series stores so the parent can read resampled values.
  function exec(bars: Bar[], chartTf: string, symbol: string, params: Record<string, any>, htfDepth: number): ExecOut {
    const N = bars.length;

    const globals = new Map<string, any[]>();
    const globalVars = new Set<string>();
    const varInited = new Set<string>();          // var decls that have run their one-time init
    const localStore = new Map<string, any[]>();  // function locals/vars, keyed `path|name`
    const localVarInit = new Set<string>();
    const localVarKeys = new Set<string>();        // storage keys of function-local `var`s — carried forward each bar
    const taState = new Map<string, any>();        // per-call-site state for ta.* and friends
    const histStore = new Map<number, any[]>();    // recorded history for non-identifier index bases
    type HtfBuilt = { globals: Map<string, any[]>; localStore: Map<string, any[]>; bars: Bar[]; groupOf: number[]; confirmChartIdx: number[]; timeframe: string };
    const htfCache = new Map<string, HtfBuilt | null>();  // one resampled re-run per coarser timeframe (shared budget)
    // Effective TF of the current evaluation context: requested TF inside an HTF binding,
    // otherwise this exec() pass's chartTf. Nested request.security compares against this,
    // not lexical chartTf, so an inline weekly expression does not fall through to daily.
    const contextTf = (ctx: Ctx): string => (ctx.htf && ctx.htf.timeframe ? ctx.htf.timeframe : chartTf);
    const ctxBaseI = (ctx: Ctx): number => (ctx.htf ? ctx.htf.barIdx : ctx.i);
    const ctxLS = (ctx: Ctx) => (ctx.htf ? ctx.htf.localStore : localStore);

    const meta: PineMeta = { title: "Script", overlay: false };
    const plotAcc = new Map<number, PinePlot & { lastColor: string }>();
    const hlineAcc = new Map<number, PineHline>();
    const shapes: PineShape[] = [];
    const inputs: PineInput[] = [];
    let collectInputs = true;   // inputs are constant across bars — record them only on bar 0
    const warnings: string[] = [];
    const warned = new Set<string>();
    const warn = (m: string) => { if (!warned.has(m)) { warned.add(m); warnings.push(m); } };
    const MAX_SHAPES = 3000;

    // ── builtin scalar series ──
    const builtinSeries = (name: string, j: number): any => builtinSeriesAt(name, bars, N, j);
    const isBuiltinSeries = (name: string) => BUILTIN_SERIES.has(name);

    // ── name resolution ──
    function resolveGet(ctx: Ctx, name: string, offset: number): any {
      const htf = ctx.htf || null;
      const baseI = htf ? htf.barIdx : ctx.i;       // HTF reads index the resampled timeline instead
      const G = htf ? htf.globals : globals;
      const LS = htf ? htf.localStore : localStore;
      if (ctx.scalars && ctx.scalars.has(name)) return offset > 0 ? NA : ctx.scalars.get(name); // loop var
      if (ctx.frame) {
        const pb = ctx.frame.params.get(name);
        if (pb) {
          if (pb.alias) { const sub: Ctx = { i: ctx.i, frame: pb.alias.frame, scalars: null, depth: ctx.depth, htf }; return resolveGet(sub, pb.alias.name, offset); }
          const arr = LS.get(pb.buf!); const idx = baseI - offset; return arr && idx >= 0 && arr[idx] !== undefined ? arr[idx] : NA;
        }
        if (ctx.frame.localNames.has(name)) { const arr = LS.get(ctx.frame.path + "|" + name); if (arr) { const idx = baseI - offset; return idx >= 0 ? (arr[idx] !== undefined ? arr[idx] : NA) : NA; } return NA; }
      }
      const g = G.get(name);
      if (g) { const idx = baseI - offset; return idx >= 0 ? (g[idx] !== undefined ? g[idx] : NA) : NA; }
      if (BUILTIN_SERIES.has(name)) return htf ? builtinSeriesAt(name, htf.bars, htf.N, baseI - offset) : builtinSeries(name, ctx.i - offset);
      if (NAMESPACES.has(name)) return name;   // bare namespace ref (member access reads it)
      warn(`undefined variable '${name}' (treated as na)`);
      return NA;
    }

    function assignName(ctx: Ctx, name: string, value: any, isVar: boolean, declare: boolean) {
      if (ctx.frame && (declare ? true : ctx.frame.localNames.has(name) || ctx.frame.params.has(name))) {
        const key = ctx.frame.path + "|" + name;
        const LS = ctxLS(ctx);
        let arr = LS.get(key); if (!arr) { arr = []; LS.set(key, arr); }
        ctx.frame.localNames.add(name); arr[ctxBaseI(ctx)] = value; return;
      }
      let arr = globals.get(name); if (!arr) { arr = []; globals.set(name, arr); }
      if (isVar) globalVars.add(name);
      arr[ctx.i] = value;
    }

    // ── expression evaluation ──
    function evalNode(n: Node, ctx: Ctx): any {
      switch (n.t) {
        case "num": return n.v;
        case "str": return n.v;
        case "color": return n.v;
        case "bool": return n.v;
        case "na": return NA;
        case "id": return resolveGet(ctx, n.name, 0);
        case "member": return evalMember(n, ctx);
        case "index": {
          const off = Math.round(num(evalNode(n.idx, ctx)));
          if (n.base.t === "id") return resolveGet(ctx, n.base.name, off);
          const hid = (n.base as any).hid;
          const val = evalNode(n.base, ctx);
          if (hid != null) { let h = histStore.get(hid); if (!h) { h = []; histStore.set(hid, h); } const at = ctxBaseI(ctx); h[at] = val; const idx = at - off; return idx >= 0 && h[idx] !== undefined ? h[idx] : NA; }
          return off === 0 ? val : NA;
        }
        case "unary": {
          if (n.op === "not") return !truthy(evalNode(n.e, ctx));
          const v = num(evalNode(n.e, ctx)); return n.op === "-" ? -v : v;
        }
        case "binary": return evalBinary(n, ctx);
        // evaluate BOTH arms so any stateful builtin (ta.*) inside an arm advances every bar like Pine,
        // then return the selected one
        case "ternary": { const c = truthy(evalNode(n.c, ctx)); const a = evalNode(n.a, ctx); const b = evalNode(n.b, ctx); return c ? a : b; }
        case "tuple": return n.items.map((it) => evalNode(it, ctx));
        case "call": return evalCall(n, ctx);
        case "if": return evalIf(n, ctx);
        case "for": return evalFor(n, ctx);
      }
    }

    function evalBinary(n: Extract<Node, { t: "binary" }>, ctx: Ctx): any {
      const op = n.op;
      // Pine `and`/`or` evaluate BOTH operands (no short-circuit) so stateful builtins in the rhs
      // still advance every bar; truthy() handles na as false.
      if (op === "and") { const l = truthy(evalNode(n.l, ctx)); const r = truthy(evalNode(n.r, ctx)); return l && r; }
      if (op === "or") { const l = truthy(evalNode(n.l, ctx)); const r = truthy(evalNode(n.r, ctx)); return l || r; }
      const a = evalNode(n.l, ctx), b = evalNode(n.r, ctx);
      if (op === "+") { if (typeof a === "string" || typeof b === "string") return (isNa(a) ? "na" : String(a)) + (isNa(b) ? "na" : String(b)); }
      switch (op) {   // Pine: a comparison with an na operand is na (not false); truthy(na)=false keeps boolean logic intact
        case "==": return isNa(a) || isNa(b) ? NA : a === b;
        case "!=": return isNa(a) || isNa(b) ? NA : a !== b;
        case "<": return isNa(a) || isNa(b) ? NA : num(a) < num(b);
        case "<=": return isNa(a) || isNa(b) ? NA : num(a) <= num(b);
        case ">": return isNa(a) || isNa(b) ? NA : num(a) > num(b);
        case ">=": return isNa(a) || isNa(b) ? NA : num(a) >= num(b);
      }
      const x = num(a), y = num(b);
      if (isNaN(x) || isNaN(y)) return NA;
      switch (op) { case "+": return x + y; case "-": return x - y; case "*": return x * y; case "/": return y === 0 ? NA : x / y; case "%": return y === 0 ? NA : x % y; }
      return NA;
    }

    function evalMember(n: Extract<Node, { t: "member" }>, ctx: Ctx): any {
      if (n.obj.t === "id") {
        const ns = n.obj.name, prop = n.prop;
        if (ns === "timeframe") { const tf = contextTf(ctx); if (prop === "period") return tf; if (prop === "multiplier") return parseInt(tf) || 1; if (prop === "isdaily") return /D$/.test(tf); if (prop === "isweekly") return /W$/.test(tf); if (prop === "ismonthly") return /M$/.test(tf); if (prop === "isintraday") return tfSeconds(tf) < 86400; return NA; }
        if (ns === "barstate") { if (prop === "islast" || prop === "islastconfirmedhistory") return ctx.i === N - 1; if (prop === "isfirst") return ctx.i === 0; if (prop === "ishistory") return ctx.i < N - 1; if (prop === "isrealtime") return false; if (prop === "isnew" || prop === "isconfirmed") return true; return false; }
        // Unknown members return na (not ""). An empty-string stub here would be accepted by
        // request.security as current-context and silently substitute chart bars.
        if (ns === "syminfo") { if (prop === "tickerid" || prop === "ticker") return symbol; if (prop === "mintick") return 0.01; if (prop === "pointvalue") return 1; if (prop === "type") return "stock"; if (prop === "currency") return "USD"; return NA; }
        if (ns === "bar_index") return ctx.i;
        if (ns === "ta" && prop === "tr") { const b = bars[ctx.i]; const pc = ctx.i > 0 ? bars[ctx.i - 1].c : NaN; return isNaN(pc) ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)); }
        const tbl = NS_CONST[ns]; if (tbl && prop in tbl) return tbl[prop];
        return NA;
      }
      return NA; // nested member as a value isn't modeled
    }

    // ── calls ──
    function evalArgs(args: Arg[], ctx: Ctx) {
      const pos: any[] = []; const named: Record<string, any> = {};
      for (const a of args) { const v = evalNode(a.value, ctx); if (a.name) named[a.name] = v; else pos.push(v); }
      return { pos, named };
    }
    const pick = (pos: any[], named: Record<string, any>, idx: number, name: string) => (named[name] !== undefined ? named[name] : pos[idx]);

    function evalCall(n: Extract<Node, { t: "call" }>, ctx: Ctx): any {
      const callee = n.callee;
      if (callee.t === "member" && callee.obj.t === "id") return callNs(callee.obj.name, callee.prop, n, ctx);
      if (callee.t === "id") { if (funcs.has(callee.name)) return callUser(callee.name, n, ctx); return callGlobal(callee.name, n, ctx); }
      if (callee.t === "na") { const { pos } = evalArgs(n.args, ctx); return isNa(pos[0]); }   // `na(x)` — `na` lexes to its own node
      warn("unsupported call form"); return NA;
    }

    function callUser(name: string, n: Extract<Node, { t: "call" }>, ctx: Ctx): any {
      if (ctx.depth > 60) { warn("call depth exceeded"); return NA; }
      const fn = funcs.get(name)!;
      const childPath = ctx.frame ? ctx.frame.path + "/" + n.id : "/" + n.id;
      const frame: Frame = { path: childPath, params: new Map(), localNames: new Set(fn.localNames), };
      const LS = ctxLS(ctx);
      const at = ctxBaseI(ctx);
      fn.params.forEach((pn, idx) => {
        const argNode = n.args[idx]?.value;
        if (argNode && argNode.t === "id") frame.params.set(pn, { alias: { name: argNode.name, frame: ctx.frame } });
        else {
          // expression arg: append its value to a per-call-site history buffer so `_src[1]`/`_src[i]` work
          const bk = childPath + "|@arg|" + pn; let buf = LS.get(bk); if (!buf) { buf = []; LS.set(bk, buf); }
          buf[at] = argNode ? evalNode(argNode, ctx) : NA; frame.params.set(pn, { buf: bk });
        }
      });
      const sub: Ctx = { i: ctx.i, frame, scalars: null, depth: ctx.depth + 1, htf: ctx.htf };
      return execBlock(fn.body, sub);
    }

    // resample-and-rerun for one coarser timeframe (cached); null if it can't be built
    function getHtfCtx(tf: string) {
      const key = tf.trim().toUpperCase();
      if (htfCache.has(key)) return htfCache.get(key)!;
      let built: HtfBuilt | null = null;
      try {
        const { bars: htfBars, groupOf, confirmChartIdx } = resampleBars(bars, tf);
        if (htfBars.length >= 1) {
          const child = exec(htfBars, tf, symbol, params, htfDepth + 1);
          child.result.warnings.forEach(warn);   // HTF-pass warnings must reach the parent run's result
          built = { globals: child.globals, localStore: child.localStore, bars: htfBars, groupOf, confirmChartIdx, timeframe: tf };
        }
      } catch (e) { if (e instanceof PineRuntimeError) throw e; built = null; }   // budget aborts must not degrade into a silent fallback
      htfCache.set(key, built);
      return built;
    }

    function callNs(ns: string, method: string, n: Extract<Node, { t: "call" }>, ctx: Ctx): any {
      if (ns === "request" && method === "security") {
        // args: (symbol, timeframe, expression, gaps, lookahead, …) positionally or named
        let tfArg: Arg | undefined, exprArg: Arg | undefined, symArg: Arg | undefined, gapsArg: Arg | undefined, lookaheadArg: Arg | undefined;
        const posA: Arg[] = [];
        for (const a of n.args) {
          if (a.name === "symbol") symArg = a;
          else if (a.name === "timeframe") tfArg = a;
          else if (a.name === "expression") exprArg = a;
          else if (a.name === "gaps") gapsArg = a;
          else if (a.name === "lookahead") lookaheadArg = a;
          else if (!a.name) posA.push(a);
        }
        // Named args override positional (same rule as pick() elsewhere in this engine).
        tfArg = tfArg || posA[1]; exprArg = exprArg || posA[2]; symArg = symArg || posA[0];
        gapsArg = gapsArg || posA[3]; lookaheadArg = lookaheadArg || posA[4];
        const exprNode = exprArg ? exprArg.value : null;
        if (!exprNode) return NA;

        // ── A01 r2/r3 refusal boundary: READ symbol + timeframe BEFORE evaluating the expression ──
        // 1) Symbol — only the canonical exact chart symbol, OR an empty-string symbol argument
        //    (Pine same-chart convention: "" means current context), may evaluate on chart bars.
        if (!symArg) {
          warn(`request.security() unsupported symbol (missing) — returning na`);
          return NA;
        }
        const symVal = evalNode(symArg.value, ctx);
        // Pine: an empty-string symbol argument means the current chart's symbol (same context).
        // This is the actual evaluated empty string from a present argument (explicit "" or a
        // variable whose value is ""), distinct from a missing argument (still refused above),
        // a non-empty different symbol (refused below), and unresolved members/functions that
        // now return na rather than stubbing "". Named assumption, not a data-plane fetch.
        const emptySym = typeof symVal === "string" && symVal.length === 0;
        const sameSymbol = emptySym || (typeof symVal === "string" && symVal === symbol);
        if (!sameSymbol) {
          // Different, missing, or ambiguous/unresolvable symbol: chart bars cannot stand in for
          // another instrument. No alias guessing, no exchange-prefix stripping, no fetch.
          warn(typeof symVal === "string" && symVal.length > 0
            ? `request.security() unsupported symbol '${symVal}' (chart symbol '${symbol}') — returning na`
            : `request.security() unsupported symbol (unresolved/ambiguous) — returning na`);
          return NA;
        }

        // 2) Timeframe — read the arg node before any expression evaluation.
        // Effective current context is the requested TF when evaluating inside an HTF binding
        // (inline expression) and this exec() pass's chartTf otherwise (chart pass / whole-script
        // HTF re-run). Nested TF checks compare against that, never lexical chart daily while
        // the expression is bound to weekly bars.
        const evalTf = contextTf(ctx);
        let tf: string;
        if (!tfArg) tf = evalTf;                       // missing timeframe arg → current context
        else {
          const raw = evalNode(tfArg.value, ctx);
          tf = raw == null ? "" : String(raw);
        }
        // Named assumption: empty timeframe preserves the Pine same-chart convention
        // ("" ≡ effective current context; on the chart pass that is the chart TF).
        // The engine only ever receives chart-TF bars, so "" cannot mean finer-than-chart here.
        if (tf.trim() === "") tf = evalTf;
        const reqSec = parseTfSecStrict(tf);
        if (reqSec == null) {
          // Unknown/unparseable/zero-second — refuse; do NOT treat as a valid TF (builtins.tfSeconds
          // falls back to 86400 for junk units, which would silently compare as same/finer).
          warn(`request.security() unsupported timeframe '${tf}' (unknown/unparseable) — returning na`);
          return NA;
        }
        const contextSec = parseTfSecStrict(evalTf) ?? (tfSeconds(evalTf) || 86400);

        // 3) Finer-than-current-context cannot be reconstructed from the supplied bars — refuse
        // with na + an explicit unsupported-finer-TF warning. Never chart-TF / same-context
        // substituted values (including an inline weekly expression whose lexical chartTf is D).
        if (reqSec < contextSec) {
          warn(`request.security() unsupported timeframe '${tf}' finer than chart '${evalTf}' — returning na`);
          return NA;
        }

        // Same as the effective current context: in-place arithmetic (chart same-TF, whole-script
        // HTF pass at the requested TF, nested same-TF inside an HTF expression). The expression's
        // own `[1]` still yields the prior-bar (non-repaint) value. Binding is preserved.
        if (reqSec <= contextSec) return evalNode(exprNode, ctx);

        // Coarser than current context. Admitted depth is a single HTF hop from the chart pass.
        // Nested coarser (inline HTF expression or whole-script HTF re-run) has no second producer
        // and must not silently substitute the current-context series.
        if (htfDepth > 0 || ctx.htf) {
          warn(`request.security() unsupported timeframe '${tf}' coarser than current context '${evalTf}' — returning na`);
          return NA;
        }

        const htfc = getHtfCtx(tf);
        if (!htfc) return evalNode(exprNode, ctx);

        // Merge flags: omitted → Pine defaults (gaps_off, lookahead_off). Unknown values refuse.
        // Daily→1W is the supported historical publication vertical (closed ISO-week last session);
        // other units keep bucket mapping.
        const readMerge = (arg: Arg | undefined, label: string): "on" | "off" | null => {
          if (!arg) return "off";
          const v = evalNode(arg.value, ctx);
          if (v === "on" || v === "off") return v;
          warn(`request.security() unsupported ${label} value — returning na`);
          return null;
        };
        const gaps = readMerge(gapsArg, "gaps");
        const lookahead = readMerge(lookaheadArg, "lookahead");
        if (gaps == null || lookahead == null) return NA;
        const gapsOn = gaps === "on";
        const lookaheadOn = lookahead === "on";
        const weeklyMerge = isOneWeekTf(tf) && isDailyTf(chartTf);
        const explicitMerge = !!(gapsArg || lookaheadArg);
        const g = htfc.groupOf[ctx.i];
        if (g == null || g < 0) return NA;

        let barIdx = g;
        if (!weeklyMerge) {
          if (explicitMerge) {
            warn(`request.security() lookahead/gaps merge flags are not implemented for timeframe '${tf}' (daily→1W historical only) — using HTF bucket mapping; flags are not claimed supported`);
          }
        } else {
          const conf = htfc.confirmChartIdx[g] ?? -1;
          if (!lookaheadOn && conf < 0) {
            warn(`request.security() weekly 1W period not confirmed: ISO-week final tail has no successor session in a later ISO week (array end is not HTF period close; missing calendar/session evidence) — previous confirmed or na`);
          }
          if (gapsOn) {
            if (lookaheadOn) {
              const isStart = ctx.i === 0 || htfc.groupOf[ctx.i - 1] !== g;
              if (!isStart) return NA;
            } else if (ctx.i !== conf || conf < 0) {
              return NA;
            }
          }
          barIdx = lookaheadOn ? g : (conf >= 0 && ctx.i >= conf ? g : g - 1);
          if (barIdx < 0) return NA;
        }

        // Evaluate the SAME expression on the resampled timeline at the published HTF bar.
        // `[n]` is an HTF-series offset from that published bar (expression history preserved).
        const sub: Ctx = { i: ctx.i, frame: ctx.frame, scalars: ctx.scalars, depth: ctx.depth, htf: { globals: htfc.globals, localStore: htfc.localStore, bars: htfc.bars, N: htfc.bars.length, barIdx, timeframe: htfc.timeframe } };
        return evalNode(exprNode, sub);
      }
      const { pos, named } = evalArgs(n.args, ctx);
      switch (ns) {
        case "ta": return taDispatch(method, pos, n, ctx);
        case "math": return mathDispatch(method, pos);
        case "color":
          if (method === "new") return toCss(pos[0], num(pos[1]));
          if (method === "rgb") return `rgba(${num(pos[0]) | 0}, ${num(pos[1]) | 0}, ${num(pos[2]) | 0}, ${pos[3] != null ? (100 - num(pos[3])) / 100 : 1})`;
          if (method === "from_gradient") return toCss(pos[3] ?? pos[4]);
          warn(`unsupported color.${method}() (na)`); return NA;
        case "str":
          if (method === "tostring") return fmtNum(num(pos[0]), pos[1]);
          if (method === "format") { let s = String(pos[0] ?? ""); for (let k = 1; k < pos.length; k++) s = s.replace(`{${k - 1}}`, isNa(pos[k]) ? "na" : String(pos[k])); return s; }
          if (method === "length") return String(pos[0] ?? "").length;
          if (method === "tonumber") return parseFloat(pos[0]);
          if (method === "contains") return String(pos[0]).includes(String(pos[1]));
          if (method === "upper") return String(pos[0]).toUpperCase();
          if (method === "lower") return String(pos[0]).toLowerCase();
          // na, not "": an empty-string stub would be accepted by request.security as current-context.
          warn(`unsupported str.${method}() (na)`); return NA;
        case "input": return inputDispatch(method, pos, named);
        case "timeframe":
          if (method === "in_seconds") return tfSeconds(pos[0] != null ? String(pos[0]) : contextTf(ctx));
          if (method === "change") return false;
          warn(`unsupported timeframe.${method}() (na)`); return NA;
        case "plot": return NA;
        default:
          // A CALL into a deferred namespace (table./label./line./box./array./strategy. orders …)
          // draws/returns nothing. Say so — a silent na here is what made a pasted SMC script report
          // "✓ Compiled successfully" and then render an empty chart. Deduped per `ns.method` by warn(),
          // so a per-bar call warns once; a bare member READ (label.style_none) stays silent by design.
          if (NOOP_NS.has(ns)) { warn(unsupportedMsg(`${ns}.${method}`)); return NA; }
          warn(`unsupported ${ns}.${method}() (na)`); return NA;
      }
    }

    function inputDispatch(method: string, pos: any[], named: Record<string, any>): any {
      const def = pos[0];
      const title = named.title !== undefined ? named.title : (typeof pos[1] === "string" ? pos[1] : method);
      if (collectInputs) inputs.push({ title: String(title), type: method, value: def }); // dedupe: first bar only
      return def;
    }

    function callGlobal(name: string, n: Extract<Node, { t: "call" }>, ctx: Ctx): any {
      if (name === "indicator" || name === "strategy") { const { pos, named } = evalArgs(n.args, ctx); meta.title = String(pick(pos, named, 0, "title") ?? meta.title); if (named.shorttitle) meta.shorttitle = String(named.shorttitle); const ov = pick(pos, named, -1, "overlay"); meta.overlay = ov !== undefined ? truthy(ov) : name === "strategy"; return NA; }
      if (name === "plot") return doPlot(n, ctx);
      if (name === "plotshape" || name === "plotchar" || name === "plotarrow") return doPlotshape(n, ctx, name);
      if (name === "hline") return doHline(n, ctx);
      if (name === "nz") { const { pos } = evalArgs(n.args, ctx); return isNa(pos[0]) ? (pos[1] !== undefined ? pos[1] : 0) : pos[0]; }
      if (name === "na") { const { pos } = evalArgs(n.args, ctx); return isNa(pos[0]); }
      if (name === "fixnan") { const { pos } = evalArgs(n.args, ctx); const key = "#fix" + n.id; const st = taState.get(key) || { last: NA }; if (!isNa(pos[0])) st.last = pos[0]; taState.set(key, st); return st.last; }
      // Deferred global drawing/alert builtins: nothing is emitted, but the args are still
      // EVALUATED (then dropped) so any stateful builtin inside them — ta.*, a nested plot(),
      // `expr[n]` history — advances its per-call-site state on every bar, the same rule the
      // and/or/ternary paths follow (see evalBinary). Skipping them would desync any series that
      // appears only inside these calls' arguments. Warn once per name instead of returning na
      // silently, so the editor can't report a bare "✓ Compiled" over a script that draws nothing.
      if (name === "fill" || name === "bgcolor" || name === "barcolor" || name === "alertcondition" || name === "alert" || name === "bgColor") { evalArgs(n.args, ctx); warn(unsupportedMsg(name)); return NA; }
      if (name === "input") { const { pos, named } = evalArgs(n.args, ctx); return inputDispatch(typeof pos[0] === "boolean" ? "bool" : typeof pos[0] === "string" ? "string" : "float", pos, named); }
      if (name === "timestamp") { evalArgs(n.args, ctx); return NA; }
      if (NOOP_NS.has(name)) { evalArgs(n.args, ctx); warn(unsupportedMsg(name)); return NA; }
      evalArgs(n.args, ctx); warn(`unsupported function '${name}()' (na)`); return NA;
    }

    // ── plot / plotshape / hline collectors ──
    function planeOverlay(force: any): boolean { return truthy(force) || meta.overlay; }
    function doPlot(n: Extract<Node, { t: "call" }>, ctx: Ctx): any {
      const { pos, named } = evalArgs(n.args, ctx);
      let acc = plotAcc.get(n.id);
      if (!acc) {
        // plot(series, title, color, linewidth, style, …) — accept style/linewidth positionally too
        const style = String(named.style ?? pos[4] ?? "line");
        const kind: PlotKind = style === "histogram" ? "histogram" : style === "columns" ? "columns" : style === "area" ? "area" : style === "circles" ? "circles" : style === "cross" ? "cross" : style === "stepline" ? "stepline" : "line";
        acc = { id: n.id, title: String(pick(pos, named, 1, "title") ?? `Plot ${plotAcc.size + 1}`), kind, overlay: planeOverlay(named.force_overlay), linewidth: num(pick(pos, named, 3, "linewidth")) || 1, color: "#787b86", data: [], lastColor: "#787b86" };
        plotAcc.set(n.id, acc);
      }
      const v = num(pos[0]);
      const colArg = named.color !== undefined ? named.color : pick(pos, named, 2, "color");
      const css = colArg !== undefined ? toCss(colArg) : acc.lastColor;
      if (!isNa(v) && isFinite(v)) { acc.data.push({ time: bars[ctx.i].time, value: v, color: css }); acc.lastColor = css; acc.color = css; }
      // na/non-finite on a CONTINUOUS line-family series → emit a whitespace point so LWC breaks the
      // line here instead of connecting across the gap (correct Pine `plot(cond ? x : na)` shape).
      // Histograms/columns/cross want the bar simply absent, so keep omitting those.
      else if (GAP_KINDS.has(acc.kind)) { acc.data.push({ time: bars[ctx.i].time }); }
      return { __plot: n.id };
    }
    function doPlotshape(n: Extract<Node, { t: "call" }>, ctx: Ctx, fn: string): any {
      const { pos, named } = evalArgs(n.args, ctx);
      const cond = pos[0];
      // Pine's plotshape/plotchar/plotarrow first arg is `series bool`. Honor bool/na semantics: a
      // FINITE numeric series (e.g. `plotshape(close, …)`) is a type error in Pine and would otherwise
      // fire a marker on EVERY non-zero bar here → surface a warning and don't trigger. na (NaN) is a
      // legitimate value of a `series bool` (an un-warmed condition) so it must NOT hit this guard.
      if (typeof cond === "number" && !isNa(cond)) { warn(`${fn}() expects a series bool (got a number) — condition ignored`); return NA; }
      if (shapes.length >= MAX_SHAPES) { warn(`${fn}(): more than ${MAX_SHAPES} markers — extra markers were dropped`); return NA; }
      if (!truthy(cond)) return NA;
      const styleRaw = String(named.style ?? (fn === "plotarrow" ? "arrowup" : "circle"));
      const loc = String(named.location ?? "abovebar");
      const position: PineShape["position"] = loc === "belowbar" || loc === "bottom" ? "belowBar" : loc === "absolute" ? "inBar" : "aboveBar";
      shapes.push({ time: bars[ctx.i].time, position, shape: MARKER_SHAPE[styleRaw] || "circle", color: toCss(named.color ?? "#787b86"), text: named.text != null ? String(named.text) : undefined, overlay: planeOverlay(named.force_overlay) });
      return NA;
    }
    function doHline(n: Extract<Node, { t: "call" }>, ctx: Ctx): any {
      const { pos, named } = evalArgs(n.args, ctx);
      const price = num(pos[0]); if (isNa(price)) return NA;
      hlineAcc.set(n.id, { price, color: toCss(named.color ?? "#787b86"), title: String(pick(pos, named, 1, "title") ?? "hline"), style: String(named.linestyle ?? "solid"), overlay: meta.overlay });
      return { __hline: n.id };
    }

    // ── ta.* (stateful, keyed per call-site) ──
    function taState_(n: Node, ctx: Ctx, init: () => any): any { const key = (ctx.frame ? ctx.frame.path : "") + "#" + (n as any).id; let s = taState.get(key); if (s === undefined) { s = init(); taState.set(key, s); } return s; }
    function rollingPush(buf: number[], v: number, len: number) { buf.push(v); if (buf.length > len) buf.shift(); }
    function winMax(buf: number[]): number { let m = -Infinity, any = false; for (const x of buf) if (!isNaN(x)) { m = Math.max(m, x); any = true; } return any ? m : NA; }
    function winMin(buf: number[]): number { let m = Infinity, any = false; for (const x of buf) if (!isNaN(x)) { m = Math.min(m, x); any = true; } return any ? m : NA; }

    function taDispatch(method: string, pos: any[], n: Extract<Node, { t: "call" }>, ctx: Ctx): any {
      const src = num(pos[0]);
      switch (method) {
        case "sma": { const len = Math.round(num(pos[1])); const s = taState_(n, ctx, () => ({ buf: [] as number[], count: 0 })); rollingPush(s.buf, src, len); s.count++; if (s.count < len) return NA; let sum = 0; for (const x of s.buf) { if (isNaN(x)) return NA; sum += x; } return sum / len; }
        case "ema": { const len = Math.round(num(pos[1])); const k = 2 / (len + 1); const s = taState_(n, ctx, () => ({ prev: NA })); if (isNaN(src)) return NA; s.prev = isNaN(s.prev) ? src : k * src + (1 - k) * s.prev; return s.prev; }
        // Wilder RMA: seed with SMA of the first `len` values (na until then), then recursive 1/len smoothing
        case "rma": { const len = Math.round(num(pos[1])); const s = taState_(n, ctx, () => ({ buf: [] as number[], prev: NA, count: 0 })); if (isNaN(src)) return NA; s.count++; if (s.count <= len) { s.buf.push(src); if (s.count === len) { s.prev = (s.buf as number[]).reduce((x: number, y: number) => x + y, 0) / len; return s.prev; } return NA; } s.prev = (src + s.prev * (len - 1)) / len; return s.prev; }
        case "wma": { const len = Math.round(num(pos[1])); const s = taState_(n, ctx, () => ({ buf: [] as number[] })); rollingPush(s.buf, src, len); if (s.buf.length < len) return NA; let wsum = 0, w = 0; for (let i = 0; i < len; i++) { if (isNaN(s.buf[i])) return NA; const wt = i + 1; wsum += s.buf[i] * wt; w += wt; } return wsum / w; }
        case "rsi": { const len = Math.round(num(pos[1])); const s = taState_(n, ctx, () => ({ prev: NA, ag: 0, al: 0, c: 0, seeded: false })); if (isNaN(src)) return NA; if (isNaN(s.prev)) { s.prev = src; return NA; } const ch = src - s.prev; s.prev = src; const up = ch > 0 ? ch : 0, dn = ch < 0 ? -ch : 0; s.c++; if (s.c <= len) { s.ag += up; s.al += dn; if (s.c === len) { s.ag /= len; s.al /= len; s.seeded = true; return s.al === 0 ? 100 : 100 - 100 / (1 + s.ag / s.al); } return NA; } s.ag = (s.ag * (len - 1) + up) / len; s.al = (s.al * (len - 1) + dn) / len; return s.al === 0 ? 100 : 100 - 100 / (1 + s.ag / s.al); }
        case "macd": { const fast = Math.round(num(pos[1])), slow = Math.round(num(pos[2])), sig = Math.round(num(pos[3])); const s = taState_(n, ctx, () => ({ ef: NA, es: NA, esig: NA })); const kf = 2 / (fast + 1), ks = 2 / (slow + 1), kg = 2 / (sig + 1); if (!isNaN(src)) { s.ef = isNaN(s.ef) ? src : kf * src + (1 - kf) * s.ef; s.es = isNaN(s.es) ? src : ks * src + (1 - ks) * s.es; } const macd = s.ef - s.es; if (!isNaN(macd)) s.esig = isNaN(s.esig) ? macd : kg * macd + (1 - kg) * s.esig; return [macd, s.esig, macd - s.esig]; }
        case "stoch": { const hi = num(pos[1]), lo = num(pos[2]), len = Math.round(num(pos[3])); const s = taState_(n, ctx, () => ({ hb: [] as number[], lb: [] as number[] })); rollingPush(s.hb, hi, len); rollingPush(s.lb, lo, len); if (s.hb.length < len) return NA; const hh = winMax(s.hb), ll = winMin(s.lb); const rng = hh - ll; return rng <= 0 ? NA : (100 * (src - ll)) / rng; }
        case "crossover": case "crossunder": case "cross": { const a = src, b = num(pos[1]); const s = taState_(n, ctx, () => ({ pa: NA, pb: NA })); const pa = s.pa, pb = s.pb; s.pa = a; s.pb = b; if (isNaN(a) || isNaN(b) || isNaN(pa) || isNaN(pb)) return false; const over = pa <= pb && a > b, under = pa >= pb && a < b; return method === "crossover" ? over : method === "crossunder" ? under : over || under; }
        case "highest": { const r = highLow(pos, n, ctx); return r.max; }
        case "lowest": { const r = highLow(pos, n, ctx); return r.min; }
        case "highestbars": { const r = highLow(pos, n, ctx); return r.maxBar; }
        case "lowestbars": { const r = highLow(pos, n, ctx); return r.minBar; }
        case "change": case "mom": { const len = pos[1] != null ? Math.round(num(pos[1])) : 1; const s = taState_(n, ctx, () => ({ buf: [] as number[] })); s.buf.push(src); if (s.buf.length > len + 1) s.buf.shift(); if (s.buf.length < len + 1) return NA; const past = s.buf[0]; return isNaN(past) || isNaN(src) ? NA : src - past; }
        case "barssince": { const s = taState_(n, ctx, () => ({ c: NA as number })); if (truthy(pos[0])) s.c = 0; else if (!isNaN(s.c)) s.c++; return s.c; }
        case "sum": { const len = Math.round(num(pos[1])); const s = taState_(n, ctx, () => ({ buf: [] as number[] })); rollingPush(s.buf, src, len); if (s.buf.length < len) return NA; let sum = 0; for (const x of s.buf) { if (isNaN(x)) return NA; sum += x; } return sum; }
        case "stdev": case "dev": { const len = Math.round(num(pos[1])); const s = taState_(n, ctx, () => ({ buf: [] as number[] })); rollingPush(s.buf, src, len); if (s.buf.length < len) return NA; const bf = s.buf as number[]; const m = bf.reduce((x: number, y: number) => x + y, 0) / len; if (method === "dev") return bf.reduce((x: number, y: number) => x + Math.abs(y - m), 0) / len; return Math.sqrt(bf.reduce((x: number, y: number) => x + (y - m) ** 2, 0) / len); }
        // atr = Wilder RMA of true range: seed prev = mean of first `len` TRs (na until then), then 1/len smoothing
        case "tr": case "atr": { const s = taState_(n, ctx, () => ({ pc: NA, prev: NA, c: 0, buf: [] as number[] })); const b = bars[ctx.i]; const tr = isNaN(s.pc) ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - s.pc), Math.abs(b.l - s.pc)); s.pc = b.c; if (method === "tr") return tr; const len = Math.round(num(pos[0])) || 14; s.c++; if (s.c <= len) { s.buf.push(tr); if (s.c === len) { s.prev = (s.buf as number[]).reduce((x: number, y: number) => x + y, 0) / len; return s.prev; } return NA; } s.prev = (tr + s.prev * (len - 1)) / len; return s.prev; }
        case "cci": { const len = Math.round(num(pos[1])); const s = taState_(n, ctx, () => ({ buf: [] as number[] })); rollingPush(s.buf, src, len); if (s.buf.length < len) return NA; const bf = s.buf as number[]; const m = bf.reduce((x: number, y: number) => x + y, 0) / len; const md = bf.reduce((x: number, y: number) => x + Math.abs(y - m), 0) / len; return md === 0 ? 0 : (src - m) / (0.015 * md); }
        case "rising": case "falling": { const len = Math.round(num(pos[1])); const s = taState_(n, ctx, () => ({ buf: [] as number[] })); s.buf.push(src); if (s.buf.length > len + 1) s.buf.shift(); if (s.buf.length < len + 1) return false; for (let i = 1; i < s.buf.length; i++) { if (method === "rising" && !(s.buf[i] > s.buf[i - 1])) return false; if (method === "falling" && !(s.buf[i] < s.buf[i - 1])) return false; } return true; }
        case "valuewhen": { const s = taState_(n, ctx, () => ({ vals: [] as number[] })); if (truthy(pos[0])) s.vals.unshift(num(pos[1])); const occ = Math.round(num(pos[2])) || 0; return s.vals[occ] !== undefined ? s.vals[occ] : NA; }
        default: warn(`unsupported ta.${method}() (na)`); return NA;
      }
    }
    function highLow(pos: any[], n: Node, ctx: Ctx) {
      // ta.highest(src,len) or ta.highest(len) using high/low builtins
      let srcv: number, len: number;
      if (pos.length >= 2) { srcv = num(pos[0]); len = Math.round(num(pos[1])); } else { len = Math.round(num(pos[0])); srcv = NA; }
      const s = taState_(n, ctx, () => ({ hb: [] as number[], lb: [] as number[], c: 0 }));
      const hv = pos.length >= 2 ? srcv : bars[ctx.i].h;
      const lv = pos.length >= 2 ? srcv : bars[ctx.i].l;
      rollingPush(s.hb, hv, len); rollingPush(s.lb, lv, len); s.c++;
      if (s.c < len) return { max: NA, min: NA, maxBar: NA, minBar: NA };
      let max = -Infinity, min = Infinity, maxIdx = 0, minIdx = 0;
      for (let i = 0; i < s.hb.length; i++) { if (s.hb[i] >= max) { max = s.hb[i]; maxIdx = i; } if (s.lb[i] <= min) { min = s.lb[i]; minIdx = i; } }
      const last = s.hb.length - 1;
      return { max, min, maxBar: -(last - maxIdx), minBar: -(last - minIdx) };
    }

    function mathDispatch(method: string, pos: any[]): any {
      const a = num(pos[0]), b = num(pos[1]);
      switch (method) {
        case "abs": return Math.abs(a); case "max": { let m = -Infinity; for (const x of pos) { const v = num(x); if (isNaN(v)) return NA; m = Math.max(m, v); } return m; }
        case "min": { let m = Infinity; for (const x of pos) { const v = num(x); if (isNaN(v)) return NA; m = Math.min(m, v); } return m; }
        case "round": return pos[1] != null ? +a.toFixed(Math.round(b)) : Math.round(a); case "floor": return Math.floor(a); case "ceil": return Math.ceil(a);
        case "sqrt": return Math.sqrt(a); case "pow": return Math.pow(a, b); case "exp": return Math.exp(a); case "log": return Math.log(a); case "log10": return Math.log10(a);
        case "sign": return Math.sign(a); case "avg": { let s = 0, c = 0; for (const x of pos) { const v = num(x); if (!isNaN(v)) { s += v; c++; } } return c ? s / c : NA; }
        case "sum": return a + b; case "todegrees": return (a * 180) / Math.PI; case "toradians": return (a * Math.PI) / 180;
        case "round_to_mintick": return a; default: warn(`unsupported math.${method}() (na)`); return NA;
      }
    }

    // ── statements / blocks ──
    function execBlock(stmts: Stmt[], ctx: Ctx): any {
      let last: any = NA;
      for (const s of stmts) last = execStmt(s, ctx);
      return last;
    }
    function execStmt(s: Stmt, ctx: Ctx): any {
      // budget check between statements — catches statement-heavy runaways (deep recursion,
      // pathological bar counts) that never enter a for-loop
      if (++totalStmts % STMT_DEADLINE_INTERVAL === 0) checkDeadline();
      if (s.t === "func") return NA; // hoisted already
      if (s.t === "seq") return execBlock(s.items, ctx);
      if (s.t === "expr") return evalNode(s.e, ctx);
      // assign
      if (s.op === "=" && s.isVar) {
        const key = ctx.frame ? ctx.frame.path + "|var|" + s.target : "var|" + String(s.target);
        const inited = ctx.frame ? localVarInit.has(key) : varInited.has(key);
        if (inited) { if (ctx.frame) ctx.frame.localNames.add(s.target as string); else globalVars.add(s.target as string); return resolveGet(ctx, s.target as string, 0); }
        if (ctx.frame) { localVarInit.add(key); localVarKeys.add(ctx.frame.path + "|" + s.target); } else varInited.add(key);
      }
      let val = evalNode(s.value, ctx);
      if (s.op === "=" && typeof s.target === "string" && isInputCall(s.value) && params[s.target] !== undefined) val = coerce(params[s.target], val);
      if (Array.isArray(s.target)) { const arr = Array.isArray(val) ? val : [val]; s.target.forEach((nm, k) => assignName(ctx, nm, arr[k], s.isVar, s.op === "=")); }
      else assignName(ctx, s.target, val, s.isVar, s.op === "=");
      return val;
    }

    function evalIf(n: Extract<Node, { t: "if" }>, ctx: Ctx): any {
      if (truthy(evalNode(n.cond, ctx))) return execBlock(n.then, ctx);
      for (const e of n.elifs) if (truthy(evalNode(e.cond, ctx))) return execBlock(e.body, ctx);
      if (n.els) return execBlock(n.els, ctx);
      return NA;
    }
    function evalFor(n: Extract<Node, { t: "for" }>, ctx: Ctx): any {
      const from = Math.round(num(evalNode(n.from, ctx))), to = Math.round(num(evalNode(n.to, ctx)));
      const step = n.step ? Math.round(num(evalNode(n.step, ctx))) : (to >= from ? 1 : -1);
      const scalars = ctx.scalars ? new Map(ctx.scalars) : new Map<string, number>();
      const sub: Ctx = { i: ctx.i, frame: ctx.frame, scalars, depth: ctx.depth, htf: ctx.htf };
      let last: any = NA;
      if (step === 0) return NA;
      for (let v = from; step > 0 ? v <= to : v >= to; v += step) {
        // run-level totals (NOT per-invocation) so nested loops can't escape the cap by resetting it
        if (++totalLoopIters > MAX_TOTAL_LOOP_ITERS) throw new PineRuntimeError(`script exceeded ${MAX_TOTAL_LOOP_ITERS.toLocaleString("en-US")} total loop iterations`);
        if ((totalLoopIters & 1023) === 0) checkDeadline();   // wall-clock poll inside tight loops, every 1024 iters
        scalars.set(n.vn, v); last = execBlock(n.body, sub);
      }
      return last;
    }

    const isInputCall = (node: Node): boolean => node.t === "call" && ((node.callee.t === "member" && node.callee.obj.t === "id" && node.callee.obj.name === "input") || (node.callee.t === "id" && node.callee.name === "input"));
    const coerce = (p: any, def: any): any => (typeof def === "number" ? Number(p) : typeof def === "boolean" ? (typeof p === "boolean" ? p : p === "true" || p === 1) : p);

    // ── the bar loop ──
    for (let i = 0; i < N; i++) {
      const ctx: Ctx = { i, frame: null, scalars: null, depth: 0 };
      if (i > 0) {
        for (const name of globalVars) { const arr = globals.get(name)!; if (arr[i] === undefined) arr[i] = arr[i - 1]; }
        for (const key of localVarKeys) { const arr = localStore.get(key); if (arr && arr[i] === undefined) arr[i] = arr[i - 1]; }   // carry function-local vars too
      }
      execBlock(body, ctx);
      collectInputs = false;
    }

    const plots = [...plotAcc.values()].map(({ lastColor, ...p }) => p);
    return { result: { meta, plots, shapes, hlines: [...hlineAcc.values()], inputs, warnings, barCount: N }, globals, localStore };
  }
}
