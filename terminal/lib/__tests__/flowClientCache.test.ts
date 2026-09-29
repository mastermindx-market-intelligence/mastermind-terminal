import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flowGet, flowGetFresh, flowInvalidate } from "@/lib/flowClientCache";

const response = (body: unknown) => ({
  ok: true,
  json: async () => body,
});

describe("flowClientCache fresh revalidation", () => {
  let now = 0;

  beforeEach(() => {
    flowInvalidate();
    now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    flowInvalidate();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps flowGet stale-while-revalidate semantics unchanged", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ asof: "2026-09-14" }))
      .mockResolvedValueOnce(response({ asof: "2026-09-17" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await flowGet("gex:GOOGL")).toEqual({ asof: "2026-09-14" });
    now = 26_000;

    // The ordinary reader still gets the cached snapshot immediately.
    expect(await flowGet("gex:GOOGL")).toEqual({ asof: "2026-09-14" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("blocks on stale revalidation when a mounted consumer explicitly needs fresh data", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ asof: "2026-09-14" }))
      .mockResolvedValueOnce(response({ asof: "2026-09-17" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await flowGet("gex:GOOGL")).toEqual({ asof: "2026-09-14" });
    now = 26_000;

    expect(await flowGetFresh("gex:GOOGL")).toEqual({ asof: "2026-09-17" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The fresh value remains in the same shared cache; no third network owner/read is created.
    expect(await flowGet("gex:GOOGL")).toEqual({ asof: "2026-09-17" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explicit user refresh revalidates inside TTL through the same deduplicated owner", async () => {
    let release!: (value: ReturnType<typeof response>) => void;
    const pending = new Promise<ReturnType<typeof response>>(resolve => { release = resolve; });
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ root: "QQQ" })).mockImplementationOnce(() => pending);
    vi.stubGlobal("fetch", fetchMock);
    expect(await flowGetFresh("matrix:SPY")).toEqual({ root: "QQQ" });
    now = 1000;
    const a = flowGetFresh("matrix:SPY", true), b = flowGetFresh("matrix:SPY", true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    release(response({ root: "SPY" }));
    expect(await a).toEqual({ root: "SPY" }); expect(await b).toEqual({ root: "SPY" });
    expect(await flowGet("matrix:SPY")).toEqual({ root: "SPY" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("joins an in-flight SWR refresh instead of starting a duplicate fetch", async () => {
    let release!: (value: ReturnType<typeof response>) => void;
    const pending = new Promise<ReturnType<typeof response>>((resolve) => { release = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ asof: "2026-09-14" }))
      .mockImplementationOnce(() => pending);
    vi.stubGlobal("fetch", fetchMock);

    expect(await flowGet("gex:GOOGL")).toEqual({ asof: "2026-09-14" });
    now = 26_000;

    expect(await flowGet("gex:GOOGL")).toEqual({ asof: "2026-09-14" });
    const freshRead = flowGetFresh("gex:GOOGL");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    release(response({ asof: "2026-09-17" }));
    expect(await freshRead).toEqual({ asof: "2026-09-17" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
