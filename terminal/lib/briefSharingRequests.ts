/** Explicit delivery sharing requests. Readiness and team eligibility never issue a request. */
import { isUuid } from "./briefs";
import type { SharingDb, SharingResult } from "./briefDeliverySharing";
export const SHARING_REQUEST_FEED_SCHEMA = "mastermind.terminal_sharing_request_feed.v1" as const;
export const SHARING_REQUEST_FEED_BYTES = 65536;
export interface TerminalRequestViewer { principal_scope: string; session_scope: string }
export interface SharingRequest {
  request_ref: string; revision: 1; issued_at: string;
  delivery: { delivery_id: string; content_sha256: string; title: string; slot_asof: string; artifact_asof: string | null };
  audience: { team_id: string; name: string; member_count: number; membership_policy: "DYNAMIC_TEAM_MEMBERSHIP" };
  review: { request_ref: string; revision: 1; delivery_id: string };
}
export type RequestCoverageReason = "LIMIT_REACHED" | "REQUEST_SOURCE_CHANGED" | "REQUEST_AUTHORITY_CHANGED";
export interface SharingRequestFeed {
  schema: typeof SHARING_REQUEST_FEED_SCHEMA;
  viewer: TerminalRequestViewer;
  source: { owner: "TERMINAL_BRIEF_DELIVERY"; scope: "OWNED_EXPLICIT_SHARING_REQUESTS"; observed_at: string };
  coverage: { state: "COMPLETE_WITHIN_SCOPE" | "PARTIAL"; reason_codes: RequestCoverageReason[] };
  requests: SharingRequest[];
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(n => Object.hasOwn(v, n));
const uuid = (v: unknown): v is string => isUuid(v) && v === v.toLowerCase();
const digest = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const title = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && Array.from(v).length <= 240 && !/[\u0000-\u001f\u007f]/.test(v);
const instant = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v) && Number.isFinite(Date.parse(v));
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
function request(v: unknown): v is SharingRequest {
  if (!object(v) || !keys(v, ["request_ref", "revision", "issued_at", "delivery", "audience", "review"]) || !uuid(v.request_ref) || v.revision !== 1 || !instant(v.issued_at)) return false;
  const d = v.delivery, a = v.audience, r = v.review;
  return object(d) && keys(d, ["delivery_id", "content_sha256", "title", "slot_asof", "artifact_asof"]) && uuid(d.delivery_id) && digest(d.content_sha256) && title(d.title) && date(d.slot_asof) && (d.artifact_asof === null || instant(d.artifact_asof)) &&
    object(a) && keys(a, ["team_id", "name", "member_count", "membership_policy"]) && uuid(a.team_id) && title(a.name) && Number.isSafeInteger(a.member_count) && (a.member_count as number) >= 1 && a.membership_policy === "DYNAMIC_TEAM_MEMBERSHIP" &&
    object(r) && keys(r, ["request_ref", "revision", "delivery_id"]) && r.request_ref === v.request_ref && r.revision === v.revision && r.delivery_id === d.delivery_id;
}
export function decodeSharingRequestFeed(value: unknown, expected: Pick<TerminalRequestViewer, "principal_scope"> & Partial<TerminalRequestViewer>): SharingRequestFeed | null {
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > SHARING_REQUEST_FEED_BYTES || !object(value) || !keys(value, ["schema", "viewer", "source", "coverage", "requests"]) || value.schema !== SHARING_REQUEST_FEED_SCHEMA) return null;
    const v = value.viewer, s = value.source, c = value.coverage;
    if (!digest(expected.principal_scope) || !object(v) || !keys(v, ["principal_scope", "session_scope"]) || !digest(v.principal_scope) || !digest(v.session_scope) || v.principal_scope !== expected.principal_scope || (expected.session_scope !== undefined && v.session_scope !== expected.session_scope)) return null;
    if (!object(s) || !keys(s, ["owner", "scope", "observed_at"]) || s.owner !== "TERMINAL_BRIEF_DELIVERY" || s.scope !== "OWNED_EXPLICIT_SHARING_REQUESTS" || !instant(s.observed_at)) return null;
    if (!object(c) || !keys(c, ["state", "reason_codes"]) || !["COMPLETE_WITHIN_SCOPE", "PARTIAL"].includes(c.state as string) || !Array.isArray(c.reason_codes) || c.reason_codes.some(r => !["LIMIT_REACHED", "REQUEST_SOURCE_CHANGED", "REQUEST_AUTHORITY_CHANGED"].includes(r)) || new Set(c.reason_codes).size !== c.reason_codes.length || (c.state === "PARTIAL") !== (c.reason_codes.length > 0)) return null;
    if (!Array.isArray(value.requests) || value.requests.length > 20 || !value.requests.every(request) || new Set(value.requests.map(r => r.request_ref)).size !== value.requests.length || new Set(value.requests.map(r => r.delivery.delivery_id)).size !== value.requests.length) return null;
    return value as unknown as SharingRequestFeed;
  } catch { return null; }
}
export async function readSharingRequestFeed(db: SharingDb, viewer: Pick<TerminalRequestViewer, "principal_scope"> & Partial<TerminalRequestViewer>): Promise<SharingResult<SharingRequestFeed>> {
  try {
    const result = await db.rpc("read_brief_sharing_requests", {});
    if (result.error) return { ok: false, code: result.error.code === "42501" ? "denied" : "unavailable" };
    const value = decodeSharingRequestFeed(result.data, viewer);
    return value ? { ok: true, value } : { ok: false, code: "unavailable" };
  } catch { return { ok: false, code: "unavailable" }; }
}

import { decodeSharingReview, type SharingReview } from "./briefDeliverySharing";
export interface SharingRequestSelection { delivery_id: string; request_ref: string; revision: 1 }
export interface SharingRequestRecord {
  schema: "mastermind.brief_sharing_request.v1"; request_ref: string; revision: 1;
  issued_at: string; disposition: "OPEN" | "SHARED" | "KEPT_PRIVATE"; resolved_at: string | null;
  review: SharingReview;
}
export type SharingRequestCommand =
  | { action: "ISSUE"; request_ref: string; team_id: string; expected_content_sha256: string }
  | { action: "SHARE"; request_ref: string; revision: 1; expected_content_sha256: string; expected_effect_sha256: string }
  | { action: "KEEP_PRIVATE"; request_ref: string; revision: 1; expected_content_sha256: string };
export function decodeSharingRequestRecord(value: unknown, selected: SharingRequestSelection): SharingRequestRecord | null {
  try {
    if (!uuid(selected.delivery_id) || !uuid(selected.request_ref) || selected.revision !== 1 || new TextEncoder().encode(JSON.stringify(value)).length > 131072 || !object(value) || !keys(value, ["schema", "request_ref", "revision", "issued_at", "disposition", "resolved_at", "review"]) || value.schema !== "mastermind.brief_sharing_request.v1" || value.request_ref !== selected.request_ref || value.revision !== 1 || !instant(value.issued_at) || !["OPEN", "SHARED", "KEPT_PRIVATE"].includes(value.disposition as string) || (value.disposition === "OPEN" ? value.resolved_at !== null : !instant(value.resolved_at))) return null;
    if (!object(value.review) || !object(value.review.audience) || !uuid(value.review.audience.team_id)) return null;
    const review = decodeSharingReview(value.review, selected.delivery_id, value.review.audience.team_id);
    if (!review || (value.disposition === "SHARED" && !review.grant) || (value.disposition === "KEPT_PRIVATE" && review.grant !== null)) return null;
    return { ...value, review } as unknown as SharingRequestRecord;
  } catch { return null; }
}
export function parseSharingRequestCommand(text: string): SharingRequestCommand | null {
  try {
    if (new TextEncoder().encode(text).length > 16384) return null;
    const v = JSON.parse(text);
    if (!object(v) || !uuid(v.request_ref) || !digest(v.expected_content_sha256)) return null;
    // Flat UUID/digest/action strings plus revision1 only. Reject duplicate
    // spelling (including escaped keys) before invoking any owner mutation.
    const seen = new Set<string>();
    for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)) {
      const key = JSON.parse('"' + match[1] + '"') as string;
      if (seen.has(key)) return null;
      seen.add(key);
    }
    if (seen.size !== Object.keys(v).length) return null;
    if (v.action === "ISSUE" && keys(v, ["action", "request_ref", "team_id", "expected_content_sha256"]) && uuid(v.team_id)) return v as unknown as SharingRequestCommand;
    if (v.action === "SHARE" && keys(v, ["action", "request_ref", "revision", "expected_content_sha256", "expected_effect_sha256"]) && v.revision === 1 && digest(v.expected_effect_sha256)) return v as unknown as SharingRequestCommand;
    if (v.action === "KEEP_PRIVATE" && keys(v, ["action", "request_ref", "revision", "expected_content_sha256"]) && v.revision === 1) return v as unknown as SharingRequestCommand;
    return null;
  } catch { return null; }
}
async function requestCall(db: SharingDb, name: string, args: Record<string, string>, selected: SharingRequestSelection, mutating: boolean): Promise<SharingResult<SharingRequestRecord>> {
  try {
    const result = await db.rpc(name, args);
    if (result.error) return { ok: false, code: result.error.code === "42501" ? "denied" : result.error.code === "40001" ? "conflict" : ["22023", "22P02"].includes(result.error.code ?? "") ? "invalid_input" : mutating ? "effect_unknown" : "unavailable" };
    const value = decodeSharingRequestRecord(result.data, selected);
    return value ? { ok: true, value } : { ok: false, code: mutating ? "effect_unknown" : "unavailable" };
  } catch { return { ok: false, code: mutating ? "effect_unknown" : "unavailable" }; }
}
export function readSharingRequest(db: SharingDb, selected: SharingRequestSelection) {
  if (!uuid(selected.delivery_id) || !uuid(selected.request_ref) || selected.revision !== 1) return Promise.resolve<SharingResult<SharingRequestRecord>>({ ok: false, code: "invalid_input" });
  return requestCall(db, "read_brief_sharing_request", { p_delivery_id: selected.delivery_id, p_request_ref: selected.request_ref, p_revision: "1" }, selected, false);
}
export async function executeSharingRequest(db: SharingDb, deliveryId: string, command: SharingRequestCommand): Promise<SharingResult<SharingRequestRecord>> {
  if (!uuid(deliveryId) || !parseSharingRequestCommand(JSON.stringify(command))) return { ok: false, code: "invalid_input" };
  const selected: SharingRequestSelection = { delivery_id: deliveryId, request_ref: command.request_ref, revision: 1 };
  const args: Record<string, string> = { p_delivery_id: deliveryId, p_request_ref: command.request_ref, p_expected_content_sha256: command.expected_content_sha256 };
  if (command.action === "ISSUE") args.p_team_id = command.team_id;
  else args.p_revision = "1";
  if (command.action === "SHARE") args.p_expected_effect_sha256 = command.expected_effect_sha256;
  const result = await requestCall(db, command.action === "ISSUE" ? "issue_brief_sharing_request" : command.action === "SHARE" ? "share_requested_brief" : "keep_requested_brief_private", args, selected, true);
  if (!result.ok) return result;
  const v = result.value;
  if (v.review.delivery.content_sha256 !== command.expected_content_sha256 || (command.action === "ISSUE" && v.review.audience.team_id !== command.team_id) || (command.action === "SHARE" && (v.disposition !== "SHARED" || v.review.expected_effect_sha256 !== command.expected_effect_sha256 || v.review.grant?.effect_sha256 !== command.expected_effect_sha256)) || (command.action === "KEEP_PRIVATE" && v.disposition !== "KEPT_PRIVATE")) return { ok: false, code: "effect_unknown" };
  return result;
}
