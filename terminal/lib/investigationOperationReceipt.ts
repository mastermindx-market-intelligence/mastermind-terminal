/**
 * Pure Investigation operation-receipt binding helper.
 *
 * Classifies a natively stored Investigation operation receipt by identity and
 * lineage only. The caller separately validates the full existing manifest
 * with its own validator; this helper never authorizes cutover or retry, never
 * computes or mutates manifest content or hashes, and never emits raw errors.
 */

export type InvestigationReceiptClass = "committed" | "not_applied";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const INT32_MAX = 2147483647;

/** Native stored fence: EXACT keys, incumbent RLS principal, no author field. */
const FENCE_KEYS = ["status", "id", "operation_id"] as const;

/** Native commit receipt: EXACT keys. */
const COMMIT_KEYS = [
  "status",
  "id",
  "investigation_id",
  "operation_id",
  "author_ref",
  "revision",
  "sequence",
  "revision_id",
  "parent_revision_id",
  "manifest_digest",
  "committed_at",
  "recorded_at",
  "lifecycle",
  "manifest",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(raw);
  if (present.length !== keys.length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(raw, key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isInvestigationReceiptTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP_RE.test(value) || !Number.isFinite(Date.parse(value))) return false;
  // Date.parse normalizes impossible calendar dates. Round-trip the wall clock
  // separately so valid offsets and native microseconds retain their meaning.
  const wall = value.slice(0, 19);
  const parsed = Date.parse(wall + "Z");
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === wall;
}

function isPositiveInt32(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= INT32_MAX;
}

export function classifyInvestigationOperationReceipt(
  raw: unknown,
  operationId: string,
  principal: string,
): InvestigationReceiptClass | null {
  if (!isUuid(operationId) || !isUuid(principal) || !isPlainObject(raw)) return null;

  const status = raw["status"];

  if (status === "not_applied") {
    if (!hasExactKeys(raw, FENCE_KEYS)) return null;
    if (!isUuid(raw["id"])) return null;
    if (raw["operation_id"] !== operationId) return null;
    return "not_applied";
  }

  if (status !== "committed") return null;
  if (!hasExactKeys(raw, COMMIT_KEYS)) return null;

  if (!isUuid(raw["id"])) return null;
  if (raw["investigation_id"] !== raw["id"]) return null;
  if (raw["operation_id"] !== operationId) return null;
  if (raw["author_ref"] !== principal) return null;

  const revision = raw["revision"];
  const sequence = raw["sequence"];
  if (!isPositiveInt32(revision) || !isPositiveInt32(sequence) || revision !== sequence) return null;

  if (!isUuid(raw["revision_id"])) return null;

  const parent = raw["parent_revision_id"];
  if (revision === 1 ? parent !== null : !isUuid(parent)) return null;

  const digest = raw["manifest_digest"];
  if (typeof digest !== "string" || !DIGEST_RE.test(digest)) return null;

  const committedAt = raw["committed_at"];
  const recordedAt = raw["recorded_at"];
  if (!isInvestigationReceiptTimestamp(committedAt) || !isInvestigationReceiptTimestamp(recordedAt)) return null;
  if (committedAt !== recordedAt) return null;

  const lifecycle = raw["lifecycle"];
  if (lifecycle !== "active" && lifecycle !== "removed") return null;

  if (!isPlainObject(raw["manifest"])) return null;

  return "committed";
}
