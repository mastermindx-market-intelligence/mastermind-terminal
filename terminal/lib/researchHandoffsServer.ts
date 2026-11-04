// Pinned research handoff route handlers (packet b-f12-handoff-consumer).
//
// The transport-thin core behind `app/api/research-handoffs/route.ts`: the session/RPC
// dependency is injected so a controlled test can drive the REAL handlers over loopback HTTP
// with synthetic principals, exactly the shape the production route runs. The route itself
// stays Next-only (runtime export, NextResponse wrapping, rate limiting); everything
// decidable here — auth ordering, the owner header, query/body strictness, status mapping —
// lives here.
//
// Ordering is frozen: authenticate (auth.getUser on the cookie client — never the service
// client), then the mandatory `x-mm-handoff-owner` binding, then shape validation, then
// effects. The owner header is what closes the cookie-owner race: a tab whose session has
// switched accounts cannot act on, or even read, the previous account's handoffs. Its value
// must equal the authenticated user id; a mismatched, absent or malformed header answers 409
// `owner_changed`, and that body NEVER names the current owner.
//
// Every failure is one of the closed status set; raw RPC/Postgres error text is never
// forwarded. An RPC error, a null result and a body that fails its shape check all answer 503
// `unavailable` — same convention as `lib/investigations.ts`.

// The typed scenario reference is accepted only through the pure leaf module's parser -- never
// re-implemented or coerced here. It is unresolved input metadata: not a retention, entitlement
// or source-availability claim, and never stored basis/result values.
import { parseScenarioCapture } from "./investigationScenario";

export type HandoffUser = { id?: string | null };

export type HandoffRpcDb = {
  auth: { getUser(): PromiseLike<{ data: { user: HandoffUser | null } | null; error: unknown }> };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export type HandoffHandlerResponse = { status: number; body: Record<string, unknown> };

export type HandoffRequestLike = {
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

export type HandoffHandlerDeps = {
  /** Session-scoped Supabase cookie client, built per request as `createClient()` does. */
  db: () => PromiseLike<HandoffRpcDb | null>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER_HEADER = "x-mm-handoff-owner";
const HANDOFF_SCHEMA_V1 = "mm.research_handoff.v1";

const OWNER_CHANGED: HandoffHandlerResponse = { status: 409, body: { status: "owner_changed" } };
const UNAUTH: HandoffHandlerResponse = { status: 401, body: { status: "unauthenticated" } };
const BAD: HandoffHandlerResponse = { status: 400, body: { status: "invalid_payload" } };
const TOO_BIG: HandoffHandlerResponse = { status: 413, body: { status: "invalid_payload" } };
const NOT_FOUND: HandoffHandlerResponse = { status: 404, body: { status: "not_found" } };
const CONFLICT: HandoffHandlerResponse = { status: 409, body: { status: "share_conflict" } };
const UNAVAILABLE: HandoffHandlerResponse = { status: 503, body: { status: "unavailable" } };
const REVOKED: HandoffHandlerResponse = { status: 200, body: { status: "revoked" } };
const CREATED_OK = "created";
const ALREADY_OK = "already_shared";

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const isIso = (v: unknown): v is string => typeof v === "string" && v.length > 0 && Number.isFinite(Date.parse(v));
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));

type SummaryRaw = {
  status?: string;
  grant_id: string;
  investigation_id: string;
  revision: number;
  title: string;
  shared_by: string;
  grantee_user_id: string;
  created_at: string;
  scenario_included?: true;
};

function summary(v: unknown): SummaryRaw | null {
  const summaryKeys = ["grant_id", "investigation_id", "revision", "title", "shared_by", "grantee_user_id", "created_at"] as const;
  if (!record(v)) return null;
  // Exactly the plain seven-key summary, or the same seven keys plus `scenario_included: true`
  // on an opted-in row. Any other key set -- including `scenario_included: false`, which the
  // SQL never emits -- is refused rather than read as a summary.
  const optedIn = exact(v, [...summaryKeys, "scenario_included"]) && v.scenario_included === true;
  if (!optedIn && !exact(v, summaryKeys)) return null;
  if (!isUuid(v.grant_id) || !isUuid(v.investigation_id) || !isUuid(v.shared_by) || !isUuid(v.grantee_user_id)) return null;
  if (!isPosInt(v.revision) || typeof v.title !== "string" || !isIso(v.created_at)) return null;
  return v as SummaryRaw;
}

/** Bound, shape and keyset discipline for one SUMMARY page: strictly ascending grant UUIDs,
 *  entirely past the requested cursor, and a trailing cursor only when the page is exactly
 *  full and equals the last row. A partial page with a cursor
 *  could not have come from the paging RPC, so the whole body is refused rather than
 *  truncated or read as complete. */
function pageOk(raw: unknown, cursor: unknown, requestedAfter: string | null): boolean {
  if (!Array.isArray(raw) || raw.length > 200) return false;
  let last = "";
  for (const item of raw) {
    const row = summary(item);
    if (!row) return false;
    const id = row.grant_id.toLowerCase();
    if (id <= last) return false;
    if (requestedAfter !== null && id <= requestedAfter) return false;
    last = id;
  }
  if (cursor === null) return true;
  return isUuid(cursor) && raw.length === 200
    && (raw[raw.length - 1] as SummaryRaw).grant_id.toLowerCase() === (cursor as string).toLowerCase();
}

function listPayload(v: unknown, sentAfter: string | null, receivedAfter: string | null): Record<string, unknown> | null {
  if (!record(v) || v.status !== "listed"
      || !exact(v, ["status", "own", "sent", "received", "sent_next_cursor", "received_next_cursor"])) return null;
  const own = v.own;
  if (!Array.isArray(own) || own.length > 500) return null;
  const seenOwn = new Set<string>();
  for (const item of own) {
    if (!record(item) || !exact(item, ["id", "revision", "title"])) return null;
    if (!isUuid(item.id) || !isPosInt(item.revision) || typeof item.title !== "string") return null;
    const id = item.id.toLowerCase();
    if (seenOwn.has(id)) return null;
    seenOwn.add(id);
  }
  // Bound discipline is the RPC's job; here only reject a body that could not have come from
  // it (over-bound, unsorted or cursor-inconsistent means a broken or hostile source, never a
  // truncatable success or a false "complete").
  if (!pageOk(v.sent, v.sent_next_cursor, sentAfter)) return null;
  if (!pageOk(v.received, v.received_next_cursor, receivedAfter)) return null;
  return v;
}

function readPayload(v: unknown): Record<string, unknown> | null {
  if (!record(v) || v.status !== "found" || !exact(v, ["status", "handoff"]) || !record(v.handoff)) return null;
  const h = v.handoff;
  const readKeys = ["schema", "grant_id", "investigation_id", "revision", "shared_by", "committed_at", "intent", "continuation"] as const;
  // Exactly the plain eight-key read DTO, or the same eight keys plus `scenario_capture` on an
  // opted-in same-pinned-revision grant. Any other key set is refused, never truncated.
  const withCapture = exact(h, [...readKeys, "scenario_capture"]);
  if (!withCapture && !exact(h, readKeys)) return null;
  if (h.schema !== HANDOFF_SCHEMA_V1 || !isUuid(h.grant_id) || !isUuid(h.investigation_id) || !isUuid(h.shared_by)) return null;
  if (!isPosInt(h.revision) || !isIso(h.committed_at)) return null;
  const intent = h.intent;
  if (!record(intent) || !exact(intent, ["title", "question"])) return null;
  if (typeof intent.title !== "string" || typeof intent.question !== "string") return null;
  const continuation = h.continuation;
  if (!record(continuation)) return null;
  const keys = Object.keys(continuation);
  if (keys.length > 2 || keys.some((k) => k !== "next_question" && k !== "next_observation")) return null;
  if (continuation.next_question !== undefined && typeof continuation.next_question !== "string") return null;
  if (continuation.next_observation !== undefined && typeof continuation.next_observation !== "string") return null;
  // The stored typed reference is accepted only when the pure module re-derives it: a malformed,
  // forged or superseded full-value payload makes the whole read unavailable, never a truncated
  // success. The value is reference metadata only.
  if (withCapture && !parseScenarioCapture(h.scenario_capture)) return null;
  return v;
}

function dbOk(value: HandoffRpcDb | null): value is HandoffRpcDb {
  return !!value && typeof value.rpc === "function" && !!value.auth && typeof value.auth.getUser === "function";
}

/** The single auth gate: session first, then the owner binding. An absent session, an auth
 *  error, a malformed principal and a session-client construction failure all read as
 *  `unauthenticated`; the header is only judged against a real id. */
async function gate(request: { headers: { get(name: string): string | null } }, deps: HandoffHandlerDeps): Promise<{ db: HandoffRpcDb; userId: string } | HandoffHandlerResponse> {
  let db: HandoffRpcDb;
  try {
    const built = await deps.db();
    if (!dbOk(built)) return UNAUTH;
    db = built;
  } catch {
    return UNAUTH;
  }
  let userId = "";
  try {
    const { data, error } = await db.auth.getUser();
    if (error) return UNAUTH;
    const id = data?.user?.id;
    userId = typeof id === "string" ? id.toLowerCase() : "";
  } catch {
    return UNAUTH;
  }
  if (!isUuid(userId)) return UNAUTH;
  const claimed = request.headers.get(OWNER_HEADER)?.trim().toLowerCase() ?? "";
  if (!isUuid(claimed) || claimed !== userId) return OWNER_CHANGED;
  return { db, userId };
}

function jsonOk(request: HandoffRequestLike): boolean {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "application/json";
}

const MAX_BODY_BYTES = 8 * 1024;

async function readBody(request: HandoffRequestLike): Promise<Record<string, unknown> | null> {
  const stated = Number(request.headers.get("content-length"));
  if (Number.isFinite(stated) && stated > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return record(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const rpcMiss = (error: unknown, data: unknown): boolean => !!error || data === null || data === undefined;

/** The list read, first page or a seek. The RPC is always called with BOTH named cursor
 *  arguments, explicitly NULL when absent — never positionally, so an upgraded database can
 *  never bind a page request to the wrong parameter. */
async function listThrough(
  auth: { db: HandoffRpcDb; userId: string },
  sentAfter: string | null,
  receivedAfter: string | null,
): Promise<HandoffHandlerResponse> {
  const { data, error } = await auth.db.rpc("list_investigation_handoffs_v1", {
    p_sent_after: sentAfter,
    p_received_after: receivedAfter,
  });
  if (rpcMiss(error, data)) return UNAVAILABLE;
  const payload = listPayload(data, sentAfter, receivedAfter);
  if (!payload) return UNAVAILABLE;
  // Actor binding holds on every page: a row the caller did not send or receive breaks the
  // whole answer, the same as on the first page.
  if (!(payload.sent as SummaryRaw[]).every(row => row.shared_by === auth.userId)
      || !(payload.received as SummaryRaw[]).every(row => row.grantee_user_id === auth.userId)) return UNAVAILABLE;
  return { status: 200, body: payload };
}

/** A present-but-malformed cursor value is a client error, not an empty page. */
function cursorParam(params: URLSearchParams, key: "sent_after" | "received_after"): { value: string | null } | null {
  const raw = params.get(key);
  if (raw === null) return { value: null };
  const value = raw.trim().toLowerCase();
  return isUuid(value) ? { value } : null;
}

/** GET: no query lists the first page; `sent_after` and/or `received_after` seek each
 *  collection's next page; exactly `?grant_id=<uuid>` reads one handoff. Duplicate keys,
 *  unknown keys, grant_id/paging mixes and malformed cursor values are a 400, never silently
 *  ignored. */
export async function handleHandoffGet(request: HandoffRequestLike, deps: HandoffHandlerDeps): Promise<HandoffHandlerResponse> {
  try {
    const auth = await gate(request, deps);
    if ("status" in auth) return auth;
    const params = new URL(request.url).searchParams;
    const keys = [...params.keys()];
    const unique = new Set(keys).size === keys.length;
    const isPageKey = (key: string): boolean => key === "sent_after" || key === "received_after";
    if (keys.length === 0) return await listThrough(auth, null, null);
    if (unique && keys.every(isPageKey)) {
      const sent = cursorParam(params, "sent_after");
      const received = cursorParam(params, "received_after");
      if (!sent || !received) return BAD;
      return await listThrough(auth, sent.value, received.value);
    }
    if (keys.length !== 1 || keys[0] !== "grant_id") return BAD;
    const grantId = params.get("grant_id") ?? "";
    if (!isUuid(grantId)) return BAD;
    const { data, error } = await auth.db.rpc("read_investigation_handoff_v1", { p_grant_id: grantId.toLowerCase() });
    if (rpcMiss(error, data)) return UNAVAILABLE;
    if (record(data) && data.status === "not_found" && exact(data, ["status"])) return NOT_FOUND;
    const payload = readPayload(data);
    return payload && (payload.handoff as Record<string, unknown>).grant_id === grantId.toLowerCase()
      ? { status: 200, body: payload } : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

/** POST {investigation_id, revision, grantee_user_id} — the create RPC. */
export async function handleHandoffPost(request: HandoffRequestLike, deps: HandoffHandlerDeps): Promise<HandoffHandlerResponse> {
  try {
    const auth = await gate(request, deps);
    if ("status" in auth) return auth;
    if (!jsonOk(request)) return BAD;
    const body = await readBody(request);
    if (body === null) return TOO_BIG_OR_BAD(request);
    const createKeys = ["investigation_id", "revision", "grantee_user_id"] as const;
    if (!exact(body, createKeys) && !exact(body, [...createKeys, "include_scenario"])) return BAD;
    // An absent or false flag is the exact plain share (routing to the plain create RPC, the
    // body never naming the flag); a present flag must be the boolean true and routes to the
    // scenario create RPC. Any non-boolean value is a 400, never silently ignored.
    let includeScenario = false;
    if (Object.hasOwn(body, "include_scenario")) {
      if (typeof body.include_scenario !== "boolean") return BAD;
      includeScenario = body.include_scenario;
    }
    const investigationId = body.investigation_id;
    const grantee = body.grantee_user_id;
    if (!isUuid(investigationId) || !isUuid(grantee)) return BAD;
    if (!isPosInt(body.revision) || Number(body.revision) > 2147483647) return BAD;
    const { data, error } = await auth.db.rpc(
      includeScenario ? "create_investigation_scenario_handoff_v1" : "create_investigation_handoff_v1",
      {
        p_id: investigationId.toLowerCase(),
        p_revision: body.revision,
        p_grantee: grantee.toLowerCase(),
      },
    );
    if (rpcMiss(error, data)) return UNAVAILABLE;
    if (!record(data) || typeof data.status !== "string") return UNAVAILABLE;
    if (data.status === CREATED_OK || data.status === ALREADY_OK) {
      if (!exact(data, ["status", "handoff"])) return UNAVAILABLE;
      const handoff = summary(data.handoff);
      // The echo must be THE share this request named — never a stray row.
      if (!handoff || handoff.investigation_id !== investigationId.toLowerCase()
          || handoff.grantee_user_id !== grantee.toLowerCase() || handoff.shared_by !== auth.userId
          || handoff.revision !== body.revision) return UNAVAILABLE;
      // The echo must carry exactly the projection this request asked for: a scenario share
      // never converges without its flag, and a plain share never grows one.
      if (includeScenario !== (handoff.scenario_included === true)) return UNAVAILABLE;
      return { status: data.status === CREATED_OK ? 201 : 200, body: data };
    }
    if (data.status === "share_conflict" && exact(data, ["status"])) return CONFLICT;
    if (data.status === "invalid_payload" && exact(data, ["status"])) return BAD;
    if (data.status === "unauthenticated" && exact(data, ["status"])) return UNAUTH;
    if (data.status === "not_found" && exact(data, ["status"])) return NOT_FOUND;
    return UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

/** DELETE {grant_id} — the revoke RPC. Terminal on the owner side; never revived. */
export async function handleHandoffDelete(request: HandoffRequestLike, deps: HandoffHandlerDeps): Promise<HandoffHandlerResponse> {
  try {
    const auth = await gate(request, deps);
    if ("status" in auth) return auth;
    if (!jsonOk(request)) return BAD;
    const body = await readBody(request);
    if (body === null) return TOO_BIG_OR_BAD(request);
    if (!exact(body, ["grant_id"]) || !isUuid(body.grant_id)) return BAD;
    const { data, error } = await auth.db.rpc("revoke_investigation_handoff_v1", { p_grant_id: (body.grant_id as string).toLowerCase() });
    if (rpcMiss(error, data)) return UNAVAILABLE;
    if (record(data) && data.status === "revoked" && exact(data, ["status"])) return REVOKED;
    if (record(data) && data.status === "not_found" && exact(data, ["status"])) return NOT_FOUND;
    if (record(data) && data.status === "unauthenticated" && exact(data, ["status"])) return UNAUTH;
    return UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

/** A rejected body is 400 unless the content-length said so up front — a missing/oversized
 *  declaration is the one case that answers 413, matching the investigations route. */
function TOO_BIG_OR_BAD(request: HandoffRequestLike): HandoffHandlerResponse {
  const stated = Number(request.headers.get("content-length"));
  return Number.isFinite(stated) && stated > MAX_BODY_BYTES ? TOO_BIG : BAD;
}
