import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import {
  isQualifiedLeadersArtifact, localFlowArtifactPath,
  tryFetchUpstream, upstreamSourceOrder,
} from "@/lib/flowSource";

let dir = "";
let realFetch: typeof globalThis.fetch;
let priorLocalPath: string | undefined;

const today = () => new Date().toISOString().slice(0, 10);
const candidate = (session: string, extra: Record<string, unknown> = {}) => ({
  schema: "flow_leaders.v1",
  as_of: new Date().toISOString(),
  session_date: session,
  stale: true,
  board_a: [{ ticker: "AAPL" }],
  board_b: [],
  ...extra,
});
const qualified = (session = today()) => candidate(session, {
  stale: false,
  source_family: "thetadata_t2a_tape",
  coverage: { n_expected_roots: 375, n_current_roots: 340 },
});
const jsonResponse = (data: Record<string, unknown>) =>
  new Response(JSON.stringify(data), {
    status: 200, headers: { "content-type": "application/json" },
  });

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

describe("Flow Leaders current-source admission and fallback", () => {
  it("reads a qualified local Theta artifact without network latency", async () => {
    const file = path.join(dir, "leaders.json");
    await writeFile(file, JSON.stringify(qualified()));
    process.env.FLOW_LEADERS_LOCAL_PATH = file;
    globalThis.fetch = vi.fn(async () => { throw new Error("unnecessary network"); })
      as unknown as typeof globalThis.fetch;

    const result = await tryFetchUpstream("leaders");
    expect(result?.source_family).toBe("thetadata_t2a_tape");
    expect(result?.stale).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not let an August historical local snapshot shadow a current R2 feed", async () => {
    const file = path.join(dir, "leaders.json");
    await writeFile(file, JSON.stringify(candidate("2026-08-12")));
    process.env.FLOW_LEADERS_LOCAL_PATH = file;
    const fetchMock = vi.fn(async () => jsonResponse(qualified()));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await tryFetchUpstream("leaders");
    expect(result?.session_date).toBe(today());
    expect(result?.stale).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("r2.dev");
  });

  it("preserves an explicitly stale snapshot when R2 and backend are down", async () => {
    const file = path.join(dir, "leaders.json");
    await writeFile(file, JSON.stringify(candidate("2026-08-12")));
    process.env.FLOW_LEADERS_LOCAL_PATH = file;
    const fetchMock = vi.fn(async () => { throw new Error("upstreams unavailable"); });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await tryFetchUpstream("leaders");
    expect(result?.session_date).toBe("2026-08-12");
    expect(result?.stale).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("chooses the newer historical source session rather than a newer build clock", async () => {
    const file = path.join(dir, "leaders.json");
    await writeFile(file, JSON.stringify(candidate("2026-08-12", {
      as_of: new Date().toISOString(),
    })));
    process.env.FLOW_LEADERS_LOCAL_PATH = file;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("r2.dev")) {
        return jsonResponse(candidate("2026-09-01", { as_of: "2026-09-02T00:00:00Z" }));
      }
      throw new Error("backend down");
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const result = await tryFetchUpstream("leaders");
    expect(result?.session_date).toBe("2026-09-01");
    expect(result?.stale).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a false-fresh legacy object even when its build date advanced", () => {
    expect(isQualifiedLeadersArtifact(candidate(today(), { stale: false }))).toBe(false);
    expect(isQualifiedLeadersArtifact(candidate("2026-08-12", {
      stale: false, source_family: "thetadata_t2a_tape",
      coverage: { n_expected_roots: 375, n_current_roots: 340 },
    }))).toBe(false);
    expect(isQualifiedLeadersArtifact(candidate(today(), {
      stale: false, source_family: "thetadata_t2a_tape",
      coverage: { n_expected_roots: 375, n_current_roots: 20 },
    }))).toBe(false);
    expect(isQualifiedLeadersArtifact(qualified())).toBe(true);
  });

  it("falls through when the local file is malformed", async () => {
    const file = path.join(dir, "leaders.json");
    await writeFile(file, '{"schema":"flow_leaders.v1","bad":NaN}');
    process.env.FLOW_LEADERS_LOCAL_PATH = file;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("r2.dev")) {
        return jsonResponse(candidate("2026-08-12", { source: "r2" }));
      }
      throw new Error("backend unavailable");
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const result = await tryFetchUpstream("leaders");
    expect(result?.source).toBe("r2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps Leaders-specific route behavior out of unrelated flow families", () => {
    delete process.env.FLOW_LEADERS_LOCAL_PATH;
    expect(localFlowArtifactPath("leaders")).toBe("/opt/macro/site/flowleaders/leaders.json");
    expect(localFlowArtifactPath("radar")).toBeNull();
    expect(localFlowArtifactPath("feed")).toBeNull();
    expect(upstreamSourceOrder("leaders")).toEqual(["r2", "backend"]);
    expect(upstreamSourceOrder("feed")).toEqual(["backend", "r2"]);
  });
});
