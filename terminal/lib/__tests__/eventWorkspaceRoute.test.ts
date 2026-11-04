import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { __resetEventWorkspaceCacheForTests } from "@/lib/eventWorkspace";

const GOLDEN = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/aapl-event-workspace.json"), "utf8"),
) as Record<string, unknown>;
const FLAGSHIP = "evt_cik0000320193_2026q3_results";
const PRIOR = "evt_cik0000320193_2026q2_results";
const GEN = "f709a0a6ec514282d5769e7d";

function sha(body: string | Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function workspaceBody(overrides: Record<string, unknown> = {}) {
  const payload = { ...GOLDEN, ...overrides };
  const wire = `${JSON.stringify(payload)}\n`;
  const bytes = new TextEncoder().encode(wire);
  return { bytes, hash: sha(bytes) };
}

let realFetch: typeof globalThis.fetch;
let calls: string[];
let fetchOptions: Array<RequestInit | undefined>;
let ip = 0;

function installR2(upstream: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (url: string, options?: RequestInit) => {
    calls.push(String(url));
    fetchOptions.push(options);
    return upstream(String(url));
  }) as unknown as typeof globalThis.fetch;
}

const req = () => new Request("https://app.mastermind-x.com/api/event-workspace/AAPL", {
  headers: { "cf-connecting-ip": `203.0.113.${++ip}` },
});
const params = (symbol: string) => ({ params: Promise.resolve({ symbol }) });
const json = async (res: Response) => res.json() as Promise<any>;

import { GET } from "@/app/api/event-workspace/[symbol]/route";

beforeEach(() => {
  __resetEventWorkspaceCacheForTests();
  realFetch = globalThis.fetch;
  calls = [];
  fetchOptions = [];
});
afterEach(() => {
  if (realFetch) globalThis.fetch = realFetch;
});

describe("/api/event-workspace/[symbol]", () => {
  it("selects AAPL/2026Q3 from a two-period alias map and returns the verified workspace", async () => {
    const q3 = workspaceBody();
    const q2 = workspaceBody({ event_id: PRIOR, aliases: ["AAPL/2026Q2"] });
    const manifest = {
      schema: "event_workspace_manifest.v1",
      generation_id: GEN,
      generated_at: "2026-07-30T20:30:28Z",
      status: "ready",
      event_count: 2,
      files: {
        [`workspaces/${PRIOR}.json`]: { sha256: q2.hash, bytes: q2.bytes.byteLength },
        [`workspaces/${FLAGSHIP}.json`]: { sha256: q3.hash, bytes: q3.bytes.byteLength },
      },
      aliases: {
        "AAPL/2026Q2": PRIOR,
        "AAPL/2026Q3": FLAGSHIP,
        [FLAGSHIP]: FLAGSHIP,
        [PRIOR]: PRIOR,
      },
      authority: "context_only",
      warnings: [],
    };
    installR2((url) => {
      if (url.includes("score_overlay") || url.includes("/companies/")) {
        throw new Error("v1 overlay must not be fetched");
      }
      if (url.endsWith("/event_workspaces/manifest.json") || url.includes(`/generations/${GEN}/manifest.json`)) {
        return new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith(`/workspaces/${FLAGSHIP}.json`)) {
        return new Response(q3.bytes, { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("missing", { status: 404 });
    });
    const res = await GET(req(), params("AAPL"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.event_id).toBe(FLAGSHIP);
    expect(body.workspace.generation_id).toBe(GEN);
    expect(body.authority).toBe("context_only");
    expect(body.workspace.schema).toBe("event_workspace.v1");
    expect(fetchOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ cache: "no-store", redirect: "error" }),
    ]));
  });

  it.each([403, 429, 500, 503])("returns retryable 503 when the publication marker returns HTTP %s", async (status) => {
    installR2(() => new Response("unavailable", { status }));
    const res = await GET(req(), params("AAPL"));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await json(res)).toMatchObject({ ok: false, available: false, error: { code: "upstream_unavailable", retryable: true } });
    expect(calls).toHaveLength(1);
    expect(fetchOptions[0]).toMatchObject({ cache: "no-store", redirect: "error" });
  });

  it("keeps a genuine missing marker as non-retryable 404", async () => {
    installR2(() => new Response("missing", { status: 404 }));
    const res = await GET(req(), params("AAPL"));
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ ok: false, error: { code: "not_found", retryable: false } });
    expect(calls).toHaveLength(1);
  });

  it("rejects traversal before any R2 call", async () => {
    installR2(() => new Response("unexpected"));
    for (const symbol of ["AAPL/../../secret", "AAPL%2Fsecret", "aapl", "AAPL?x=1"]) {
      const res = await GET(req(), params(symbol));
      expect(res.status, symbol).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
});
