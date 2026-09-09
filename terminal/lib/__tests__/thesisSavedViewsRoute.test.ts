import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  key: "saved-views-route",
  user: { id: "e2e-user-saved-views-route" } as { id: string } | null,
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

import { GET, PUT } from "@/app/api/thesis-saved-views/route";
import { fixtureUserId, resetFixtureStores } from "@/lib/watchlistsFixtureDb";
import { MAX_SAVED_VIEWS } from "@/lib/rmsViews";

const put = (body: Record<string, unknown>) => PUT(new Request("https://x.test/api/thesis-saved-views", {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));

beforeEach(() => {
  resetFixtureStores();
  H.key = "saved-views-route";
  H.user = { id: fixtureUserId(H.key) };
  H.faults = [];
  delete process.env.TERMINAL_E2E_FIXTURE;
  vi.clearAllMocks();
});

describe("GET /api/thesis-saved-views", () => {
  it("requires auth", async () => {
    H.user = null;
    const response = await GET(new Request("https://x.test/api/thesis-saved-views"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns an empty list from the fixture store", async () => {
    const response = await GET(new Request("https://x.test/api/thesis-saved-views"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ views: [], truncated: false });
  });
});

describe("PUT /api/thesis-saved-views", () => {
  it("creates, lists, renames, and deletes a user-scoped view", async () => {
    const created = await put({
      action: "create",
      name: "Check on this",
      filter: { lifecycle: "active", staleDays: 30 },
    });
    expect(created.status).toBe(201);
    const payload = await created.json();
    expect(payload.view.name).toBe("Check on this");
    expect(payload.view.id).toMatch(/^[0-9a-f-]{36}$/i);

    const listed = await GET(new Request("https://x.test/api/thesis-saved-views"));
    expect((await listed.json()).views).toHaveLength(1);

    const renamed = await put({ action: "rename", id: payload.view.id, name: "Renamed" });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).view.name).toBe("Renamed");

    const deleted = await put({ action: "delete", id: payload.view.id });
    expect(deleted.status).toBe(200);
    const empty = await GET(new Request("https://x.test/api/thesis-saved-views"));
    expect((await empty.json()).views).toEqual([]);
  });

  it("enforces the 50-item bound server-side even if a client bypasses it", async () => {
    for (let i = 0; i < MAX_SAVED_VIEWS; i += 1) {
      const response = await put({
        action: "create",
        name: `View ${i}`,
        filter: { lifecycle: "active" },
      });
      expect(response.status).toBe(201);
    }
    const overflow = await put({
      action: "create",
      name: "One too many",
      filter: { lifecycle: "active" },
    });
    expect(overflow.status).toBe(409);
    expect(await overflow.json()).toEqual({ error: "limit_reached" });
  });

  it("rejects any request body naming scope workspace", async () => {
    const response = await put({
      action: "create",
      name: "Team view",
      filter: { lifecycle: "active" },
      scope: "workspace",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_scope" });
    const listed = await GET(new Request("https://x.test/api/thesis-saved-views"));
    expect((await listed.json()).views).toEqual([]);
  });
});

// Round-2 review of PR #546 — Opus minor 2: the delete branch's 404 was dead code
// because the service answered ok for an id that never existed.
describe("PUT /api/thesis-saved-views — delete of an unknown id", () => {
  it("answers 404 saved_view_not_found", async () => {
    const response = await PUT(new Request("https://x.test/api/thesis-saved-views", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", id: "99999999-9999-4999-8999-999999999999" }),
    }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "saved_view_not_found" });
  });
});
