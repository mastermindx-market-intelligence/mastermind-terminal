import { describe, expect, it, vi } from "vitest";
import { executeWrongUserProbe, validateNegativeCaseReceipt, negativeCaseExitRequired } from "../../e2e/tools/thesisJourneyLib.mjs";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const base = "https://terminal.test";
const thesisId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const principal = (id: unknown) => ({ schema: "mmx.cookie-principal.v1", verified: true, principalId: id });
const response = (status: number, body: unknown = null) => ({ status: () => status, json: async () => body });

function setup(owner: unknown = principal(ownerId), other: unknown = principal(otherId)) {
  const ownerRequest = { get: vi.fn(async () => response(200, owner)) };
  const otherRequest = {
    get: vi.fn(async (url: string) => url.endsWith("/api/auth/principal") ? response(200, other)
      : url.includes("?id=") ? response(404) : response(200, { theses: [] })),
    post: vi.fn(async () => response(404)),
  };
  const progress: unknown[] = [];
  const verifyUi = vi.fn(async () => true);
  const options = { ownerRequest, otherRequest, ownerPrincipal: ownerId, base, thesisId, reviseData: { action: "revise" }, archiveData: { action: "archive" }, verifyUi,
    onProgress: (receipt: unknown) => { progress.push(structuredClone(receipt)); } };
  return { ...options, progress, options };
}

describe("fresh cookie-principal gate and actual wrong-user sequence", () => {
  it.each([
    ["same account", principal(ownerId), principal(ownerId), "same_principal"],
    ["case-only same account", principal(ownerId.toUpperCase()), principal(ownerId), "same_principal"],
    ["absent owner", null, principal(otherId), "principal_unverified"],
    ["absent other", principal(ownerId), null, "principal_unverified"],
    ["malformed id", principal(ownerId), principal("not-a-user"), "principal_unverified"],
    ["unverified", principal(ownerId), { ...principal(otherId), verified: false }, "principal_unverified"],
    ["wrong authority", principal(ownerId), { ...principal(otherId), schema: "api-key" }, "principal_unverified"],
  ])("%s sends zero thesis targets or mutations", async (_name, owner, other, reason) => {
    const s = setup(owner, other);
    const result = await executeWrongUserProbe(s.options);
    expect(result).toMatchObject({ ran: false, route: "none", reason });
    expect(s.otherRequest.get.mock.calls.every(([url]) => url.endsWith("/api/auth/principal"))).toBe(true);
    expect(s.otherRequest.post).not.toHaveBeenCalled();
    expect(s.verifyUi).not.toHaveBeenCalled();
    expect(negativeCaseExitRequired(result)).toBe(true);
  });

  it("requires the fresh owner to match the owner captured before create", async () => {
    const s = setup(principal(otherId), principal("dddddddd-dddd-4ddd-8ddd-dddddddddddd"));
    const result = await executeWrongUserProbe(s.options);
    expect(result).toMatchObject({ ran: false, reason: "owner_principal_changed" });
    expect(s.otherRequest.get).toHaveBeenCalledTimes(1);
    expect(s.otherRequest.post).not.toHaveBeenCalled();
    expect(negativeCaseExitRequired(result)).toBe(true);
  });

  it("requires a captured verified owner, not only a fresh pair", async () => {
    const s = setup();
    const result = await executeWrongUserProbe({ ...s.options, ownerPrincipal: "" });
    expect(result).toMatchObject({ ran: false, reason: "principal_unverified" });
    expect(s.otherRequest.post).not.toHaveBeenCalled();
    expect(s.otherRequest.get).toHaveBeenCalledTimes(1);
  });

  it("verifies distinct identities afresh before any thesis target and keeps IDs ephemeral", async () => {
    const s = setup();
    const result = await executeWrongUserProbe(s.options);
    expect(s.ownerRequest.get).toHaveBeenCalledWith(`${base}/api/auth/principal`, expect.objectContaining({ maxRedirects: 0 }));
    expect(s.otherRequest.get.mock.calls[0][0]).toBe(`${base}/api/auth/principal`);
    expect(s.otherRequest.post.mock.calls).toHaveLength(2);
    expect(s.verifyUi).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ran: true, principalsVerifiedDistinct: true, read: 404, revise: 404, archive: 404, ok: true, leak: false });
    expect(validateNegativeCaseReceipt({ phaseC: result })).toBe(true);
    expect(validateNegativeCaseReceipt({ phaseC: { ...result, principalsVerifiedDistinct: false } })).toBe(false);
    expect(JSON.stringify(s.progress)).not.toContain(ownerId);
    expect(JSON.stringify(s.progress)).not.toContain(otherId);
  });

  it.each([200, 201, 301, 401, 403, 409, 500])("non404 read%s stops before every subsequent C target", async (status) => {
    const s = setup();
    s.otherRequest.get.mockImplementation(async (url: string) => url.endsWith("/api/auth/principal") ? response(200, principal(otherId)) : response(status));
    const result = await executeWrongUserProbe(s.options);
    expect(result).toMatchObject({ ran: true, read: status, revise: null, archive: null, listExcludes: null, uiNotFound: null, ok: false, reason: "read_not_denied" });
    expect(s.otherRequest.post).not.toHaveBeenCalled();
    expect(s.otherRequest.get).toHaveBeenCalledTimes(2);
    expect(s.verifyUi).not.toHaveBeenCalled();
    expect(s.progress.at(-1)).toEqual(result);
    expect(validateNegativeCaseReceipt({ phaseC: result })).toBe(true);
    expect(negativeCaseExitRequired(result)).toBe(true);
  });

  it("unverifiable identity response/transport cannot reach a target", async () => {
    for (const kind of ["http", "json", "transport"]) {
      const s = setup();
      s.ownerRequest.get.mockImplementation(async () => {
        if (kind === "transport") throw new Error("synthetic-secret");
        if (kind === "json") return { status: () => 200, json: async () => { throw new Error("synthetic-secret"); } };
        return response(503);
      });
      const result = await executeWrongUserProbe(s.options);
      expect(result).toMatchObject({ ran: false, reason: "principal_unverified" });
      expect(s.otherRequest.post).not.toHaveBeenCalled();
      expect(s.otherRequest.get.mock.calls.every(([url]) => url.endsWith("/api/auth/principal"))).toBe(true);
      expect(JSON.stringify(s.progress)).not.toContain("synthetic-secret");
    }
  });

  it("preserves partial read evidence when the next transport fails", async () => {
    const s = setup();
    s.otherRequest.post.mockRejectedValueOnce(new Error("synthetic-secret"));
    const result = await executeWrongUserProbe(s.options);
    expect(result).toMatchObject({ ran: true, read: 404, revise: null, archive: null, reason: "phase_c_error", ok: false });
    expect(result).toHaveProperty("attempted", { read: true, revise: true, archive: false, list: false, ui: false });
    expect(s.otherRequest.post).toHaveBeenCalledTimes(1);
    expect(s.progress.some((x) => (x as { read: unknown }).read === 404)).toBe(true);
    expect(validateNegativeCaseReceipt({ phaseC: result })).toBe(true);
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });

  it("retains an attempted read with unknown response after transport failure", async () => {
    const s = setup();
    s.otherRequest.get.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/auth/principal")) return response(200, principal(otherId));
      throw new Error("synthetic-secret");
    });
    const result = await executeWrongUserProbe(s.options);
    expect(result).toMatchObject({ ran: true, read: null, revise: null, archive: null, reason: "phase_c_error", attempted: { read: true, revise: false, archive: false } });
    expect(s.otherRequest.post).not.toHaveBeenCalled();
    expect(s.progress.at(-1)).toEqual(result);
  });

  it("does not send archive after a non404 revise", async () => {
    const s = setup();
    s.otherRequest.post.mockResolvedValueOnce(response(409));
    const result = await executeWrongUserProbe(s.options);
    expect(result).toMatchObject({ read: 404, revise: 409, archive: null, leak: true, reason: "revise_not_denied" });
    expect(s.otherRequest.post).toHaveBeenCalledTimes(1);
  });

  it("stops before mutation if evidence cannot be retained", async () => {
    const s = setup();
    const onProgress = vi.fn(() => { throw new Error("synthetic-write-failure"); });
    await expect(executeWrongUserProbe({ ...s.options, onProgress })).rejects.toThrow();
    expect(s.otherRequest.post).not.toHaveBeenCalled();
  });

  it.each(["revise", "archive"])("serializes the %s attempt before its held POST settles", async (stage) => {
    const s = setup();
    let settlePost!: (value: ReturnType<typeof response>) => void;
    let started!: () => void;
    const held = new Promise<ReturnType<typeof response>>((resolve) => { settlePost = resolve; });
    const dispatched = new Promise<void>((resolve) => { started = resolve; });
    if (stage === "archive") s.otherRequest.post.mockResolvedValueOnce(response(404));
    s.otherRequest.post.mockImplementationOnce(async () => { started(); return held; });
    const running = executeWrongUserProbe(s.options);
    await dispatched;
    const snapshot = s.progress.at(-1);
    // structuredClone in onProgress represents bytes already serialized to disk.
    expect(snapshot).toMatchObject({ [stage]: null, attempted: { [stage]: true } });
    expect(validateNegativeCaseReceipt({ phaseC: snapshot })).toBe(true);
    settlePost(response(404));
    expect(await running).toMatchObject({ ok: true });
  });

  it.each(["revise", "archive"])("cannot dispatch %s when its predispatch evidence write fails", async (stage) => {
    const s = setup();
    const onProgress = (value: { attempted?: Record<string, boolean> }) => {
      if (value.attempted?.[stage]) throw new Error("synthetic-record-failure");
    };
    await expect(executeWrongUserProbe({ ...s.options, onProgress })).rejects.toThrow("synthetic-record-failure");
    expect(s.otherRequest.post).toHaveBeenCalledTimes(stage === "revise" ? 0 : 1);
  });

  it("rejects complete success whose attempt evidence says nothing was attempted", async () => {
    const s = setup();
    const result = await executeWrongUserProbe(s.options);
    expect(validateNegativeCaseReceipt({ phaseC: { ...result,
      attempted: { read: false, revise: false, archive: false, list: false, ui: false },
    } })).toBe(false);
  });

  it.each([
    ["missing attempt evidence", { attempted: undefined }],
    ["nonboolean flag", { attempted: { read: true, revise: true, archive: true, list: true, ui: "true" } }],
    ["extra attempt key", { attempted: { read: true, revise: true, archive: true, list: true, ui: true, secret: true } }],
    ["unattempted read with observed status", { attempted: { read: false, revise: true, archive: true, list: true, ui: true } }],
    ["list not attempted with a response", { attempted: { read: true, revise: true, archive: true, list: false, ui: true } }],
    ["UI not attempted with a result", { attempted: { read: true, revise: true, archive: true, list: true, ui: false } }],
    ["list status absent despite success", { listStatus: null }],
    ["non200 list claimed excluded", { listStatus: 503 }],
    ["malformed list status", { listStatus: "200" }],
  ])("rejects contradictory receipt: %s", async (_name, mutation) => {
    const s = setup();
    const result = await executeWrongUserProbe(s.options);
    expect(validateNegativeCaseReceipt({ phaseC: { ...result, ...mutation } })).toBe(false);
  });

  it("rejects a partial response attributed to an unattempted request", async () => {
    const s = setup();
    s.otherRequest.post.mockRejectedValueOnce(new Error("synthetic-transport"));
    const result = await executeWrongUserProbe(s.options);
    expect(validateNegativeCaseReceipt({ phaseC: result })).toBe(true);
    expect(validateNegativeCaseReceipt({ phaseC: { ...result, archive: 404 } })).toBe(false);
  });
});
