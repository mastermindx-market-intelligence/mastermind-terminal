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
const title = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 240 && !/[\u0000-\u001f\u007f]/.test(v);
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
