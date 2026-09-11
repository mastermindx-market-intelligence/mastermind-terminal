import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapOutboxToConditionStates } from "@/lib/rmsViews";
import { isUuid } from "@/lib/theses";

const H = vi.hoisted(() => ({
  key: "fire-status-route",
  user: { id: "e2e-user-fire-status-route" } as { id: string } | null,
  faults: [] as string[],
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("@/lib/supabase/server", async () => {
  const { createFixtureDb } = await import("@/lib/watchlistsFixtureDb");
  return {
    createClient: vi.fn(async () => ({
      auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
      ...createFixtureDb(H.key, H.faults),
    })),
  };
});

import { GET } from "@/app/api/thesis-fire-status/route";
import { fixtureStore, fixtureUserId, resetFixtureStores } from "@/lib/watchlistsFixtureDb";

const THESIS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const THESIS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const THESIS_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

describe("mapOutboxToConditionStates", () => {
  it("maps a payload.thesis_id match with status pending to window_closed", () => {
    const map = mapOutboxToConditionStates([THESIS_A], [{
      payload: { thesis_id: THESIS_A, title: "closed" },
      status: "pending",
      created_at: "2026-09-01T00:00:00.000Z",
    }]);
    expect(map.get(THESIS_A)).toEqual({
      source: "monitor",
      state: "window_closed",
      at: "2026-09-01T00:00:00.000Z",
    });
  });

  it("returns unavailable, never open, when no matching row exists", () => {
    const map = mapOutboxToConditionStates([THESIS_A], []);
    expect(map.get(THESIS_A)).toEqual({ source: "unavailable" });
    expect(map.get(THESIS_A)).not.toMatchObject({ state: "open" });
  });

  it("skips malformed or missing payload.thesis_id instead of throwing", () => {
    expect(() => mapOutboxToConditionStates([THESIS_A], [
      { payload: null, status: "pending" },
      { payload: "not-an-object", status: "pending" },
      { payload: ["array"], status: "pending" },
      { payload: { thesis_id: "not-a-uuid" }, status: "pending" },
      { payload: { thesis_id: 12 }, status: "sent" },
    ])).not.toThrow();
    const map = mapOutboxToConditionStates([THESIS_A], [
      { payload: { thesis_id: "not-a-uuid" }, status: "pending" },
    ]);
    expect(map.get(THESIS_A)).toEqual({ source: "unavailable" });
  });

  it("ignores a non-thesis alert_outbox row (position-alert payload without a well-formed thesis_id)", () => {
    const map = mapOutboxToConditionStates([THESIS_A], [{
      payload: { symbol: "NVDA", alert_id: "pos-1", kind: "price" },
      status: "sent",
      created_at: "2026-09-01T00:00:00.000Z",
    }]);
    expect(map.get(THESIS_A)).toEqual({ source: "unavailable" });
  });
});

describe("GET /api/thesis-fire-status", () => {
  beforeEach(() => {
    resetFixtureStores();
    H.key = "fire-status-route";
    H.user = { id: fixtureUserId(H.key) };
    H.faults = [];
    delete process.env.TERMINAL_E2E_FIXTURE;
    vi.clearAllMocks();
  });

  it("requires auth", async () => {
    H.user = null;
    const response = await GET(new Request(`https://x.test/api/thesis-fire-status?id=${THESIS_A}`));
    expect(response.status).toBe(401);
  });

  it("rejects an over-length id list", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => {
      const n = String(i + 1).padStart(12, "0");
      return `aaaaaaaa-aaaa-4aaa-8aaa-${n}`;
    });
    expect(ids.every((id) => isUuid(id))).toBe(true);
    const url = `https://x.test/api/thesis-fire-status?${ids.map((id) => `id=${id}`).join("&")}`;
    const response = await GET(new Request(url));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_thesis_ids" });
  });

  it("maps a pending thesis outbox row and ignores a non-thesis row in the same store", async () => {
    const store = fixtureStore(H.key);
    store.alertOutbox.push(
      {
        id: "out-1",
        user_id: H.user!.id,
        status: "pending",
        payload: { thesis_id: THESIS_A },
        created_at: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "out-pos",
        user_id: H.user!.id,
        status: "sent",
        payload: { symbol: "NVDA", kind: "price" },
        created_at: "2026-09-01T00:00:00.000Z",
      },
    );
    const response = await GET(new Request(
      `https://x.test/api/thesis-fire-status?id=${THESIS_A}&id=${THESIS_B}&id=${THESIS_C}`,
    ));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.states[THESIS_A]).toEqual({
      source: "monitor",
      state: "window_closed",
      at: "2026-09-01T00:00:00.000Z",
    });
    expect(body.states[THESIS_B]).toEqual({ source: "unavailable" });
    expect(body.states[THESIS_C]).toEqual({ source: "unavailable" });
  });
});

// Round-2 review of PR #546 — BLOCKER 1. The window-closed crops were produced by a
// `page.route` stub of this API. The fixture transport can carry the real row: a
// store key holding FIXTURE_MONITOR_FIRED_TOKEN models "macro's nightly monitor
// enqueued one alert_outbox row", and the shipped route reads it with the same query
// it runs against Postgres.
describe("fixture transport: monitor-fired store key", () => {
  beforeEach(() => {
    resetFixtureStores();
    H.faults = [];
    delete process.env.TERMINAL_E2E_FIXTURE;
    vi.clearAllMocks();
  });

  it("seeds one alert_outbox row for the first thesis created in a monitor-fired store", async () => {
    const { createFixtureDb, FIXTURE_MONITOR_FIRED_TOKEN } = await import("@/lib/watchlistsFixtureDb");
    const key = `crops-${FIXTURE_MONITOR_FIRED_TOKEN}-1`;
    H.key = key;
    H.user = { id: fixtureUserId(key) };
    const db = createFixtureDb(key);
    const create = async (title: string) => {
      const result = await db.rpc("apply_thesis_version_v1", {
        p_thesis_id: null,
        p_expected_version: 0,
        p_transition: "create",
        p_subject_ref: { schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol", key: "NVDA", display: "NVDA" },
        p_content: { schema: "mastermind.thesis-content/v1", title, statement: "s" },
        p_client_request_id: `req-${title}`,
        p_effective_at: null,
      });
      const row = Array.isArray(result.data) ? result.data[0] : null;
      return String(row?.thesis_id);
    };
    const first = await create("closed window");
    const second = await create("still open");
    expect(isUuid(first)).toBe(true);
    expect(isUuid(second)).toBe(true);

    const store = fixtureStore(key);
    expect(store.alertOutbox).toHaveLength(1);

    const response = await GET(new Request(
      `https://x.test/api/thesis-fire-status?id=${first}&id=${second}`,
    ));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.states[first].source).toBe("monitor");
    expect(body.states[first].state).toBe("window_closed");
    expect(body.states[second]).toEqual({ source: "unavailable" });
  });

  it("seeds nothing in an ordinary store", async () => {
    const { createFixtureDb } = await import("@/lib/watchlistsFixtureDb");
    const key = "crops-ordinary-store";
    const db = createFixtureDb(key);
    await db.rpc("apply_thesis_version_v1", {
      p_thesis_id: null,
      p_expected_version: 0,
      p_transition: "create",
      p_subject_ref: { schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol", key: "NVDA", display: "NVDA" },
      p_content: { schema: "mastermind.thesis-content/v1", title: "t", statement: "s" },
      p_client_request_id: "req-ordinary",
      p_effective_at: null,
    });
    expect(fixtureStore(key).alertOutbox).toHaveLength(0);
  });
});
