import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThesisContent, ThesisSubjectRef } from "@/lib/theses";

const H = vi.hoisted(() => ({
  key: "thesis-route",
  user: { id: "e2e-user-thesis-route" } as { id: string } | null,
  faults: [] as string[],
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("@/lib/supabase/server", async () => {
  const { createFixtureDb } = await import("@/lib/watchlistsFixtureDb");
  return {
    createClient: vi.fn(async () => ({
      auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
      ...createFixtureDb(H.key, H.faults),
    })),
  };
});

import { GET, POST } from "@/app/api/theses/route";
import { FAULT_THESES_READ, fixtureStore, fixtureUserId, resetFixtureStores } from "@/lib/watchlistsFixtureDb";

const subject: ThesisSubjectRef = {
  schema: "mastermind.thesis-subject-ref/v1",
  kind: "issuer",
  owner: "terminal.analysis_symbol",
  key: "NVDA",
  identityState: "listing_scoped",
  listing: { symbol: "NVDA", mic: null, securityId: null },
  companyId: null,
  display: "NVDA · listing scoped",
};
const content = (statement = "Demand will outrun supply."): ThesisContent => ({
  schema: "mastermind.thesis-content/v1",
  title: "NVDA operating leverage",
  statement,
  catalysts: ["Data-center revenue compounds"],
  falsifiers: ["Gross margin falls below 65%"],
  risks: ["Customer concentration"],
  horizon: "quarters",
  effectiveAt: null,
  revisionNote: null,
});
const post = (body: Record<string, unknown>) => POST(new Request("https://x.test/api/theses", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));
const create = (request = "60000000-0000-4000-8000-000000000001") => post({
  action: "create",
  clientRequestId: request,
  subject,
  content: content(),
});

beforeEach(() => {
  resetFixtureStores();
  H.key = "thesis-route";
  H.user = { id: fixtureUserId(H.key) };
  H.faults = [];
  delete process.env.TERMINAL_E2E_FIXTURE;
  vi.clearAllMocks();
});

describe("GET /api/theses", () => {
  it("keeps a genuine empty list distinct from an unavailable store", async () => {
    const empty = await GET(new Request("https://x.test/api/theses"));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ theses: [], truncated: false });

    H.faults = [FAULT_THESES_READ];
    const unavailable = await GET(new Request("https://x.test/api/theses"));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "thesis_store_unavailable" });
  });

  it("lists then reads the exact current head and immutable history", async () => {
    const made = await create();
    expect(made.status).toBe(201);
    const created = await made.json();

    const revised = await post({
      action: "revise",
      id: created.thesisId,
      expectedVersion: 1,
      clientRequestId: "60000000-0000-4000-8000-000000000002",
      subject,
      content: content("Software mix expands pricing power."),
    });
    expect(revised.status).toBe(200);

    const list = await GET(new Request("https://x.test/api/theses"));
    expect((await list.json()).theses).toMatchObject([{ id: created.thesisId, currentVersion: 2 }]);
    const detail = await GET(new Request(`https://x.test/api/theses?id=${created.thesisId}`));
    const payload = await detail.json();
    expect(detail.status).toBe(200);
    expect(payload.thesis).toMatchObject({ id: created.thesisId, currentVersion: 2 });
    expect(payload.thesis.history.map((item: { version: number }) => item.version)).toEqual([2, 1]);
  });

  it("accepts the real PostgREST UUID and timestamptz response shape at the API read boundary", async () => {
    const made = await post({
      action: "create",
      clientRequestId: "60100000-0000-4000-8000-000000000001",
      subject,
      content: { ...content(), effectiveAt: "2026-07-15T16:34:56.789Z" },
    });
    const created = await made.json();
    const store = fixtureStore(H.key);
    store.theses[0].created_at = "2026-07-15T16:34:56+00:00";
    store.theses[0].updated_at = "2026-07-15T12:34:56.120-04:00";
    store.thesisVersions[0].system_recorded_at = "2026-07-15T16:34:56.120456+00:00";
    store.thesisVersions[0].effective_at = "2026-07-15T12:34:56.789000-04:00";

    const response = await GET(new Request(`https://x.test/api/theses?id=${created.thesisId}`));
    expect(response.status).toBe(200);
    expect((await response.json()).thesis).toMatchObject({
      id: created.thesisId,
      createdAt: "2026-07-15T16:34:56.000Z",
      updatedAt: "2026-07-15T16:34:56.120Z",
      current: {
        effectiveAt: "2026-07-15T16:34:56.789Z",
        systemRecordedAt: "2026-07-15T16:34:56.120456Z",
      },
    });
  });

  it("accepts only a complete validated subject filter", async () => {
    await create();
    const matched = await GET(new Request("https://x.test/api/theses?subjectOwner=terminal.analysis_symbol&subjectKind=issuer&subjectKey=NVDA"));
    expect(matched.status).toBe(200);
    expect((await matched.json()).theses).toHaveLength(1);

    for (const terminalKey of ["nvda", "NvDa"]) {
      const canonicalMatch = await GET(new Request(`https://x.test/api/theses?subjectOwner=terminal.analysis_symbol&subjectKind=issuer&subjectKey=${terminalKey}`));
      expect(canonicalMatch.status).toBe(200);
      expect((await canonicalMatch.json()).theses).toHaveLength(1);
    }

    const unmatched = await GET(new Request("https://x.test/api/theses?subjectOwner=terminal.analysis_symbol&subjectKind=issuer&subjectKey=AAPL"));
    expect(unmatched.status).toBe(200);
    expect((await unmatched.json()).theses).toEqual([]);

    for (const query of [
      "subjectOwner=terminal.analysis_symbol",
      "subjectOwner=brain&subjectKind=issuer&subjectKey=NVDA",
      "subjectOwner=macro.theme_registry&subjectKind=issuer&subjectKey=NVDA",
      "subjectOwner=data_os.security_master&subjectKind=theme&subjectKey=semiconductors",
      "subjectOwner=terminal.analysis_symbol&subjectKind=issuer&subjectKey=NVDA&subjectKey=AAPL",
    ]) {
      const invalid = await GET(new Request(`https://x.test/api/theses?${query}`));
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "invalid_subject_filter" });
    }
  });

  it("filters with the canonical U+0020 boundary and Unicode code-point length", async () => {
    const nbsp = "\u00a0";
    const opaque = `${nbsp}issuer-key${nbsp}`;
    const made = await post({
      action: "create",
      clientRequestId: "61000000-0000-4000-8000-000000000001",
      subject: {
        ...subject,
        owner: "data_os.security_master",
        key: ` ${opaque} `,
        identityState: "resolved",
        listing: undefined,
        display: "Opaque issuer",
      },
      content: content(),
    });
    expect(made.status).toBe(201);

    const matched = await GET(new Request(`https://x.test/api/theses?subjectOwner=data_os.security_master&subjectKind=issuer&subjectKey=${encodeURIComponent(` ${opaque} `)}`));
    expect(matched.status).toBe(200);
    expect((await matched.json()).theses).toHaveLength(1);

    const maxCodePoints = await GET(new Request(`https://x.test/api/theses?subjectOwner=data_os.security_master&subjectKind=issuer&subjectKey=${encodeURIComponent("😀".repeat(256))}`));
    expect(maxCodePoints.status).toBe(200);
    const tooManyCodePoints = await GET(new Request(`https://x.test/api/theses?subjectOwner=data_os.security_master&subjectKind=issuer&subjectKey=${encodeURIComponent("😀".repeat(257))}`));
    expect(tooManyCodePoints.status).toBe(400);
  });

  it("uses one response for foreign and missing IDs and refuses malformed IDs", async () => {
    const made = await create();
    const { thesisId } = await made.json();
    H.key = "thesis-route-b";
    H.user = { id: fixtureUserId(H.key) };

    const foreign = await GET(new Request(`https://x.test/api/theses?id=${thesisId}`));
    const missing = await GET(new Request("https://x.test/api/theses?id=70000000-0000-4000-8000-000000000099"));
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    expect(await missing.json().catch(() => null)).toBeNull();

    const malformed = await GET(new Request("https://x.test/api/theses?id=not-a-uuid"));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_thesis_id" });
  });

  it("401s an expired session instead of returning an anonymous empty workspace", async () => {
    H.user = null;
    const response = await GET(new Request("https://x.test/api/theses"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });
});

describe("POST /api/theses", () => {
  it("maps create, exact replay, stale CAS, and mismatched replay without false success", async () => {
    const first = await create();
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created).toMatchObject({ version: 1, lifecycleState: "active", replayed: false });

    const replay = await create();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ thesisId: created.thesisId, version: 1, replayed: true });

    const mismatch = await post({
      action: "create",
      clientRequestId: "60000000-0000-4000-8000-000000000001",
      subject,
      content: content("Different payload."),
    });
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toEqual({ error: "idempotency_conflict" });

    const stale = await post({
      action: "revise",
      id: created.thesisId,
      expectedVersion: 99,
      clientRequestId: "60000000-0000-4000-8000-000000000003",
      subject,
      content: content("Stale edit remains local."),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "version_conflict", currentVersion: 1, lifecycleState: "active" });
  });

  it("derives ownership only from the session and ignores a forged body owner", async () => {
    const response = await post({
      action: "create",
      clientRequestId: "80000000-0000-4000-8000-000000000001",
      userId: "forged-owner",
      subject,
      content: content(),
    });
    expect(response.status).toBe(201);
    const { thesisId } = await response.json();
    const detail = await GET(new Request(`https://x.test/api/theses?id=${thesisId}`));
    expect(detail.status).toBe(200);
  });

  it("closes malformed, unsupported, unauthenticated, and oversized requests", async () => {
    const unsupported = await post({ action: "delete" });
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toEqual({ error: "unsupported_action" });

    const malformed = await POST(new Request("https://x.test/api/theses", { method: "POST", body: "{" }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_json" });

    const oversized = await POST(new Request("https://x.test/api/theses", {
      method: "POST",
      body: JSON.stringify({ action: "create", padding: "x".repeat(70_000) }),
    }));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: "request_too_large" });

    H.user = null;
    expect((await create("90000000-0000-4000-8000-000000000001")).status).toBe(401);
  });
});
