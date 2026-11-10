// Round-2 review MAJOR 2: proves the committed fixture stockdata server (e2e/) actually enforces
// the cookie gate it claims to — 401 without the session cookie, 200 with it — and MAJOR 4:
// proves its fixture book covers >= 3 sectors and >= 3 company-size buckets, using the SAME
// bucket function the real readout uses so this can never silently drift from the real bands.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startFixtureStockdataServer,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_VALUE,
  FIXTURE_TICKERS,
} from "../../e2e/fixtureStockdataServer.mjs";
import { sizeBucketOf } from "@/lib/portfolioRisk";

let baseUrl: string;
let close: () => Promise<void>;

beforeAll(async () => {
  const server = await startFixtureStockdataServer();
  baseUrl = server.url;
  close = server.close;
});

afterAll(async () => {
  await close();
});

describe("fixture stockdata server", () => {
  it("answers 401 locked (real regwall shape) without the session cookie", async () => {
    const res = await fetch(`${baseUrl}/stockdata/ZZTA.json`);
    expect(res.status).toBe(401);
    expect(res.headers.get("x-regwall")).toBe("deny");
    const body = await res.json();
    expect(body.locked).toBe(true);
  });

  it("answers 200 with the fixture facts once the session cookie is present", async () => {
    const res = await fetch(`${baseUrl}/stockdata/ZZTA.json`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_COOKIE_VALUE}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sector).toBe(FIXTURE_TICKERS.ZZTA.sector);
    expect(body.personality.market_cap).toBe(FIXTURE_TICKERS.ZZTA.marketCap);
  });

  it("an unrelated cookie alongside the session cookie still reads through (only presence is checked)", async () => {
    const res = await fetch(`${baseUrl}/stockdata/ZZTB.json`, {
      headers: { Cookie: `unrelated=1; ${SESSION_COOKIE_NAME}=${SESSION_COOKIE_VALUE}` },
    });
    expect(res.status).toBe(200);
  });

  it("answers 404 for a ticker outside the fixture book, cookie or not", async () => {
    const res = await fetch(`${baseUrl}/stockdata/ZZZZ.json`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_COOKIE_VALUE}` },
    });
    expect(res.status).toBe(404);
  });

  it("covers >= 3 distinct sectors across its fixture tickers", () => {
    const facts = Object.values(FIXTURE_TICKERS) as { sector: string; marketCap: number }[];
    const sectors = new Set(facts.map((f) => f.sector));
    expect(sectors.size).toBeGreaterThanOrEqual(3);
  });

  it("covers >= 3 distinct company-size buckets across its fixture tickers", () => {
    const facts = Object.values(FIXTURE_TICKERS) as { sector: string; marketCap: number }[];
    const buckets = new Set(facts.map((f) => sizeBucketOf(f.marketCap)));
    expect(buckets.size).toBeGreaterThanOrEqual(3);
  });

  it("serves /ohlc/SPY.json only with the session cookie, and 404s a missing series", async () => {
    const locked = await fetch(`${baseUrl}/ohlc/SPY.json`);
    expect(locked.status).toBe(401);
    const res = await fetch(`${baseUrl}/ohlc/SPY.json`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_COOKIE_VALUE}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.bars)).toBe(true);
    expect(body.bars.length).toBeGreaterThanOrEqual(126);
    const missing = await fetch(`${baseUrl}/ohlc/MISSING.json`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_COOKIE_VALUE}` },
    });
    expect(missing.status).toBe(404);
  });

  it("serves one close-only OHLC name so capture and e2e worlds exercise o:0 bars", async () => {
    const res = await fetch(`${baseUrl}/ohlc/ZZTB.json`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_COOKIE_VALUE}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.o).toBe(0);
    expect(Array.isArray(body.bars)).toBe(true);
    expect(body.bars[0]).toHaveLength(3);
    expect(body.bars.length).toBeGreaterThanOrEqual(126);
  });

  it("401s anonymous DGS3MO like SPY, and 404s DGS3MO/us3m once the session cookie is present", async () => {
    const anon = await fetch(`${baseUrl}/ohlc/DGS3MO.json`);
    expect(anon.status).toBe(401);
    expect(anon.headers.get("x-regwall")).toBe("deny");
    const cookie = { headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_COOKIE_VALUE}` } };
    const dgs = await fetch(`${baseUrl}/ohlc/DGS3MO.json`, cookie);
    expect(dgs.status).toBe(404);
    const us3m = await fetch(`${baseUrl}/ohlc/us3m.json`, cookie);
    expect(us3m.status).toBe(404);
  });
});

describe("explicit public synthetic OHLC fixture", () => {
  let publicUrl: string;
  let closePublic: () => Promise<void>;

  beforeAll(async () => {
    const server = await startFixtureStockdataServer(0, { ohlcMode: "public-fixture" });
    publicUrl = server.url;
    closePublic = server.close;
  });

  afterAll(async () => { await closePublic(); });

  it.each([
    ["ZZTA", 140, 1], ["ZZTB", 140, 0], ["THIN", 20, 1], ["SPY", 140, 1],
  ] as const)("serves only the declared synthetic %s price series without credentials", async (ticker, count, shape) => {
    const response = await fetch(`${publicUrl}/ohlc/${ticker}.json`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.o).toBe(shape);
    expect(body.bars).toHaveLength(count);
    expect(body.bars[0]).toHaveLength(shape === 0 ? 3 : 6);
  });

  it.each([
    "/stockdata/ZZTA.json", "/ohlc/DGS3MO.json", "/ohlc/us3m.json",
    "/ohlc/MISSING.json", "/ohlc/UNDECLARED.json",
  ])("retains the credential gate for %s in public-price mode", async (path) => {
    const response = await fetch(publicUrl + path);
    expect(response.status).toBe(401);
    expect(response.headers.get("x-regwall")).toBe("deny");
    expect(await response.json()).toEqual({ locked: true, reason: "authentication_required" });
  });

  it.each(["ZZTA", "ZZTB", "THIN", "SPY"])("keeps default anonymous %s prices gated", async (ticker) => {
    const response = await fetch(`${baseUrl}/ohlc/${ticker}.json`);
    expect(response.status).toBe(401);
    expect(response.headers.get("x-regwall")).toBe("deny");
    expect((await response.json()).locked).toBe(true);
  });

  it("does not extend the public-price exception to non-GET requests", async () => {
    const response = await fetch(publicUrl + "/ohlc/ZZTA.json", { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("x-regwall")).toBe("deny");
  });

  it("keeps the public-price setting local to its own server instance", async () => {
    expect((await fetch(publicUrl + "/ohlc/SPY.json")).status).toBe(200);
    expect((await fetch(baseUrl + "/ohlc/SPY.json")).status).toBe(401);
  });
});
