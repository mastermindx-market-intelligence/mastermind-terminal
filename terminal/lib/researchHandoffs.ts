// Pinned research handoff client (packet b-f12-handoff-consumer).
//
// The ONE typed description of `/api/research-handoffs` for browser code. Mirrors
// `lib/investigations.ts`: every response body is validated field-by-field and anything that
// does not match the accepted contract — a missing field, a wrong type, an unknown field, a
// non-JSON content type — becomes `unavailable`, never a partial object and never raw error
// text. The route is the same convention: private, no-store, Vary: Cookie on every response
// including failures.
//
// Owner binding: every request carries `x-mm-handoff-owner: <identity.userId>`. The server
// compares it with the authenticated session and answers 409 `owner_changed` on any mismatch,
// which is what closes the cookie-owner race when two accounts share a browser tab. Only the
// uuid crosses this boundary — never the email.
//
// List paging: `sent` and `received` are each a 200-row keyset page over the caller's grant
// UUIDs, ascending, paged independently by the opaque grant-UUID cursors the route returns. A
// cursor is a position, not authority: it names nothing the session cannot already see. The
// client validates the page metadata as strictly as the rows — a trailing cursor that is not a
// full page ending at the last row, a cursor-shaped-but-wrong value, an unsorted or duplicated
// page is `unavailable`, never a silently complete read.

// The typed scenario reference rides only on an opted-in read DTO and is validated through the
// pure leaf module's parser -- never re-implemented or coerced here. It is unresolved input
// metadata: not a retention, entitlement or source-availability claim, and never stored
// basis/result values.
import { parseScenarioCapture, type ScenarioCapture } from "./investigationScenario";

export type HandoffSummary = {
  grantId: string;
  investigationId: string;
  revision: number;
  title: string;
  sharedBy: string;
  granteeUserId: string;
  createdAt: string;
  /** Present (always true) only on an opted-in scenario row; absent -- never false -- on a
   *  plain row, whose payload keyset stays exactly the 0041 one. */
  scenarioIncluded?: true;
};

export type HandoffOwnItem = { id: string; revision: number; title: string };

export type HandoffListResult =
  | {
      status: "listed";
      own: HandoffOwnItem[];
      sent: HandoffSummary[];
      received: HandoffSummary[];
      /** Grant-UUID seek position per collection, or null when that collection has no more
       *  known rows. Absent metadata is not "complete" — a malformed body is unavailable. */
      sentNextCursor: string | null;
      receivedNextCursor: string | null;
    }
  | { status: "unauthenticated" }
  | { status: "unavailable" };

/** Per-collection seek for the next list page. Both keys are optional and independent. */
export type HandoffListQuery = { sentAfter?: string; receivedAfter?: string };

export type HandoffReadPayload = {
  schema: "mm.research_handoff.v1";
  grantId: string;
  investigationId: string;
  revision: number;
  sharedBy: string;
  committedAt: string;
  intent: { title: string; question: string };
  continuation: { nextQuestion?: string; nextObservation?: string };
  /** The pinned revision's stored typed scenario reference; present only on an opted-in
   *  same-pinned-revision grant, and only after the pure module re-derives it. */
  scenarioCapture?: ScenarioCapture;
};

export type HandoffReadResult =
  | { status: "found"; handoff: HandoffReadPayload }
  | { status: "unauthenticated" | "not_found" | "unavailable" };

export type HandoffShareResult =
  | { status: "created" | "already_shared"; handoff: HandoffSummary }
  | { status: "share_conflict" | "invalid_payload" | "unauthenticated" | "not_found" | "unavailable" };

export type HandoffRevokeResult =
  | { status: "revoked" }
  | { status: "unauthenticated" | "not_found" | "unavailable" };

export type HandoffOwnerChange = { status: "owner_changed" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HANDOFF_ROUTE = "/api/research-handoffs";
export const HANDOFF_OWNER_HEADER = "x-mm-handoff-owner";
export const HANDOFF_SCHEMA_V1 = "mm.research_handoff.v1";

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const isIso = (v: unknown): v is string => typeof v === "string" && v.length > 0 && Number.isFinite(Date.parse(v));
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));

function parseSummary(v: unknown): HandoffSummary | null {
  const summaryKeys = ["grant_id", "investigation_id", "revision", "title", "shared_by", "grantee_user_id", "created_at"] as const;
  if (!isPlainObject(v)) return null;
  // Exactly the plain seven-key summary, or the same seven keys plus `scenario_included: true`
  // on an opted-in row. Any other key set -- including `scenario_included: false`, which the
  // SQL never emits -- is refused, never coerced.
  const optedIn = exactKeys(v, [...summaryKeys, "scenario_included"]) && v.scenario_included === true;
  if (!optedIn && !exactKeys(v, summaryKeys)) return null;
  if (!isUuid(v.grant_id) || !isUuid(v.investigation_id) || !isUuid(v.shared_by) || !isUuid(v.grantee_user_id)) return null;
  if (!isPosInt(v.revision) || typeof v.title !== "string" || !isIso(v.created_at)) return null;
  return {
    grantId: v.grant_id,
    investigationId: v.investigation_id,
    revision: v.revision,
    title: v.title,
    sharedBy: v.shared_by,
    granteeUserId: v.grantee_user_id,
    createdAt: v.created_at,
    ...(optedIn ? { scenarioIncluded: true as const } : {}),
  };
}

/** One keyset page of SUMMARY rows: bounded, strictly ascending by grant UUID, entirely past
 *  the requested cursor, and a trailing cursor ONLY when the page is exactly full and equals
 *  the last row. A partial page with a cursor could not have
 *  come from the paging RPC, so it is refused rather than read as a completed list. */
function parsePage(raw: unknown, cursor: unknown, requestedAfter: string | null): { rows: HandoffSummary[]; nextCursor: string | null } | null {
  if (!Array.isArray(raw) || raw.length > 200) return null;
  const rows: HandoffSummary[] = [];
  let last = "";
  for (const item of raw) {
    const parsed = parseSummary(item);
    if (!parsed) return null;
    const id = parsed.grantId.toLowerCase();
    if (id <= last) return null; // duplicate or non-ascending: never a page
    if (requestedAfter !== null && id <= requestedAfter) return null; // the seek was ignored
    rows.push(parsed);
    last = id;
  }
  if (cursor === null) return { rows, nextCursor: null };
  if (!isUuid(cursor) || rows.length !== 200
      || rows[rows.length - 1].grantId.toLowerCase() !== cursor.toLowerCase()) return null;
  return { rows, nextCursor: cursor.toLowerCase() };
}

function parseList(v: unknown, sentAfter: string | null, receivedAfter: string | null): HandoffListResult {
  if (!isPlainObject(v) || v.status !== "listed"
      || !exactKeys(v, ["status", "own", "sent", "received", "sent_next_cursor", "received_next_cursor"])) {
    return { status: "unavailable" };
  }
  const ownRaw = v.own;
  if (!Array.isArray(ownRaw) || ownRaw.length > 500) return { status: "unavailable" };
  const own: HandoffOwnItem[] = [];
  const ownIds = new Set<string>();
  for (const item of ownRaw) {
    if (!isPlainObject(item) || !exactKeys(item, ["id", "revision", "title"])) return { status: "unavailable" };
    if (!isUuid(item.id) || !isPosInt(item.revision) || typeof item.title !== "string") return { status: "unavailable" };
    if (ownIds.has(item.id.toLowerCase())) return { status: "unavailable" };
    ownIds.add(item.id.toLowerCase());
    own.push({ id: item.id, revision: item.revision, title: item.title });
  }
  const sent = parsePage(v.sent, v.sent_next_cursor, sentAfter);
  if (!sent) return { status: "unavailable" };
  const received = parsePage(v.received, v.received_next_cursor, receivedAfter);
  if (!received) return { status: "unavailable" };
  return {
    status: "listed",
    own,
    sent: sent.rows,
    received: received.rows,
    sentNextCursor: sent.nextCursor,
    receivedNextCursor: received.nextCursor,
  };
}

function parseRead(v: unknown): HandoffReadResult {
  if (!isPlainObject(v)) return { status: "unavailable" };
  if (v.status === "not_found" && exactKeys(v, ["status"])) return { status: "not_found" };
  if (v.status !== "found" || !exactKeys(v, ["status", "handoff"]) || !isPlainObject(v.handoff)) return { status: "unavailable" };
  const h = v.handoff;
  const readKeys = ["schema", "grant_id", "investigation_id", "revision", "shared_by", "committed_at", "intent", "continuation"] as const;
  if (!isPlainObject(h)) return { status: "unavailable" };
  // Exactly the plain eight-key read DTO, or the same eight keys plus `scenario_capture` on an
  // opted-in same-pinned-revision grant. Any other key set is unavailable, never a partial read.
  const withCapture = exactKeys(h, [...readKeys, "scenario_capture"]);
  if (!withCapture && !exactKeys(h, readKeys)) return { status: "unavailable" };
  if (h.schema !== HANDOFF_SCHEMA_V1 || !isUuid(h.grant_id) || !isUuid(h.investigation_id) || !isUuid(h.shared_by)) {
    return { status: "unavailable" };
  }
  if (!isPosInt(h.revision) || !isIso(h.committed_at)) return { status: "unavailable" };
  const intent = h.intent;
  if (!isPlainObject(intent) || !exactKeys(intent, ["title", "question"])) return { status: "unavailable" };
  if (typeof intent.title !== "string" || typeof intent.question !== "string") return { status: "unavailable" };
  const continuationRaw = h.continuation;
  if (!isPlainObject(continuationRaw)) return { status: "unavailable" };
  const contKeys = Object.keys(continuationRaw);
  if (contKeys.length > 2 || contKeys.some((k) => k !== "next_question" && k !== "next_observation")) {
    return { status: "unavailable" };
  }
  const nextQuestion = continuationRaw.next_question;
  const nextObservation = continuationRaw.next_observation;
  if (nextQuestion !== undefined && typeof nextQuestion !== "string") return { status: "unavailable" };
  if (nextObservation !== undefined && typeof nextObservation !== "string") return { status: "unavailable" };
  const continuation: HandoffReadPayload["continuation"] = {};
  if (typeof nextQuestion === "string") continuation.nextQuestion = nextQuestion;
  if (typeof nextObservation === "string") continuation.nextObservation = nextObservation;
  let scenarioCapture: ScenarioCapture | undefined;
  if (withCapture) {
    // A malformed, forged, superseded-full-value or unknown stored reference makes the whole
    // read unavailable -- never a partial object and never a coerced value. The parsed value is
    // reference metadata only: it claims no retention, entitlement or source availability.
    const capture = parseScenarioCapture(h.scenario_capture);
    if (!capture) return { status: "unavailable" };
    scenarioCapture = capture;
  }
  return {
    status: "found",
    handoff: {
      schema: HANDOFF_SCHEMA_V1,
      grantId: h.grant_id,
      investigationId: h.investigation_id,
      revision: h.revision,
      sharedBy: h.shared_by,
      committedAt: h.committed_at,
      intent: { title: intent.title, question: intent.question },
      continuation,
      ...(scenarioCapture ? { scenarioCapture } : {}),
    },
  };
}

/** Transport result shared by every call: the HTTP status is kept beside the parsed outcome so a
 *  caller can distinguish "confirmed gone" (404) from "a failed refresh says nothing". */
export type HandoffResponse<T> = { httpStatus: number; result: T };

class OwnerChangedError extends Error {
  constructor() {
    super("owner_changed");
  }
}

function isOwnerChanged(v: unknown): v is HandoffOwnerChange {
  return isPlainObject(v) && v.status === "owner_changed" && exactKeys(v, ["status"]);
}

async function call<T>(
  userId: string,
  init: RequestInit,
  parse: (body: unknown, httpStatus: number) => T,
  path: string = HANDOFF_ROUTE,
): Promise<HandoffResponse<T>> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set(HANDOFF_OWNER_HEADER, userId);
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, cache: "no-store", redirect: "error", credentials: "same-origin" });
  } catch {
    // A transport failure is not a server answer: the caller must not read state from it.
    return { httpStatus: 0, result: parse({ status: "unavailable" }, 0) };
  }
  const contentType = response.headers.get("content-type") ?? "";
  let body: unknown = undefined;
  if (contentType.includes("application/json")) {
    body = await response.json().catch(() => undefined);
  }
  if (response.status === 409 && isOwnerChanged(body)) {
    throw new OwnerChangedError();
  }
  return { httpStatus: response.status, result: parse(body, response.status) };
}

export function isHandoffOwnerChangeError(error: unknown): error is OwnerChangedError {
  return error instanceof OwnerChangedError;
}

/** Absent → null; a well-formed UUID → its lowercase form; anything else → false, so a
 *  malformed cursor is refused here and never reaches the wire — the same pre-wire refusal a
 *  malformed grant id gets, because a seek position is a client-side value too. */
function normalizeCursor(value: string | undefined): string | null | false {
  if (value === undefined) return null;
  if (typeof value !== "string" || !isUuid(value)) return false;
  return value.toLowerCase();
}

/** GET — the list RPC. Without options this is the first page of both collections; a
 *  `sentAfter`/`receivedAfter` cursor seeks that one collection's next page, independently.
 *  No retries: the caller re-reads on explicit reload. */
export function listHandoffs(userId: string, options?: HandoffListQuery): Promise<HandoffResponse<HandoffListResult>> {
  const sentAfter = normalizeCursor(options?.sentAfter);
  const receivedAfter = normalizeCursor(options?.receivedAfter);
  if (sentAfter === false || receivedAfter === false) {
    return Promise.resolve({ httpStatus: 0, result: { status: "unavailable" } });
  }
  const query = new URLSearchParams();
  if (sentAfter !== null) query.set("sent_after", sentAfter);
  if (receivedAfter !== null) query.set("received_after", receivedAfter);
  const qs = query.toString();
  return call(
    userId,
    { method: "GET", headers: {} },
    (body, httpStatus) => {
      if (httpStatus === 401 && isPlainObject(body) && body.status === "unauthenticated") return { status: "unauthenticated" };
      if (httpStatus === 503 && isPlainObject(body) && body.status === "unavailable") return { status: "unavailable" };
      if (httpStatus === 200) return parseList(body, sentAfter, receivedAfter);
      return { status: "unavailable" };
    },
    qs ? `${HANDOFF_ROUTE}?${qs}` : HANDOFF_ROUTE,
  );
}

/** GET ?grant_id=<uuid> — the recipient's pinned read. A confirmed 404 clears view state. */
export async function readHandoff(userId: string, grantId: string): Promise<HandoffResponse<HandoffReadResult>> {
  // A malformed id never reaches the wire: there is nothing a server could say about it that
  // this module cannot say for itself.
  if (!isUuid(grantId)) return { httpStatus: 0, result: { status: "unavailable" } };
  return call(
    userId,
    { method: "GET", headers: {} },
    (body, httpStatus) => {
      if (httpStatus === 401 && isPlainObject(body) && body.status === "unauthenticated") return { status: "unauthenticated" };
      if (httpStatus === 404 && isPlainObject(body) && body.status === "not_found") return { status: "not_found" };
      if (httpStatus === 503 && isPlainObject(body) && body.status === "unavailable") return { status: "unavailable" };
      if (httpStatus === 200) return parseRead(body);
      return { status: "unavailable" };
    },
    `${HANDOFF_ROUTE}?grant_id=${encodeURIComponent(grantId.toLowerCase())}`,
  );
}

/** POST {investigation_id, revision, grantee_user_id} — the create RPC. */
export function shareHandoff(
  userId: string,
  input: {
    investigationId: string;
    revision: number;
    granteeUserId: string;
    /** Opt the share into carrying the pinned revision's typed scenario reference: the request
     *  routes to the scenario create RPC. Absent or false is the exact plain 0041 share -- the
     *  body then never names the flag at all. The choice is owner read protocol only: it
     *  claims no entitlement and no source availability. */
    includeScenario?: boolean;
  },
): Promise<HandoffResponse<HandoffShareResult>> {
  const payload: {
    investigation_id: string;
    revision: number;
    grantee_user_id: string;
    include_scenario?: true;
  } = {
    investigation_id: input.investigationId,
    revision: input.revision,
    grantee_user_id: input.granteeUserId,
  };
  if (input.includeScenario === true) payload.include_scenario = true;
  return call(
    userId,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    (body, httpStatus) => {
      if (!isPlainObject(body)) return { status: "unavailable" };
      if (body.status === "created" || body.status === "already_shared") {
        if (!exactKeys(body, ["status", "handoff"]) ||
            (body.status === "created" ? httpStatus !== 201 : httpStatus !== 200)) return { status: "unavailable" };
        const handoff = parseSummary(body.handoff);
        return handoff ? { status: body.status, handoff } : { status: "unavailable" };
      }
      if (!exactKeys(body, ["status"])) return { status: "unavailable" };
      if (body.status === "unauthenticated" && httpStatus === 401) return { status: "unauthenticated" };
      if (body.status === "not_found" && httpStatus === 404) return { status: "not_found" };
      if (body.status === "share_conflict" && httpStatus === 409) return { status: "share_conflict" };
      if (body.status === "invalid_payload" && httpStatus === 400) return { status: "invalid_payload" };
      return { status: "unavailable" };
    },
  );
}

/** DELETE {grant_id} — the revoke RPC. Terminal on the owner side: never regranted. */
export function revokeHandoff(userId: string, grantId: string): Promise<HandoffResponse<HandoffRevokeResult>> {
  return call(
    userId,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_id: grantId }),
    },
    (body, httpStatus) => {
      if (isPlainObject(body) && body.status === "revoked" && (httpStatus === 200 || httpStatus === 204)) {
        return { status: "revoked" };
      }
      if (httpStatus === 401 && isPlainObject(body) && body.status === "unauthenticated") return { status: "unauthenticated" };
      if (httpStatus === 404 && isPlainObject(body) && body.status === "not_found") return { status: "not_found" };
      if (httpStatus === 503 && isPlainObject(body) && body.status === "unavailable") return { status: "unavailable" };
      return { status: "unavailable" };
    },
  );
}
