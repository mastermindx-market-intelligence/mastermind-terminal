import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic authentication exists only inside this unit test. No account/session
// is installed, no network is used, and these cases are not production auth proof.
const auth = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth })) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/upstreams", () => ({ NW_BASE: "https://mastermind-x.com" }));
import { GET } from "@/app/api/sector-intelligence/route";

const request = (source: string) => new Request(`http://localhost/api/sector-intelligence?source=${source}`);
const payload = { as_of: "2026-09-25", sectors: [] };
let upstream: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: "test-owner" } }, error: null });
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: "test-owner" }, access_token: "synthetic-unit-token" } } });
  upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("sector gateway owner-envelope admission", () => {
  it("does not fetch owner JSON without a validated user", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(request("sector"));
    expect(response.status).toBe(401); expect(upstream).not.toHaveBeenCalled();
    expect((await response.json()).data).toBeNull();
  });
  it("does not forward a session belonging to a different user", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "other-owner" }, access_token: "synthetic-unit-token" } } });
    expect((await GET(request("sector"))).status).toBe(401); expect(upstream).not.toHaveBeenCalled();
  });
  it("preserves an authorized owner envelope, source clock and exact content digest", async () => {
    const raw = JSON.stringify(payload);
    upstream.mockResolvedValue(new Response(raw, { headers: { "Content-Type": "application/json" } }));
    const response = await GET(request("sector")), result = await response.json();
    expect(response.status).toBe(200); expect(result.data).toEqual(payload);
    expect(result.receipt.asOf).toBe("2026-09-25");
    expect(result.receipt.contentHash).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(String(upstream.mock.calls[0][0])).toBe("https://mastermind-x.com/sectordata/sector_central.json");
    expect(upstream.mock.calls[0][1]).toMatchObject({ redirect: "manual", cache: "no-store" });
  });
  it("rejects a flat theme fixture rather than accepting it as the real owner schema", async () => {
    upstream.mockResolvedValue(Response.json({ themes: [{ theme_id: "memory", stage: "WATCH", entry_ready: false }] }));
    const response = await GET(request("themes")), result = await response.json();
    expect(response.status).toBe(502); expect(result.data).toBeNull(); expect(result.receipt.status).toBe("invalid");
  });
  it("keeps a valid empty theme collection distinct from an invalid response", async () => {
    const data = { schema: "neuralweb.theme_state.v1", as_of: "2026-09-26", themes: [] };
    upstream.mockResolvedValue(Response.json(data));
    const response = await GET(request("themes"));
    expect(response.status).toBe(200); expect((await response.json()).data).toEqual(data);
  });
  it("does not relay an upstream authorization failure as usable JSON", async () => {
    upstream.mockResolvedValue(Response.json(payload, { status: 403 }));
    const response = await GET(request("sector")), result = await response.json();
    expect(response.status).toBe(403); expect(result.data).toBeNull(); expect(result.receipt.status).toBe("access");
  });
  it("does not follow an upstream redirect or expose its body", async () => {
    upstream.mockResolvedValue(new Response("untrusted redirect", { status: 302, headers: { location: "https://example.invalid" } }));
    const response = await GET(request("sector"));
    expect(response.status).toBe(503); expect(upstream).toHaveBeenCalledTimes(1);
    expect((await response.json()).data).toBeNull();
  });
  it("does not accept an HTML login page as sector data", async () => {
    upstream.mockResolvedValue(new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } }));
    const response = await GET(request("sector"));
    expect(response.status).toBe(502); expect((await response.json()).receipt.status).toBe("invalid");
  });
});
