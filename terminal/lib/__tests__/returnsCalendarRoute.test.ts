import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bar6 } from "../intradayShared";

const state = vi.hoisted(() => ({
  fetchCalls: 0,
  storeCalls: 0,
  studyCalls: 0,
  overnightCalls: 0,
  assembled: [] as Bar6[],
  study: [] as Bar6[],
  overnight: [] as Bar6[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));
vi.mock("@/lib/flowSource", () => ({ intradayFixture: async () => null }));
vi.mock("@/lib/intradaySources", async (original) => ({
  ...await original<typeof import("@/lib/intradaySources")>(),
  fetchIntraday: async () => {
    state.fetchCalls++;
    return [] as Bar6[];
  },
  fetchUsEquityDateStudyBars: async () => {
    state.studyCalls++;
    return state.study;
  },
}));
vi.mock("@/lib/intradayStore", () => ({
  withStoredHistory: async () => {
    state.storeCalls++;
    return state.assembled;
  },
}));
vi.mock("@/lib/overnightHistory", () => ({
  fetchHubOvernightWallDate: async () => {
    state.overnightCalls++;
    return {
      bars: state.overnight,
      source: "alpaca-boats" as const,
      status: state.overnight.length ? "available" as const : "empty" as const,
    };
  },
}));

import { GET } from "@/app/api/intraday/route";

const bar = (day: string, h: number, m = 0, close = 101): Bar6 => [
  Date.parse(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`) / 1000,
  100, 102, 99, close, 50,
];

const call = (sym: string, date: string, overnight: "1" | "only" | "bogus" = "1") =>
  GET(new Request(
    `https://unit.test/api/intraday?sym=${sym}&tf=30m&ext=1&overnight=${overnight}&date=${date}`,
  ));

beforeEach(() => {
  state.fetchCalls = 0;
  state.storeCalls = 0;
  state.studyCalls = 0;
  state.overnightCalls = 0;
  state.assembled = [];
  state.study = [];
  state.overnight = [];
  vi.stubEnv("TERMINAL_REQUIRE_AUTH", "0");
  vi.stubEnv("FLOW_FIXTURE", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("returns-calendar intraday route contract", () => {
  it("serves prior-wall-date overnight-only reads without touching Massive/store", async () => {
    state.overnight = [bar("2026-10-13", 20, 0, 103)];
    const response = await call("ONLYA", "2026-10-13", "only");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bars).toEqual(state.overnight);
    expect(body.overnight_evidence).toMatchObject({
      source: "alpaca-boats",
      status: "available",
      bars: 1,
    });
    expect(state.overnightCalls).toBe(1);
    expect(state.fetchCalls).toBe(0);
    expect(state.storeCalls).toBe(0);
    expect(state.studyCalls).toBe(0);
  });

  it("backfills an empty selected date from Massive before adding disjoint BOATS bars", async () => {
    state.study = [bar("2026-10-14", 9, 30, 105)];
    state.overnight = [bar("2026-10-14", 2, 0, 102)];
    const body = await (await call("STUDYA", "2026-10-14")).json();

    expect(state.fetchCalls).toBe(1);
    expect(state.storeCalls).toBe(1);
    expect(state.studyCalls).toBe(1);
    expect(state.overnightCalls).toBe(1);
    expect(body.bars).toEqual([
      state.overnight[0],
      state.study[0],
    ]);
    expect(body.session_study_evidence).toEqual({
      source: "massive-date",
      status: "available",
      bars: 1,
    });
    expect(body.overnight_evidence).toEqual({
      source: "alpaca-boats",
      status: "available",
      bars: 1,
    });
  });

  it("returns the canonical early-close window with a date-scoped U.S. response", async () => {
    state.assembled = [bar("2026-11-27", 12, 30, 101)];
    const body = await (await call("EARLYA", "2026-11-27")).json();

    expect(body.regular_session_window).toEqual({ start_minute: 570, end_minute: 780 });
    expect(state.studyCalls).toBe(0);
  });

  it("rejects unknown overnight modes instead of silently changing semantics", async () => {
    const response = await call("MODEA", "2026-10-14", "bogus");
    expect(response.status).toBe(400);
    expect(state.fetchCalls).toBe(0);
    expect(state.storeCalls).toBe(0);
    expect(state.overnightCalls).toBe(0);
  });
});
