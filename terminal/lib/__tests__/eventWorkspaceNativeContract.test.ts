import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { __resetEventWorkspaceCacheForTests, normalizeEventWorkspace, resolveEventWorkspaceFromR2 } from "../eventWorkspace";
import { presentEventWorkspace } from "../eventWorkspacePresent";
import { planHeldMaterialEvents } from "../../../ingest/heldMaterialEvents";

// Unchanged public immutable UTF-8 bytes, including their original clocks and
// manifest receipts. No network or private holdings are used by these tests.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/native-company-results-workspaces.json", import.meta.url), "utf8"));
const objects: { file: string; body: string; bytes: number; sha256: string }[] = fixture.objects;
const native = (ticker: string) => JSON.parse(objects.find(row => JSON.parse(row.body).issuer.listings.some((listing: { ticker: string }) => listing.ticker === ticker))!.body);
const now = Date.parse("2026-10-19T08:00:00Z");
const position = (ticker: string) => ({ userId: "11111111-1111-4111-8111-111111111111", ticker, status: "open" as const, rowCount: 1, firstHeldAt: "1970-01-01T00:00:00Z" });
function freshNative(ticker = "TOL") {
  const payload = native(ticker);
  // Explicit synthetic freshness for a unit control, never applied to public bytes.
  payload.generated_at = "2026-10-19T08:00:00Z";
  payload.lifecycle = { state: "complete", source_available_at: "2026-10-19T06:00:00Z", observed_at: "2026-10-19T07:00:00Z" };
  return payload;
}
function denominatorPayload() {
  const payload = native("TOL");
  payload.facts = [payload.facts.find((fact: { metric: string }) => fact.metric === "cancellation_rate_basis")];
  payload.facts[0].basis = "native convention"; // isolate the text-value boundary
  return payload;
}
beforeEach(() => __resetEventWorkspaceCacheForTests());
afterEach(() => vi.unstubAllGlobals());

describe("native company-results fact contract", () => {
  it.each(["TOL", "KBH", "PHM", "DHI"])("preserves %s native numeric fact basis beyond 40 characters", ticker => {
    const payload = native(ticker);
    payload.facts = payload.facts.filter((fact: { value: unknown }) => typeof fact.value === "number");
    expect(payload.facts.some((fact: { basis: string }) => fact.basis.length > 40)).toBe(true);
    const result = normalizeEventWorkspace(payload);
    expect(result).not.toBeNull();
    expect(result!.facts.map(fact => fact.basis)).toEqual(payload.facts.map((fact: { basis: string }) => fact.basis));
  });
  it.each(["TOL", "KBH", "DHI"])("preserves %s source-bound denominator text and renders it literally", ticker => {
    const payload = native(ticker);
    payload.facts = [payload.facts.find((fact: { metric: string }) => fact.metric === "cancellation_rate_basis")];
    payload.facts[0].basis = "native convention";
    const result = normalizeEventWorkspace(payload);
    expect(result).not.toBeNull();
    expect(result!.facts[0].value).toBe(payload.facts[0].value);
    expect(presentEventWorkspace(result!).facts[0].value).toBe(payload.facts[0].value);
  });
  it.each([
    { metric: "revenue" }, { metric: "net_orders" }, { fact_id: "unrelated_text_fact" },
    { unit: "percent" }, { period: "2026-06-30" }, { value: "" }, { value: "x".repeat(4001) },
  ])("rejects text outside the bounded native denominator shape: %j", changes => {
    const payload = denominatorPayload(); Object.assign(payload.facts[0], changes);
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });
  it("does not turn denominator absence into a present textual fact", () => {
    const payload = native("PHM");
    payload.facts = [payload.facts.find((fact: { metric: string }) => fact.metric === "cancellation_rate_basis")];
    expect(payload.facts[0].typed_absence).toBeTruthy();
    payload.facts[0].value = "invented denominator";
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });
  it.each(["123", "NaN", NaN, Infinity])("keeps ordinary financial facts numeric: %s", value => {
    const payload = native("AAPL"); payload.facts[0].value = value;
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });
  it("preserves a native convention string on a numeric delta side", () => {
    const payload = native("AAPL");
    const basis = native("TOL").facts.find((fact: { metric: string }) => fact.metric === "cancellation_rate").basis;
    payload.deltas[0].current.basis = basis;
    const parsed = normalizeEventWorkspace(payload);
    expect(parsed).not.toBeNull();
    expect(parsed!.deltas[0].current).toMatchObject({ basis });
  });
  it("accepts the existing source-text ceiling without truncation", () => {
    const payload = denominatorPayload(); payload.facts[0].basis = "b".repeat(4000); payload.facts[0].value = "v".repeat(4000);
    expect(normalizeEventWorkspace(payload)!.facts[0]).toMatchObject({ basis: payload.facts[0].basis, value: payload.facts[0].value });
  });
  it("retains the bounded text ceiling for fact and delta basis", () => {
    const fact = native("AAPL"); fact.facts[0].basis = "x".repeat(4001);
    expect(normalizeEventWorkspace(fact)).toBeNull();
    const delta = native("AAPL"); delta.deltas[0].current.basis = "x".repeat(4001);
    expect(normalizeEventWorkspace(delta)).toBeNull();
  });
});

describe("native bound filing eligibility", () => {
  it.each(["AAPL", "TOL"])("plans a synthetic fresh %s native bound filing after the real reader", ticker => {
    const parsed = normalizeEventWorkspace(freshNative(ticker));
    expect(parsed).not.toBeNull();
    expect(planHeldMaterialEvents([position(ticker)], [parsed!], now)).toMatchObject({ evaluated: 1, unevaluable: 0, rows: [{ payload: { ticker } }] });
  });
  it.each([
    { status: "present", filing_key: { cik: "0000794170", accession: "0000794170-26-000001" } },
    { status: "absent" }, { status: "unbound", filing_key: { cik: "0000794170", accession: "0000794170-26-000001" } },
    { status: "bound" }, { status: "bound", filing_key: null },
    { status: "bound", filing_key: { cik: "not-a-cik", accession: "0000794170-26-000001" } },
    { status: "bound", filing_key: { cik: "0000794170", accession: "bad" } },
    { status: "bound", filing_key: { cik: "0000320193", accession: "0000320193-26-000018" } },
  ])("excludes missing/malformed/unbound or other-issuer filing: %j", filing => {
    const payload = freshNative(); payload.completeness.filing = filing;
    const parsed = normalizeEventWorkspace(payload);
    if (parsed) expect(planHeldMaterialEvents([position("TOL")], [parsed], now)).toMatchObject({ rows: [], unevaluable: 1 });
  });
  it("a bound key cannot override a different event identity or missing release", () => {
    const parsed = normalizeEventWorkspace(freshNative());
    expect(parsed).not.toBeNull();
    if (!parsed) throw Error("native reader failed");
    expect(planHeldMaterialEvents([position("TOL")], [{ ...parsed, event_id: "evt_cik0000320193_2026q3_results" }], now).rows).toEqual([]);
    expect(planHeldMaterialEvents([position("TOL")], [{ ...parsed, completeness: { ...parsed.completeness, release: { status: "absent" } } }], now).rows).toEqual([]);
  });
});

describe("all five immutable public native objects", () => {
  it("passes the unchanged byte/SHA resolver while every actual old source clock remains excluded", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("manifest.json")) return new Response(JSON.stringify(fixture.manifest));
      const row = objects.find(object => url === `${fixture.source}/generations/${fixture.manifest.generation_id}/${object.file}`);
      return row ? new Response(row.body) : new Response("", { status: 404 });
    }));
    expect(objects).toHaveLength(5);
    for (const row of objects) {
      expect(Buffer.byteLength(row.body)).toBe(row.bytes);
      expect(createHash("sha256").update(row.body).digest("hex")).toBe(row.sha256);
      expect(fixture.manifest.files[row.file]).toEqual({ bytes: row.bytes, sha256: row.sha256 });
      const original = JSON.parse(row.body);
      const result = await resolveEventWorkspaceFromR2(original.event_id, fixture.source.split("/company_intelligence/")[0]);
      expect(result.ok && result.state === "ready").toBe(true);
      if (!result.ok || result.state !== "ready") throw Error("native reader failed");
      expect(result.workspace.lifecycle).toEqual(original.lifecycle);
      expect(result.workspace.facts.map(fact => fact.value)).toEqual(original.facts.map((fact: { value?: unknown }) => fact.value ?? null));
      const ticker = original.issuer.listings.find((listing: { is_primary: boolean }) => listing.is_primary).ticker;
      expect(planHeldMaterialEvents([position(ticker)], [result.workspace], now)).toMatchObject({ rows: [], unevaluable: 1 });
    }
  });
});
