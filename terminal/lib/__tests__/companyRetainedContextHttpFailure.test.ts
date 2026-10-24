import { beforeEach, describe, expect, it, vi } from "vitest";
import golden from "./fixtures/aapl-event-workspace.json";
const { getUser, retained, current } = vi.hoisted(() => ({ getUser: vi.fn(), retained: vi.fn(), current: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
vi.mock("@/lib/eventWorkspace", async () => {
  const real = await vi.importActual<typeof import("@/lib/eventWorkspace")>("@/lib/eventWorkspace");
  return { ...real, resolveCurrentEventWorkspaceFromR2: current };
});
// Isolate the current selected-release owner boundary; the real BFF default-deny
// path is separately exercised in companyRetainedContextOwnerIntegration.test.ts.
vi.mock("@/lib/investigationIssuerRelease", () => ({ resolveInvestigationIssuerRelease: retained }));
import { GET } from "@/app/api/investigations/baseline/route";
import { loadCompanyRetainedContext } from "../companyRetainedContext";

const pin = { event_id: golden.event_id, generation_id: golden.generation_id, company_id: golden.issuer.company_id, fingerprint: "a".repeat(64) };
const metadata = (reason = "denied") => ({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason });
const errorResponse = (body: unknown, status = 503) => new Response(JSON.stringify(body), { status });
const routeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => GET(new Request(`https://terminal.test${input}`, init)));
beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "6ed52847-3cbe-49d2-b54d-33d39ef482cf" } }, error: null });
  retained.mockResolvedValue(metadata());
});

describe("actual baseline HTTP error → shared Company loader", () => {
  it.each([
    ["denied", "rights_denied", 503], ["missing_generation", "missing_generation", 503],
    ["invalid_owner_receipt", "invalid_owner_receipt", 503], ["subject_mismatch", "subject_mismatch", 503],
    ["rights_unavailable", "rights_unavailable", 503], ["invalid_reference", "invalid_reference", 400],
  ])("preserves the closed %s owner failure with no fallback", async (ownerReason, expected, status) => {
    retained.mockResolvedValue(metadata(ownerReason as string));
    const statuses: number[] = [];
    const fetchImpl: typeof fetch = async (input, init) => { const response = await routeFetch(input, init); statuses.push(response.status); return response; };
    const signal = new AbortController().signal;
    expect(await loadCompanyRetainedContext({ symbol: "AAPL", pin, signal, fetchImpl }))
      .toEqual({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: expected });
    expect(statuses).toEqual([status]); expect(routeFetch).toHaveBeenCalledTimes(1); expect(current).not.toHaveBeenCalled();
    expect(retained.mock.calls[0][0]).toEqual(pin); expect(routeFetch.mock.calls[0][1]?.signal).toBe(signal);
  });
  it("preserves the actual route's generic owner exception as owner_unavailable", async () => {
    retained.mockRejectedValue(new Error("owner offline"));
    expect(await loadCompanyRetainedContext({ symbol: "AAPL", pin, fetchImpl: routeFetch }))
      .toEqual({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "owner_unavailable" });
    expect(routeFetch).toHaveBeenCalledTimes(1);
  });
  it("preserves current_owner_unavailable for an unpinned bootstrap without another request", async () => {
    current.mockResolvedValue({ ok: false });
    expect(await loadCompanyRetainedContext({ symbol: "AAPL", fetchImpl: routeFetch }))
      .toEqual({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "current_owner_unavailable" });
    expect(routeFetch).toHaveBeenCalledTimes(1); expect(retained).not.toHaveBeenCalled();
  });
  it("never accepts a valid success payload delivered with an HTTP error status", async () => {
    const receipt = { schema: "earnings.retained_baseline.v1", owner: "earnings.workspace_generation", ...pin,
      workspace_schema: "event_workspace.v1", manifest_schema: "event_workspace_manifest.v1", authority: "context_only",
      manifest_sha256: "b".repeat(64), manifest_bytes: 1, workspace_sha256: "c".repeat(64), workspace_bytes: 1,
      public_known_at: null, platform_known_at: null, generation_emitted_at: golden.generated_at,
      rights: { allowed: true, policy_version: "earnings.public_primary.context_read.v1", checked_at: golden.generated_at } };
    retained.mockResolvedValue({ ok: true, workspace: golden, receipt });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const actual = await routeFetch(input, init);
      expect(actual.status).toBe(200);
      return new Response(await actual.text(), { status: 503 });
    });
    expect(await loadCompanyRetainedContext({ symbol: "AAPL", pin, fetchImpl }))
      .toEqual({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "http_503" });
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(current).not.toHaveBeenCalled();
  });
});

describe("failure-only error metadata admission", () => {
  it.each([
    { ok: false, code: "OTHER_CODE", reason: "denied" }, metadata("unknown_reason"),
    { ...metadata(), receipt: { allowed: true } }, { ...metadata(), workspace: golden },
    { ...metadata(), ok: true }, { ...metadata(), reason: { code: "denied" } }, null,
  ])("keeps arbitrary or malformed error metadata as an HTTP failure: %j", async body => {
    const fetchImpl = vi.fn(async () => errorResponse(body));
    expect(await loadCompanyRetainedContext({ symbol: "AAPL", pin, fetchImpl }))
      .toEqual({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "http_503" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("does not consume failure metadata when HTTP 401 already establishes unauthenticated", async () => {
    const response = errorResponse(metadata(), 401);
    expect(await loadCompanyRetainedContext({ symbol: "AAPL", pin, fetchImpl: async () => response }))
      .toEqual({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "unauthenticated" });
    expect(response.bodyUsed).toBe(false);
  });
  it("keeps non-JSON errors and over-limit metadata as HTTP failures", async () => {
    for (const response of [
      new Response("upstream unavailable", { status: 503 }),
      new Response(JSON.stringify(metadata()) + " ".repeat(2048), { status: 503 }),
      new Response(JSON.stringify(metadata()), { status: 503, headers: { "content-length": "99999" } }),
    ]) expect(await loadCompanyRetainedContext({ symbol: "AAPL", pin, fetchImpl: async () => response }))
      .toEqual({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "http_503" });
  });
  it("honors abort while an error body is still streaming", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new TextEncoder().encode('{"ok":false')); } });
    const response = new Response(body, { status: 503 });
    const fetchImpl = vi.fn(async () => response);
    const pending = loadCompanyRetainedContext({ symbol: "AAPL", pin, signal: controller.signal, fetchImpl });
    await Promise.resolve(); await Promise.resolve(); controller.abort();
    expect(await pending).toEqual({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "aborted" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
