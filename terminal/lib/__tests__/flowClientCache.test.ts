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

  it("a manual Leaders check forces the server upstream even inside both TTLs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ session_date: "2026-08-12", stale: true }))
      .mockResolvedValueOnce(response({ session_date: "2026-10-08", stale: false }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await flowGetFresh("leaders")).toMatchObject({ session_date: "2026-08-12" });
    // Same clock: an ordinary read would reuse the 25-second client cache.
    expect(await flowGetFresh("leaders", { forceUpstream: true }))
      .toMatchObject({ session_date: "2026-10-08" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/flow?f=leaders");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/flow?f=leaders&refresh=1");
    expect(await flowGet("leaders")).toMatchObject({ session_date: "2026-10-08" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waits for an existing normal cache read before forcing its own source check", async () => {
    let release!: (value: ReturnType<typeof response>) => void;
    const pending = new Promise<ReturnType<typeof response>>((resolve) => { release = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ session_date: "2026-08-12" }))
      .mockImplementationOnce(() => pending)
      .mockResolvedValueOnce(response({ session_date: "2026-10-08" }));
    vi.stubGlobal("fetch", fetchMock);
    await flowGetFresh("leaders");
    now = 26_000;
    // Starts the existing ordinary background refresh.
    await flowGet("leaders");
    const forced = flowGetFresh("leaders", { forceUpstream: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    release(response({ session_date: "2026-10-07" }));
    expect(await forced).toMatchObject({ session_date: "2026-10-08" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/flow?f=leaders&refresh=1");
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
