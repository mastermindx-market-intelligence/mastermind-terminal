import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IntradayAssemblyTrace } from "../intradayEvidence";
import type { Bar6 } from "../intradayShared";
const state = vi.hoisted(() => ({ user: true, calls: 0, demand: [] as string[][], failDemand: false, failAuth: false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  getUser: async () => {
    if (state.failAuth) throw new Error("session verification unavailable");
    return { data: { user: state.user ? { id: "reader" } : null } };
  },
} }) }));
vi.mock("@/lib/tiingoBoatsLiveHistory", () => ({ requestBoatsLiveHistory: async (...args: string[]) => {
  state.demand.push(args);
  if (state.failDemand) throw new Error("private IO unavailable");
  return { status: "recorded" };
} }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));
vi.mock("@/lib/flowSource", () => ({ intradayFixture: async () => null }));
vi.mock("@/lib/intradaySources", async original => ({
  ...await original<typeof import("@/lib/intradaySources")>(),
  fetchIntraday: async () => { state.calls++; throw new Error("upstream unavailable"); },
}));
vi.mock("@/lib/intradayStore", () => ({ withStoredHistory: async (
  _s: string, _tf: string, _e: boolean, _live: Bar6[], capture?: (trace: IntradayAssemblyTrace) => void,
) => { capture?.({ origins: [], storeReads: [] }); return []; } }));
import { GET } from "@/app/api/intraday/route";
let directory: string;
const call = (symbol: string, query = "session=24h") => GET(new Request(`https://unit.test/api/intraday?sym=${symbol}&tf=5m&${query}`));
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "terminal-boats-route-"));
  vi.stubEnv("TIINGO_BOATS_HISTORY_DIR", directory);
  vi.stubEnv("TERMINAL_REQUIRE_AUTH", "0"); vi.stubEnv("FLOW_FIXTURE", "0"); state.user = true; state.demand = []; state.failDemand = false; state.failAuth = false;
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
async function save(symbol: string, epochs = [Date.parse("2026-10-09T00:00:00Z") / 1000]) {
  const id = "a".repeat(64);
  await writeFile(path.join(directory, symbol + ".json"), JSON.stringify({
    schema: "terminal.tiingo_boats_history.v1", symbol, source: "tiingo-boats-rest", venue: "BOATS",
    timestamp_basis: "utc", bar_seconds: 60, price_basis: "vendor_reported_unqualified",
    volume_basis: "vendor_reported_shares", coverage: "captured_vendor_bars_only", complete: false,
    receipts: [{ receipt_id: id, raw_sha256: "b".repeat(64), observed_at_utc: "2026-10-11T12:00:00Z",
      request_path: `/boats/${symbol}/prices?resampleFreq=1min` }],
    bars: epochs.map(epoch => [epoch, 10, 12, 9, 11, 123]),
    bar_receipt_ids: epochs.map(() => [id]),
  }));
}
describe("existing intraday route consumes private BOATS history", () => {
  it("keeps the chart's class-share symbol while reading exact vendor receipts", async () => {
    await save("BRK-B");
    const result = await (await call("BRK.B")).json();
    expect(result.t).toBe("BRK.B");
    expect(result.boats_history).toMatchObject({ status: "available", requested_symbol: "BRK.B", vendor_symbol: "BRK-B" });
    expect(result.source_evidence.symbol).toBe("BRK.B");
    expect(result.bars).toHaveLength(1);
  });
  it("serves persisted candles when upstream is unavailable and re-serves after cache hits", async () => {
    await save("HISTORYA");
    const first = await (await call("HISTORYA")).json();
    expect(first.bars).toEqual([[Date.parse("2026-10-08T20:00:00Z") / 1000, 10, 12, 9, 11, 123]]);
    expect(first.boats_history.status).toBe("available");
    expect(first.boats_history.complete).toBe(false);
    expect(first.source_evidence.source_counts.tiingo_boats_rest).toBe(1);
    expect(first.source_evidence.session).toBe("24h");
    const cached = await (await call("HISTORYA")).json();
    expect(cached.bars).toEqual(first.bars);
    expect(cached.source_evidence.assembly_clock.cache_state).toBe("cache");
    const sliced = await (await call("HISTORYA", "session=24h&date=2026-10-09")).json();
    expect(sliced.bars).toEqual([]);
    expect(sliced.boats_history.returned_bars).toBe(0);
  });
  it("does not load overnight history in regular or extended mode", async () => {
    await save("HISTORYB");
    for (const q of ["", "ext=1"]) {
      const body = await (await call("HISTORYB", q)).json();
      expect(body.bars).toEqual([]); expect(body).not.toHaveProperty("boats_history");
    }
  });
  it("exposes an honest missing-history state for uncaptured symbols", async () => {
    const body = await (await call("HISTORYC")).json();
    expect(body.bars).toEqual([]);
    expect(body.boats_history.status).toBe("missing");
    expect(body.error).toBe("upstream unavailable");
  });
  it("preserves the existing auth gate before a warmed history cache", async () => {
    await save("HISTORYD");
    expect((await (await call("HISTORYD")).json()).bars).toHaveLength(1);
    vi.stubEnv("TERMINAL_REQUIRE_AUTH", "1"); state.user = false;
    const denied = await call("HISTORYD");
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "unauthenticated" });
  });
});


it("serves an older requested day beyond the latest 20000 bars and keeps dated caches separate", async () => {
  const epochs: number[] = [];
  for (let day = Date.parse("2026-07-20T00:00:00Z"); day < Date.parse("2026-10-09T00:00:00Z"); day += 86_400_000) {
    const d = new Date(day);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || d.toISOString().startsWith("2026-09-07")) continue;
    for (let minute = 0; minute < 480; minute++) epochs.push(day / 1000 + minute * 60);
  }
  await save("DEEPOVERNIGHT", epochs);
  const request = (date = "") => GET(new Request(`https://unit.test/api/intraday?sym=DEEPOVERNIGHT&tf=1m&session=24h${date ? `&date=${date}` : ""}`));
  const latest = await (await request()).json();
  expect(latest.bars).toHaveLength(20_000);
  expect(latest.bars[0][0]).toBeGreaterThan(Date.parse("2026-07-21T00:00:00Z") / 1000);
  const old = await (await request("2026-07-20")).json();
  expect(old.bars).toHaveLength(480);
  expect(old.boats_history.input_bars).toBe(epochs.length);
  expect(old.boats_history.returned_bars).toBe(480);
  expect(old.source_evidence.source_counts.tiingo_boats_rest).toBe(480);
  expect(old.bars.every((bar: Bar6) => new Date(bar[0] * 1000).toISOString().startsWith("2026-07-20"))).toBe(true);
  const cachedOld = await (await request("2026-07-20")).json();
  expect(cachedOld.bars).toEqual(old.bars);
  expect(cachedOld.source_evidence.assembly_clock.cache_state).toBe("cache");
  const other = await (await request("2026-07-21")).json();
  expect(other.bars).toHaveLength(480);
  expect(other.bars[0][0]).not.toBe(old.bars[0][0]);
  expect((await (await request()).json()).bars).toEqual(latest.bars);
});


it("records signed-in overnight demand before cache hits and never for anonymous callers", async () => {
  await save("DEMANDA");
  vi.stubEnv("TERMINAL_REQUIRE_AUTH", "1");
  vi.stubEnv("TIINGO_BOATS_LIVE_DIR", directory);
  const first = await (await call("DEMANDA")).json();
  const second = await (await call("DEMANDA")).json();
  expect(first.bars).toHaveLength(1);
  expect(second.source_evidence.assembly_clock.cache_state).toBe("cache");
  expect(state.demand).toEqual([["DEMANDA", "5m", ""], ["DEMANDA", "5m", ""]]);
  state.user = false;
  expect((await call("DEMANDA")).status).toBe(401);
  expect(state.demand).toHaveLength(2);
});

it("does not create provider demand in unauthenticated, regular, extended or higher-timeframe paths", async () => {
  vi.stubEnv("TIINGO_BOATS_LIVE_DIR", directory);
  state.user = false;
  await call("DEMANDB");
  state.user = true;
  vi.stubEnv("TERMINAL_REQUIRE_AUTH", "1");
  await call("DEMANDB", "");
  await call("DEMANDB", "ext=1");
  await GET(new Request("https://unit.test/api/intraday?sym=DEMANDB&tf=1d&session=24h"));
  expect(state.demand).toHaveLength(0);
});

it("verifies demand separately when existing baseline charts permit public reads", async () => {
  await save("DEMANDPUBLIC");
  vi.stubEnv("TIINGO_BOATS_LIVE_DIR", directory);
  expect((await (await call("DEMANDPUBLIC")).json()).bars).toHaveLength(1);
  expect(state.demand).toEqual([["DEMANDPUBLIC", "5m", ""]]);
  state.user = false;
  expect((await (await call("DEMANDPUBLIC")).json()).bars).toHaveLength(1);
  expect(state.demand).toHaveLength(1);
  state.user = true; state.failAuth = true;
  expect((await (await call("DEMANDPUBLIC")).json()).bars).toHaveLength(1);
  expect(state.demand).toHaveLength(1);
});

it("retains existing candles when private refresh demand cannot be recorded", async () => {
  await save("DEMANDC");
  vi.stubEnv("TERMINAL_REQUIRE_AUTH", "1");
  vi.stubEnv("TIINGO_BOATS_LIVE_DIR", directory);
  state.failDemand = true;
  const body = await (await call("DEMANDC")).json();
  expect(body.bars).toHaveLength(1);
  expect(body.boats_history.status).toBe("available");
});
