import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flowGet, flowGetResult, flowInvalidate } from "@/lib/flowClientCache";

// flowGetResult carries the same availability contract as dataCache's getJSONResult: only a
// 404/410 from /api/flow is a published absence; a 5xx, a refused fetch or a body that does not
// parse says nothing about whether the payload exists. flowGet keeps its null contract.
const reply = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

beforeEach(() => flowInvalidate());
afterEach(() => {
  flowInvalidate();
  vi.unstubAllGlobals();
});

describe("flowGetResult classification", () => {
  it.each([404, 410])("classifies a %i as a published absence", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(JSON.stringify({ error: "not published" }), status)));
    expect(await flowGetResult("vol:ZZZ")).toEqual({ status: "absent", httpStatus: status });
  });

  it.each([500, 502, 503, 403, 429])("classifies a %i as a server failure, not an absence", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => reply("{}", status)));
    expect(await flowGetResult("vol:SPY")).toEqual({ status: "unavailable", reason: "server", httpStatus: status });
  });

  it("classifies a rejected fetch as a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await flowGetResult("vol:SPY")).toEqual({ status: "unavailable", reason: "network" });
  });

  it.each([
    ["an unparseable body", "<html>bad gateway</html>"],
    ["a JSON null body", "null"],
  ])("classifies %s as malformed", async (_label, body) => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(body)));
    expect(await flowGetResult("vol:SPY")).toEqual({ status: "unavailable", reason: "malformed", httpStatus: 200 });
  });

  it("returns data through the same shared cache flowGet reads", async () => {
    const transport = vi.fn(async () => reply(JSON.stringify({ root: "SPY" })));
    vi.stubGlobal("fetch", transport);
    expect(await flowGetResult("vol:SPY")).toEqual({ status: "data", data: { root: "SPY" } });
    expect(await flowGet("vol:SPY")).toEqual({ root: "SPY" });
    expect(await flowGetResult("vol:SPY")).toEqual({ status: "data", data: { root: "SPY" } });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("never remembers a failure or an absence: each next read asks again", async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(reply("{}", 503))
      .mockResolvedValueOnce(reply("{}", 404))
      .mockResolvedValueOnce(reply(JSON.stringify({ root: "SPY" })));
    vi.stubGlobal("fetch", transport);
    expect((await flowGetResult("vol:SPY")).status).toBe("unavailable");
    expect((await flowGetResult("vol:SPY")).status).toBe("absent");
    expect(await flowGetResult("vol:SPY")).toEqual({ status: "data", data: { root: "SPY" } });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("joins a flowGet already in flight instead of opening a second request", async () => {
    let finish!: (response: Response) => void;
    const transport = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", transport);
    const legacy = flowGet("vol:SPY");
    const outcome = flowGetResult("vol:SPY");
    expect(transport).toHaveBeenCalledTimes(1);
    finish(reply("{}", 503));
    expect(await legacy).toBeNull();
    expect(await outcome).toEqual({ status: "unavailable", reason: "server", httpStatus: 503 });
  });

  it("keeps flowGet's null contract for every non-data outcome", async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(reply("{}", 404))
      .mockResolvedValueOnce(reply("{}", 503))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(reply("<html>"));
    vi.stubGlobal("fetch", transport);
    for (let i = 0; i < 4; i++) expect(await flowGet("gex:SPY")).toBeNull();
    expect(transport).toHaveBeenCalledTimes(4);
  });
});
