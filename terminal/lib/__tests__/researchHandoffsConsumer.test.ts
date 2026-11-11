import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import {
  HANDOFF_ROUTE,
  isHandoffOwnerChangeError,
  listHandoffs,
  readHandoff,
  revokeHandoff,
  shareHandoff,
} from "@/lib/researchHandoffs";

// ── Synthetic principals and a contract-faithful RPC double ─────────────────────────────────
// No real auth, DB or network beyond this process's loopback. The double implements the
// ACCEPTED RPC contract only: principal from the session, non-disclosing not_found, bounded
// lists, no raw error text. The REAL exported route handlers run over loopback HTTP and the
// REAL typed client speaks to them — nothing here stubs the code under test.

const OWNER = "11111111-1111-4111-8111-111111111111";
const GRANTEE = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const INV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_INV = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UNKNOWN_GRANT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const REVISION = 3;
const COMMITTED = "2026-10-01T12:00:00.000Z";

const state = vi.hoisted(() => ({
  user: "",
  mode: "ok" as "ok" | "rpc_error" | "storage_down" | "malformed_summary" | "malformed_read" | "extra_field" | "read_metadata" | "empty" | "partial_cursor",
  grants: [] as {
    grant_id: string;
    investigation_id: string;
    revision: number;
    title: string;
    shared_by: string;
    grantee_user_id: string;
    created_at: string;
    revoked: boolean;
  }[],
  grantSeq: 0,
  currentRevision: 3,
  // Mutation trips are switched explicitly so the 429 case is deterministic instead of
  // racing the suite's own budget; every other call passes through to the real limiter.
  tripMutations: false,
  limiterCase: 0,
  // When true, the loopback server destroys the socket AFTER the route handler (and any
  // mutation it performed) has run, so the HTTP response itself is lost — the exact
  // "committed, then the answer disappeared" transport shape the UI honesty rules cover.
  dropResponse: false,
}));

vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return {
    ...actual,
    rateLimit: (request: Request, opts: { name: string }) =>
      state.tripMutations && opts.name === "research-handoffs-mutate"
        ? { ok: false, remaining: 0, retryAfterSec: 60 }
        : actual.rateLimit(request, { ...opts, name: `${opts.name}:case-${state.limiterCase}` }),
  };
});

const OWN = [
  { id: INV, revision: REVISION, title: "Copper question" },
  { id: OTHER_INV, revision: 1, title: "Zinc question" },
];

function summaryOf(grant: (typeof state.grants)[number]) {
  return {
    grant_id: grant.grant_id,
    investigation_id: grant.investigation_id,
    revision: grant.revision,
    title: grant.title,
    shared_by: grant.shared_by,
    grantee_user_id: grant.grantee_user_id,
    created_at: grant.created_at,
  };
}

function readPayloadFor(grant: (typeof state.grants)[number]) {
  return {
    status: "found",
    handoff: {
      schema: "mm.research_handoff.v1",
      grant_id: grant.grant_id,
      investigation_id: grant.investigation_id,
      revision: grant.revision,
      shared_by: grant.shared_by,
      committed_at: COMMITTED,
      intent: { title: grant.title, question: "Is copper supply tightening into Q1?" },
      continuation: { next_question: "Check smelter margins", next_observation: "LME stocks fell 8 days running" },
    },
  };
}

// The double implements the accepted keyset page: fetch one MORE than the page in grant-UUID
// ascending order after the seek, trim the extra, and name the 200th grant only when the page
// was full. This is the RPC's contract, mirrored small — the real SQL has the same shape.
const PAGE = 200;
function pageOf(grants: (typeof state.grants)[number][], after: unknown) {
  const seek = typeof after === "string" ? after.toLowerCase() : null;
  const live = grants
    .filter((g) => !g.revoked)
    .map(summaryOf)
    .sort((a, b) => (a.grant_id < b.grant_id ? -1 : a.grant_id > b.grant_id ? 1 : 0))
    .filter((g) => seek === null || g.grant_id.toLowerCase() > seek);
  const fetched = live.slice(0, PAGE + 1);
  const rows = fetched.slice(0, PAGE);
  return {
    rows,
    next_cursor: fetched.length > PAGE ? rows[PAGE - 1].grant_id.toLowerCase() : null,
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        if (!state.user) return { data: { user: null }, error: { message: "no session (synthetic)" } };
        return { data: { user: { id: state.user } }, error: null };
      },
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (state.mode === "rpc_error") return { data: null, error: { message: "pg_secret internal detail", code: "XX000" } };
      if (state.mode === "storage_down") throw new Error("storage_secret down");
      if (fn === "list_investigation_handoffs_v1") {
        // Named-args contract: both cursors arrive explicitly, NULL for a first page.
        if (typeof args !== "object" || args === null || !("p_sent_after" in args) || !("p_received_after" in args)) {
          return { data: null, error: { message: "list_investigation_handoffs_v1 requires named cursors" } };
        }
        if (state.mode === "malformed_summary") {
          return { data: { status: "listed", own: [], sent: [{ grant_id: "x" }], received: [] }, error: null };
        }
        if (state.mode === "partial_cursor") {
          // Cursor metadata that could not have come from the paging RPC: a non-full page
          // that still claims a next page.
          return { data: { status: "listed", own: [], sent: [], received: [], sent_next_cursor: UNKNOWN_GRANT, received_next_cursor: null }, error: null };
        }
        if (state.mode === "extra_field") {
          const g = state.grants.find((x) => !x.revoked && x.grantee_user_id === state.user);
          return {
            data: {
              status: "listed",
              own: [],
              sent: g ? [{ ...summaryOf(g), raw_metadata: { email: "leak@example.com" } }] : [],
              received: [],
              sent_next_cursor: null,
              received_next_cursor: null,
            },
            error: null,
          };
        }
        if (state.mode === "empty") {
          return { data: { status: "listed", own: [], sent: [], received: [], sent_next_cursor: null, received_next_cursor: null }, error: null };
        }
        const sentPage = pageOf(state.grants.filter((g) => g.shared_by === state.user), args.p_sent_after);
        const receivedPage = pageOf(state.grants.filter((g) => g.grantee_user_id === state.user), args.p_received_after);
        return {
          data: {
            status: "listed",
            own: OWN.filter((item) => item.revision > 0 && state.user === OWNER).map(item =>
              item.id === INV ? { ...item, revision: state.currentRevision } : item),
            sent: sentPage.rows,
            received: receivedPage.rows,
            sent_next_cursor: sentPage.next_cursor,
            received_next_cursor: receivedPage.next_cursor,
          },
          error: null,
        };
      }
      if (fn === "create_investigation_handoff_v1") {
        const inv = OWN.find((item) => item.id === args.p_id
          && Number.isSafeInteger(args.p_revision) && Number(args.p_revision) > 0
          && Number(args.p_revision) <= (item.id === INV ? state.currentRevision : item.revision));
        // Only the owner's own active aggregate at the active exact revision may be granted.
        if (!inv || state.user !== OWNER) return { data: { status: "not_found" }, error: null };
        if (args.p_grantee === state.user) return { data: { status: "invalid_payload" }, error: null };
        if (args.p_grantee !== GRANTEE) return { data: { status: "not_found" }, error: null };
        const existing = state.grants.find(
          (g) => !g.revoked && g.investigation_id === args.p_id && g.grantee_user_id === args.p_grantee,
        );
        if (existing) {
          return existing.revision === args.p_revision
            ? { data: { status: "already_shared", handoff: summaryOf(existing) }, error: null }
            : { data: { status: "share_conflict" }, error: null };
        }
        state.grantSeq += 1;
        const grant = {
          grant_id: `dddddddd-dddd-4ddd-8ddd-${String(state.grantSeq).padStart(12, "0")}`,
          investigation_id: String(args.p_id),
          revision: Number(args.p_revision),
          title: inv.title,
          shared_by: state.user,
          grantee_user_id: String(args.p_grantee),
          created_at: COMMITTED,
          revoked: false,
        };
        state.grants.push(grant);
        return { data: { status: "created", handoff: summaryOf(grant) }, error: null };
      }
      if (fn === "read_investigation_handoff_v1") {
        if (state.mode === "malformed_read") return { data: { status: "found", handoff: { schema: "mm.research_handoff.v1" } }, error: null };
        if (state.mode === "read_metadata") {
          const g = state.grants.find((x) => !x.revoked && x.grant_id === args.p_grant_id && x.grantee_user_id === state.user);
          if (!g) return { data: { status: "not_found" }, error: null };
          const payload = readPayloadFor(g);
          return { data: { ...payload, handoff: { ...payload.handoff, layout: {}, evidence: [] } }, error: null };
        }
        // Grantee-only: the grant must name THIS caller; anyone else sees the same not_found.
        const grant = state.grants.find(
          (g) => !g.revoked && g.grant_id === args.p_grant_id && g.grantee_user_id === state.user,
        );
        return grant ? { data: readPayloadFor(grant), error: null } : { data: { status: "not_found" }, error: null };
      }
      if (fn === "revoke_investigation_handoff_v1") {
        const grant = state.grants.find((g) => g.grant_id === args.p_grant_id && g.shared_by === state.user);
        if (!grant) return { data: { status: "not_found" }, error: null };
        grant.revoked = true;
        return { data: { status: "revoked" }, error: null };
      }
      return { data: null, error: { message: `unexpected ${fn}` } };
    },
  }),
}));

let server: Server;
let origin = "";
let realFetch: typeof fetch;

function cachePrivate(response: Response) {
  expect(response.headers.get("cache-control")?.replace(/\s/g, "").toLowerCase()).toContain("private,no-store");
  expect(response.headers.get("vary")?.toLowerCase()).toContain("cookie");
}

beforeAll(async () => {
  realFetch = globalThis.fetch;
  // The production client fetches its relative route; resolve that against the loopback origin.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(new URL(String(input), origin) as unknown as RequestInfo, init)) as typeof fetch;
  const { GET, POST, DELETE } = await import("@/app/api/research-handoffs/route");
  const run = (pick: (method: string) => (request: Request) => Promise<Response>) =>
    createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const handler = pick(request.method ?? "GET");
        const result = await handler(
          new Request(new URL(request.url!, origin), {
            method: request.method,
            headers: request.headers as HeadersInit,
            body: ["GET", "HEAD"].includes(request.method ?? "") ? undefined : Buffer.concat(chunks),
          }),
        );
        if (state.dropResponse) {
          // The handler has already run — any mutation it performed is committed in the RPC
          // double — but the answer never reaches the client: the socket dies here.
          response.destroy();
          return;
        }
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(await result.text());
      } catch {
        response.writeHead(500);
        response.end("Unexpected route failure");
      }
    });
  server = run((method) => {
    if (method === "POST") return POST;
    if (method === "DELETE") return DELETE;
    return GET;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local HTTP address");
  origin = `http://127.0.0.1:${address.port}`;
});

// Each case keeps the real limiter and its limits, in its own namespace. Extra mutation
// proof must not consume another case's bucket before it tests body validation.
beforeEach(() => {
  state.limiterCase += 1;
  state.user = OWNER;
  state.mode = "ok";
  state.grants = [];
  state.grantSeq = 0;
  state.currentRevision = REVISION;
  state.dropResponse = false;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function raw(path: string, init?: RequestInit) {
  return realFetch(`${origin}${path}`, init);
}

function jsonInit(method: string, body: unknown) {
  return {
    method,
    headers: { "content-type": "application/json", "x-mm-handoff-owner": OWNER },
    body: JSON.stringify(body),
  };
}

async function makeGrant(revision = REVISION): Promise<string> {
  const created = await shareHandoff(OWNER, { investigationId: INV, revision, granteeUserId: GRANTEE });
  if (created.result.status !== "created" && created.result.status !== "already_shared") throw new Error("grant fixture failed");
  return created.result.handoff.grantId;
}

describe("real research-handoff route -> loopback HTTP -> production typed client", () => {
  it("shares on purpose, proves the recipient read, and converges a repeat share", async () => {
    const grantId = await makeGrant();

    // The recipient lists and reads under THEIR OWN session and identity header.
    state.user = GRANTEE;
    const received = await listHandoffs(GRANTEE);
    expect(received.httpStatus).toBe(200);
    expect(received.result).toMatchObject({ status: "listed" });
    expect(received.result.status === "listed" ? received.result.received.map((g) => g.grantId) : []).toEqual([grantId]);
    expect(received.result.status === "listed" ? received.result.own : []).toEqual([]);

    const read = await readHandoff(GRANTEE, grantId);
    expect(read.httpStatus).toBe(200);
    expect(read.result).toMatchObject({
      status: "found",
      handoff: {
        schema: "mm.research_handoff.v1",
        investigationId: INV,
        revision: REVISION,
        intent: { title: "Copper question", question: "Is copper supply tightening into Q1?" },
        continuation: { nextQuestion: "Check smelter margins", nextObservation: "LME stocks fell 8 days running" },
      },
    });

    state.user = OWNER;
    const again = await shareHandoff(OWNER, { investigationId: INV, revision: REVISION, granteeUserId: GRANTEE });
    expect(again.httpStatus).toBe(200);
    expect(again.result).toMatchObject({ status: "already_shared", handoff: { grantId } });

    // Owner publishes a later revision; it does not silently move the existing pin.
    state.currentRevision = 4;
    // A DIFFERENT live revision on the same share is a conflict, not a silent repoint.
    const conflict = await shareHandoff(OWNER, { investigationId: INV, revision: 4, granteeUserId: GRANTEE });
    expect(conflict.httpStatus).toBe(409);
    expect(conflict.result).toMatchObject({ status: "share_conflict" });

    // Owner revoke ends it; the recipient's next read is a confirmed not_found.
    const revoked = await revokeHandoff(OWNER, grantId);
    expect(revoked.httpStatus).toBe(200);
    expect(revoked.result).toMatchObject({ status: "revoked" });
    state.user = GRANTEE;
    const after = await readHandoff(GRANTEE, grantId);
    expect(after.httpStatus).toBe(404);
    expect(after.result).toMatchObject({ status: "not_found" });

    // Owner-side revoke is idempotent on an already-revoked owned grant.
    state.user = OWNER;
    const againRevoke = await revokeHandoff(OWNER, grantId);
    expect(againRevoke.result).toMatchObject({ status: "revoked" });

    // The owner's own list shows the share while live and drops it after revoke.
    const before = await listHandoffs(OWNER);
    expect(before.result.status === "listed" ? before.result.sent.map((g) => g.grantId) : ["kept"]).toEqual([]);
    const live = await makeGrant();
    const ownerList = await listHandoffs(OWNER);
    expect(ownerList.result.status === "listed" ? ownerList.result.sent.map((g) => g.grantId) : []).toEqual([live]);
  });

  it("pages >200 sent shares by grant-UUID keyset through the real route and client", async () => {
    // 201 pre-existing live grants in the RPC double: a first page of exactly 200 plus one
    // more. Direct fixture rows, exactly the pre-existing-overflow shape the SQL contract
    // keeps navigable.
    for (let i = 1; i <= 201; i += 1) {
      state.grants.push({
        grant_id: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}`,
        investigation_id: INV,
        revision: REVISION,
        title: "Copper question",
        shared_by: OWNER,
        grantee_user_id: GRANTEE,
        created_at: COMMITTED,
        revoked: false,
      });
    }
    const first = await listHandoffs(OWNER);
    expect(first.httpStatus).toBe(200);
    if (first.result.status !== "listed") throw new Error("expected a listed page");
    expect(first.result.sent).toHaveLength(200);
    const pageOne = first.result.sent.map((g) => g.grantId);
    expect([...pageOne].sort()).toEqual(pageOne);
    expect(new Set(pageOne).size).toBe(200);
    expect(first.result.sentNextCursor).toBe(pageOne[199]);
    expect(first.result.receivedNextCursor).toBeNull();

    // A malformed seek never reaches the wire: the client refuses it outright.
    const badSeek = await listHandoffs(OWNER, { sentAfter: "zzz" });
    expect(badSeek).toEqual({ httpStatus: 0, result: { status: "unavailable" } });

    // The named cursor fetches only rows after the seek, for that one collection.
    const second = await listHandoffs(OWNER, { sentAfter: first.result.sentNextCursor ?? undefined });
    expect(second.httpStatus).toBe(200);
    if (second.result.status !== "listed") throw new Error("expected a listed page");
    const pageTwo = second.result.sent.map((g) => g.grantId);
    expect(pageTwo).toHaveLength(1);
    expect(pageTwo[0] > pageOne[199]).toBe(true);
    expect(second.result.sentNextCursor).toBeNull();
    expect(new Set([...pageOne, ...pageTwo]).size).toBe(201);
    expect(second.result.received).toEqual([]);

    // A seek with nothing after it is an honest empty page, not an error or a cursor.
    const tail = await listHandoffs(OWNER, { sentAfter: pageTwo[0] });
    expect(tail.httpStatus).toBe(200);
    expect(tail.result.status === "listed" ? tail.result.sent : ["kept"]).toEqual([]);
    expect(tail.result.status === "listed" ? tail.result.sentNextCursor : "kept").toBeNull();

    // Cursor metadata that could not have come from the paging RPC — a non-full page that
    // still claims a next page — is unavailable, never a false complete.
    state.mode = "partial_cursor";
    const lie = await listHandoffs(OWNER);
    expect(lie.httpStatus).toBe(503);
    expect(lie.result).toMatchObject({ status: "unavailable" });
  });

  it("keeps a genuine empty list distinct from an unavailable source", async () => {
    state.mode = "empty";
    const empty = await listHandoffs(OWNER);
    expect(empty.httpStatus).toBe(200);
    expect(empty.result).toEqual({ status: "listed", own: [], sent: [], received: [], sentNextCursor: null, receivedNextCursor: null });
    state.mode = "storage_down";
    const down = await listHandoffs(OWNER);
    expect(down.httpStatus).toBe(503);
    expect(down.result).toMatchObject({ status: "unavailable" });
  });

  it("refuses account mismatches with owner_changed and never names the session owner", async () => {
    const grantId = await makeGrant();
    // Session is the owner; a client claiming the recipient's identity must be refused.
    const refused = await readHandoff(GRANTEE, grantId).then(
      () => null,
      (error: unknown) => error,
    );
    expect(isHandoffOwnerChangeError(refused)).toBe(true);
    // Absent header at the raw transport layer: same refusal, same private headers.
    const noHeader = await raw(`/api/research-handoffs?grant_id=${grantId}`);
    cachePrivate(noHeader);
    expect(noHeader.status).toBe(409);
    expect(await noHeader.json()).toEqual({ status: "owner_changed" });
    // A malformed header value is the same refusal.
    const badHeader = await raw("/api/research-handoffs", { headers: { "x-mm-handoff-owner": "not-a-uuid" } });
    expect(badHeader.status).toBe(409);
  });

  it.each([
    ["unknown query key", "/api/research-handoffs?id=x"],
    ["duplicate query keys", "/api/research-handoffs?grant_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&grant_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    ["malformed grant_id", "/api/research-handoffs?grant_id=zzz"],
    ["grant_id plus extra key", "/api/research-handoffs?grant_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&revision=1"],
    ["malformed sent_after", "/api/research-handoffs?sent_after=zzz"],
    ["malformed received_after", "/api/research-handoffs?received_after=not-a-uuid"],
    ["duplicate sent_after", "/api/research-handoffs?sent_after=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&sent_after=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    ["cursor mixed with grant_id", "/api/research-handoffs?grant_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&sent_after=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    ["cursor plus unknown key", "/api/research-handoffs?sent_after=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&revision=1"],
  ])("rejects %s with 400 before any effect", async (_name, path) => {
    const response = await raw(path, { headers: { "x-mm-handoff-owner": OWNER } });
    cachePrivate(response);
    expect(response.status).toBe(400);
  });

  it.each([
    ["extra body field", "POST", { investigation_id: INV, revision: REVISION, grantee_user_id: GRANTEE, action: "share" }],
    ["missing field", "POST", { investigation_id: INV, revision: REVISION }],
    ["wrong revision type", "POST", { investigation_id: INV, revision: "3", grantee_user_id: GRANTEE }],
    ["zero revision", "POST", { investigation_id: INV, revision: 0, grantee_user_id: GRANTEE }],
    ["bad investigation id", "POST", { investigation_id: "nope", revision: REVISION, grantee_user_id: GRANTEE }],
    ["email grantee", "POST", { investigation_id: INV, revision: REVISION, grantee_user_id: "a@example.com" }],
    ["self grant", "POST", { investigation_id: INV, revision: REVISION, grantee_user_id: OWNER }],
    ["unknown delete field", "DELETE", { grant_id: UNKNOWN_GRANT, resource_kind: "watchlist" }],
    ["delete missing grant", "DELETE", {}],
    ["delete bad uuid", "DELETE", { grant_id: "zz" }],
  ])("rejects %s on the strict body contract", async (_name, method, body) => {
    const response = await raw(HANDOFF_ROUTE, jsonInit(method, body));
    cachePrivate(response);
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("pg_secret");
  });

  it("requires JSON content type on mutations and a parseable JSON body", async () => {
    const text = await raw(HANDOFF_ROUTE, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-mm-handoff-owner": OWNER },
      body: JSON.stringify({ investigation_id: INV, revision: REVISION, grantee_user_id: GRANTEE }),
    });
    expect(text.status).toBe(400);
    const broken = await raw(HANDOFF_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mm-handoff-owner": OWNER },
      body: "{not json",
    });
    expect(broken.status).toBe(400);
    const array = await raw(HANDOFF_ROUTE, jsonInit("POST", [INV]));
    expect(array.status).toBe(400);
  });

  it("maps a foreign or absent target to a non-disclosing not_found", async () => {
    const foreign = await shareHandoff(OWNER, { investigationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", revision: 1, granteeUserId: GRANTEE });
    expect(foreign.httpStatus).toBe(404);
    expect(foreign.result).toMatchObject({ status: "not_found" });
    const absentGrantee = await shareHandoff(OWNER, { investigationId: INV, revision: REVISION, granteeUserId: STRANGER });
    expect(absentGrantee.result).toMatchObject({ status: "not_found" });
    const unknownGrant = await readHandoff(OWNER, UNKNOWN_GRANT);
    expect(unknownGrant.httpStatus).toBe(404);
    expect(unknownGrant.result).toMatchObject({ status: "not_found" });
    // A grant the caller is NOT the recipient of is equally invisible.
    const grantId = await makeGrant();
    state.user = STRANGER;
    const strangerRead = await readHandoff(STRANGER, grantId);
    expect(strangerRead.httpStatus).toBe(404);
  });

  it("answers 503 unavailable for RPC, storage and malformed-shape failures, leaking nothing", async () => {
    state.mode = "rpc_error";
    const viaError = await listHandoffs(OWNER);
    expect(viaError.httpStatus).toBe(503);
    expect(viaError.result).toMatchObject({ status: "unavailable" });
    expect(JSON.stringify(viaError.result)).not.toContain("pg_secret");

    state.mode = "malformed_summary";
    const viaShape = await listHandoffs(OWNER);
    expect(viaShape.httpStatus).toBe(503);

    // A page whose trailing cursor contradicts its rows is refused the same way.
    state.mode = "partial_cursor";
    const viaCursor = await listHandoffs(OWNER);
    expect(viaCursor.httpStatus).toBe(503);

    state.mode = "malformed_read";
    const grantId = await makeGrant();
    state.user = GRANTEE;
    const badRead = await readHandoff(GRANTEE, grantId);
    expect(badRead.httpStatus).toBe(503);

    // A read payload carrying whole-manifest fields is refused, not trimmed into shape.
    state.mode = "ok";
    state.user = OWNER;
    const second = await makeGrant();
    state.user = GRANTEE;
    state.mode = "read_metadata";
    const leaky = await readHandoff(GRANTEE, second);
    expect(leaky.httpStatus).toBe(503);
    expect(leaky.result).toMatchObject({ status: "unavailable" });

    // A list row carrying metadata beyond SUMMARY is refused the same way.
    state.mode = "extra_field";
    const leakyList = await listHandoffs(GRANTEE);
    expect(leakyList.httpStatus).toBe(503);
  });

  it("never lets a mutation speak after an uncertain answer", async () => {
    // In this double, storage_down throws BEFORE the create RPC runs, so nothing commits and
    // the empty sent list below is true for this fixture. The opposite shape — the mutation
    // committing and only the response being lost — is proven by the two tests that follow.
    state.mode = "storage_down";
    const interrupted = await shareHandoff(OWNER, { investigationId: INV, revision: REVISION, granteeUserId: GRANTEE });
    expect(interrupted.httpStatus).toBe(503);
    expect(interrupted.result).toMatchObject({ status: "unavailable" });
    state.mode = "ok";
    const rows = await listHandoffs(OWNER);
    expect(rows.result).toMatchObject({ status: "listed", sent: [] });
  });

  it("a share whose HTTP response is lost has still committed: 0/unavailable to the caller, a live grant in the route state", async () => {
    // The route performs the create RPC, then the socket dies before any response byte.
    state.dropResponse = true;
    const lost = await shareHandoff(OWNER, { investigationId: INV, revision: REVISION, granteeUserId: GRANTEE });
    expect(lost).toEqual({ httpStatus: 0, result: { status: "unavailable" } });
    state.dropResponse = false;

    // The grant is live: the recipient lists exactly it and reads it under their own session.
    state.user = GRANTEE;
    const received = await listHandoffs(GRANTEE);
    expect(received.httpStatus).toBe(200);
    if (received.result.status !== "listed" || received.result.received.length !== 1) {
      throw new Error("expected the committed grant in the recipient's received list");
    }
    const grantId = received.result.received[0].grantId;
    const read = await readHandoff(GRANTEE, grantId);
    expect(read.httpStatus).toBe(200);
    expect(read.result).toMatchObject({ status: "found", handoff: { revision: REVISION } });

    // And the owner's own sent list shows the share the client was told was "unavailable".
    state.user = OWNER;
    const ownerList = await listHandoffs(OWNER);
    expect(ownerList.result.status === "listed" ? ownerList.result.sent.map((g) => g.grantId) : ["kept"]).toEqual([grantId]);
  });

  it("a revoke whose HTTP response is lost has still revoked: 0/unavailable to the caller, not_found to the next read", async () => {
    const grantId = await makeGrant();
    state.dropResponse = true;
    const lost = await revokeHandoff(OWNER, grantId);
    expect(lost).toEqual({ httpStatus: 0, result: { status: "unavailable" } });
    state.dropResponse = false;

    // The revocation committed: the recipient's read is a confirmed not_found, and the
    // owner's sent list no longer shows the grant.
    state.user = GRANTEE;
    const after = await readHandoff(GRANTEE, grantId);
    expect(after.httpStatus).toBe(404);
    expect(after.result).toMatchObject({ status: "not_found" });
    state.user = OWNER;
    const ownerList = await listHandoffs(OWNER);
    expect(ownerList.result.status === "listed" ? ownerList.result.sent.map((g) => g.grantId) : ["kept"]).toEqual([]);
  });

  it("keeps unauthenticated answers private", async () => {
    state.user = "";
    const listed = await raw("/api/research-handoffs", { headers: { "x-mm-handoff-owner": OWNER } });
    cachePrivate(listed);
    expect(listed.status).toBe(401);
    const shared = await raw(HANDOFF_ROUTE, jsonInit("POST", { investigation_id: INV, revision: REVISION, grantee_user_id: GRANTEE }));
    cachePrivate(shared);
    expect(shared.status).toBe(401);
  });

  it("bounds an oversized mutation body with 413", async () => {
    const response = await raw(
      HANDOFF_ROUTE,
      jsonInit("POST", { investigation_id: INV, revision: REVISION, grantee_user_id: GRANTEE, note: "x".repeat(9 * 1024) }),
    );
    cachePrivate(response);
    expect(response.status).toBe(413);
  });

  it("rate limits mutations with the shared limiter, still privately", async () => {
    state.tripMutations = true;
    try {
      const response = await realFetch(`${origin}${HANDOFF_ROUTE}`, jsonInit("POST", { investigation_id: INV, revision: REVISION, grantee_user_id: GRANTEE }));
      cachePrivate(response);
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(JSON.stringify(await response.json())).not.toContain("pg_secret");
    } finally {
      state.tripMutations = false;
    }
  });
});
