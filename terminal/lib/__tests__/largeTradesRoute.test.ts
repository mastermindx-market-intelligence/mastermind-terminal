import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { makeLargeTradesFixture } from "@/lib/largeTrades/fixtures";
import { IEX_HIST_ATTRIBUTION, IEX_HIST_TERMS } from "@/lib/largeTrades/sourceAdmission";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), createClient: vi.fn(), limited: false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: auth.createClient }));
vi.mock("@/lib/rateLimit", () => ({
  rateLimit: () => ({ ok: !auth.limited, remaining: 10, retryAfterSec: 30 }),
  tooMany: () => Response.json({ error: "rate_limited" }, { status: 429 }),
}));
import { GET } from "@/app/api/large-trades/route";

let root: string;
const request = (query = "sym=AAPL") => new Request("http://terminal.test/api/large-trades?" + query);
const published = () => path.join(root, "large_trades", "AAPL.json");
function IEX_HIST_SYNTHETIC() {
  const value = makeLargeTradesFixture("AAPL");
  // IEX_HIST_SYNTHETIC is an explicit fixture with reviewed-source metadata for route
  // boundary testing. These generated prints are never claimed as real IEX transactions.
  const acquired = (BigInt(Date.parse("2026-10-07T12:00:00Z")) * BigInt(1000000)).toString();
  value.provenance = { ...value.provenance, dataMode: "historical", evidenceMode: "HISTORICAL_REPLAY",
    provider: "IEX", dataset: "HIST DEEP+ 1.0", venue: "IEX", scope: "venue", coverage: "partial",
    receiptBasis: "archive_acquisition", acquiredAtNs: acquired, generatedAtNs: acquired,
    sourceSha256: "a".repeat(64), sourceRef: "test:historical-archive", sourceId: "test:historical",
    attribution: IEX_HIST_ATTRIBUTION, termsUrl: IEX_HIST_TERMS };
  value.prints = value.prints.map((p) => ({ ...p, availableNs: acquired }));
  value.responses = value.responses.map((p) => ({ ...p, availableNs: acquired }));
  value.responseKnownAtNs = acquired;
  return value;
}

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TERMINAL_E2E_FIXTURE", "0");
  root = await fs.mkdtemp(path.join(os.tmpdir(), "large-trades-route-"));
  await fs.mkdir(path.join(root, "large_trades"));
  vi.stubEnv("MACRO_LIVE_DIR", root);
  auth.limited = false;
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: "signed-in-user" } }, error: null });
  auth.createClient.mockReset().mockResolvedValue({ auth: { getUser: auth.getUser } });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

describe("large-trades signed-in published artifact boundary", () => {
  it("does not expose a published artifact to a signed-out request", async () => {
    await fs.writeFile(published(), JSON.stringify(IEX_HIST_SYNTHETIC()));
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ state: "signed_out", reason: "authentication_required" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("fails closed when user verification is unavailable", async () => {
    auth.createClient.mockRejectedValue(new Error("test auth unavailable"));
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ state: "signed_out" });
  });
  it("returns truthful unavailable without generating fixture records", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "unavailable", reason: "feed_not_published" });
  });
  it("serves exact historical bytes with hash, acquisition clock and partial scope", async () => {
    const envelope = IEX_HIST_SYNTHETIC();
    const bytes = JSON.stringify(envelope);
    await fs.writeFile(published(), bytes);
    const response = await GET(request("sym=aapl"));
    const body = await response.json();
    expect(body.state).toBe("ready");
    expect(body.envelope).toEqual(envelope);
    expect(body.envelope.provenance).toMatchObject({ dataMode: "historical", coverage: "partial", scope: "venue" });
    expect(body.artifactSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(body.servedAtNs).toMatch(/^\d+$/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("admits synthetic records only through the explicit nonproduction seam", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(request());
    const body = await response.json();
    expect(body.state).toBe("ready");
    expect(body.envelope.provenance).toMatchObject({ dataMode: "fixture", evidenceMode: "FIXTURE" });
    expect(body.artifactSha256).toBeNull();
    expect(auth.createClient).not.toHaveBeenCalled();
  });
  it("the fixture environment flag cannot bypass production authentication", async () => {
    vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(request())).status).toBe(401);
  });
  it("production with the fixture flag still requires a published real-mode artifact", async () => {
    vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
    expect(await (await GET(request())).json()).toMatchObject({ state: "unavailable" });
    expect(auth.createClient).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["fixture publication", () => makeLargeTradesFixture()],
    ["symbol mismatch", () => { const e = IEX_HIST_SYNTHETIC(); e.instrument.symbol = "MSFT"; return e; }],
    ["candles without executions", () => ({ symbol: "AAPL", bars: [[1, 2, 3, 1, 2, 1301]] })],
    ["future acquisition contradiction", () => { const e = IEX_HIST_SYNTHETIC(); e.provenance.acquiredAtNs = "1"; return e; }],
  ])("refuses %s without a fallback", async (_, envelope) => {
    await fs.writeFile(published(), JSON.stringify(envelope()));
    const body = await (await GET(request())).json();
    expect(body).toEqual({ state: "invalid", reason: "artifact_contract" });
  });
  it("refuses malformed JSON", async () => {
    await fs.writeFile(published(), "{");
    expect(await (await GET(request())).json()).toEqual({ state: "invalid", reason: "artifact_json" });
  });
  it.each(["sym=..%2FAAPL", "sym=%2Fetc%2Fpasswd", "sym=AAPL&sym=MSFT", "", "sym=" + "A".repeat(33)])(
    "rejects unsafe or ambiguous symbol query %s", async (query) => {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ state: "invalid" });
    });
  it.each(["%5EGSPC", "MNQ%3DF", "NQ1!"])("preserves a safe canonical chart symbol %s as unavailable", async (symbol) => {
    const response = await GET(request("sym=" + symbol));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "unavailable", reason: "feed_not_published" });
  });
  it("refuses a symlink even when its target is a valid artifact", async () => {
    const target = path.join(root, "private.json");
    await fs.writeFile(target, JSON.stringify(IEX_HIST_SYNTHETIC()));
    await fs.symlink(target, published());
    expect(await (await GET(request())).json()).toEqual({ state: "unavailable", reason: "published_source_unreadable" });
  });
  it("refuses oversized published files before parsing", async () => {
    const handle = await fs.open(published(), "w");
    await handle.truncate(8 * 1024 * 1024 + 1);
    await handle.close();
    expect(await (await GET(request())).json()).toEqual({ state: "invalid", reason: "artifact_size_or_type" });
  });
  it("rate limiting prevents auth and artifact reads", async () => {
    auth.limited = true;
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(auth.createClient).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("reviewed source admission is narrower than structural validity", () => {
  it.each([
    ["another provider", (e: ReturnType<typeof IEX_HIST_SYNTHETIC>) => { e.provenance.provider = "TEST unreviewed provider"; }],
    ["another dataset", (e: ReturnType<typeof IEX_HIST_SYNTHETIC>) => { e.provenance.dataset = "TEST unreviewed dataset"; }],
    ["a consolidated scope", (e: ReturnType<typeof IEX_HIST_SYNTHETIC>) => { e.provenance.scope = "consolidated"; }],
    ["a missing archive hash", (e: ReturnType<typeof IEX_HIST_SYNTHETIC>) => { e.provenance.sourceSha256 = null; }],
    ["changed attribution", (e: ReturnType<typeof IEX_HIST_SYNTHETIC>) => { e.provenance.attribution = "TEST missing required notice"; }],
    ["another terms URL", (e: ReturnType<typeof IEX_HIST_SYNTHETIC>) => { e.provenance.termsUrl = "https://example.test/terms"; }],
    ["nonnative trade reports", (e: ReturnType<typeof IEX_HIST_SYNTHETIC>) => {
      e.prints = e.prints.map((p) => ({ ...p, sourceRecordType: "MASSIVE_T" }));
    }],
    ["CME futures", (e: ReturnType<typeof IEX_HIST_SYNTHETIC>) => {
      e.provenance.provider = "CME"; e.provenance.venue = "CME";
      e.instrument.assetClass = "future"; e.instrument.quantityUnit = "contracts";
      e.prints = e.prints.map((p) => ({ ...p, sourceRecordType: "CME_TRADE_SUMMARY" }));
    }],
    ["a declared live source", (e: ReturnType<typeof IEX_HIST_SYNTHETIC>) => {
      e.provenance.dataMode = "live"; e.provenance.evidenceMode = "ACTUAL_AS_SEEN";
      e.provenance.receiptBasis = "original_receive"; e.provenance.acquiredAtNs = null; e.provenance.delayMs = 0;
    }],
  ])("does not admit %s to signed-in users", async (_, mutate) => {
    const envelope = IEX_HIST_SYNTHETIC();
    mutate(envelope);
    await fs.writeFile(published(), JSON.stringify(envelope));
    expect(await (await GET(request())).json()).toEqual({ state: "unavailable", reason: "feed_not_admitted" });
  });
});
