// E07 — /api/study-templates: auth, no-store, never-404, statuses for every store outcome.
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  key: "study-templates-route",
  user: { id: "e2e-user-study-templates-route" } as { id: string } | null,
  faults: [] as string[],
  cookies: {} as Record<string, string>,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => (name in H.cookies ? { value: H.cookies[name] } : undefined) })),
}));
vi.mock("@/lib/supabase/server", async () => {
  const { createFixtureDb } = await import("@/lib/watchlistsFixtureDb");
  return {
    createClient: vi.fn(async () => ({
      auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
      ...createFixtureDb(H.key, H.faults),
    })),
  };
});

import { GET, PUT } from "@/app/api/study-templates/route";
import {
  FAULT_SAVED_VIEWS_READ,
  FAULT_WORKSPACE_SETTINGS_WRITE,
  FIXTURE_FAULT_COOKIE,
  FIXTURE_STORE_COOKIE,
  fixtureStore,
  fixtureUserId,
  resetFixtureStores,
} from "@/lib/watchlistsFixtureDb";
import { GUEST_COOKIE } from "@/lib/layoutsFixtureDb";

const body = { indicators: ["rsi", "macd"], indParams: { rsi: { length: 9 } }, hidden: [] };

const put = (payload: unknown, raw?: string) => PUT(new Request("https://x.test/api/study-templates", {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: raw ?? JSON.stringify(payload),
}));

beforeEach(() => {
  resetFixtureStores();
  H.key = "study-templates-route";
  H.user = { id: fixtureUserId(H.key) };
  H.faults = [];
  H.cookies = {};
  delete process.env.TERMINAL_E2E_FIXTURE;
  vi.clearAllMocks();
});

describe("GET /api/study-templates", () => {
  it("requires a signed-in owner and is never cacheable", async () => {
    H.user = null;
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers an empty library with 200, never 404", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ templates: [], unreadable: 0, truncated: false });
  });

  it("says unavailable when the store cannot be read", async () => {
    H.faults = [FAULT_SAVED_VIEWS_READ];
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "study_templates_unavailable" });
  });
});

describe("PUT /api/study-templates", () => {
  it("creates, updates with the revision it read, and deletes", async () => {
    const created = await put({ action: "create", name: "Swing", body });
    expect(created.status).toBe(201);
    const { template } = await created.json();
    expect(template).toMatchObject({ name: "Swing", revision: 1, indicators: ["rsi", "macd"] });
    expect(template.id).toMatch(/^[0-9a-f]{32}$/);

    const updated = await put({ action: "update", id: template.id, baseRevision: 1, body: { indicators: ["rsi"], indParams: {}, hidden: [] } });
    expect(updated.status).toBe(200);
    expect((await updated.json()).template).toMatchObject({ name: "Swing", revision: 2, indicators: ["rsi"] });

    const stale = await put({ action: "update", id: template.id, baseRevision: 1, name: "Other" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "conflict", current: { revision: 2 } });

    const deleted = await put({ action: "delete", id: template.id, baseRevision: 2 });
    expect(deleted.status).toBe(200);
    const missing = await put({ action: "update", id: template.id, baseRevision: 2, name: "Ghost" });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual({ error: "not_found" });
  });

  it("maps validation, duplicate and scope problems to their own answers", async () => {
    expect((await put({ action: "create", name: "", body })).status).toBe(400);
    expect((await put({ action: "create", name: "Empty", body: { indicators: [] } })).status).toBe(400);
    await put({ action: "create", name: "Swing", body });
    const dup = await put({ action: "create", name: "swing", body });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "name_taken", existing: { name: "Swing" } });
    expect((await put({ action: "create", name: "Team", body, scope: "workspace" })).status).toBe(400);
    expect((await put({ action: "create", name: "Team", body, team_id: "t1" })).status).toBe(400);
    expect((await put({ action: "explode" })).status).toBe(400);
    expect((await put(null, "{not json")).status).toBe(400);
    expect((await put(null, JSON.stringify({ action: "create", name: "Big", pad: "x".repeat(70 * 1024) }))).status).toBe(413);
  });

  it("never reports a failed write as saved", async () => {
    H.faults = [FAULT_WORKSPACE_SETTINGS_WRITE];
    const response = await put({ action: "create", name: "Swing", body });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "study_templates_unavailable" });
    expect(fixtureStore(H.key).workspaceSettings).toHaveLength(0);
  });
});

describe("fixture identity", () => {
  it("treats the guest cookie as signed out and the store cookie as the owner", async () => {
    process.env.TERMINAL_E2E_FIXTURE = "1";
    H.cookies = { [GUEST_COOKIE]: "1" };
    expect((await GET()).status).toBe(401);

    H.cookies = { [FIXTURE_STORE_COOKIE]: "tplroute::a" };
    expect((await put({ action: "create", name: "Mine", body })).status).toBe(201);
    H.cookies = { [FIXTURE_STORE_COOKIE]: "tplroute::b" };
    expect(await (await GET()).json()).toMatchObject({ templates: [] });
    H.cookies = { [FIXTURE_STORE_COOKIE]: "tplroute::a", [FIXTURE_FAULT_COOKIE]: FAULT_WORKSPACE_SETTINGS_WRITE };
    expect((await put({ action: "create", name: "Second", body })).status).toBe(503);
    H.cookies = { [FIXTURE_STORE_COOKIE]: "tplroute::a" };
    expect((await (await GET()).json()).templates.map((t: { name: string }) => t.name)).toEqual(["Mine"]);
  });
});
