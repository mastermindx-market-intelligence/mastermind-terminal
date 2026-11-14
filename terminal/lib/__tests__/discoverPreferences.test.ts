import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { DiscoverPreferenceClient } from "@/lib/discoverPreferences";
import { parseDiscoverView, discoverViewKey, DISCOVER_LOCAL_KEY } from "@/lib/discoverWorkspace";
import { readDiscoverWorkspace, writeDiscoverWorkspace, DISCOVER_SETTINGS_KEY } from "@/lib/smartScreen/discoverStore";
import { createFixtureDb, fixtureStore, fixtureUserId, resetFixtureStores } from "@/lib/watchlistsFixtureDb";
import type { StoragePort } from "@/lib/ownerStorage";

const a = "a".repeat(32), b = "b".repeat(32), keyA = discoverViewKey(a), keyB = discoverViewKey(b);
const view = (id = a, name = id === a ? "A" : "B") => parseDiscoverView({ schema: 1, id, name, columns: ["sym", "verdict", "regimeBull", "last"], density: "c", sort: { k: "dv", dir: -1 }, filters: { market: "all" }, technical: null, fundamental: [], search: "" })!;
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
class MemoryStorage implements StoragePort {
  map = new Map<string, string>(); fail = false;
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error("quota"); this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}
let storage: MemoryStorage;
const storeKey = "discover-delivery", user = fixtureUserId(storeKey), owner = "account:" + user;
const db = () => createFixtureDb(storeKey);
const clients: DiscoverPreferenceClient[] = [];
let before: ((init: RequestInit) => Promise<void>) | null;
let after: ((init: RequestInit) => Promise<void>) | null;
const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
  await before?.(init ?? {});
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const result = init?.method === "PUT" ? await writeDiscoverWorkspace(db(), user, body.patch, body.expected) : await readDiscoverWorkspace(db(), user);
  await after?.(init ?? {});
  return new Response(JSON.stringify(result.ok ? { owner, values: result.values, ...("blocked" in result ? { blocked: result.blocked } : {}) } : result), { status: result.ok ? 200 : result.status });
});
function client() { const instance = new DiscoverPreferenceClient(owner, storage, vi.fn(), transport as typeof fetch); clients.push(instance); return instance; }
async function seed(values: Record<string, unknown>) { const result = await writeDiscoverWorkspace(db(), user, values, Object.fromEntries(Object.keys(values).map(key => [key, null]))); expect(result.ok).toBe(true); }
async function values() { const read = await readDiscoverWorkspace(db(), user); if (!read.ok) throw new Error(read.error); return read.values; }
const putBodies = () => transport.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => JSON.parse(String(init?.body)));
beforeEach(() => { vi.useFakeTimers(); resetFixtureStores(); storage = new MemoryStorage(); before = null; after = null; transport.mockClear(); });
afterEach(() => { clients.splice(0).forEach(c => c.dispose()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Discover durable edits and account conflicts", () => {
  it("uses the platform fetch receiver for both account reads and saves", async () => {
    // Window.fetch rejects a class instance as its receiver before issuing a request.
    // Arrow transports injected by other tests intentionally do not model that binding.
    vi.stubGlobal("fetch", function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return transport(input, init);
    });
    const c = new DiscoverPreferenceClient(owner, storage, vi.fn()); clients.push(c);
    await c.load(); expect(c.snapshot()).toMatchObject({ base: "loaded", issue: null });
    expect(c.save(view(), true)).toBe(true); await flush();
    expect(c.snapshot().sync.phase).toBe("saved"); expect((await values())[keyA]).toEqual(view());
    expect(transport.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "PUT"]);
  });

  it("persists original preimages across a conflict and browser reload", async () => {
    await seed({ [keyA]: view() }); const first = client(); await first.load();
    await writeDiscoverWorkspace(db(), user, { [keyA]: view(a, "Other device") }, { [keyA]: view() });
    expect(first.rename(a, "Local edit")).toBe(true); await flush(); expect(first.snapshot().issue).toBe("conflict");
    first.dispose(); const second = client(); await second.load();
    expect(second.snapshot().issue).toBe("conflict"); expect(second.snapshot().value.views[0].name).toBe("Local edit");
    second.dispose(); const third = client(); const writes = putBodies().length; await third.load(); await vi.advanceTimersByTimeAsync(30_000);
    expect(putBodies()).toHaveLength(writes); expect((await values())[keyA]).toEqual(view(a, "Other device"));
    expect(third.snapshot().issue).toBe("conflict");
  });
  it("does not rebase a queued sibling edit from another key's whole-document acknowledgement", async () => {
    await seed({ [keyA]: view(), [keyB]: view(b) }); const c = client(); await c.load();
    const gate = deferred(); let firstPut = true;
    before = async init => { if (init.method === "PUT" && firstPut) { firstPut = false; await gate.promise; } };
    c.rename(a, "A local"); c.rename(b, "B local");
    await writeDiscoverWorkspace(db(), user, { [keyB]: view(b, "B remote") }, { [keyB]: view(b) });
    gate.release(); await flush();
    expect(putBodies().at(-1).expected[keyB]).toEqual(view(b));
    expect(c.snapshot().issue).toBe("conflict"); expect((await values())[keyB]).toEqual(view(b, "B remote"));
    expect((await values())[keyA]).toEqual(view(a, "A local"));
  });
  it("advances only the acknowledged key's preimage for edits made while it was saving", async () => {
    await seed({ [keyA]: view() }); const c = client(); await c.load();
    const gate = deferred(); let firstPut = true;
    before = async init => { if (init.method === "PUT" && firstPut) { firstPut = false; await gate.promise; } };
    c.rename(a, "First"); c.rename(a, "Latest"); gate.release(); await flush();
    expect(putBodies()).toHaveLength(2); expect(putBodies()[1].expected[keyA]).toEqual(view(a, "First"));
    expect((await values())[keyA]).toEqual(view(a, "Latest")); expect(c.snapshot().sync.phase).toBe("saved");
  });
  it("does not strand a coalesced edit that returns to the in-flight value", async () => {
    await seed({ [keyA]: view() }); const c = client(); await c.load();
    const gate = deferred(); before = async init => { if (init.method === "PUT") await gate.promise; };
    c.rename(a, "First"); c.rename(a, "Second"); c.rename(a, "First"); gate.release(); await flush();
    expect(putBodies()).toHaveLength(1); expect(c.snapshot().sync.phase).toBe("saved"); expect(c.snapshot().issue).toBeNull();
  });
  it("reconciles a lost acknowledgement as an identical replay without changing the row twice", async () => {
    const c = client(); await c.load(); let lose = true;
    after = async init => { if (init.method === "PUT" && lose) { lose = false; throw new Error("response lost after commit"); } };
    c.save(view(), true); await flush(); const token = fixtureStore(storeKey).workspaceSettings[0].updated_at;
    expect(c.snapshot().sync.phase).toBe("failed"); c.retry(); await flush();
    expect(c.snapshot().sync.phase).toBe("saved"); expect(fixtureStore(storeKey).workspaceSettings[0].updated_at).toBe(token);
    expect(c.snapshot().value.views).toEqual([view()]);
  });
  it("retains unresolved writes until they settle, then discards local intent and resets status", async () => {
    await seed({ [keyA]: view() }); const c = client(); await c.load();
    const gate = deferred(); before = async init => { if (init.method === "PUT") await gate.promise; };
    c.rename(a, "Local"); await c.load(true); expect(c.snapshot().sync.phase).toBe("syncing");
    await writeDiscoverWorkspace(db(), user, { [keyA]: view(a, "Remote") }, { [keyA]: view() });
    gate.release(); await flush(); expect(c.snapshot().issue).toBe("conflict");
    await c.load(true); expect(c.snapshot()).toMatchObject({ issue: null, ready: true, base: "loaded", sync: { phase: "idle", revision: 0, acked: 0 } });
    expect(c.snapshot().value.views).toEqual([view(a, "Remote")]);
    expect(c.rename(a, "After discard")).toBe(true); await flush(); expect(c.snapshot().sync.phase).toBe("saved");
  });
  it("uses cache for display during a failed read without writing over the unread account", async () => {
    await seed({ [keyA]: view() }); const first = client(); await first.load(); first.dispose();
    before = async () => { throw new Error("offline"); }; const c = client(); await c.load();
    expect(c.snapshot().value.views).toEqual([view()]); expect(c.snapshot().base).toBe("retrying"); expect(c.rename(a, "Unsafe")).toBe(false);
    before = null; c.retry(); await flush(); expect(c.snapshot().base).toBe("loaded"); expect(putBodies()).toHaveLength(0);
  });
  it("keeps the conflict draft durable when fetching the chosen account replacement fails", async () => {
    await seed({ [keyA]: view() }); const c = client(); await c.load();
    await writeDiscoverWorkspace(db(), user, { [keyA]: view(a, "Remote") }, { [keyA]: view() });
    c.rename(a, "My recoverable draft"); await flush(); expect(c.snapshot().issue).toBe("conflict");
    before = async init => { if (init.method === "GET") throw new Error("replacement unavailable"); };
    await c.load(true); expect(c.snapshot().base).toBe("retrying"); expect(c.snapshot().value.views[0].name).toBe("My recoverable draft");
    c.dispose(); before = null; const reopened = client(); await reopened.load();
    expect(reopened.snapshot().issue).toBe("conflict"); expect(reopened.snapshot().value.views[0].name).toBe("My recoverable draft");
    expect((await values())[keyA]).toEqual(view(a, "Remote"));
  });
  it("does not silently rebase legacy pending cache without captured preimages", async () => {
    await seed({ [keyA]: view() }); storage.setItem(DISCOVER_LOCAL_KEY, JSON.stringify({ [owner]: { v: 1, ack: { [keyA]: view() }, pending: { [keyA]: view(a, "Unbased edit") } } }));
    const c = client(); await c.load(); expect(c.snapshot().issue).toBe("conflict"); expect(putBodies()).toHaveLength(0);
  });
  it.each([
    { schema: 2, values: {} },
    { schema: 1, values: { [keyA]: { ...view(), schema: 2 } } },
    { schema: 1, values: { [keyA]: { ...view(), columns: ["sym", "future_metric"] } } },
    { schema: 1, values: {}, futureSetting: true },
  ])("preserves an unsupported account format without writing it: %j", async value => {
    fixtureStore(storeKey).workspaceSettings.push({ id: "future", scope: "user", user_id: user, key: DISCOVER_SETTINGS_KEY, value, updated_at: "2026-11-14T00:00:00.000Z" });
    const c = client(); await c.load(); expect(c.snapshot().issue).toBe("newer_schema"); expect(c.snapshot().value.blocked).toBe(true);
    expect(c.save(view(), true)).toBe(false); expect(putBodies()).toHaveLength(0); expect(fixtureStore(storeKey).workspaceSettings[0].value).toEqual(value);
  });
  it("can save to the account when device storage is unavailable without claiming a device copy", async () => {
    storage.fail = true; const c = client(); await c.load(); c.save(view(), true); await flush();
    expect(c.snapshot()).toMatchObject({ device: false, sync: { phase: "saved" } }); expect((await values())[keyA]).toEqual(view());
  });
  it("makes disposed owner continuations inert", async () => {
    const c = client(); await c.load(); const gate = deferred(); before = async init => { if (init.method === "PUT") await gate.promise; };
    c.save(view(), true); const snapshot = c.snapshot(); c.dispose(); gate.release(); await flush();
    expect(c.snapshot()).toBe(snapshot); expect(putBodies()).toHaveLength(1);
  });
});
