import { parseSessionStampMs } from "./host-shared";
import { resolveSessionPhase } from "./runtime";
import type { Node, ParseResult } from "./parser";
import type { Bar, RunResult, RunOpts } from "./index";

/**
 * Digest inputs are the original supplied bytes, UTF-8 probe source, and UTF-8 JSON
 * of ordered [time, timeClose, o, h, l, c, v] arrays respectively. Numbers use
 * round-trip decimal text, including -0. The caller supplies the expected pair
 * of raw and normalized input digests from the source contract.
 */
export interface ReferenceExportRequest {
  inputBytes: Uint8Array;
  inputSha256: string;
  probeSha256: string;
  columnsSha256: string;
}

export type ReferenceExport =
  | { status: "unavailable"; reason: string }
  | { status: "retained"; bytes: Uint8Array; sha256: string; byteLength: number };

const names = ["TG_rsi", "TG_rsi_macd", "TG_rsi_macd_signal", "TG_rsi_macd_hist", "TG_stoch_k", "TG_stoch_d"];
const encoder = new TextEncoder();

// Stable JSON bytes, including signed zero. Nonfinite numbers never silently become gaps.
function json(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? "-0" : String(value);
  if (Array.isArray(value)) return "[" + value.map(json).join(",") + "]";
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map(key => JSON.stringify(key) + ":" + json(record[key])).join(",") + "}";
  }
  throw new Error("unrepresentable export value");
}

// The chart interpreter includes compatibility stubs. Only this small, positively
// supported probe language can issue a reference. Check the complete AST, including
// unselected branches, and execute exclusively through the existing interpreter.
const scalarNames = new Set(["open", "high", "low", "close", "volume", "bar_index", "time", "time_close"]);
const members = new Set(["display.data_window", "format.price", "syminfo.ticker", "syminfo.tickerid"]);
const callShapes = new Map<string, [number, number, string[]]>([
  ["indicator", [1, 1, ["overlay", "format", "precision"]]], ["plot", [1, 2, ["title", "display", "precision"]]],
  ["input.int", [1, 2, ["title"]]], ["na", [1, 1, []]], ["nz", [1, 2, []]],
  ...["ta.rsi", "ta.ema", "ta.sma", "ta.lowest", "ta.highest"].map(
    (name): [string, [number, number, string[]]] => [name, [2, 2, []]]),
]);
const operators = new Set(["+", "-", "*", "/", "%", "<", ">", "<=", ">=", "==", "!=", "and", "or"]);

export function supportsReferenceProbe(ast: ParseResult): boolean {
  const variables = new Set<string>();
  function supported(n: Node, inputAssignment = false): boolean {
    switch (n.t) {
      case "num": return Number.isFinite(n.v);
      case "str": case "bool": case "na": return true;
      case "id": return scalarNames.has(n.name) || variables.has(n.name);
      case "member": return n.obj.t === "id" && members.has(n.obj.name + "." + n.prop);
      case "unary": return ["+", "-", "not"].includes(n.op) && supported(n.e);
      case "binary": return operators.has(n.op) && supported(n.l) && supported(n.r);
      case "ternary": return supported(n.c) && supported(n.a) && supported(n.b);
      case "call": {
        const callee = n.callee;
        const name = callee.t === "id" ? callee.name :
          callee.t === "member" && callee.obj.t === "id" ? callee.obj.name + "." + callee.prop : "";
        const shape = callShapes.get(name);
        if (!shape) return false;
        if (name === "input.int") {
          const def = n.args[0]?.value;
          if (!inputAssignment || def?.t !== "num" || !Number.isSafeInteger(def.v) ||
              n.args.slice(1).some(a => a.value.t !== "str")) return false;
        }
        const named = n.args.flatMap(a => a.name === undefined ? [] : [a.name]);
        const positional = n.args.length - named.length;
        return positional >= shape[0] && positional <= shape[1] && named.every(k => shape[2].includes(k))
          && new Set(named).size === named.length && n.args.every(a => supported(a.value));
      }
      default: return false;
    }
  }
  return ast.body.every(stmt => {
    if (stmt.t === "expr") return supported(stmt.e);
    if (stmt.t !== "assign" || stmt.op !== "=" || stmt.isVar || typeof stmt.target !== "string"
        || scalarNames.has(stmt.target) || variables.has(stmt.target) || !supported(stmt.value, true)) return false;
    variables.add(stmt.target);
    return true;
  });
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

export async function retainReference(
  request: ReferenceExportRequest, source: string, bars: Bar[], options: RunOpts,
  hostBudgetMs: number, startedMs: number, completedMs: number, result: RunResult,
): Promise<ReferenceExport> {
  const unavailable = (reason: string): ReferenceExport => ({ status: "unavailable", reason });
  try {
    const build = process.env.NEXT_PUBLIC_SHARED_SHELL_BUILD;
    const sourceClosure = process.env.NEXT_PUBLIC_PINE_SOURCE_SHA256;
    if (!build || !/^[0-9a-f]{40}$/.test(build) || !sourceClosure || !/^[0-9a-f]{64}$/.test(sourceClosure)) {
      return unavailable("unidentified_worker_build");
    }
    if (!Number.isSafeInteger(startedMs) || startedMs <= 0 || !Number.isSafeInteger(completedMs) || completedMs < startedMs)
      return unavailable("invalid_run_clocks");
    if (typeof options.symbol !== "string" || !options.symbol.trim() || typeof options.timeframe !== "string" ||
        !options.timeframe.trim() || !Number.isFinite(hostBudgetMs) || hostBudgetMs <= 0) return unavailable("missing_run_options");
    const sessionPhase = resolveSessionPhase(bars, options.sessionAnchor);
    if (options.sessionAnchor != null && sessionPhase.fallback) return unavailable("invalid_session_anchor");
    if (result.warnings.length) return unavailable("runtime_warning");
    if (!result.effectiveInputs || result.effectiveInputs.some(x => !Number.isSafeInteger(x.value))) {
      return unavailable("invalid_effective_input");
    }
    if (!(request.inputBytes instanceof Uint8Array) || !request.inputBytes.byteLength ||
        request.inputBytes.byteLength > 64 * 1024 * 1024) return unavailable("invalid_source_bytes");
    if (!(request.inputBytes.buffer instanceof ArrayBuffer)) return unavailable("shared_source_bytes");
    if (!bars.length || bars.length > 100_000 || result.barCount !== bars.length) return unavailable("incomplete_rows");
    let previousClose = -Infinity;
    const columns = bars.map(b => {
      const open = parseSessionStampMs(b.time), close = parseSessionStampMs(b.timeClose);
      if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open || open < previousClose)
        throw new Error("invalid_explicit_bar_interval");
      previousClose = close;
      return [b.time, b.timeClose, b.o, b.h, b.l, b.c, b.v];
    });
    const [inputHash, probeHash, columnsHash] = await Promise.all([
      digest(request.inputBytes), digest(encoder.encode(source)), digest(encoder.encode(json(columns))),
    ]);
    if (inputHash !== request.inputSha256 || probeHash !== request.probeSha256 || columnsHash !== request.columnsSha256)
      return unavailable("source_binding_mismatch");
    const series = names.map(name => {
      const plots = result.plots.filter(p => p.title === name);
      if (plots.length !== 1 || plots[0].data.length !== bars.length) throw new Error("incomplete_series:" + name);
      return [name, plots[0].data.map((point, i) => {
        if (point.time !== bars[i].time) throw new Error("misaligned_series:" + name);
        if (point.value !== undefined && !Number.isFinite(point.value)) throw new Error("invalid_series_value:" + name);
        return point.value === undefined ? null : point.value;
      })];
    });
    const bytes = encoder.encode(json({
      schema: "terminal.pine.reference_export.v1", origin: "terminal_native_worker",
      build, sourceClosure, probeLanguage: "asc-six-series-v1", probeSha256: probeHash,
      inputSha256: inputHash, inputBytes: request.inputBytes.byteLength,
      normalizationBinding: "supplied_pair_unverified_derivation",
      columnsSha256: columnsHash, columnOrder: ["time", "timeClose", "o", "h", "l", "c", "v"],
      times: bars.map(b => [b.time, b.timeClose]), series,
      options: { timeframe: options.timeframe, symbol: options.symbol, params: options.params ?? {},
        budgetMs: options.budgetMs, sessionAnchor: options.sessionAnchor ?? null },
      declaredInputs: result.inputs, effectiveInputs: result.effectiveInputs,
      hostBudgetMs, sessionPhase, startedMs, completedMs,
    }));
    return { status: "retained", bytes, byteLength: bytes.byteLength, sha256: await digest(bytes) };
  } catch (err) {
    return unavailable(err instanceof Error ? err.message : "export_failed");
  }
}
