import "server-only";
import { scenarioBasisEncoding } from "./scenarioAcquisition";
import { createHash } from "node:crypto";
import { parseScenarioCapture, type ScenarioCapture } from "./investigationScenario";
import { isInvestigationId } from "./investigations";
import { createExposureMapReader } from "./exposureMap";
import { scenarioBasisFromRead } from "@/components/exposure-map/exposureScenarioBasis";
import { SCENARIO_VERSION, localScenarioValue, type ScenarioBasis, type ScenarioValue } from "./exposureScenario";

export const SCENARIO_NATIVE_URL = "https://www.mastermind-x.com/api/options/scenario-source/resolve";
const MAX_RESPONSE = 13 * 1024 * 1024;
type ReadIntent = { mode: "resolve"; investigation_id: string; revision: number; grant_id: string | null };
type SaveIntent = { mode: "qualify" | "capture"; investigation_id: string; revision: number; grant_id: null; expected_revision: number; operation_id: string; capture: ScenarioCapture };
export type ScenarioNativeIntent = ReadIntent | SaveIntent;
export type ScenarioNativeResult =
  | { status: "resolved"; investigation_id: string; revision: number; grant_id: string | null; capture: ScenarioCapture; basis: ScenarioBasis; result: ScenarioValue }
  | { status: "not_found" | "denied" | "unavailable" };
const unavailable = (): ScenarioNativeResult => ({ status: "unavailable" });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Reflect.ownKeys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const scenarioBasisDigest = (basis: ScenarioBasis) => sha(Buffer.from(scenarioBasisEncoding(basis), "utf8"));

export function parseScenarioNativeIntent(raw: unknown): ScenarioNativeIntent | null {
  if (!record(raw) || !isInvestigationId(raw.investigation_id) || !Number.isSafeInteger(raw.revision)
    || Number(raw.revision) < 1 || Number(raw.revision) > 2147483647) return null;
  if (raw.mode === "resolve" && exact(raw, ["mode", "investigation_id", "revision", "grant_id"])
    && (raw.grant_id === null || isInvestigationId(raw.grant_id))) {
    return { mode: "resolve", investigation_id: raw.investigation_id, revision: Number(raw.revision), grant_id: raw.grant_id };
  }
  if ((raw.mode !== "qualify" && raw.mode !== "capture") || !exact(raw, ["mode", "investigation_id", "revision", "grant_id", "expected_revision", "operation_id", "capture"])
    || raw.grant_id !== null || !isInvestigationId(raw.operation_id) || !Number.isSafeInteger(raw.expected_revision)
    || Number(raw.expected_revision) < 0 || Number(raw.expected_revision) + 1 !== raw.revision) return null;
  const capture = parseScenarioCapture(raw.capture);
  return capture ? { mode: raw.mode, investigation_id: raw.investigation_id, revision: Number(raw.revision), grant_id: null,
    expected_revision: Number(raw.expected_revision), operation_id: raw.operation_id, capture } : null;
}

/** Strict UTF-8 JSON with duplicate names/nonfinite numbers/deep structures refused.
 * Structural validation preserves source bytes for hashing; it never normalizes them.
 */
function jsonBytes(bytes: Uint8Array): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let at = 0;
  const ws = () => { while (/[\x20\x09\x0a\x0d]/.test(text[at] ?? "!")) at++; };
  const str = (): string => {
    const start = at++;
    while (at < text.length) {
      if (text[at++] === '"') return JSON.parse(text.slice(start, at));
      if (text[at-1] === "\\") at++;
    }
    throw Error("invalid_json");
  };
  const value = (depth = 0): void => {
    if (depth > 100) throw Error("invalid_json");
    ws();
    if (text[at] === '"') { str(); return; }
    if (text[at] === "{") {
      at++; ws(); const keys = new Set<string>();
      if (text[at] !== "}") while (true) {
        ws(); if (text[at] !== '"') throw Error("invalid_json");
        const key = str(); if (keys.has(key)) throw Error("duplicate_json_key"); keys.add(key);
        ws(); if (text[at++] !== ":") throw Error("invalid_json");
        value(depth+1); ws(); if (text[at] === "}") break;
        if (text[at++] !== ",") throw Error("invalid_json");
      }
      at++; return;
    }
    if (text[at] === "[") {
      at++; ws(); if (text[at] !== "]") while (true) {
        value(depth+1); ws(); if (text[at] === "]") break;
        if (text[at++] !== ",") throw Error("invalid_json");
      }
      at++; return;
    }
    const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
    if (!match || (!/^(null|true|false)$/.test(match[0]) && !Number.isFinite(Number(match[0])))) throw Error("invalid_json");
    at += match[0].length;
  };
  value(); ws(); if (at !== text.length) throw Error("invalid_json");
  return JSON.parse(text);
}

function retainedBytes(raw: unknown, ref: { sha256: string; byte_length: number }, max: number): unknown {
  if (!record(raw) || !exact(raw, ["sha256", "byte_length", "base64"]) || raw.sha256 !== ref.sha256
    || raw.byte_length !== ref.byte_length || ref.byte_length > max || typeof raw.base64 !== "string"
    || raw.base64.length > Math.ceil(max/3)*4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.base64)) throw Error("invalid_source");
  const bytes = Buffer.from(raw.base64, "base64");
  if (bytes.length !== ref.byte_length || bytes.toString("base64") !== raw.base64 || sha(bytes) !== ref.sha256) throw Error("invalid_source");
  return jsonBytes(bytes);
}

/** Verify untrusted native response against exact request, then use existing native TS math.
 * Generic Investigation storage never receives raw bytes, basis or calculated values.
 */
export function decodeNativeScenario(raw: unknown, expected: ScenarioNativeIntent): ScenarioNativeResult {
  try {
    if (!record(raw)) return unavailable();
    if (raw.status === "not_found") return exact(raw, ["status"]) ? { status: "not_found" } : unavailable();
    if (raw.status === "denied") {
      const reasons = ["revision_conflict", "resource_denied", "resource_revoked", "current_actor_changed", "source_denied", "destination_denied"];
      return exact(raw, ["status", "reason"]) && reasons.includes(String(raw.reason)) ? { status: "denied" } : unavailable();
    }
    if (raw.status === "unavailable") return unavailable();
    if (!exact(raw, ["status", "mode", "investigation_id", "revision", "grant_id", "capture", "gex", "moves"])
      || raw.status !== "resolved" || raw.mode !== expected.mode || raw.investigation_id !== expected.investigation_id
      || raw.revision !== expected.revision || raw.grant_id !== expected.grant_id) return unavailable();
    const capture = parseScenarioCapture(raw.capture);
    if (!capture || (expected.mode !== "resolve" && JSON.stringify(capture) !== JSON.stringify(expected.capture))) return unavailable();
    const s = capture.source;
    const gex = retainedBytes(raw.gex, s.gex, 8*1024*1024);
    const moves = s.moves === null ? null : retainedBytes(raw.moves, s.moves, 1024*1024);
    if (s.moves === null && raw.moves !== null) return unavailable();
    if (!record(gex) || gex.schema !== "options_hub.gex/v1" || gex.root !== s.root || typeof gex.asof !== "string" || gex.asof.slice(0,10) !== s.session) return unavailable();
    if (moves !== null && (!record(moves) || moves.schema !== "options_hub.moves/v1" || moves.root !== s.root || typeof moves.asof !== "string" || moves.asof.slice(0,10) !== s.session)) return unavailable();
    const instant = Date.parse(s.evaluated_at);
    const reader = createExposureMapReader(gex, s.root, null, s.session, instant);
    const read = reader(s.lens, "gamma");
    if (read.state !== "data" || read.qualification !== "qualified" || read.session !== s.session
      || read.sourceAsOf !== s.source_as_of || read.selectionKey !== s.selection_key) return unavailable();
    const basis = scenarioBasisFromRead(read, reader, s.lens, s.root, moves === null ? null : { root: s.root, raw: moves, now: instant });
    if (!basis || basis.qualification !== "qualified" || (moves !== null && basis.emPct === null)
      || scenarioBasisDigest(basis) !== s.basis_sha256) return unavailable();
    const result = localScenarioValue(basis, capture.inputs);
    if (!result.ok) return unavailable();
    return { status: "resolved", investigation_id: expected.investigation_id, revision: expected.revision,
      grant_id: expected.grant_id, capture, basis, result };
  } catch { return unavailable(); }
}

function within<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("source_deadline"));
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Error("source_deadline"));
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw Error("source_deadline"); return action(); })
      .then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

export async function requestNativeScenario(raw: unknown, token: string, options: { fetcher?: typeof fetch } = {}): Promise<ScenarioNativeResult> {
  const intent = parseScenarioNativeIntent(raw);
  if (!intent || typeof token !== "string" || !token || token.length > 16384 || /\s/.test(token)) return unavailable();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await within(controller.signal, () => (options.fetcher ?? fetch)(SCENARIO_NATIVE_URL, { method: "POST", redirect: "manual", cache: "no-store", signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(intent) }));
    if (response.status >= 300 && response.status < 400) return unavailable();
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !response.body
      || Number(response.headers.get("content-length")) > MAX_RESPONSE) return unavailable();
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const next = await within(controller.signal, () => reader!.read()); if (next.done) break;
      length += next.value.byteLength; if (length > MAX_RESPONSE) return unavailable(); chunks.push(next.value);
    }
    const bytes = new Uint8Array(length); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    const value = jsonBytes(bytes);
    if (!response.ok && (!record(value) || value.status === "resolved")) return unavailable();
    return decodeNativeScenario(value, intent);
  } catch { return unavailable(); }
  finally { clearTimeout(timeout); controller.abort(); void reader?.cancel().catch(() => {}); }
}
