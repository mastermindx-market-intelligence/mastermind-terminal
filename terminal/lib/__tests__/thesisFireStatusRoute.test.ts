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
