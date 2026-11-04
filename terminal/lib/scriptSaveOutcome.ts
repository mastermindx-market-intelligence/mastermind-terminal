import { compareExpectedUpdatedAt, parseExpectedUpdatedAtMs } from "@/lib/savedScriptStamp";

export type ScriptVersion = {
  id: string; name: string; source: string; params: Record<string, unknown>; updated_at: string;
};
export type ScriptSaveAttempt = {
  sequence: number; id: string; name: string; source: string;
  params: Record<string, unknown>; expected_updated_at: string;
};
export type ConfirmedScriptSave = { attempt: ScriptSaveAttempt; version: ScriptVersion };

function jsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(jsonValue);
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, ordered(item)]),
  );
  return value;
}
export function scriptParamsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}
export function sameScriptContent(a: Pick<ScriptVersion, "name" | "source" | "params">,
  b: Pick<ScriptVersion, "name" | "source" | "params">): boolean {
  return a.name === b.name && a.source === b.source && scriptParamsEqual(a.params, b.params);
}
export function parseScriptVersion(value: unknown, expectedId?: string): ScriptVersion | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id || (expectedId && row.id !== expectedId)
    || typeof row.name !== "string" || typeof row.source !== "string"
    || !row.params || typeof row.params !== "object" || Array.isArray(row.params) || !jsonValue(row.params)
    || typeof row.updated_at !== "string" || parseExpectedUpdatedAtMs(row.updated_at) === null) return null;
  return { id: row.id, name: row.name, source: row.source, params: row.params as Record<string, unknown>, updated_at: row.updated_at };
}
/** A 2xx response is useful only when it advances this exact attempted CAS token. */
export function verifyScriptSaveReceipt(value: unknown, attempt: ScriptSaveAttempt): ConfirmedScriptSave | null {
  if (!value || typeof value !== "object") return null;
  const receipt = value as Record<string, unknown>;
  if (receipt.ok !== true || receipt.id !== attempt.id || typeof receipt.updated_at !== "string"
    || (compareExpectedUpdatedAt(receipt.updated_at, attempt.expected_updated_at) ?? 0) <= 0) return null;
  return { attempt, version: { id: attempt.id, name: attempt.name, source: attempt.source,
    params: attempt.params, updated_at: receipt.updated_at } };
}
export type ScriptReadback =
  | { kind: "matched" | "different"; version: ScriptVersion }
  | { kind: "unresolved" | "missing" | "invalid" };

/** Observe the current owner-filtered row. An unchanged revision does not prove
 * an uncertain POST finished: it can still commit after this GET. A strictly
 * newer token fences that old update under the existing server CAS contract. */
export function classifyScriptReadback(value: unknown, attempt: ScriptSaveAttempt): ScriptReadback {
  if (!value || typeof value !== "object" || !Array.isArray((value as { scripts?: unknown }).scripts)) return { kind: "invalid" };
  const matches = ((value as { scripts: unknown[] }).scripts).filter((row) => row && typeof row === "object" && (row as { id?: unknown }).id === attempt.id);
  if (!matches.length) return { kind: "missing" };
  if (matches.length !== 1) return { kind: "invalid" };
  const version = parseScriptVersion(matches[0], attempt.id);
  if (!version) return { kind: "invalid" };
  const order = compareExpectedUpdatedAt(version.updated_at, attempt.expected_updated_at);
  if (order === null || order < 0) return { kind: "invalid" };
  if (order === 0) return { kind: "unresolved" };
  return { kind: sameScriptContent(version, attempt) ? "matched" : "different", version };
}
