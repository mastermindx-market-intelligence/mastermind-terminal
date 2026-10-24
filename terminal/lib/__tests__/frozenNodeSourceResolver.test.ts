import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/exposure-native-qqq-observed-v2.json";
import { createExposureMapReader } from "../exposureMap";
import { exposureValueFingerprint } from "../exposureChartLink";
import { bindCompanionGexComparison, readCompanionGexSnapshot } from "../optionsCompanion";
import type { ExposureLens } from "../exposureMapProjection";
import type { FrozenNodeTarget } from "../optionsAlerts";
import { matchFrozenNodeSource, resolveFrozenNodeSource, type FrozenNodeSourceRequest } from "../frozenNodeSourceResolver";

// Existing fixture is explicitly synthetic, including QQQ's observed 119/120 population.
const at = "2026-10-21T00:00:00Z";
const now = Date.parse(at);
const all: ExposureLens = { kind: "all" };
const one: ExposureLens = { kind: "one", exp: "2026-10-23" };
function native(raw = fixture, lens = all) {
  return createExposureMapReader(raw, "QQQ", null, "2026-10-21", now).reportedGamma(lens)!;
}
async function pin(raw = fixture, lens = all, price = 159): Promise<FrozenNodeSourceRequest> {
  const reported = native(raw, lens);
  expect(reported).not.toBeNull();
  const expected: FrozenNodeTarget = {
    root: reported.root, securityId: reported.securityId, sourceSession: reported.sourceSession,
    sourceKey: await exposureValueFingerprint(raw), definitionKey: reported.definitionKey,
    scopeKey: reported.scopeKey, availableAt: reported.availableAt, sourceBinding: reported.sourceBinding,
    members: reported.members.filter(member => member.strike === price)
      .map(({ expiry, strike, right }) => ({ expiry, strike, right })),
    price, qualification: "observed_partial",
  };
  return { expected, lens, evaluationAt: at };
}

describe("source-only exact frozen-node composition", () => {
  it("reuses native observed members and preserves missing measurements and clock metadata", async () => {
    const request = await pin();
    const report = native();
    const selected = report.members.filter(member => member.strike === 159);
    expect(selected).toHaveLength(2);
    expect(selected.some(member => member.valueUsd === null)).toBe(true);
    const result = await matchFrozenNodeSource(fixture, request);
    expect(result.kind).toBe("matched");
    if (result.kind !== "matched") throw new Error(JSON.stringify(result));
    expect(result.target).toEqual(request.expected);
    expect(result.target.members).toHaveLength(2);
    expect(result.target.sourceBinding.clocks).toEqual(report.sourceBinding.clocks);
    expect(result.target.sourceBinding.clocks.option_observed_at).toBeNull();
    expect(result.target.sourceBinding.clocks.source_session).toBe("2026-10-20");
    expect(result.target.qualification).toBe("observed_partial");
    expect(result).not.toHaveProperty("rights");
    expect(result).not.toHaveProperty("armingEpoch");
  });

  it("refuses an outside-lens correction even when the entire selected projection is unchanged", async () => {
    const request = await pin(fixture, one, 100);
    const corrected = structuredClone(fixture);
    // Change one real native Gamma cell outside the selected expiry and price.
    const row = corrected.exposure_projection.cells.find(cell => cell[0] === 2)!;
    const metrics = row[3] as number[][];
    const gamma = metrics[0];
    gamma[5] = 2000; gamma[6] = 22000; gamma[7] = 2000; gamma[8] = 22000; gamma[10] = 12000;
    expect(native(corrected, one)).toEqual(native(fixture, one));
    expect(await exposureValueFingerprint(corrected)).not.toBe(request.expected.sourceKey);
    expect(await matchFrozenNodeSource(corrected, request)).toEqual({ kind: "unavailable", reason: "source_fingerprint_mismatch" });
  });

  it("does not substitute the incumbent lens/member comparison digest for the full document identity", async () => {
    const request = await pin(fixture, one, 100);
    const read = readCompanionGexSnapshot(fixture, "QQQ", now, one);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.reason);
    const comparison = await bindCompanionGexComparison(read.value);
    request.expected.sourceKey = comparison.measurement!.reportedGamma!.sourceKey;
    expect(await matchFrozenNodeSource(fixture, request)).toEqual({ kind: "unavailable", reason: "source_fingerprint_mismatch" });
  });

  it.each(["securityId", "definitionKey", "availableAt", "members", "inputSha256", "populationId", "sourceRef", "clocks"])(
    "refuses an altered independent %s binding", async field => {
      const request = await pin();
      if (field === "securityId") request.expected.securityId = "different-security";
      else if (field === "definitionKey") request.expected.definitionKey = "different-definition";
      else if (field === "availableAt") request.expected.availableAt = "2026-10-20T12:04:48.960845+00:00";
      else if (field === "members") request.expected.members.pop(); // includes the missing P member
      else if (field === "inputSha256") request.expected.sourceBinding.inputSha256 = "d".repeat(64);
      else if (field === "populationId") request.expected.sourceBinding.populationId = "different-population";
      else if (field === "sourceRef") request.expected.sourceBinding.sourceRef = "different-ref";
      else request.expected.sourceBinding.clocks.option_observed_at = "null";
      expect((await matchFrozenNodeSource(fixture, request)).kind).toBe("unavailable");
    },
  );

  it("requires the exact document and projection source session", async () => {
    const request = await pin();
    const changed = structuredClone(fixture); changed.asof = "2026-10-19";
    expect(await matchFrozenNodeSource(changed, request)).toEqual({ kind: "unavailable", reason: "document_session_mismatch" });
    const projectionChanged = structuredClone(fixture);
    projectionChanged.exposure_projection.clocks.source_session = "2026-10-19";
    request.expected.sourceKey = await exposureValueFingerprint(projectionChanged);
    expect(await matchFrozenNodeSource(projectionChanged, request)).toEqual({ kind: "unavailable", reason: "native_source_unavailable" });
  });

  it("refuses a different document root and never unwraps an alternate root object", async () => {
    const request = await pin();
    expect((await matchFrozenNodeSource({ ...fixture, root: "SPY" }, request)).kind).toBe("unavailable");
    expect((await matchFrozenNodeSource({ QQQ: fixture }, request)).kind).toBe("unavailable");
  });

  it.each([{ kind: "next-live" }, { kind: "week" }, { kind: "all", extra: true }] as ExposureLens[])("refuses unsupported native lens %j", async lens => {
    const request = await pin(); request.lens = lens;
    expect(await matchFrozenNodeSource(fixture, request)).toEqual({ kind: "unavailable", reason: "invalid_source_pin" });
  });

  it("withholds legacy-only and unsupported modeled sources rather than synthesizing members", async () => {
    const request = await pin();
    const legacy = { schema: fixture.schema, root: fixture.root, asof: fixture.asof, by_strike: fixture.by_strike };
    request.expected.sourceKey = await exposureValueFingerprint(legacy);
    expect((await matchFrozenNodeSource(legacy, request)).kind).toBe("unavailable");
    const unsupported = structuredClone(fixture);
    (unsupported.exposure_projection as { kind: string }).kind = "modeled_exposure";
    request.expected.sourceKey = await exposureValueFingerprint(unsupported);
    expect((await matchFrozenNodeSource(unsupported, request)).kind).toBe("unavailable");
  });

  it("requires a usable native node, separately valid availability and explicit evaluation time", async () => {
    const request = await pin(); request.expected.price = 9999;
    request.expected.members = [{ expiry: "2026-10-23", strike: 9999, right: "C" }];
    expect(await matchFrozenNodeSource(fixture, request)).toEqual({ kind: "unavailable", reason: "selected_node_unavailable" });
    const missing = await pin(); missing.evaluationAt = "";
    expect(await matchFrozenNodeSource(fixture, missing)).toEqual({ kind: "unavailable", reason: "invalid_source_pin" });
    missing.evaluationAt = at; missing.expected.availableAt = "2026-10-20";
    expect(await matchFrozenNodeSource(fixture, missing)).toEqual({ kind: "unavailable", reason: "invalid_source_pin" });
  });

  it("takes immutable pin/document snapshots across async fingerprinting", async () => {
    const raw = structuredClone(fixture), request = await pin(raw);
    const original = structuredClone(request.expected);
    const result = matchFrozenNodeSource(raw, request);
    raw.root = "SPY"; request.expected.sourceKey = "f".repeat(64); request.expected.members.pop();
    expect(await result).toEqual({ kind: "matched", target: original });
  });

  it("keeps the incumbent full-value depth bound even outside the selected projection", async () => {
    const request = await pin();
    const document: Record<string, unknown> = structuredClone(fixture);
    let nested: Record<string, unknown> = document;
    for (let i = 0; i < 40; i++) { const next = {}; nested.unselected = next; nested = next; }
    expect(await matchFrozenNodeSource(document, request)).toEqual({ kind: "unavailable", reason: "source_fingerprint_unavailable" });
  });

  it("withholds malformed native clocks without throwing or inventing an instant", async () => {
    const request = await pin();
    const document = structuredClone(fixture);
    (document.exposure_projection.clocks as Record<string, unknown>).available_at = { toString: "invalid" };
    request.expected.sourceKey = await exposureValueFingerprint(document);
    expect(await matchFrozenNodeSource(document, request)).toEqual({ kind: "unavailable", reason: "native_source_unavailable" });
  });
});


const sourceUrl = "https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev/options_hub/gex_history/QQQ/2026-10-20.json";
function sourceResponse(raw: unknown = fixture, status = 200, url = sourceUrl): Response {
  const response = new Response(JSON.stringify(raw), { status });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

describe("injected dated transport plus exact native matcher", () => {
  it("reads the one exact dated object, matches it, and never invokes ambient fetch", async () => {
    const ambient = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ambient fetch forbidden"));
    try {
      const request = await pin();
      const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => sourceResponse());
      expect(await resolveFrozenNodeSource(request, { fetcher })).toEqual({ kind: "matched", target: request.expected });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toBe(sourceUrl);
      expect(ambient).not.toHaveBeenCalled();
      expect((await resolveFrozenNodeSource(request, {} as never)).kind).toBe("unavailable");
      expect(ambient).not.toHaveBeenCalled();
    } finally { ambient.mockRestore(); }
  });

  it("snapshots root/session and the entire expected pin before the fetch await", async () => {
    const request = await pin();
    const expected = structuredClone(request.expected);
    let complete!: (response: Response) => void;
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>(done => { complete = done; }));
    const pending = resolveFrozenNodeSource(request, { fetcher });
    request.expected.root = "SPY"; request.expected.sourceSession = "2026-10-19";
    request.expected.sourceKey = "a".repeat(64); request.expected.members.pop();
    request.expected.sourceBinding.inputSha256 = "b".repeat(64); request.lens = one;
    request.evaluationAt = "2026-10-19T00:00:00Z";
    complete(sourceResponse());
    expect(await pending).toEqual({ kind: "matched", target: expected });
    expect(fetcher.mock.calls[0][0]).toBe(sourceUrl);
  });

  it("returns missing for the original dated object without another read or substitution", async () => {
    const fetcher = vi.fn(async () => sourceResponse(null, 404));
    expect(await resolveFrozenNodeSource(await pin(), { fetcher })).toEqual({ kind: "missing" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses a correction outside the selected native lens even through transport", async () => {
    const request = await pin(fixture, one, 100);
    const corrected = structuredClone(fixture);
    corrected.by_strike[0].strike += 0.01; // outside the native projection, still part of the selected-root document
    expect(native(corrected, one)).toEqual(native(fixture, one));
    expect(await resolveFrozenNodeSource(request, { fetcher: async () => sourceResponse(corrected) }))
      .toEqual({ kind: "unavailable", reason: "source_fingerprint_mismatch" });
  });

  it("refuses document root and native member mismatches rather than taking a usable subset", async () => {
    const request = await pin();
    expect((await resolveFrozenNodeSource(request, { fetcher: async () => sourceResponse({ ...fixture, root: "SPY" }) })).kind).toBe("unavailable");
    request.expected.members.pop();
    expect((await resolveFrozenNodeSource(request, { fetcher: async () => sourceResponse() })).kind).toBe("unavailable");
  });

  it("refuses an unsupported origin before transport and a redirected/final-URL substitution after it", async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => sourceResponse());
    expect((await resolveFrozenNodeSource(await pin(), { fetcher, baseUrl: "https://other.example" })).kind).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
    const response = sourceResponse(fixture, 200, sourceUrl.replace("2026-10-20", "2026-10-21"));
    Object.defineProperty(response, "redirected", { value: true });
    expect((await resolveFrozenNodeSource(await pin(), { fetcher: async () => response })).kind).toBe("unavailable");
  });

  it("withholds oversized or malformed transport/native data as typed unavailable", async () => {
    const oversized = sourceResponse(); oversized.headers.set("content-length", String(8 * 1024 * 1024 + 1));
    expect((await resolveFrozenNodeSource(await pin(), { fetcher: async () => oversized })).kind).toBe("unavailable");
    expect((await resolveFrozenNodeSource(await pin(), { fetcher: async () => ({} as Response) })).kind).toBe("unavailable");
    expect((await resolveFrozenNodeSource(await pin(), { fetcher: async () => sourceResponse({ unexpected: true }) })).kind).toBe("unavailable");
    expect((await resolveFrozenNodeSource(await pin(), { fetcher: async () => { throw new Error("offline"); } })).kind).toBe("unavailable");
  });

  it("does not return condition-authored grant or lifecycle fields as source authority", async () => {
    const request = await pin();
    Object.assign(request.expected, { rights: { allowed: true }, armingEpoch: at, admission: true });
    const fetcher = vi.fn(async () => sourceResponse());
    expect(await resolveFrozenNodeSource(request, { fetcher })).toEqual({ kind: "unavailable", reason: "invalid_source_pin" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
