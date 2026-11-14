// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const fake = vi.hoisted(() => ({ id: "11111111-1111-4111-8111-111111111111", meta: {} as Record<string, unknown>, updates: [] as Record<string, unknown>[] }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  getUser: async () => ({ data: { user: { id: fake.id, user_metadata: fake.meta } }, error: null }),
  updateUser: async ({ data }: { data: Record<string, unknown> }) => { fake.updates.push(data); fake.meta = { ...fake.meta, ...data }; return { error: null }; },
} }) }));
vi.mock("@/lib/i18n", () => ({ applyLang: vi.fn() }));
import { __loadOwner, __marketPrefsSnapshot, __resetMarketPrefsStore, currentOwnerToken, openDiscover, persistDiscover, deleteDiscover, renameDiscover, persistTradeTypes } from "@/lib/useMarketPrefs";
import { parseDiscoverView, discoverViewKey, DISCOVER_CURRENT_KEY } from "@/lib/discoverWorkspace";
import { readDiscoverWorkspace, writeDiscoverWorkspace } from "@/lib/smartScreen/discoverStore";
import { createFixtureDb, resetFixtureStores } from "@/lib/watchlistsFixtureDb";

const a = "a".repeat(32), b = "b".repeat(32);
const view = (id = a) => parseDiscoverView({ schema: 1, id, name: id === a ? "A" : "B", columns: ["sym", "verdict", "regimeBull", "last"], density: "c", sort: { k: "dv", dir: -1 }, filters: { market: "all" }, technical: null, fundamental: [], search: "" })!;
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const db = () => createFixtureDb("discover-account");
const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
  const user = fake.id;
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const result = init?.method === "PUT" ? await writeDiscoverWorkspace(db(), user, body.patch, body.expected) : await readDiscoverWorkspace(db(), user);
  return new Response(JSON.stringify(result.ok ? { owner: "account:" + user, values: result.values, ...("blocked" in result ? { blocked: result.blocked } : {}) } : result), { status: result.ok ? 200 : result.status });
});
const load = async () => { __loadOwner("account:" + fake.id); await flush(); openDiscover(currentOwnerToken()); await flush(); };
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); __resetMarketPrefsStore(); resetFixtureStores(); fake.id = "11111111-1111-4111-8111-111111111111"; fake.meta = {}; fake.updates = []; request.mockClear(); vi.stubGlobal("fetch", request); });
afterEach(() => { __resetMarketPrefsStore(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Discover uses the existing account owner and database store", () => {
  it("loads lazily, round-trips account views, and never places view payloads in auth metadata", async () => {
    __loadOwner("account:" + fake.id); await flush(); expect(request).not.toHaveBeenCalled();
    await load(); expect(persistDiscover(view(), true, currentOwnerToken())).toBe(true); await flush();
    expect(fake.updates).toEqual([]); expect(__marketPrefsSnapshot().discoverSync.phase).toBe("saved");
    __resetMarketPrefsStore(); localStorage.clear(); await load();
    expect(__marketPrefsSnapshot().discover.current).toEqual(view()); expect(__marketPrefsSnapshot().discover.views).toEqual([view()]);
    persistTradeTypes(["stocks"]); await flush(); expect(fake.updates).toEqual([{ trade_types: ["stocks"] }]);
  });
  it("renames/deletes inactive views without changing the active view", async () => {
    await writeDiscoverWorkspace(db(), fake.id, { [DISCOVER_CURRENT_KEY]: view(), [discoverViewKey(a)]: view(), [discoverViewKey(b)]: view(b) }, { [DISCOVER_CURRENT_KEY]: null, [discoverViewKey(a)]: null, [discoverViewKey(b)]: null });
    await load(); expect(renameDiscover(b, "Renamed", currentOwnerToken())).toBe(true); await flush();
    expect(__marketPrefsSnapshot().discover.current).toEqual(view());
    expect(deleteDiscover(b, currentOwnerToken())).toBe(true); await flush();
    expect(__marketPrefsSnapshot().discover.views.map(v => v.id)).toEqual([a]);
    expect(deleteDiscover(a, currentOwnerToken())).toBe(true); await flush();
    expect(__marketPrefsSnapshot().discover.current?.id).toBe("current"); expect(fake.updates).toEqual([]);
  });
  it("rejects delayed callbacks across A → B → A account generations", async () => {
    await load(); const token = currentOwnerToken();
    fake.id = "22222222-2222-4222-8222-222222222222"; await load();
    fake.id = "11111111-1111-4111-8111-111111111111"; await load(); request.mockClear();
    expect(persistDiscover(view(), true, token)).toBe(false); expect(renameDiscover(a, "Stale", token)).toBe(false); expect(deleteDiscover(a, token)).toBe(false);
    expect(request).not.toHaveBeenCalled(); expect(fake.updates).toEqual([]);
  });
});
