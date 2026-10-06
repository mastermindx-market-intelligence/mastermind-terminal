import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(__dirname, "..", "..");
const PLANE_FIXTURE = JSON.parse(
  readFileSync(join(ROOT, "public", "data", "nw_plane_fixture.json"), "utf8"),
);

const envSnapshot = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...envSnapshot };
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...envSnapshot };
});

describe("/api/nw", () => {
  it("NW_FIXTURE=1 + selection_cohort_us -> 503 fixture unavailable", async () => {
    process.env.NW_FIXTURE = "1";
    const { GET } = await import("@/app/api/nw/route");
    const res = await GET(new Request("https://x.test/api/nw?f=selection_cohort_us"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "fixture unavailable" });
  });

  it("NW_FIXTURE=1 default f serves market_plane fixture unchanged", async () => {
    process.env.NW_FIXTURE = "1";
    const { GET } = await import("@/app/api/nw/route");
    const res = await GET(new Request("https://x.test/api/nw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(PLANE_FIXTURE);
  });

  it("bad f param -> 400", async () => {
    process.env.NW_FIXTURE = "1";
    const { GET } = await import("@/app/api/nw/route");
    const res = await GET(new Request("https://x.test/api/nw?f=nope"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad f param" });
  });

  it("live fetch selection_cohort/us.json passes through", async () => {
    delete process.env.NW_FIXTURE;
    const payload = { schema: "mastermind.selection_cohort_projection.v1", ok: true };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    } as Response);
    const { GET } = await import("@/app/api/nw/route");
    const res = await GET(new Request("https://x.test/api/nw?f=selection_cohort_us"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url.endsWith("/selection_cohort/us.json")).toBe(true);
  });

  it("fetch failure with no cache -> 503 feed unavailable", async () => {
    delete process.env.NW_FIXTURE;
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
    const { GET } = await import("@/app/api/nw/route");
    const res = await GET(new Request("https://x.test/api/nw?f=selection_cohort_us"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "feed unavailable" });
  });
});
