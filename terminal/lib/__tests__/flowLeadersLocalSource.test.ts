import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import { localFlowArtifactPath, tryFetchUpstream } from "@/lib/flowSource";

let dir = "";
let realFetch: typeof globalThis.fetch;
let priorLocalPath: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "flow-leaders-local-"));
  realFetch = globalThis.fetch;
  priorLocalPath = process.env.FLOW_LEADERS_LOCAL_PATH;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  if (priorLocalPath === undefined) delete process.env.FLOW_LEADERS_LOCAL_PATH;
  else process.env.FLOW_LEADERS_LOCAL_PATH = priorLocalPath;
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("Flow Leaders co-located artifact source", () => {
  it("reads the canonical local artifact before touching backend or R2", async () => {
    const file = path.join(dir, "leaders.json");
    await writeFile(file, JSON.stringify({
      schema: "flow_leaders.v1",
      session_date: "2026-08-12",
      stale: true,
      board_a: [{ ticker: "AAPL" }],
      board_b: [],
    }));
    process.env.FLOW_LEADERS_LOCAL_PATH = file;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network must not be reached when local artifact is valid");
    }) as unknown as typeof globalThis.fetch;

    const result = await tryFetchUpstream("leaders");

    expect(result?.schema).toBe("flow_leaders.v1");
    expect(result?.session_date).toBe("2026-08-12");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("falls through when the local artifact is absent or malformed", async () => {
    const file = path.join(dir, "leaders.json");
    await writeFile(file, '{"schema":"flow_leaders.v1","bad":NaN}');
    process.env.FLOW_LEADERS_LOCAL_PATH = file;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:8000")) {
        return new Response("not found", { status: 404 });
      }
      return new Response(JSON.stringify({
        schema: "flow_leaders.v1",
        session_date: "2026-08-12",
        stale: true,
        source: "r2",
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await tryFetchUpstream("leaders");

    expect(result?.source).toBe("r2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not invent local paths for unrelated flow families", () => {
    delete process.env.FLOW_LEADERS_LOCAL_PATH;
    expect(localFlowArtifactPath("leaders")).toBe("/opt/macro/site/flowleaders/leaders.json");
    expect(localFlowArtifactPath("radar")).toBeNull();
    expect(localFlowArtifactPath("feed")).toBeNull();
  });
});
