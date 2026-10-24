import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import golden from "./fixtures/aapl-event-workspace.json";
import { __resetEventWorkspaceCacheForTests } from "../eventWorkspace";
import { loadCompanyRetainedContext } from "../companyRetainedContext";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
import { GET } from "@/app/api/investigations/baseline/route";

const wire = JSON.stringify(golden);
const manifest = JSON.stringify({
  schema: "event_workspace_manifest.v1", generation_id: golden.generation_id,
  generated_at: golden.generated_at, status: "ready", event_count: 1,
  files: { [`workspaces/${golden.event_id}.json`]: {
    sha256: createHash("sha256").update(wire).digest("hex"), bytes: Buffer.byteLength(wire),
  } }, aliases: { "AAPL/2026Q3": golden.event_id, [golden.event_id]: golden.event_id },
  authority: "context_only", warnings: [],
});
let ownerCalls: string[];
let rightsAvailable: boolean;
const localFetch: typeof fetch = async (input, init) => GET(new Request(`https://terminal.test${input}`, init));
beforeEach(() => {
  __resetEventWorkspaceCacheForTests();
  ownerCalls = [];
  rightsAvailable = true;
  getUser.mockResolvedValue({ data: { user: { id: "6ed52847-3cbe-49d2-b54d-33d39ef482cf" } }, error: null });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    ownerCalls.push(url);
    if (!url.includes("/generations/") && !rightsAvailable) return new Response("", { status: 503 });
    return new Response(url.endsWith("manifest.json") ? manifest : wire, { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); __resetEventWorkspaceCacheForTests(); });

// Explicit Company scope selects the full owner, separately from no-scope IW2
// issuer-release requests. Neither production scope has a qualified authorizer:
// do not report a successful full-Company integration from fixture permissions.
// Pure retained-owner/loader positive cases remain in eventWorkspaceRetained.test.ts
// and companyRetainedContext.test.ts; selected-release identity is covered in
// investigationIssuerRelease.test.ts with an explicit fixture authorization.
const pin = { event_id: golden.event_id, generation_id: golden.generation_id,
  company_id: golden.issuer.company_id, fingerprint: "a".repeat(64) };
const unavailable = { ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "rights_unavailable" };
describe("actual Company client/BFF rights-scope boundary", () => {
  it("never promotes a public mixed-workspace bootstrap into a full Company authorization", async () => {
    expect(await loadCompanyRetainedContext({ symbol: "AAPL", fetchImpl: localFetch })).toEqual(unavailable);
    expect(ownerCalls.length).toBeGreaterThan(0);
    expect(ownerCalls.filter(url => url.endsWith("manifest.json") && !url.includes("/generations/"))).toHaveLength(1);
  });
  it("refuses an exact retained pin before fetching protected historical bytes", async () => {
    expect(await loadCompanyRetainedContext({ symbol: "AAPL", pin, fetchImpl: localFetch })).toEqual(unavailable);
    expect(ownerCalls).toEqual([]);
  });
  it("does not recover a changed fingerprint by selecting current or an old public-primary grant", async () => {
    expect(await loadCompanyRetainedContext({ symbol: "AAPL", pin: { ...pin, fingerprint: "0".repeat(64) }, fetchImpl: localFetch })).toEqual(unavailable);
    expect(ownerCalls).toEqual([]);
  });
  it("requires authentication again and never substitutes a cached authenticated response", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await loadCompanyRetainedContext({ symbol: "AAPL", pin, fetchImpl: localFetch }))
      .toEqual({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "unauthenticated" });
    expect(ownerCalls).toEqual([]);
  });
  it("refuses an unresolvable unrelated bootstrap without falling back to the fixture company", async () => {
    expect(await loadCompanyRetainedContext({ symbol: "MSFT", fetchImpl: localFetch }))
      .toEqual({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "current_owner_unavailable" });
    expect(ownerCalls.filter(url => url.includes("/workspaces/"))).toEqual([]);
  });
});
