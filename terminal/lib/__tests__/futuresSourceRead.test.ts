import { afterEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
vi.mock("server-only", () => ({}));
import { readFuturesSource } from "../futuresSourceRead";
import { DEFAULT_FUTURES_REQUEST } from "../futuresRequest";
import { sourceFixture, fixtureNow } from "./fixtures/futuresSourceFixture";
const fetcher = vi.fn();
function response() {
  const body = JSON.stringify(sourceFixture());
  return new Response(body, { headers: { "content-type": "application/json", "x-futures-source-sha256": createHash("sha256").update(body).digest("hex") } });
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetcher.mockReset(); });
const ask = () => { vi.stubGlobal("fetch", fetcher); return readFuturesSource(DEFAULT_FUTURES_REQUEST, fixtureNow); };
describe("source relay remains bound to the existing loopback Quote Hub", () => {
  it("accepts exact source bytes and never follows redirects or sends user credentials", async () => {
    vi.stubEnv("HUB_PORT", "3100"); fetcher.mockResolvedValue(response()); const result = await ask(); expect(result.status).toBe("data");
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:3100/futures?pair=ES&interval=1&rows=1");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("headers.Authorization");
  });
  it("rejects port injection before any network effect", async () => {
    vi.stubEnv("HUB_PORT", "3100/../../elsewhere"); expect((await ask()).status).toBe("unavailable"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("missing or incorrect hash cannot be made valid by a successful HTTP code", async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify(sourceFixture()))); expect((await ask()).status).toBe("unavailable");
  });
  for (const code of [301, 403, 404, 500, 503]) it(`does not interpret HTTP ${code} as an empty market`, async () => {
    fetcher.mockResolvedValue(new Response("unavailable", { status: code })); expect((await ask()).status).toBe("unavailable");
  });
  it("oversized declared bodies are cancelled", async () => {
    const r = response(); r.headers.set("content-length", String(8 * 1024 * 1024)); fetcher.mockResolvedValue(r);
    expect((await ask()).status).toBe("unavailable"); expect(r.bodyUsed).toBe(true);
  });
  it("undeclared streaming body is bounded too", async () => {
    let cancellations = 0;
    const stream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancellations++; } });
    fetcher.mockResolvedValue(new Response(stream)); expect((await ask()).status).toBe("unavailable"); expect(cancellations).toBe(1);
  });
  it("network errors return no source values", async () => {
    fetcher.mockRejectedValue(Error("offline")); expect(await ask()).toEqual({ status: "unavailable", reason: "source_unavailable" });
  });
});

describe("source refusal meaning survives the existing relay", () => {
  for (const reason of ["source_restricted", "source_invalid"] as const) it(`retains ${reason} without data`, async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ error: reason }), { status: 503 }));
    expect(await ask()).toEqual({ status: "unavailable", reason });
  });
  it("does not forward arbitrary upstream diagnostics", async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ error: "private-path-or-token" }), { status: 503 }));
    expect(await ask()).toEqual({ status: "unavailable", reason: "source_unavailable" });
  });
});
