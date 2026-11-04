/** Closed consumer of the canonical delivery owner's exact sharing RPCs.
 * The authenticated database owns permission, locking and effect identity.
 * A saved reference is an address for reconciliation, never retry authority.
 */
import { isUuid as sourceUuid, validateBriefBody, type BriefBody } from "./briefs";

// PostgreSQL emits canonical lowercase UUIDs. Reject an ambiguous wire spelling
// before a mutation, rather than applying it and then failing response identity.
const isUuid = (value: unknown): value is string => sourceUuid(value) && value === value.toLowerCase();

export interface Grant {
  team_id: string; content_sha256: string; effect_sha256: string;
  shared_by: string; shared_at: string;
}
export interface Delivery<B> {
  delivery_id: string; slot_asof: string; artifact_asof: string | null;
  content_sha256: string; body: B;
}
export interface Audience { team_id: string; name: string; membership_policy: "DYNAMIC_TEAM_MEMBERSHIP" }
export interface SharingReview {
  schema: "mastermind.brief_delivery_sharing.v1";
  delivery: Delivery<BriefBody>; audience: Audience; eligibility: { can_share: boolean };
  expected_effect_sha256: string; grant: Grant | null;
}
export interface Receipt {
  schema: "mastermind.brief_delivery_sharing_receipt.v1";
  delivery_id: string; expected_effect_sha256: string;
  observation: "MATCHED" | "NOT_OBSERVED" | "CONFLICT";
  grant: Grant | null; current_access: boolean;
}
export type SharedBody = Pick<BriefBody, "market_read" | "monitors" | "artifact">;
export interface Shared {
  schema: "mastermind.shared_brief_delivery.v1";
  delivery: Delivery<SharedBody>; audience: Audience;
}
export interface SharingReference { delivery_id: string; expected_effect_sha256: string }
export type SharingCode = "invalid_input" | "denied" | "conflict" | "unavailable" | "effect_unknown";
export type SharingResult<T> = { ok: true; value: T } |
  { ok: false; code: SharingCode; reference?: SharingReference };
export interface SharingDb {
  rpc(name: string, args: Record<string, string>): PromiseLike<{
    data: unknown; error: { code?: string } | null;
  }>;
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
export const sharingDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const text = (value: unknown): value is string => typeof value === "string" &&
  value.length > 0 && value.length <= 16384 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const instant = (value: unknown): value is string => text(value) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const date = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
function bounded(value: unknown): boolean {
  try { return new TextEncoder().encode(JSON.stringify(value)).length <= 131072; } catch { return false; }
}
function grant(value: unknown): value is Grant {
  return object(value) && keys(value, ["team_id", "content_sha256", "effect_sha256", "shared_by", "shared_at"]) &&
    isUuid(value.team_id) && sharingDigest(value.content_sha256) && sharingDigest(value.effect_sha256) &&
    isUuid(value.shared_by) && instant(value.shared_at);
}
function audience(value: unknown): value is Audience {
  return object(value) && keys(value, ["team_id", "name", "membership_policy"]) &&
    isUuid(value.team_id) && text(value.name) && value.name.length <= 120 &&
    value.membership_policy === "DYNAMIC_TEAM_MEMBERSHIP";
}
function delivery(value: unknown, expected: string): value is Delivery<unknown> {
  return object(value) && keys(value, ["delivery_id", "slot_asof", "artifact_asof", "content_sha256", "body"]) &&
    value.delivery_id === expected && date(value.slot_asof) &&
    (value.artifact_asof === null || instant(value.artifact_asof)) && sharingDigest(value.content_sha256);
}
function sharedBody(value: unknown): SharedBody | null {
  if (!object(value) || !keys(value, ["market_read", "monitors", "artifact"]) ||
      !Array.isArray(value.market_read) || !Array.isArray(value.monitors) ||
      !object(value.artifact) || !keys(value.artifact, ["name", "asof"]) ||
      !text(value.artifact.name) || !text(value.artifact.asof)) return null;
  const market_read: SharedBody["market_read"] = [], monitors: SharedBody["monitors"] = [];
  for (const row of value.market_read) {
    if (!object(row) || !keys(row, ["section", "sentence_en", "sentence_zh", "asof"]) ||
        !text(row.section) || !text(row.sentence_en) || !text(row.sentence_zh) || !text(row.asof)) return null;
    market_read.push({ section: row.section, sentence_en: row.sentence_en, sentence_zh: row.sentence_zh, asof: row.asof });
  }
  for (const row of value.monitors) {
    if (!object(row) || !keys(row, ["name", "state_en", "state_zh"]) ||
        !text(row.name) || !text(row.state_en) || !text(row.state_zh)) return null;
    monitors.push({ name: row.name, state_en: row.state_en, state_zh: row.state_zh });
  }
  return { market_read, monitors, artifact: { name: value.artifact.name, asof: value.artifact.asof } };
}
export function decodeSharingReview(raw: unknown, deliveryId: string, teamId: string): SharingReview | null {
  if (!isUuid(deliveryId) || !isUuid(teamId) || !bounded(raw) || !object(raw) ||
      !keys(raw, ["schema", "delivery", "audience", "eligibility", "expected_effect_sha256", "grant"]) ||
      raw.schema !== "mastermind.brief_delivery_sharing.v1" || !delivery(raw.delivery, deliveryId) ||
      !audience(raw.audience) || raw.audience.team_id !== teamId || !object(raw.eligibility) ||
      !keys(raw.eligibility, ["can_share"]) || typeof raw.eligibility.can_share !== "boolean" ||
      !sharingDigest(raw.expected_effect_sha256) || (raw.grant !== null && !grant(raw.grant))) return null;
  const body = validateBriefBody(raw.delivery.body);
  if (!body) return null;
  return structuredClone({ ...raw, delivery: { ...raw.delivery, body } }) as unknown as SharingReview;
}
export function decodeSharingReceipt(raw: unknown, deliveryId: string, expected: string): Receipt | null {
  if (!isUuid(deliveryId) || !sharingDigest(expected) || !bounded(raw) || !object(raw) ||
      !keys(raw, ["schema", "delivery_id", "expected_effect_sha256", "observation", "grant", "current_access"]) ||
      raw.schema !== "mastermind.brief_delivery_sharing_receipt.v1" || raw.delivery_id !== deliveryId ||
      raw.expected_effect_sha256 !== expected || typeof raw.current_access !== "boolean") return null;
  if (raw.observation === "MATCHED") {
    if (!grant(raw.grant) || raw.grant.effect_sha256 !== expected) return null;
  } else if (!["NOT_OBSERVED", "CONFLICT"].includes(String(raw.observation)) ||
      raw.grant !== null || raw.current_access !== false) return null;
  return structuredClone(raw) as unknown as Receipt;
}
export function decodeSharedBrief(raw: unknown, deliveryId: string): Shared | null {
  if (!isUuid(deliveryId) || !bounded(raw) || !object(raw) || !keys(raw, ["schema", "delivery", "audience"]) ||
      raw.schema !== "mastermind.shared_brief_delivery.v1" || !delivery(raw.delivery, deliveryId) ||
      !audience(raw.audience)) return null;
  const body = sharedBody(raw.delivery.body);
  return body ? structuredClone({ ...raw, delivery: { ...raw.delivery, body } }) as unknown as Shared : null;
}
const invalid = (): SharingResult<never> => ({ ok: false, code: "invalid_input" });
function errorCode(code: string | undefined, mutating: boolean): SharingCode {
  if (code === "42501") return "denied";
  if (code === "40001") return "conflict";
  if (code === "22P02" || code === "22023") return "invalid_input";
  if (code === "PGRST202" || code === "42883") return "unavailable";
  return mutating ? "effect_unknown" : "unavailable";
}
async function acquire<T>(db: SharingDb, name: string, args: Record<string, string>,
  decode: (value: unknown) => T | null, reference?: SharingReference): Promise<SharingResult<T>> {
  const unknown = (): SharingResult<T> => reference
    ? { ok: false, code: "effect_unknown", reference: { ...reference } }
    : { ok: false, code: "unavailable" };
  try {
    const response = await db.rpc(name, args);
    if (response.error) {
      const code = errorCode(response.error.code, !!reference);
      return code === "effect_unknown" ? unknown() : { ok: false, code };
    }
    const value = decode(response.data);
    return value ? { ok: true, value } : unknown();
  } catch { return unknown(); }
}
export function readBriefDeliverySharing(db: SharingDb, deliveryId: string, teamId: string) {
  if (!isUuid(deliveryId) || !isUuid(teamId)) return Promise.resolve(invalid());
  return acquire(db, "read_brief_delivery_sharing", { p_delivery_id: deliveryId, p_team_id: teamId },
    raw => decodeSharingReview(raw, deliveryId, teamId));
}
export function shareBriefDelivery(db: SharingDb, deliveryId: string, teamId: string,
  expectedContent: string, expectedEffect: string, expectedActor: string) {
  if (!isUuid(deliveryId) || !isUuid(teamId) || !sharingDigest(expectedContent) || !sharingDigest(expectedEffect) || !isUuid(expectedActor))
    return Promise.resolve(invalid());
  return acquire(db, "share_brief_delivery", {
    p_delivery_id: deliveryId, p_team_id: teamId, p_expected_content_sha256: expectedContent,
    p_expected_effect_sha256: expectedEffect,
  }, raw => {
    const value = decodeSharingReview(raw, deliveryId, teamId), g = value?.grant;
    return value && g && value.delivery.content_sha256 === expectedContent &&
      value.expected_effect_sha256 === expectedEffect && g.team_id === teamId &&
      g.content_sha256 === expectedContent && g.effect_sha256 === expectedEffect && g.shared_by === expectedActor ? value : null;
  }, { delivery_id: deliveryId, expected_effect_sha256: expectedEffect });
}
export function reconcileBriefDeliverySharing(db: SharingDb, deliveryId: string, expectedEffect: string) {
  if (!isUuid(deliveryId) || !sharingDigest(expectedEffect)) return Promise.resolve(invalid());
  return acquire(db, "reconcile_brief_delivery_sharing", {
    p_delivery_id: deliveryId, p_expected_effect_sha256: expectedEffect,
  }, raw => decodeSharingReceipt(raw, deliveryId, expectedEffect));
}
export function readSharedBriefDelivery(db: SharingDb, deliveryId: string) {
  if (!isUuid(deliveryId)) return Promise.resolve(invalid());
  return acquire(db, "read_shared_brief_delivery", { p_delivery_id: deliveryId },
    raw => decodeSharedBrief(raw, deliveryId));
}

/** Flat string command only; duplicate and escaped duplicate keys are rejected. */
export function parseSharingCommand(textValue: string): {
  team_id: string; expected_content_sha256: string; expected_effect_sha256: string;
} | null {
  try {
    if (new TextEncoder().encode(textValue).length > 16384) return null;
    const raw: unknown = JSON.parse(textValue);
    const expected = ["team_id", "expected_content_sha256", "expected_effect_sha256"];
    if (!object(raw) || !keys(raw, expected) || !isUuid(raw.team_id) ||
        !sharingDigest(raw.expected_content_sha256) || !sharingDigest(raw.expected_effect_sha256)) return null;
    // Values have already been restricted to UUID/SHA strings, so this scan can
    // only match actual property keys or a malformed command that fails closed.
    const seen = new Set<string>();
    for (const match of textValue.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)) {
      const key = JSON.parse('"' + match[1] + '"') as string;
      if (seen.has(key) || !expected.includes(key)) return null;
      seen.add(key);
    }
    return seen.size === expected.length ? raw as ReturnType<typeof parseSharingCommand> : null;
  } catch { return null; }
}
