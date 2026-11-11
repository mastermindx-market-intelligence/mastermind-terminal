import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({ auth: "ok", token: "verified-test-token" }));
vi.mock("@/app/api/billing/gateway", () => ({
  BILLING_BASE: "https://macro.test",
  billingAuthResult: vi.fn(async () => state.auth === "ok" ? { status: "ok", token: state.token } : { status: state.auth }),
}));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(() => ({ ok: true })) }));

import { GET } from "@/app/api/prophet/beta-evaluation/route";
import { decodeBetaEvaluation } from "@/lib/prophetBetaEvaluation";

const realArtifact = (): unknown =>
  JSON.parse(readFileSync(path.join(process.cwd(), "public/data/prophet_beta_evaluation_fixture.json"), "utf8"));
const request = (query = "", signal?: AbortSignal) =>
  new Request(`https://terminal.test/api/prophet/beta-evaluation${query ? `?${query}` : ""}`, { signal });
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  state.auth = "ok";
  delete process.env.FLOW_FIXTURE;
  delete process.env.TERMINAL_E2E_FIXTURE;
  vi.stubGlobal("fetch", vi.fn(async () => json(realArtifact())));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("the strategy-evaluation BFF (live path)", () => {
  it("verifies authentication before any upstream call", async () => {
    state.auth = "denied";
    const result = await GET(request());
    expect(result.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("vary")).toContain("Cookie");
  });

  it("keeps verifier unavailability distinct from a denied session", async () => {
    state.auth = "unavailable";
    expect((await GET(request())).status).toBe(502);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("takes no query parameters at all", async () => {
    for (const query of ["panel=1", "ticker=KO", "x"]) {
      const result = await GET(request(query));
      expect(result.status).toBe(422);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("forwards the bearer token to the frozen upstream singleton and rehosts the artifact verbatim", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://macro.test/api/prophet/beta-evaluation/v1");
    expect(init).toMatchObject({ cache: "no-store", redirect: "error", headers: { Authorization: "Bearer verified-test-token" } });
    const body: unknown = await response.json();
    expect(decodeBetaEvaluation(body)).not.toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("passes the owner's entitlement refusal through without leaking its body", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ detail: "private operator or billing data" }, 403));
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private operator");
  });

  it.each([[404], [502], [503], [500]])("folds upstream %i into the designed unavailable state", async status => {
    vi.mocked(fetch).mockResolvedValue(json({ detail: "nothing yet" }, status));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "evaluation_unavailable" });
  });

  it("does not rehost HTML, malformed JSON or a body outside the closed contract", async () => {
    const mayAuthority = JSON.parse(JSON.stringify(realArtifact())) as Record<string, unknown>;
    mayAuthority.may_size = true;
    for (const bad of [
      new Response("<script>secret()</script>", { headers: { "Content-Type": "text/html" } }),
      new Response("not json", { headers: { "Content-Type": "application/json" } }),
      json(mayAuthority),
    ]) {
      vi.mocked(fetch).mockResolvedValue(bad);
      const response = await GET(request());
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain("secret");
    }
  });

  it("bounds the read even when content length is absent or false", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(" ".repeat(160 * 1024 + 1), {
      headers: { "Content-Type": "application/json", "Content-Length": "1" },
    }));
    expect((await GET(request())).status).toBe(502);
  });

  it("cancels a hanging owner within one bounded deadline", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const pending = GET(request());
    await vi.advanceTimersByTimeAsync(10_001);
    expect((await pending).status).toBe(503);
  });

  it("honors caller cancellation without reaching the owner", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await GET(request("", controller.signal));
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the strategy-evaluation BFF (fixture mode)", () => {
  /** NODE_ENV is read-only in Next's process typings; the seam reads the same
   * runtime slot these tests must be able to pin. */
  const setNodeEnv = (value: string | undefined) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
  };

  it("serves the committed real artifact through the same closed decoder gate", async () => {
    process.env.TERMINAL_E2E_FIXTURE = "1";
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-flow-source")).toBe("fixture");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body: unknown = await response.json();
    expect(decodeBetaEvaluation(body)).not.toBeNull();
  });

  it("fixture mode never reaches the upstream owner", async () => {
    process.env.FLOW_FIXTURE = "1";
    await GET(request());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stays live in a production runtime: a stray fixture variable alone trips the guard", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    setNodeEnv("production");
    delete process.env.TERMINAL_E2E_CANARY;
    process.env.FLOW_FIXTURE = "1";
    try {
      const response = await GET(request());
      expect(response.status).toBe(200); // live path: auth + upstream, no fixture shortcut
      expect(response.headers.get("x-flow-source")).toBeNull();
      expect(fetch).toHaveBeenCalled();
    } finally {
      setNodeEnv(previousNodeEnv);
    }
  });

  it("reaches the fixture branch in production only with the canary marker", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    setNodeEnv("production");
    process.env.TERMINAL_E2E_CANARY = "1";
    process.env.TERMINAL_E2E_FIXTURE = "1";
    try {
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(response.headers.get("x-flow-source")).toBe("fixture");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      setNodeEnv(previousNodeEnv);
      delete process.env.TERMINAL_E2E_CANARY;
    }
  });
});

describe("the strategy-evaluation BFF (throttling)", () => {
  it("carries the local limiter's wait on its 429 (Retry-After, as the sector BFF)", async () => {
    const limited = vi.mocked(await import("@/lib/rateLimit")).rateLimit;
    limited.mockReturnValueOnce({ ok: false, remaining: 0, retryAfterSec: 37 } as never);
    const result = await GET(request());
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("37");
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps an upstream 429 a 429 and forwards the owner's own wait", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "throttled" }), {
      status: 429, headers: { "Content-Type": "application/json", "Retry-After": "17" },
    })));
    const result = await GET(request());
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("17");
  });

  it("keeps an upstream 429 a 429 even when the owner sends no usable wait", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "throttled" }), {
      status: 429, headers: { "Content-Type": "application/json" },
    })));
    const result = await GET(request());
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBeNull();
  });
});
