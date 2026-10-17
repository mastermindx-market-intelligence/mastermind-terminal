// @vitest-environment node
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { LangProvider } from "../i18n";
import CompanyThemeContextCard from "@/components/fin/CompanyThemeContextCard";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinEnvironments } from "vitest/environments";
import { createHash } from "node:crypto";

const state = vi.hoisted(() => ({
  user: true,
  resolveCompanyIntelligence: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: state.user ? { id: "reader" } : null } })) },
  })),
}));

vi.mock("@/lib/companyIntelligence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/companyIntelligence")>();
  return { ...actual, resolveCompanyIntelligenceFromR2: state.resolveCompanyIntelligence };
});

import { __resetCompanyThemeExposureCacheForTests, getCompanyThemeExposure } from "@/lib/companyThemeExposure";
import { GET } from "@/app/api/company-theme-context/[symbol]/route";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const generation = "a".repeat(24);
const companyGeneration = "b".repeat(24);
const latestEventId = "NVDA-2026Q1";
const body = {
  schema: "company_theme_exposure.v1", authority: "context_only", generated_at: "2026-08-01T12:00:00Z", generation_id: generation, status: "ready",
  company: { ticker: "NVDA" },
  company_intelligence: { generation_id: companyGeneration, context_sha256: "c".repeat(64), latest_event_id: latestEventId, latest_event_call_date: "2026-05-28" },
  exposures: [{ theme_id: "ai_infrastructure", name_en: "AI Infrastructure", name_zh: "人工智能基础设施", basket_id: "ai_semiconductors", mapping_qualifier: "proxy" }],
  coverage: { status: "mapped", active_basket_count: 1, mapped_basket_count: 1, unmapped_basket_count: 0 },
  theme_state: { status: "fresh", as_of: "2026-08-01", sha256: "d".repeat(64) }, warnings: [],
};
const raw = JSON.stringify(body);
const root = {
  schema: "company_theme_exposure_manifest.v1", generation_id: generation, generated_at: "2026-08-01T12:00:00Z", company_count: 1, exposure_count: 1,
  coverage: { active_membership_count: 1, mapped_membership_count: 1, unmapped_membership_count: 0, active_member_ticker_count: 1, unmapped_only_ticker_count: 0, active_member_tickers_without_company_context: 0 },
  source: { company_intelligence: { generation_id: companyGeneration, sha256: "e".repeat(64) }, membership: { sha256: "f".repeat(64) }, crosswalk: { sha256: "1".repeat(64) }, theme_state: { status: "fresh", as_of: "2026-08-01", sha256: "d".repeat(64) }, builder: "company_theme_exposure.v1" },
  files: { "companies/NVDA.json": { sha256: createHash("sha256").update(raw).digest("hex"), bytes: Buffer.byteLength(raw) } }, status: "ready", warnings: [],
};

let originalFetch: typeof globalThis.fetch;
let ip = 0;

beforeEach(() => {
  __resetCompanyThemeExposureCacheForTests();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-01T12:00:01Z"));
  originalFetch = globalThis.fetch;
  delete process.env.TERMINAL_E2E_FIXTURE;
  state.user = true;
  state.resolveCompanyIntelligence.mockResolvedValue({
    ok: true,
    state: "ready",
    context: { generation_id: companyGeneration, latest_event_id: latestEventId },
  });
  globalThis.fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("companies/NVDA.json") ? body : root))) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.TERMINAL_E2E_FIXTURE;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const request = (address = `203.0.113.${++ip}`) => new Request("https://app.mastermind-x.com/api/company-theme-context/NVDA", { headers: { "cf-connecting-ip": address } });
const params = (symbol: string) => ({ params: Promise.resolve({ symbol }) });

describe("/api/company-theme-context/[symbol]", () => {
  it("round-trips a future-source derived partial from verified resolver through API to browser and mounted card", async () => {
    const futureBody = { ...body, theme_state: { ...body.theme_state, as_of: "2026-08-02" } };
    const futureRaw = JSON.stringify(futureBody);
    const futureHash = createHash("sha256").update(futureRaw).digest("hex");
    const futureRoot = {
      ...root,
      source: { ...root.source, theme_state: futureBody.theme_state },
      files: { "companies/NVDA.json": { sha256: futureHash, bytes: Buffer.byteLength(futureRaw) } },
    };
    globalThis.fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("companies/NVDA.json") ? futureBody : futureRoot))) as unknown as typeof globalThis.fetch;
    const response = await GET(request(), params("NVDA"));
    expect(response.status).toBe(200);
    const wire = await response.json();
    expect(wire).toMatchObject({ ok: true, state: "partial", context: { status: "ready" }, freshness: { status: "future" } });
    expect(wire.context).toEqual({ ...futureBody, is_context_only: true });
    expect(createHash("sha256").update(futureRaw).digest("hex")).toBe(futureHash);
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(wire))) as unknown as typeof globalThis.fetch;
    expect(await getCompanyThemeExposure("NVDA")).toMatchObject({ ok: true, state: "partial", context: { status: "ready" }, freshness: { status: "future" } });
    // Resolve/hash the server receipt in Node. A DOM belongs only to the
    // mounted browser leg: jsdom's ArrayBuffer cannot feed Node 20 WebCrypto.
    const browserEnvironment = await builtinEnvironments.jsdom.setup(globalThis, {
      jsdom: { runScripts: "outside-only" },
    });
    try {
      const host = document.createElement("div");
      document.body.append(host);
      const mounted = createRoot(host);
      try {
        await act(async () => mounted.render(React.createElement(LangProvider, null, React.createElement(CompanyThemeContextCard, {
          ticker: "NVDA", selectedEventId: latestEventId, selectedEventLabel: "Q1 FY2026", companyIntelligenceGenerationId: companyGeneration, latestEventId,
        }))));
        expect(host.querySelector(".ci-theme-footer")?.textContent).toContain("Future date");
        expect(host.querySelector(".ci-theme-header")?.textContent).toContain("Partial");
        expect(host.querySelector(".ci-theme-warning")?.textContent).toContain("not used");
        expect(host.querySelector(".ci-theme-unavailable")).toBeNull();
      } finally {
        await act(async () => mounted.unmount());
        host.remove();
      }
    } finally {
      await browserEnvironment.teardown(globalThis);
    }
  });
  it("ages a hash-verified HTTP200 publication without changing its context receipts", async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-08-07T00:00:00Z"));
    const response = await GET(request(), params("NVDA"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const result = await response.json();
    expect(result).toMatchObject({ ok: true, state: "stale", freshness: { status: "stale", reason: "expired", expires_at: "2026-08-07T00:00:00.000Z" } });
    expect(result.context).toEqual({ ...body, is_context_only: true });
  });
  it("returns a receipt-verified payload aligned to current Company Intelligence", async () => {
    const response = await GET(request(), params("NVDA"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ schema: "mastermind.company-theme-context/v1", ok: true, state: "ready", context: { is_context_only: true, exposures: [{ mapping_qualifier: "proxy" }] } });
    expect(state.resolveCompanyIntelligence).toHaveBeenCalled();
  });

  it("requires a server-verified session before either data plane is read", async () => {
    state.user = false;
    const response = await GET(request(), params("NVDA"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "unauthorized", retryable: false } });
    expect(state.resolveCompanyIntelligence).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed ticker segments before upstream access", async () => {
    const upstream = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    for (const symbol of ["NVDA/../../secret", "NVDA%2Fsecret", "NVDA?x=1", "NVDA#x"]) {
      const response = await GET(request(), params(symbol));
      expect(response.status, symbol).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
    expect(state.resolveCompanyIntelligence).not.toHaveBeenCalled();
  });

  it("quarantines a sidecar whose Company Intelligence generation lags current", async () => {
    state.resolveCompanyIntelligence.mockResolvedValueOnce({
      ok: true,
      state: "ready",
      context: { generation_id: "7".repeat(24), latest_event_id: latestEventId },
    });
    const response = await GET(request(), params("NVDA"));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "invalid_payload", retryable: true } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not read the sidecar when current Company Intelligence is unavailable", async () => {
    state.resolveCompanyIntelligence.mockResolvedValueOnce({ ok: false, state: "error", error: { code: "upstream_unavailable", message: "down", retryable: true } });
    const response = await GET(request(), params("NVDA"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "upstream_unavailable", retryable: true } });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns a browser-parseable no-store rate-limit envelope", async () => {
    const address = `198.51.100.${++ip}`;
    for (let attempt = 0; attempt < 60; attempt += 1) expect((await GET(request(address), params("NVDA"))).status).toBe(200);
    const throttled = await GET(request(address), params("NVDA"));
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("cache-control")).toBe("no-store");
    expect(Number(throttled.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await throttled.json()).toMatchObject({ schema: "mastermind.company-theme-context/v1", ok: false, state: "error", error: { code: "upstream_unavailable", retryable: true } });
  });
});
