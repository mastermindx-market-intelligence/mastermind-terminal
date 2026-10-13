import { afterEach, describe, it, expect, vi } from "vitest";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/entitlement", () => ({ hasLiveOptions: vi.fn(async () => true) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: () => new Response("limited", { status: 429 }) }));
import { GET } from "../../app/api/futures/route";
import { hasLiveOptions } from "../entitlement";
import { sourceFixture } from "./fixtures/futuresSourceFixture";
const { handleFuturesRequest } = createRequire(import.meta.url)("../../../hub/lib/futuresPublication.js");
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("actual HTTP source-to-Terminal API vertical", () => {
  it("consumes a digest-bound publication through the real Hub handler, fetch reader, source join and authenticated API", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "futures-http-test-")); let requests = 0;
    const server = createServer((req, res) => { requests++;
      void handleFuturesRequest(res, new URL(req.url!, "http://127.0.0.1"), { root }).catch(() => { res.writeHead(500); res.end(); }); });
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address(); if (!address || typeof address === "string") throw Error("test_listener");
      vi.stubEnv("HUB_PORT", String(address.port)); vi.mocked(hasLiveOptions).mockResolvedValue(true);
      const publish = async (pair: "ES" | "NQ", audience = "subscriber_display", corrupt = false) => {
        const source = sourceFixture(pair); source.audience = audience; const payloadJson = JSON.stringify(source);
        await writeFile(path.join(root, pair + ".json"), JSON.stringify({ schema: "hub.futures_publication/v1", payloadJson,
          payloadSha256: corrupt ? "0".repeat(64) : createHash("sha256").update(payloadJson).digest("hex") }));
      };
      await publish("ES");
      const ask = (query = "pair=ES") => GET(new Request(`http://127.0.0.1/api/futures?${query}`));
      const es = await ask(); expect(es.status).toBe(200); const data = await es.json();
      expect(data.contract).toBe("ESZ6"); expect(data.frames).toHaveLength(24);
      expect(data.frames.at(-1).gex.status).toBe("ok"); expect(data.frames.reduce((v: number, f: any) => v + f.bar.total, 0)).toBe(4203);
      await publish("NQ"); const nq = await ask("pair=NQ&expiry=zero&interval=5&rows=4");
      expect(nq.status).toBe(200); const nqd = await nq.json(); expect(nqd.contract).toBe("NQZ6");
      expect(nqd.frames.at(-1).gex.provenance.expiryLens).toBe("zero");
      const count = requests; vi.mocked(hasLiveOptions).mockResolvedValue(false);
      expect((await ask()).status).toBe(403); expect(requests).toBe(count);
      vi.mocked(hasLiveOptions).mockResolvedValue(true); await publish("ES", "internal_only");
      const restricted = await ask(); expect(restricted.status).toBe(503); expect(await restricted.text()).not.toContain("frames");
      await publish("ES", "subscriber_display", true); const altered = await ask(); expect(altered.status).toBe(503);
      expect(altered.headers.get("cache-control")).toBe("private, no-store");
    } finally {
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
