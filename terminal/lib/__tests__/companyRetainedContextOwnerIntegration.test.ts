import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import golden from "./fixtures/aapl-event-workspace.json";
import { __resetEventWorkspaceCacheForTests } from "../eventWorkspace";
import { companyRetainedContextParams, loadCompanyRetainedContext, parseCompanyRetainedContext } from "../companyRetainedContext";

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

describe("Company client composed with the actual retained owner and authenticated BFF", () => {
  it("exports a real owner fingerprint, then reloads the exact immutable tuple", async () => {
    const first = await loadCompanyRetainedContext({ symbol: "AAPL", fetchImpl: localFetch });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const parsed = parseCompanyRetainedContext(companyRetainedContextParams(first.receipt), "AAPL");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.pin) return;
    ownerCalls.length = 0;
    const resumed = await loadCompanyRetainedContext({ symbol: "AAPL", pin: parsed.pin, fetchImpl: localFetch });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.receipt.fingerprint).toBe(first.receipt.fingerprint);
    expect(resumed.workspace.event_id).toBe(golden.event_id);
    expect(resumed.workspace.generation_id).toBe(golden.generation_id);
    expect(ownerCalls.some(url => url.endsWith("/manifest.json") && !url.includes("/generations/"))).toBe(true);
  });
  it("rechecks current rights and refuses a retained reload after rights publication is unavailable", async () => {
    const first = await loadCompanyRetainedContext({ symbol: "AAPL", fetchImpl: localFetch });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const parsed = parseCompanyRetainedContext(companyRetainedContextParams(first.receipt), "AAPL");
    if (!parsed.ok || !parsed.pin) throw new Error("valid owner pin expected");
    rightsAvailable = false;
    const resumed = await loadCompanyRetainedContext({ symbol: "AAPL", pin: parsed.pin, fetchImpl: localFetch });
    expect(resumed).toMatchObject({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "rights_denied" });
  });
  it("refuses a changed fingerprint without selecting current even after a valid bootstrap", async () => {
    const first = await loadCompanyRetainedContext({ symbol: "AAPL", fetchImpl: localFetch });
    if (!first.ok) throw new Error("owner baseline expected");
    const parsed = parseCompanyRetainedContext(companyRetainedContextParams(first.receipt), "AAPL");
    if (!parsed.ok || !parsed.pin) throw new Error("valid owner pin expected");
    ownerCalls.length = 0;
    const result = await loadCompanyRetainedContext({ symbol: "AAPL", pin: { ...parsed.pin, fingerprint: "0".repeat(64) }, fetchImpl: localFetch });
    expect(result).toMatchObject({ ok: false, code: "HISTORICAL_UNAVAILABLE" });
    expect(ownerCalls.every(url => url.includes(`/generations/${golden.generation_id}/`))).toBe(true);
  });
  it("requires authentication again on reload and never substitutes a cached authenticated response", async () => {
    const first = await loadCompanyRetainedContext({ symbol: "AAPL", fetchImpl: localFetch });
    if (!first.ok) throw new Error("owner baseline expected");
    const parsed = parseCompanyRetainedContext(companyRetainedContextParams(first.receipt), "AAPL");
    if (!parsed.ok || !parsed.pin) throw new Error("valid owner pin expected");
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    ownerCalls.length = 0;
    expect(await loadCompanyRetainedContext({ symbol: "AAPL", pin: parsed.pin, fetchImpl: localFetch }))
      .toMatchObject({ ok: false, code: "HISTORICAL_UNAVAILABLE" });
    expect(ownerCalls).toHaveLength(0);
  });
  it("refuses a different requested listing even with a genuine retained owner receipt", async () => {
    const first = await loadCompanyRetainedContext({ symbol: "AAPL", fetchImpl: localFetch });
    if (!first.ok) throw new Error("owner baseline expected");
    const parsed = parseCompanyRetainedContext(companyRetainedContextParams(first.receipt), "AAPL");
    if (!parsed.ok || !parsed.pin) throw new Error("valid owner pin expected");
    expect(await loadCompanyRetainedContext({ symbol: "MSFT", pin: parsed.pin, fetchImpl: localFetch }))
      .toMatchObject({ ok: false, code: "HISTORICAL_UNAVAILABLE" });
  });
});
