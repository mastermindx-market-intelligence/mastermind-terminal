/** Opt-in actual archive -> existing API -> depth consumer test.
 * Only account verification is mocked. No fixture source, filesystem or decoder
 * is substituted; this is not an authenticated production customer session.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: auth.getUser } }) }));
import { GET } from "../../app/api/large-trades/route";
import { parseIexDepthEnvelope, iexExecutionProfile } from "../iexDepthReplay";
const input = process.env.IEX_DEPTH_REAL_DIR;
let root = "";
const symbols = ["NVDA", "SPY", "QQQ"];
describe.runIf(Boolean(input))("real IEX retained bytes through the production source-reader code", () => {
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "iex-depth-api-local-"));
    await fs.mkdir(path.join(root, "large_trades"));
    for (const symbol of symbols) {
      const source = path.join(input!, symbol + ".json");
      const info = await fs.stat(source);
      if (!info.isFile() || info.size > 8*1024*1024) throw Error("source size/type");
      await fs.copyFile(source, path.join(root, "large_trades", symbol + ".json"));
    }
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TERMINAL_E2E_FIXTURE", "0");
    vi.stubEnv("MACRO_LIVE_DIR", root);
    auth.getUser.mockResolvedValue({ data: { user: { id: "explicit-local-auth-test-principal" } }, error: null });
  });
  afterAll(async () => { vi.unstubAllEnvs(); if (root) await fs.rm(root, { recursive:true, force:true }); });
  for (const symbol of symbols) it(symbol + ": exact source bytes survive reader admission and renderable projection", async () => {
    const bytes = await fs.readFile(path.join(input!, symbol + ".json"));
    const response = await GET(new Request("http://localhost/api/large-trades?sym=" + symbol));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const result = await response.json();
    expect(result.state).toBe("ready");
    expect(result.artifactSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    const value = parseIexDepthEnvelope(result.envelope, symbol);
    expect(value).not.toBeNull(); if (!value) throw Error("invalid depth artifact");
    const last = value.depthReplay.samples.at(-1)!;
    expect(iexExecutionProfile(value,last).volume).toBeGreaterThan(0);
    expect(last.availableNs).toBe(value.provenance.acquiredAtNs);
  });
  it("the same real artifacts remain inaccessible without an authenticated principal", async () => {
    auth.getUser.mockResolvedValue({ data:{ user:null }, error:null });
    const response = await GET(new Request("http://localhost/api/large-trades?sym=NVDA"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ state:"signed_out", reason:"authentication_required" });
  });
});
