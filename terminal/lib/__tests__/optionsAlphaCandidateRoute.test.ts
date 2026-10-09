import { beforeEach, describe, expect, it, vi } from "vitest";

const hasLiveOptions = vi.fn(); const pair = vi.fn(); const upstream = vi.fn();
vi.mock("next/server", () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { ...init, headers: init?.headers }) } }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: () => new Response("limited", { status: 429 }) }));
vi.mock("@/lib/entitlement", () => ({ hasLiveOptions }));
vi.mock("@/lib/optionsAlphaCandidatePair", () => ({ fetchOptionsAlphaCandidatePair: pair }));
vi.mock("@/lib/flowSource", () => ({ isValidF: () => true, fixtureFor: vi.fn(), attachFlowScores: vi.fn(), tryFetchUpstream: upstream, tryFetchUpstreamResult: upstream }));
const { GET } = await import("@/app/api/flow/route");

beforeEach(() => { vi.clearAllMocks(); delete process.env.FLOW_FIXTURE; });
describe("Options Alpha candidate route boundary", () => {
  it("checks entitlement before R2 and returns an uncacheable 403", async () => {
    hasLiveOptions.mockResolvedValue(false);
    const response = await GET(new Request("http://terminal/api/flow?f=options_alpha_candidate_feed"));
    expect(response.status).toBe(403); expect(pair).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("uses the verified pair directly and never enters generic upstream/cache work", async () => {
    hasLiveOptions.mockResolvedValue(true); pair.mockResolvedValue({ feed: {}, receipt: {}, metadata: {} });
    const response = await GET(new Request("http://terminal/api/flow?f=options_alpha_candidate_feed"));
    expect(response.status).toBe(200); expect(pair).toHaveBeenCalledOnce(); expect(upstream).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns private no-store 503 when the pair verifier fails", async () => {
    hasLiveOptions.mockResolvedValue(true); pair.mockRejectedValue(new Error("bad receipt"));
    const response = await GET(new Request("http://terminal/api/flow?f=options_alpha_candidate_feed"));
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("refuses the obsolete single-object fixture path", async () => {
    process.env.FLOW_FIXTURE = "1"; hasLiveOptions.mockResolvedValue(true);
    const response = await GET(new Request("http://terminal/api/flow?f=options_alpha_candidate_feed"));
    expect(response.status).toBe(503); expect(pair).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
