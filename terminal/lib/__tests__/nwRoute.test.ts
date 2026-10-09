import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(__dirname, "..", "..");
const PLANE_FIXTURE = JSON.parse(
  readFileSync(join(ROOT, "public", "data", "nw_plane_fixture.json"), "utf8"),
);

const envSnapshot = { ...process.env };

// The caller's own Supabase session (chunked, as @supabase/ssr writes it) amid unrelated cookies.
const SB0 = "sb-fsldfzlxyavsuwqbceod-auth-token.0=base64-eyJhY2Nlc3MiOiJ4In0=";
const SB1 = "sb-fsldfzlxyavsuwqbceod-auth-token.1=part-1";
const SB_WHOLE = "sb-fsldfzlxyavsuwqbceod-auth-token=base64-whole";
const ENTITLED = `${SB0}; ${SB1}`;
const PAYLOAD = { schema: "mastermind.selection_cohort_projection.v1", secret_marker: "PAID-BYTES-7f3a" };

function req(f: string | null, cookie?: string): Request {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("cookie", cookie);
  return new Request(`https://x.test/api/nw${f === null ? "" : `?f=${f}`}`, { headers });
}

function upstream(status: number, body: unknown = null, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fetchInit(call = 0): RequestInit {
  return vi.mocked(fetch).mock.calls[call][1] as RequestInit;
}

function sentCookie(call = 0): string | null {
  return new Headers(fetchInit(call).headers).get("cookie");
}

function expectPrivate(res: Response): void {
  expect(res.headers.get("cache-control")).toBe("private, no-store");
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...envSnapshot };
  delete process.env.NW_FIXTURE;
  delete process.env.NW_DATA_BASE;
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...envSnapshot };
});

describe("/api/nw fixture mode (unchanged)", () => {
  it("NW_FIXTURE=1 + selection_cohort_us -> 503 fixture unavailable", async () => {
    process.env.NW_FIXTURE = "1";
    const { GET } = await import("@/app/api/nw/route");
    const res = await GET(req("selection_cohort_us"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "fixture unavailable" });
  });

  it("NW_FIXTURE=1 default f serves market_plane fixture unchanged", async () => {
    process.env.NW_FIXTURE = "1";
    const { GET } = await import("@/app/api/nw/route");
    const res = await GET(req(null));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PLANE_FIXTURE);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("/api/nw entitlement relay (T-NW-AUTH)", () => {
  it("NW_BASE defaults to the canonical www host", async () => {
    const { NW_BASE } = await import("@/lib/upstreams");
    expect(NW_BASE).toBe("https://www.mastermind-x.com/neuralwebdata");
  });

  it("T1 no Supabase session cookie -> 401 sign_in_required and no upstream fetch", async () => {
    const { GET } = await import("@/app/api/nw/route");
    for (const cookie of [undefined, "", "theme=dark; mm_lang=zh", "sb-fsldfzlxyavsuwqbceod-auth-token-code-verifier=v"]) {
      const res = await GET(req("market_plane", cookie));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "sign_in_required" });
      expectPrivate(res);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("T2 upstream receives ONLY the sb-*-auth-token cookies (chunked and whole)", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(upstream(200, PAYLOAD))
      .mockResolvedValueOnce(upstream(200, PAYLOAD));
    const { GET } = await import("@/app/api/nw/route");
    const mixed = `theme=dark; ${SB0}; mm_session=zzz; ${SB1}; sb-fsldfzlxyavsuwqbceod-auth-token-code-verifier=v; sb-abc-auth-token.123=x; SB-ABC-auth-token=y`;
    expect((await GET(req("selection_cohort_us", mixed))).status).toBe(200);
    expect(sentCookie(0)).toBe(ENTITLED);
    expect((await GET(req("market_plane", `a=1; ${SB_WHOLE}; b=2`))).status).toBe(200);
    expect(sentCookie(1)).toBe(SB_WHOLE);
    for (const call of [0, 1]) {
      const sent = sentCookie(call) ?? "";
      for (const stray of ["theme=", "mm_session=", "code-verifier", "a=1", "b=2", ".123", "SB-ABC"]) {
        expect(sent).not.toContain(stray);
      }
      expect(new Headers(fetchInit(call).headers).get("authorization")).toBeNull();
    }
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      "https://www.mastermind-x.com/neuralwebdata/selection_cohort/us.json",
    );
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe(
      "https://www.mastermind-x.com/neuralwebdata/market_plane.json",
    );
  });

  it("T3 upstream 401 -> 401 sign_in_required; 403 and 402 -> 403 not_entitled", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(upstream(401, { detail: "login" }))
      .mockResolvedValueOnce(upstream(403, { detail: "paywall" }))
      .mockResolvedValueOnce(upstream(402, { detail: "pay" }));
    const { GET } = await import("@/app/api/nw/route");
    const r401 = await GET(req("market_plane", ENTITLED));
    expect(r401.status).toBe(401);
    expect(await r401.json()).toEqual({ error: "sign_in_required" });
    expectPrivate(r401);
    for (let i = 0; i < 2; i++) {
      const res = await GET(req("selection_cohort_us", ENTITLED));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "not_entitled" });
      expectPrivate(res);
    }
  });

  it("T4 upstream 301/302 -> 503, fetched with redirect:'manual' and never followed", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(upstream(301, null, { location: "https://evil.example/neuralwebdata/market_plane.json" }))
      .mockResolvedValueOnce(upstream(302, null, { location: "https://www.mastermind-x.com/login" }));
    const { GET } = await import("@/app/api/nw/route");
    for (const f of ["market_plane", "selection_cohort_us"]) {
      const res = await GET(req(f, ENTITLED));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "feed unavailable" });
      expectPrivate(res);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of [0, 1]) {
      expect(fetchInit(call)).toMatchObject({ redirect: "manual", cache: "no-store" });
    }
  });

  it("T5 upstream 200 -> 200 body with Cache-Control private, no-store", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(upstream(200, PAYLOAD));
    const { GET } = await import("@/app/api/nw/route");
    const res = await GET(req("selection_cohort_us", ENTITLED));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PAYLOAD);
    expectPrivate(res);
    expect(res.headers.get("vary")).toBe("Cookie");
  });

  it("T6 LEAK REGRESSION: entitled bytes never reach a later anonymous caller, and never serve stale", async () => {
    // One module instance across all three calls: this is exactly the shared state the old CACHE lived in.
    vi.mocked(fetch)
      .mockResolvedValueOnce(upstream(200, PAYLOAD))
      .mockRejectedValueOnce(new Error("network"));
    const { GET } = await import("@/app/api/nw/route");

    const entitled = await GET(req("selection_cohort_us", ENTITLED));
    expect(entitled.status).toBe(200);
    expect(await entitled.json()).toEqual(PAYLOAD);

    const anonymous = await GET(req("selection_cohort_us", "theme=dark"));
    expect(anonymous.status).toBe(401);
    const anonText = await anonymous.text();
    expect(anonText).not.toContain("PAID-BYTES-7f3a");
    expect(JSON.parse(anonText)).toEqual({ error: "sign_in_required" });
    expect(fetch).toHaveBeenCalledTimes(1);

    const failing = await GET(req("selection_cohort_us", ENTITLED));
    expect(failing.status).toBe(503);
    const failText = await failing.text();
    expect(failText).not.toContain("PAID-BYTES-7f3a");
    expect(failText).not.toContain("stale");
    expect(JSON.parse(failText)).toEqual({ error: "feed unavailable" });
    expectPrivate(failing);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("T7 unknown f -> 400 bad f param (unchanged), before any cookie check or fetch", async () => {
    const { GET } = await import("@/app/api/nw/route");
    for (const cookie of [undefined, ENTITLED]) {
      const res = await GET(req("nope", cookie));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad f param" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("upstream 5xx, network failure and an unparseable 200 body -> 503 feed unavailable", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(upstream(500, { detail: "boom" }))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response("<html>not json</html>", { status: 200 }));
    const { GET } = await import("@/app/api/nw/route");
    for (let i = 0; i < 3; i++) {
      const res = await GET(req("market_plane", ENTITLED));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "feed unavailable" });
      expectPrivate(res);
    }
  });
});
