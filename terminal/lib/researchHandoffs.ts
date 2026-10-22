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

export type HandoffSummary = {
  grantId: string;
  investigationId: string;
  revision: number;
  title: string;
  sharedBy: string;
  granteeUserId: string;
  createdAt: string;
};

export type HandoffOwnItem = { id: string; revision: number; title: string };

export type HandoffListResult =
  | {
      status: "listed";
      own: HandoffOwnItem[];
      sent: HandoffSummary[];
      received: HandoffSummary[];
    }
  | { status: "unauthenticated" }
  | { status: "unavailable" };

export type HandoffReadPayload = {
  schema: "mm.research_handoff.v1";
  grantId: string;
  investigationId: string;
  revision: number;
  sharedBy: string;
  committedAt: string;
  intent: { title: string; question: string };
  continuation: { nextQuestion?: string; nextObservation?: string };
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
  if (!isPlainObject(v) || !exactKeys(v, ["grant_id", "investigation_id", "revision", "title", "shared_by", "grantee_user_id", "created_at"])) return null;
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
  };
}

function parseList(v: unknown): HandoffListResult {
  if (!isPlainObject(v) || v.status !== "listed" || !exactKeys(v, ["status", "own", "sent", "received"])) return { status: "unavailable" };
  const ownRaw = v.own;
  const sentRaw = v.sent;
  const receivedRaw = v.received;
  if (!Array.isArray(ownRaw) || !Array.isArray(sentRaw) || !Array.isArray(receivedRaw)) return { status: "unavailable" };
  if (ownRaw.length > 500 || sentRaw.length > 200 || receivedRaw.length > 200) return { status: "unavailable" };
  const own: HandoffOwnItem[] = [];
  for (const item of ownRaw) {
    if (!isPlainObject(item) || !exactKeys(item, ["id", "revision", "title"])) return { status: "unavailable" };
    if (!isUuid(item.id) || !isPosInt(item.revision) || typeof item.title !== "string") return { status: "unavailable" };
    own.push({ id: item.id, revision: item.revision, title: item.title });
  }
  const sent: HandoffSummary[] = [];
  for (const item of sentRaw) {
    const parsed = parseSummary(item);
    if (!parsed) return { status: "unavailable" };
    sent.push(parsed);
  }
  const received: HandoffSummary[] = [];
  for (const item of receivedRaw) {
    const parsed = parseSummary(item);
    if (!parsed) return { status: "unavailable" };
    received.push(parsed);
  }
  return { status: "listed", own, sent, received };
}

function parseRead(v: unknown): HandoffReadResult {
  if (!isPlainObject(v)) return { status: "unavailable" };
  if (v.status === "not_found" && exactKeys(v, ["status"])) return { status: "not_found" };
  if (v.status !== "found" || !exactKeys(v, ["status", "handoff"]) || !isPlainObject(v.handoff)) return { status: "unavailable" };
  const h = v.handoff;
  if (!isPlainObject(h) || !exactKeys(h, ["schema", "grant_id", "investigation_id", "revision", "shared_by", "committed_at", "intent", "continuation"])) {
    return { status: "unavailable" };
  }
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

/** GET without a query — the list RPC. No retries: the caller re-reads on explicit reload. */
export function listHandoffs(userId: string): Promise<HandoffResponse<HandoffListResult>> {
  return call(
    userId,
    { method: "GET", headers: {} },
    (body, httpStatus) => {
      if (httpStatus === 401 && isPlainObject(body) && body.status === "unauthenticated") return { status: "unauthenticated" };
      if (httpStatus === 503 && isPlainObject(body) && body.status === "unavailable") return { status: "unavailable" };
      if (httpStatus === 200) return parseList(body);
      return { status: "unavailable" };
    },
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
  input: { investigationId: string; revision: number; granteeUserId: string },
): Promise<HandoffResponse<HandoffShareResult>> {
  const payload = {
    investigation_id: input.investigationId,
    revision: input.revision,
    grantee_user_id: input.granteeUserId,
  };
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
