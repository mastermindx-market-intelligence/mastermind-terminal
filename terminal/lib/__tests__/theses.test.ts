import { beforeEach, describe, expect, it } from "vitest";
import {
  applyThesisVersion,
  listTheses,
  normalizeThesisContent,
  normalizeThesisSubject,
  normalizeThesisSubjectKey,
  readThesis,
  type ThesisContent,
  type ThesisDb,
  type ThesisSubjectRef,
} from "@/lib/theses";
import {
  createFixtureDb,
  FAULT_THESES_READ,
  fixtureStore,
  fixtureUserId,
  resetFixtureStores,
} from "@/lib/watchlistsFixtureDb";

const owner = fixtureUserId("thesis-race");
const db = () => createFixtureDb("thesis-race") as ThesisDb;

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

const content = (statement: string, patch: Partial<ThesisContent> = {}): ThesisContent => ({
  schema: "mastermind.thesis-content/v1",
  title: "NVDA operating leverage",
  statement,
  catalysts: ["Data-center revenue compounds"],
  falsifiers: ["Gross margin falls below 65%"],
  risks: ["Customer concentration"],
  horizon: "quarters",
  effectiveAt: null,
  revisionNote: null,
  ...patch,
});

const create = (key: string, requestId: string) => applyThesisVersion(
  createFixtureDb(key) as ThesisDb,
  fixtureUserId(key),
  {
    action: "create",
    id: null,
    expectedVersion: 0,
    clientRequestId: requestId,
    subject,
    content: content("Demand will outrun supply."),
  },
);

beforeEach(() => resetFixtureStores());

describe("the atomic thesis mutation boundary", () => {
  it("lets one of two expectedVersion=1 writers advance and leaves no split head or orphan", async () => {
    const created = await applyThesisVersion(db(), owner, {
      action: "create",
      id: null,
      expectedVersion: 0,
      clientRequestId: "10000000-0000-4000-8000-000000000001",
      subject,
      content: content("Demand will outrun supply."),
    });
    expect(created).toMatchObject({ ok: true, status: "created", version: 1 });
    if (!created.ok) throw new Error("fixture create failed");

    const [left, right] = await Promise.all([
      applyThesisVersion(db(), owner, {
        action: "revise",
        id: created.thesisId,
        expectedVersion: 1,
        clientRequestId: "10000000-0000-4000-8000-000000000002",
        subject,
        content: content("Supply remains constrained through next year."),
      }),
      applyThesisVersion(db(), owner, {
        action: "revise",
        id: created.thesisId,
        expectedVersion: 1,
        clientRequestId: "10000000-0000-4000-8000-000000000003",
        subject,
        content: content("Pricing power expands with software mix."),
      }),
    ]);

    expect([left.status, right.status].sort()).toEqual(["advanced", "version_conflict"]);
    const detail = await readThesis(db(), owner, created.thesisId);
    expect(detail).toMatchObject({ ok: true, thesis: { currentVersion: 2 } });
    if (!detail.ok) throw new Error("fixture read failed");
    expect(detail.thesis.history.map((version) => version.version)).toEqual([2, 1]);
    expect(detail.thesis.history).toHaveLength(2);
    expect(detail.thesis.current.version).toBe(detail.thesis.currentVersion);
  });

  it("replays the same request exactly once and rejects the same key with different bytes", async () => {
    const input = {
      action: "create" as const,
      id: null,
      expectedVersion: 0,
      clientRequestId: "20000000-0000-4000-8000-000000000001",
      subject,
      content: content("Demand will outrun supply."),
    };
    const first = await applyThesisVersion(db(), owner, input);
    const replay = await applyThesisVersion(db(), owner, input);
    const mismatch = await applyThesisVersion(db(), owner, {
      ...input,
      content: content("This is a different semantic payload."),
    });

    expect(first).toMatchObject({ ok: true, status: "created", version: 1, replayed: false });
    expect(replay).toMatchObject({ ok: true, status: "replayed", version: 1, replayed: true });
    expect(mismatch).toEqual({ ok: false, status: "idempotency_conflict", error: "idempotency conflict" });
    if (!first.ok) throw new Error("fixture create failed");
    const detail = await readThesis(db(), owner, first.thesisId);
    expect(detail.ok && detail.thesis.history).toHaveLength(1);
  });

  it("fails closed when the RPC success row does not prove the exact head identity", async () => {
    const malformedRpc = {
      from: db().from,
      rpc: async () => ({
        data: [{
          status: "created",
          thesis_id: "not-a-uuid",
          version: 1,
          current_version: 2,
          lifecycle_state: "active",
          replayed: false,
        }],
        error: null,
      }),
    } as ThesisDb;
    expect(await applyThesisVersion(malformedRpc, owner, {
      action: "create",
      id: null,
      expectedVersion: 0,
      clientRequestId: "20000000-0000-4000-8000-000000000099",
      subject,
      content: content("No malformed success may escape."),
    })).toEqual({ ok: false, status: "unavailable", error: "thesis mutation returned an invalid result" });
  });

  it("cross-checks successful RPC status, target, lifecycle, and replay metadata", async () => {
    const createdId = "21000000-0000-4000-8000-000000000001";
    const otherId = "21000000-0000-4000-8000-000000000002";
    const createInput = {
      action: "create" as const,
      id: null,
      expectedVersion: 0,
      clientRequestId: "21000000-0000-4000-8000-000000000003",
      subject,
      content: content("Strict create result."),
    };
    const reviseInput = {
      ...createInput,
      action: "revise" as const,
      id: createdId,
      expectedVersion: 1,
      clientRequestId: "21000000-0000-4000-8000-000000000004",
    };
    const canonical = {
      status: "created",
      thesis_id: createdId,
      version: 1,
      current_version: 1,
      lifecycle_state: "active",
      replayed: false,
    };
    const cases = [
      { input: createInput, row: { ...canonical, status: "advanced" } },
      { input: createInput, row: { ...canonical, replayed: true } },
      { input: createInput, row: { ...canonical, status: "replayed", replayed: false } },
      { input: reviseInput, row: { ...canonical, status: "advanced", thesis_id: otherId, version: 2, current_version: 2 } },
      { input: reviseInput, row: { ...canonical, version: 2, current_version: 2 } },
      { input: reviseInput, row: { ...canonical, status: "advanced", version: 2, current_version: 2, lifecycle_state: "archived" } },
    ];

    for (const { input, row } of cases) {
      const malformedRpc = {
        from: db().from,
        rpc: async () => ({ data: [row], error: null }),
      } as ThesisDb;
      expect(await applyThesisVersion(malformedRpc, owner, input))
        .toEqual({ ok: false, status: "unavailable", error: "thesis mutation returned an invalid result" });
    }
  });

  it("enforces lifecycle transitions without writing rejected attempts", async () => {
    const created = await create("thesis-race", "30000000-0000-4000-8000-000000000001");
    if (!created.ok) throw new Error("fixture create failed");
    const mutate = (action: "revise" | "archive" | "invalidate" | "reopen", version: number, request: string, note: string | null = null) =>
      applyThesisVersion(db(), owner, {
        action,
        id: created.thesisId,
        expectedVersion: version,
        clientRequestId: request,
        subject,
        content: content("Demand will outrun supply.", { revisionNote: note }),
      });

    expect(await mutate("reopen", 1, "30000000-0000-4000-8000-000000000002"))
      .toMatchObject({ ok: false, status: "invalid_transition" });
    expect(await applyThesisVersion(db(), owner, {
      action: "archive",
      id: created.thesisId,
      expectedVersion: 1,
      clientRequestId: "30000000-0000-4000-8000-000000000010",
      subject,
      content: content("A lifecycle label must not conceal a substantive rewrite."),
    })).toMatchObject({ ok: false, status: "invalid_transition" });
    expect(fixtureStore("thesis-race").thesisVersions).toHaveLength(1);
    expect(await mutate("archive", 1, "30000000-0000-4000-8000-000000000003"))
      .toMatchObject({ ok: true, version: 2, lifecycleState: "archived" });
    expect(await mutate("revise", 2, "30000000-0000-4000-8000-000000000004"))
      .toMatchObject({ ok: false, status: "invalid_transition" });
    expect(await mutate("reopen", 2, "30000000-0000-4000-8000-000000000005"))
      .toMatchObject({ ok: true, version: 3, lifecycleState: "active" });
    expect(await mutate("invalidate", 3, "30000000-0000-4000-8000-000000000006"))
      .toEqual({ ok: false, status: "invalid_payload", error: "invalidation reason required" });
    expect(await mutate("invalidate", 3, "30000000-0000-4000-8000-000000000007", "Margin evidence broke the thesis."))
      .toMatchObject({ ok: true, version: 4, lifecycleState: "invalidated" });
    expect(await mutate("reopen", 4, "30000000-0000-4000-8000-000000000008"))
      .toMatchObject({ ok: false, status: "invalid_transition" });
    expect(await mutate("reopen", 4, "30000000-0000-4000-8000-000000000009", "New audited evidence resolves the falsifier."))
      .toMatchObject({ ok: true, version: 5, lifecycleState: "active" });

    const detail = await readThesis(db(), owner, created.thesisId);
    expect(detail.ok && detail.thesis.history.map((item) => item.transition))
      .toEqual(["reopen", "invalidate", "reopen", "archive", "create"]);
  });

  it("refuses subject retargeting and keeps the stored subject and lineage unchanged", async () => {
    const created = await create("thesis-race", "40000000-0000-4000-8000-000000000001");
    if (!created.ok) throw new Error("fixture create failed");
    const retargeted = { ...subject, key: "AAPL", listing: { ...subject.listing!, symbol: "AAPL" }, display: "AAPL" };
    const result = await applyThesisVersion(db(), owner, {
      action: "revise",
      id: created.thesisId,
      expectedVersion: 1,
      clientRequestId: "40000000-0000-4000-8000-000000000002",
      subject: retargeted,
      content: content("A URL symbol cannot retarget a loaded thesis."),
    });
    expect(result).toMatchObject({ ok: false, status: "invalid_transition" });
    const detail = await readThesis(db(), owner, created.thesisId);
    expect(detail.ok && detail.thesis.subject.key).toBe("NVDA");
    expect(detail.ok && detail.thesis.history).toHaveLength(1);
  });
});

describe("privacy and failure honesty", () => {
  it("makes a foreign thesis indistinguishable from a nonexistent thesis", async () => {
    const database = "tenant-proof";
    const accountAKey = `${database}::owner-a`;
    const accountBKey = `${database}::owner-b`;
    const created = await create(accountAKey, "50000000-0000-4000-8000-000000000001");
    if (!created.ok) throw new Error("fixture create failed");
    const accountB = createFixtureDb(accountBKey) as ThesisDb;
    const coResident = await accountB.from("theses").select("id,user_id");
    expect(coResident.data).toMatchObject([{ id: created.thesisId, user_id: fixtureUserId(accountAKey) }]);
    const foreign = await readThesis(accountB, fixtureUserId(accountBKey), created.thesisId);
    const missing = await readThesis(accountB, fixtureUserId(accountBKey), "50000000-0000-4000-8000-000000000099");
    expect(foreign).toEqual(missing);
    expect(foreign).toEqual({ ok: false, status: "not_found", error: "thesis not found" });
  });

  it("distinguishes an empty owner list from an unavailable store", async () => {
    expect(await listTheses(createFixtureDb("empty") as ThesisDb, fixtureUserId("empty")))
      .toEqual({ ok: true, theses: [], truncated: false });
    expect(await listTheses(
      createFixtureDb("down", [FAULT_THESES_READ]) as ThesisDb,
      fixtureUserId("down"),
    )).toEqual({ ok: false, status: "unavailable", error: "fixture: thesis store unavailable" });
  });

  it("fails closed instead of silently dropping a malformed head or lineage row", async () => {
    const malformedHead = await create("malformed-head", "52000000-0000-4000-8000-000000000001");
    if (!malformedHead.ok) throw new Error("fixture create failed");
    fixtureStore("malformed-head").theses[0].current_version = 0;
    expect(await listTheses(
      createFixtureDb("malformed-head") as ThesisDb,
      fixtureUserId("malformed-head"),
    )).toEqual({ ok: false, status: "unavailable", error: "thesis head and lineage disagree" });

    const malformedHistory = await create("malformed-history", "52000000-0000-4000-8000-000000000002");
    if (!malformedHistory.ok) throw new Error("fixture create failed");
    await applyThesisVersion(
      createFixtureDb("malformed-history") as ThesisDb,
      fixtureUserId("malformed-history"),
      {
        action: "revise",
        id: malformedHistory.thesisId,
        expectedVersion: 1,
        clientRequestId: "52000000-0000-4000-8000-000000000003",
        subject,
        content: content("A valid current version."),
      },
    );
    const firstVersion = fixtureStore("malformed-history").thesisVersions.find((row) => row.version === 1)!;
    firstVersion.content = { ...(firstVersion.content as Record<string, unknown>), confidence: 0.9 };
    expect(await readThesis(
      createFixtureDb("malformed-history") as ThesisDb,
      fixtureUserId("malformed-history"),
      malformedHistory.thesisId,
    )).toEqual({ ok: false, status: "unavailable", error: "thesis history is malformed" });
  });

  it("refuses a mixed head/history snapshot instead of returning a future version", async () => {
    const created = await create("mixed-snapshot", "53000000-0000-4000-8000-000000000001");
    if (!created.ok) throw new Error("fixture create failed");
    await applyThesisVersion(
      createFixtureDb("mixed-snapshot") as ThesisDb,
      fixtureUserId("mixed-snapshot"),
      {
        action: "revise",
        id: created.thesisId,
        expectedVersion: 1,
        clientRequestId: "53000000-0000-4000-8000-000000000002",
        subject,
        content: content("This version committed after the stale head read."),
      },
    );
    fixtureStore("mixed-snapshot").theses[0].current_version = 1;
    expect(await readThesis(
      createFixtureDb("mixed-snapshot") as ThesisDb,
      fixtureUserId("mixed-snapshot"),
      created.thesisId,
    )).toEqual({ ok: false, status: "unavailable", error: "thesis head and lineage disagree" });
  });

  it("lists the most recently updated thesis first with a deterministic id tie-break", async () => {
    const first = await create("ordered", "51000000-0000-4000-8000-000000000001");
    const second = await create("ordered", "51000000-0000-4000-8000-000000000002");
    if (!first.ok || !second.ok) throw new Error("fixture create failed");

    const laterId = [first.thesisId, second.thesisId].sort().at(-1)!;
    const earlierId = laterId === first.thesisId ? second.thesisId : first.thesisId;
    for (const row of fixtureStore("ordered").theses) {
      row.updated_at = row.id === laterId ? "2026-09-02T12:00:00.000Z" : "2026-09-01T12:00:00.000Z";
    }

    const result = await listTheses(createFixtureDb("ordered") as ThesisDb, fixtureUserId("ordered"));
    expect(result.ok && result.theses.map((thesis) => thesis.id)).toEqual([laterId, earlierId]);
  });

  it("denies direct authenticated writes to both thesis tables", async () => {
    for (const table of ["theses", "thesis_versions"]) {
      const result = await db().from(table).insert({ user_id: owner }).select("id");
      expect(result.data).toBeNull();
      expect(result.error?.message).toBe(`permission denied for table ${table}`);
    }
  });
});

describe("closed thesis payloads", () => {
  it("rejects unknown authority fields, over-limit values, and forbidden controls", () => {
    expect(normalizeThesisContent({ ...content("valid"), confidence: 0.9 })).toBeNull();
    expect(normalizeThesisContent({ ...content("valid"), catalysts: Array(21).fill("x") })).toBeNull();
    expect(normalizeThesisContent(content(`bad\u0000statement`))).toBeNull();
    expect(normalizeThesisContent({ ...content("valid"), title: "two\nlines" })).toBeNull();
    expect(normalizeThesisContent({ ...content("valid"), catalysts: ["tab\tinside"] })).toBeNull();
    expect(normalizeThesisContent({ ...content("valid"), effectiveAt: "next quarter" })).toBeNull();
  });

  it("accepts newlines in prose but requires a truthful listing-scoped owner", () => {
    expect(normalizeThesisContent(content("Line one\r\nLine two"))?.statement).toBe("Line one\nLine two");
    expect(normalizeThesisSubject(subject)).toEqual(subject);
    expect(normalizeThesisSubject({ ...subject, owner: "data_os.security_master" })).toBeNull();
    expect(normalizeThesisSubject({
      ...subject,
      owner: "macro.theme_registry",
      identityState: "resolved",
      listing: undefined,
    })).toBeNull();
    expect(normalizeThesisSubject({ ...subject, listing: { ...subject.listing!, surprise: true } })).toBeNull();
    expect(normalizeThesisSubject({ ...subject, listing: { ...subject.listing!, mic: "XN\nAS" } })).toBeNull();
    expect(normalizeThesisSubject({ ...subject, companyId: "company\talias" })).toBeNull();
    expect(normalizeThesisSubject({ ...subject, key: "AAPL" })).toBeNull();
    expect(normalizeThesisSubject({ ...subject, identityState: "resolved" })).toBeNull();
    expect(normalizeThesisSubject({
      ...subject,
      owner: "data_os.security_master",
      identityState: "resolved",
    })).toMatchObject({ owner: "data_os.security_master", identityState: "resolved" });
  });

  it("uses the database's explicit space/line-ending contract and canonical UTC timestamps", () => {
    const nbsp = "\u00a0";
    expect(normalizeThesisSubject({
      ...subject,
      owner: "data_os.security_master",
      key: ` ${nbsp}NVDA${nbsp} `,
      identityState: "resolved",
      listing: undefined,
      display: ` ${nbsp}NVIDIA${nbsp} `,
    })).toMatchObject({ key: `${nbsp}NVDA${nbsp}`, display: `${nbsp}NVIDIA${nbsp}` });
    expect(normalizeThesisSubject({
      ...subject,
      listing: { ...subject.listing!, mic: "   ", securityId: "   " },
      companyId: "   ",
    })).toMatchObject({ listing: { mic: null, securityId: null }, companyId: null });
    expect(normalizeThesisContent({
      ...content(` Line one\r\nLine two `),
      title: ` ${nbsp}Title${nbsp} `,
      effectiveAt: "2026-09-03T12:34:56.789Z",
      revisionNote: "   ",
    })).toMatchObject({
      title: `${nbsp}Title${nbsp}`,
      statement: "Line one\nLine two",
      effectiveAt: "2026-09-03T12:34:56.789Z",
      revisionNote: null,
    });
    expect(normalizeThesisContent({
      ...content("valid"),
      effectiveAt: "2026-09-03 12:34:56+00",
    })).toBeNull();
    expect(normalizeThesisContent({ ...content("valid"), effectiveAt: "2026-09-03T12:34:60.000Z" })).toBeNull();
  });

  it("exports the exact U+0020 and Unicode-code-point subject-key contract for filters", () => {
    const nbsp = "\u00a0";
    expect(normalizeThesisSubjectKey(` ${nbsp}opaque${nbsp} `)).toBe(`${nbsp}opaque${nbsp}`);
    expect(normalizeThesisSubjectKey("😀".repeat(256))).toBe("😀".repeat(256));
    expect(normalizeThesisSubjectKey("😀".repeat(257))).toBeNull();
    expect(normalizeThesisSubjectKey("bad\nkey")).toBeNull();
  });
});
