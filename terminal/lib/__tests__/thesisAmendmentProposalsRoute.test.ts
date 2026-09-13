import { beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGES } from "@/lib/thesisAmendmentProposals";

const THESIS_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_THESIS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROPOSAL_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const USER_A = "user-A";
const USER_B = "user-B";

const H = vi.hoisted(() => ({
  user: { id: "user-A" } as { id: string } | null,
  theses: [] as Array<{ id: string; user_id: string }>,
  versions: [] as Array<{
    id: string;
    thesis_id: string;
    version: number;
    system_recorded_at: string;
    user_id: string;
  }>,
  proposals: [] as Array<Record<string, unknown>>,
  insertError: null as { message: string } | null,
  rpc: { status: "ok", proposal_id: "", state: "" } as {
    status: string;
    proposal_id: string | null;
    state: string | null;
  },
  consoleError: [] as unknown[],
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
    from(table: string) {
      const q: {
        _filters: Array<[string, unknown]>;
        _pending: Record<string, unknown> | null;
        select: (cols?: string) => typeof q;
        eq: (col: string, val: unknown) => typeof q;
        order: () => typeof q;
        insert: (row: Record<string, unknown>) => typeof q;
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
      } = {
        _filters: [],
        _pending: null,
        select() { return q; },
        eq(col, val) { q._filters.push([col, val]); return q; },
        order() { return q; },
        insert(row) { q._pending = row; return q; },
        maybeSingle: async () => {
          if (q._pending) {
            if (H.insertError) return { data: null, error: H.insertError };
            const stored = {
              proposal_id: PROPOSAL_ID,
              created_at: "2026-09-12T12:00:00.000Z",
              ...q._pending,
            };
            H.proposals.push(stored);
            return { data: stored, error: null };
          }
          const match = (rows: Array<Record<string, unknown>>) =>
            rows.find((row) => q._filters.every(([col, val]) => row[col] === val)) ?? null;
          if (table === "theses") return { data: match(H.theses), error: null };
          if (table === "thesis_versions") return { data: match(H.versions), error: null };
          if (table === "thesis_amendment_proposals") return { data: match(H.proposals), error: null };
          return { data: null, error: null };
        },
        then(resolve, reject) {
          const list = H.proposals.filter((row) => q._filters.every(([col, val]) => row[col] === val));
          return Promise.resolve({ data: list, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe("set_thesis_amendment_state");
      return { data: [{ ...H.rpc, proposal_id: args.p_proposal_id }], error: null };
    }),
  })),
}));

import { GET, POST } from "@/app/api/thesis/[thesisId]/proposals/route";
import { PATCH } from "@/app/api/thesis/[thesisId]/proposals/[proposalId]/route";

const params = (thesisId: string) => Promise.resolve({ thesisId });
const patchParams = (thesisId: string, proposalId: string) => Promise.resolve({ thesisId, proposalId });

function post(thesisId: string, body: unknown) {
  return POST(new Request(`https://x.test/api/thesis/${thesisId}/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), { params: params(thesisId) });
}

function get(thesisId: string) {
  return GET(new Request(`https://x.test/api/thesis/${thesisId}/proposals`), { params: params(thesisId) });
}

function patch(thesisId: string, proposalId: string, body: unknown) {
  return PATCH(new Request(`https://x.test/api/thesis/${thesisId}/proposals/${proposalId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: patchParams(thesisId, proposalId) });
}

beforeEach(() => {
  H.user = { id: USER_A };
  H.theses = [{ id: THESIS_ID, user_id: USER_A }];
  H.versions = [{
    id: VERSION_ID,
    thesis_id: THESIS_ID,
    version: 2,
    system_recorded_at: "2026-09-10T08:00:00.000Z",
    user_id: USER_A,
  }];
  H.proposals = [];
  H.insertError = null;
  H.rpc = { status: "ok", proposal_id: PROPOSAL_ID, state: "accepted" };
  H.consoleError = [];
  delete process.env.TERMINAL_E2E_FIXTURE;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    H.consoleError.push(args);
  });
});

describe("POST /api/thesis/[thesisId]/proposals", () => {
  it("returns 401 for an anonymous request", async () => {
    H.user = null;
    const res = await post(THESIS_ID, { amended_from: VERSION_ID, body: "Tighten the horizon." });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 404 for a thesis the caller does not own, without confirming it exists", async () => {
    H.theses = [{ id: THESIS_ID, user_id: USER_B }];
    const res = await post(THESIS_ID, { amended_from: VERSION_ID, body: "Tighten the horizon." });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 400 with the plain-word reason when amended_from is missing", async () => {
    const res = await post(THESIS_ID, { body: "Tighten the horizon." });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toBe(MESSAGES.missingAmendedFrom[0]);
    expect(json.messageZh).toBe(MESSAGES.missingAmendedFrom[1]);
  });

  it("returns 400 with the same plain-word reason when amended_from is not a version of this thesis", async () => {
    const res = await post(THESIS_ID, { amended_from: OTHER_THESIS, body: "Tighten the horizon." });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toBe(MESSAGES.missingAmendedFrom[0]);
    expect(json.messageZh).toBe(MESSAGES.missingAmendedFrom[1]);
  });

  it("returns 400 when evidence_refs copies a payload instead of a K1 pointer", async () => {
    const res = await post(THESIS_ID, {
      amended_from: VERSION_ID,
      body: "Tighten the horizon.",
      evidence_refs: [{ owner: "macro", payload: { close: 140 } }],
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toBe(MESSAGES.payloadCopy[0]);
    expect(json.messageZh).toBe(MESSAGES.payloadCopy[1]);
  });

  it.each(["conviction", "confidence", "probability", "rank", "size", "target", "score"] as const)(
    "returns 400 when the body carries a %s judgement key",
    async (key) => {
      const res = await post(THESIS_ID, {
        amended_from: VERSION_ID,
        body: "Tighten the horizon.",
        [key]: 0.8,
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.message).toBe(MESSAGES.judgement[0]);
      expect(json.messageZh).toBe(MESSAGES.judgement[1]);
    },
  );

  it("returns 201 and the inserted row on the happy path", async () => {
    const res = await post(THESIS_ID, {
      amended_from: VERSION_ID,
      body: "Name the demand that has to keep compounding.",
      evidence_refs: [{ owner: "macro", native_id: "briefing.json", schema: "artifact/v1" }],
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { proposal: Record<string, unknown> };
    expect(json.proposal.body).toBe("Name the demand that has to keep compounding.");
    expect(json.proposal.state).toBe("proposed");
    expect(json.proposal.amendedFrom).toBe(VERSION_ID);
    expect(json.proposal.versionNumber).toBe(2);
    expect(H.proposals[0]?.proposed_by).toBe("assistant");
  });

  it("never logs the proposal body when insert fails", async () => {
    H.insertError = { message: "row rejected" };
    const res = await post(THESIS_ID, { amended_from: VERSION_ID, body: "SECRET-BODY-TEXT" });
    expect(res.status).toBe(503);
    const dumped = JSON.stringify(H.consoleError);
    expect(dumped).not.toContain("SECRET-BODY-TEXT");
  });
});

describe("GET /api/thesis/[thesisId]/proposals", () => {
  it("returns 404 for a non-owner", async () => {
    H.theses = [];
    const res = await get(THESIS_ID);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("lists the owner's proposals on the happy path", async () => {
    H.proposals = [{
      proposal_id: PROPOSAL_ID,
      thesis_id: THESIS_ID,
      amended_from: VERSION_ID,
      body: "Name the demand that has to keep compounding.",
      evidence_refs: [],
      proposed_by: "assistant",
      state: "proposed",
      created_at: "2026-09-12T12:00:00.000Z",
    }];
    const res = await get(THESIS_ID);
    expect(res.status).toBe(200);
    const json = await res.json() as { proposals: Array<{ body: string; versionNumber: number }> };
    expect(json.proposals).toHaveLength(1);
    expect(json.proposals[0].body).toBe("Name the demand that has to keep compounding.");
    expect(json.proposals[0].versionNumber).toBe(2);
  });
});

describe("PATCH /api/thesis/[thesisId]/proposals/[proposalId]", () => {
  it("returns 404 for a non-owner", async () => {
    H.theses = [];
    const res = await patch(THESIS_ID, PROPOSAL_ID, { state: "accepted" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 404 when the function reports not_found", async () => {
    H.rpc = { status: "not_found", proposal_id: null, state: null };
    const res = await patch(THESIS_ID, PROPOSAL_ID, { state: "accepted" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a state the function will not accept", async () => {
    const res = await patch(THESIS_ID, PROPOSAL_ID, { state: "superseded" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toBe(MESSAGES.invalidState[0]);
  });

  it("returns the new state on the happy path", async () => {
    H.rpc = { status: "ok", proposal_id: PROPOSAL_ID, state: "accepted" };
    const res = await patch(THESIS_ID, PROPOSAL_ID, { state: "accepted" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ proposalId: PROPOSAL_ID, state: "accepted" });
  });
});
