/**
 * SmartScreenStore against the REAL /api/smart-screens handlers (E04, AC-E04-03/04).
 *
 * Each "device" is a store with its own localStorage; every request goes through the route
 * handlers into the shared fixture database, so a conflict here is the same conflict the account
 * would answer. The network can be cut, and an answer can be LOST after the write landed — the
 * two failure shapes that make "acknowledged only after persistence" matter (#884).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ key: "smart-screens-client", user: null as { id: string } | null, faults: [] as string[] }));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("@/lib/supabase/server", async () => {
  const { createFixtureDb } = await import("@/lib/watchlistsFixtureDb");
  return {
    createClient: vi.fn(async () => {
      const user = H.user;
      return { auth: { getUser: vi.fn(async () => ({ data: { user } })) }, ...createFixtureDb(H.key, H.faults) };
    }),
  };
});

import { GET, PUT } from "@/app/api/smart-screens/route";
import { fixtureStore, fixtureUserId, resetFixtureStores } from "@/lib/watchlistsFixtureDb";
import { GUEST_OWNER, ownerKeyFor } from "@/lib/accountIdentity";
import type { StoragePort } from "@/lib/ownerStorage";
import { MAX_PENDING, SMART_SCREENS_LOCAL_KEY, SmartScreenStore } from "@/lib/smartScreen/client";
import { DEVICE_PRESETS_KEY, readDevicePresets } from "@/lib/smartScreen/devicePresets";
import { compileFilters, normalizeDefinition } from "@/lib/smartScreen/predicate";
import { screenKey } from "@/lib/smartScreen/record";

// ── harness ──────────────────────────────────────────────────────────────────────────────

type Net = { down: boolean; loseAnswer: boolean; calls: number; answer?: (response: Response) => Promise<Response> };

class MemoryStorage implements StoragePort {
  map = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { if (this.failWrites) throw new Error("QuotaExceededError"); this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

let seq = 0;
const nextId = () => (++seq).toString(16).padStart(32, "a");

function device(userId: string | null, storage = new MemoryStorage()) {
  const net: Net = { down: false, loseAnswer: false, calls: 0 };
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    net.calls++;
    if (net.down) throw new TypeError("Failed to fetch");
    H.user = userId ? { id: userId } : null;
    const request = new Request(`https://x.test${input}`, {
      method: init?.method ?? "GET", headers: init?.headers, body: init?.body as BodyInit | undefined,
    });
    const response = request.method === "PUT" ? await PUT(request) : await GET(request);
    // The write landed; the answer never reached the browser.
    if (net.loseAnswer) throw new TypeError("network connection was lost");
    return request.method === "PUT" && net.answer ? net.answer(response) : response;
  };
  const owner = userId ? ownerKeyFor(userId) : GUEST_OWNER;
  const make = () => new SmartScreenStore(owner, { fetch, storage, now: () => "2026-10-11T09:00:00.000Z", newId: nextId });
  return { store: make(), remount: make, storage, net, owner };
}

const USER_A = fixtureUserId("smart-screens-client");
const USER_B = "e2e-user-a-different-account";
const DEF = { grammar: 1, scope: { markets: "all", asset: "Equities", unpriced: false }, where: { all: [{ f: "chg", op: "gte", v: 3 }] } };
const DEF_2 = { grammar: 1, scope: { markets: "all", asset: null, unpriced: false }, where: { all: [{ f: "dv", op: "gte", v: 1e7 }] } };
const rows = () => fixtureStore(H.key).workspaceSettings;

beforeEach(() => {
  resetFixtureStores();
  H.user = null;
  H.faults = [];
  seq = 0;
  delete process.env.TERMINAL_E2E_FIXTURE;
});

describe("write acknowledgements belong to the requested screen", () => {
  it.each(["id", "name", "definition", "revision"])("retains a create after a mismatched %s answer and recovers the same original id", async (field) => {
    const a = device(USER_A);
    await a.store.load();
    a.net.answer = async response => {
      const body = await response.json();
      if (field === "id") body.record.id = "f".repeat(32);
      if (field === "name") body.record.name = "Another question";
      if (field === "definition") {
        const other = normalizeDefinition(DEF_2);
        if (!other.ok) throw new Error("invalid fixture");
        body.record.def = other.def; body.record.hash = other.hash;
      }
      if (field === "revision") body.record.rev = 2;
      return Response.json(body, { status: response.status });
    };
    expect(await a.store.create({ name: "Momentum", def: DEF })).toEqual({ ok: false, reason: "failed" });
    const op = a.store.getSnapshot().pending[0];
    expect(op).toMatchObject({ action: "create", error: "unavailable", name: "Momentum" });
    expect(a.store.getSnapshot()).toMatchObject({ status: "stale", readFailure: "unavailable" });
    expect(a.store.getSnapshot().ack!.screens).toEqual([]);
    expect(rows()).toHaveLength(1); // The original write landed; only its answer was replaced.
    const restored = a.remount();
    expect(restored.getSnapshot().pending[0].id).toBe(op.id);
    a.net.answer = undefined;
    expect(await restored.retry(op.opId)).toEqual({ ok: true });
    expect(restored.getSnapshot().ack!.screens[0]).toMatchObject({ id: op.id, name: "Momentum", rev: 1 });
    expect(rows()).toHaveLength(1);
  });

  it("does not erase an acknowledged screen on a different delete answer", async () => {
    const a = device(USER_A);
    await a.store.load();
    await a.store.create({ name: "Momentum", def: DEF });
    const before = a.store.getSnapshot().ack!;
    const id = before.screens[0].id;
    a.net.answer = async () => Response.json({ deleted: "f".repeat(32), alreadyGone: false });
    expect(await a.store.remove(id)).toEqual({ ok: false, reason: "failed" });
    expect(a.store.getSnapshot().ack).toEqual(before);
    const op = a.store.getSnapshot().pending[0];
    a.net.answer = undefined;
    expect(await a.remount().retry(op.opId)).toEqual({ ok: true });
    expect(rows()).toHaveLength(0);
  });

  it("does not settle an update using a stale successful answer", async () => {
    const a = device(USER_A);
    await a.store.load();
    await a.store.create({ name: "Momentum", def: DEF });
    const original = a.store.getSnapshot().ack!.screens[0];
    a.net.answer = async () => Response.json({ record: original, replay: false });
    expect(await a.store.update(original.id, { name: "Revised" })).toEqual({ ok: false, reason: "failed" });
    const op = a.store.getSnapshot().pending[0];
    expect(a.store.getSnapshot().ack!.screens[0]).toEqual(original);
    a.net.answer = undefined;
    expect(await a.remount().retry(op.opId)).toEqual({ ok: true });
    expect(rows()[0].value).toMatchObject({ id: original.id, rev: 2, name: "Revised" });
  });

  it("accepts the original same-content no-op revision", async () => {
    const a = device(USER_A);
    await a.store.load();
    await a.store.create({ name: "Momentum", def: DEF });
    const original = a.store.getSnapshot().ack!.screens[0];
    expect(await a.store.update(original.id, { name: "Momentum" })).toEqual({ ok: true });
    expect(a.store.getSnapshot().ack!.screens[0]).toEqual(original);
    expect(a.store.getSnapshot().pending).toEqual([]);
  });

  it("retains a matching update whose successful answer skips the expected revision", async () => {
    const a = device(USER_A);
    await a.store.load();
    await a.store.create({ name: "Momentum", def: DEF });
    const original = a.store.getSnapshot().ack!.screens[0];
    a.net.answer = async response => {
      const body = await response.json();
      body.record.rev = 99;
      return Response.json(body);
    };
    expect(await a.store.update(original.id, { name: "Revised" })).toEqual({ ok: false, reason: "failed" });
    expect(a.store.getSnapshot().ack!.screens[0]).toEqual(original);
    expect(a.store.getSnapshot().pending).toHaveLength(1);
  });

  it("does not replace the acknowledged screen with another newer-schema target", async () => {
    const a = device(USER_A);
    await a.store.load();
    await a.store.create({ name: "Momentum", def: DEF });
    const original = a.store.getSnapshot().ack!.screens[0];
    a.net.answer = async () => Response.json({ error: "newer_schema", readOnly: { id: "f".repeat(32), rev: 2, name: "Other", schema: 2 } }, { status: 409 });
    expect(await a.store.update(original.id, { name: "Revised" })).toEqual({ ok: false, reason: "failed" });
    expect(a.store.getSnapshot().ack!.screens).toEqual([original]);
    expect(a.store.getSnapshot().ack!.readOnly).toEqual([]);
    expect(a.store.getSnapshot().pending[0].error).toBe("unavailable");
  });

  it.each([-1, 0, 1.5, 1_000_000_001])("rejects a newer-format answer with invalid revision %s without replacing the baseline", async rev => {
    const a = device(USER_A);
    await a.store.load();
    await a.store.create({ name: "Momentum", def: DEF });
    const original = a.store.getSnapshot().ack!.screens[0];
    a.net.answer = async () => Response.json({ error: "newer_schema", readOnly: { id: original.id, rev, name: "Future", schema: 2 } }, { status: 409 });
    await a.store.update(original.id, { name: "Revised" });
    expect(a.store.getSnapshot().ack!.screens).toEqual([original]);
    expect(a.store.getSnapshot().ack!.readOnly).toEqual([]);
    expect(a.store.getSnapshot().pending[0]).toMatchObject({ error: "unavailable", state: "failed" });
  });

  it("preserves a valid newer grammar in the current record schema as read-only", async () => {
    const a = device(USER_A);
    await a.store.load();
    await a.store.create({ name: "Momentum", def: DEF });
    const original = a.store.getSnapshot().ack!.screens[0];
    rows()[0].value = { ...original, rev: 2, def: { ...original.def, grammar: 2 } };
    await a.store.update(original.id, { name: "Revised" });
    expect(a.store.getSnapshot().ack!.screens).toEqual([]);
    expect(a.store.getSnapshot().ack!.readOnly).toEqual([{ id: original.id, name: "Momentum", rev: 2, schema: 1 }]);
    expect(a.store.getSnapshot().pending[0].error).toBe("newer_schema");
  });

  it("forgetting a lost-answer request does not claim an empty current account or undo the landed write", async () => {
    const a = device(USER_A);
    await a.store.load();
    a.net.loseAnswer = true;
    await a.store.create({ name: "Landed", def: DEF });
    const op = a.store.getSnapshot().pending[0];
    const calls = a.net.calls;
    a.store.discard(op.opId);
    expect(a.net.calls).toBe(calls);
    expect(rows()).toHaveLength(1);
    expect(a.store.getSnapshot()).toMatchObject({ status: "stale", readFailure: "network", pending: [] });
    a.net.loseAnswer = false;
    await a.store.refresh();
    expect(a.net.calls).toBe(calls + 1);
    expect(a.store.getSnapshot()).toMatchObject({ status: "ready", readFailure: null, pending: [] });
    expect(a.store.getSnapshot().ack!.screens[0]).toMatchObject({ id: op.id, name: "Landed" });
  });

  it.each([null, { id: "f".repeat(32), rev: 2, name: "Other", schema: 2 }])("does not turn an unusable conflict answer into a settleable account version", async readOnly => {
    const a = device(USER_A);
    await a.store.load();
    await a.store.create({ name: "Momentum", def: DEF });
    const original = a.store.getSnapshot().ack!.screens[0];
    a.net.answer = async () => Response.json({ error: "conflict", current: null, readOnly }, { status: 409 });
    await a.store.remove(original.id);
    const pending = a.store.getSnapshot().pending[0];
    expect(pending).toMatchObject({ state: "failed", error: "unavailable", expectedRev: 1 });
    expect(a.store.useAccountVersion(pending.opId)).toEqual({ ok: false, reason: "not_found" });
    expect(a.store.getSnapshot().ack!.screens).toEqual([original]);
  });

  it("does not offer another record as the conflict resolution target", async () => {
    const a = device(USER_A);
    await a.store.load();
    await a.store.create({ name: "Momentum", def: DEF });
    const original = a.store.getSnapshot().ack!.screens[0];
    a.net.answer = async () => Response.json({ error: "conflict", current: { ...original, id: "f".repeat(32), name: "Revised", rev: 2 } }, { status: 409 });
    expect(await a.store.update(original.id, { name: "Revised" })).toEqual({ ok: false, reason: "failed" });
    expect(a.store.getSnapshot().ack!.screens).toEqual([original]);
    expect(a.store.getSnapshot().pending[0]).toMatchObject({ id: original.id, current: null, error: "unavailable" });
  });
});

// ── baseline rules (#884) ────────────────────────────────────────────────────────────────

describe("no write without an acknowledged baseline", () => {
  it("a guest never reads, writes or stores anything", async () => {
    const guest = device(null);
    expect(guest.store.getSnapshot().status).toBe("guest");
    await guest.store.load();
    expect(await guest.store.create({ name: "x", def: DEF })).toEqual({ ok: false, reason: "guest" });
    expect(guest.net.calls).toBe(0);
    expect(guest.storage.map.size).toBe(0);
  });

  it("refuses to save before the account list was read, and after a first read failed", async () => {
    const a = device(USER_A);
    expect(await a.store.create({ name: "x", def: DEF })).toEqual({ ok: false, reason: "no_baseline" });
    H.faults = ["saved_views_read"];
    await a.store.load();
    expect(a.store.getSnapshot()).toMatchObject({ status: "unavailable", readFailure: "unavailable", ack: null });
    expect(await a.store.create({ name: "x", def: DEF })).toEqual({ ok: false, reason: "no_baseline" });
    expect(rows()).toHaveLength(0);
  });

  it("a failed re-read keeps the acknowledged list (stale), never an empty one", async () => {
    const a = device(USER_A);
    await a.store.load();
    await a.store.create({ name: "Momentum", def: DEF });
    const before = a.storage.getItem(SMART_SCREENS_LOCAL_KEY);
    H.faults = ["saved_views_read"];
    await a.store.refresh();
    expect(a.store.getSnapshot()).toMatchObject({ status: "stale", readFailure: "unavailable" });
    expect(a.store.getSnapshot().ack!.screens.map((screen) => screen.name)).toEqual(["Momentum"]);
    a.net.down = true;
    await a.store.refresh();
    expect(a.store.getSnapshot()).toMatchObject({ status: "stale", readFailure: "network" });
    // The device copy is the last acknowledged one, byte-for-byte.
    expect(a.storage.getItem(SMART_SCREENS_LOCAL_KEY)).toBe(before);
    // A fresh mount on this device starts from that acknowledged copy, still offline.
    const reopened = a.remount();
    expect(reopened.getSnapshot().ack!.screens.map((screen) => screen.name)).toEqual(["Momentum"]);
  });

  it("acknowledges a save only after the account answered", async () => {
    const a = device(USER_A);
    await a.store.load();
    const pendingSeen: string[] = [];
    a.store.subscribe(() => {
      const snap = a.store.getSnapshot();
      if (snap.busy) pendingSeen.push(`${snap.pending.map((op) => op.state).join(",")}|${snap.ack!.screens.length}`);
    });
    const outcome = await a.store.create({ name: "Momentum", def: DEF });
    expect(outcome).toEqual({ ok: true });
    // While in flight it is a pending "sending" write, not a listed screen.
    expect(pendingSeen).toContain("sending|0");
    expect(a.store.getSnapshot().pending).toEqual([]);
    expect(a.store.getSnapshot().ack!.screens).toHaveLength(1);
    expect(rows()).toHaveLength(1);
  });
});

// ── AC-E04-04: unsaved work survives failure and reload ─────────────────────────────────────

describe("a failed save is recoverable", () => {
  it("keeps the complete intended screen across a remount, and retries it on request", async () => {
    const a = device(USER_A);
    await a.store.load();
    a.net.down = true;
    expect(await a.store.create({ name: "Offline save", def: DEF })).toEqual({ ok: false, reason: "failed" });
    const [op] = a.store.getSnapshot().pending;
    expect(op).toMatchObject({ action: "create", state: "failed", error: "network", name: "Offline save" });
    expect(a.store.getSnapshot().ack!.screens).toEqual([]);

    // Reload the page: the intent is still there, nothing was retried behind the user's back.
    const callsBefore = a.net.calls;
    const reopened = a.remount();
    expect(reopened.getSnapshot().pending).toEqual([op]);
    expect(a.net.calls).toBe(callsBefore);

    a.net.down = false;
    await reopened.load();
    expect(await reopened.retry(op.opId)).toEqual({ ok: true });
    expect(reopened.getSnapshot().pending).toEqual([]);
    expect(reopened.getSnapshot().ack!.screens.map((screen) => [screen.id, screen.name])).toEqual([[op.id, "Offline save"]]);
  });

  it("a retried save whose first answer was lost lands once, not twice", async () => {
    const a = device(USER_A);
    await a.store.load();
    a.net.loseAnswer = true;
    await a.store.create({ name: "Lost answer", def: DEF });
    expect(rows()).toHaveLength(1); // it DID land
    expect(a.store.getSnapshot().pending[0]).toMatchObject({ state: "failed", error: "network" });
    a.net.loseAnswer = false;
    expect(await a.store.retry(a.store.getSnapshot().pending[0].opId)).toEqual({ ok: true });
    expect(rows()).toHaveLength(1);
    expect(a.store.getSnapshot().ack!.screens).toHaveLength(1);
  });

  it("a retried update whose first answer was lost is recognised as already applied", async () => {
    const a = device(USER_A);
    await a.store.load();
    await a.store.create({ name: "One", def: DEF });
    const id = a.store.getSnapshot().ack!.screens[0].id;
    a.net.loseAnswer = true;
    await a.store.update(id, { name: "Two" });
    a.net.loseAnswer = false;
    // The retry still names rev 1; the account holds rev 2 = exactly this intent.
    expect(await a.store.retry(a.store.getSnapshot().pending[0].opId)).toEqual({ ok: true });
    expect(a.store.getSnapshot().pending).toEqual([]);
    expect(a.store.getSnapshot().ack!.screens[0]).toMatchObject({ rev: 2, name: "Two" });
  });

  it("a write a reload interrupted comes back as failed (effect unknown), never as silently done", async () => {
    const a = device(USER_A);
    await a.store.load();
    a.net.down = true;
    await a.store.create({ name: "Mid-flight", def: DEF });
    // Rewrite the device copy as it looks if the tab closed while the request was in flight.
    const envelope = JSON.parse(a.storage.getItem(SMART_SCREENS_LOCAL_KEY)!);
    envelope[a.owner].pending[0].state = "sending";
    envelope[a.owner].pending[0].error = null;
    a.storage.setItem(SMART_SCREENS_LOCAL_KEY, JSON.stringify(envelope));
    const reopened = a.remount();
    expect(reopened.getSnapshot().pending[0]).toMatchObject({ state: "failed", error: "interrupted", name: "Mid-flight" });
  });

  it("an unavailable account, a full account and a too-large record all stay pending with their reason", async () => {
    const a = device(USER_A);
    await a.store.load();
    H.faults = ["saved_views_read"];
    await a.store.create({ name: "Store down", def: DEF });
    expect(a.store.getSnapshot().pending.at(-1)).toMatchObject({ state: "failed", error: "unavailable" });
    H.faults = [];
    for (let n = 0; n < 10; n++) {
      rows().push({ id: `r${n}`, scope: "user", user_id: USER_A, owner_id: USER_A, key: screenKey(String(n).padStart(32, "0")), value: { schema: 9 }, updated_at: "2026-10-01T00:00:00.000Z" });
    }
    await a.store.create({ name: "Over the cap", def: DEF });
    expect(a.store.getSnapshot().pending.at(-1)).toMatchObject({ state: "failed", error: "limit_reached" });
    expect(a.store.getSnapshot().pending).toHaveLength(2);
  });

  it("caps the unacknowledged queue and allows one request at a time", async () => {
    const a = device(USER_A);
    await a.store.load();
    a.net.down = true;
    for (let n = 0; n < MAX_PENDING; n++) await a.store.create({ name: `Q${n}`, def: DEF });
    expect(await a.store.create({ name: "one more", def: DEF })).toEqual({ ok: false, reason: "too_many_pending" });
    a.store.discard(a.store.getSnapshot().pending[0].opId);
    const first = a.store.create({ name: "in flight", def: DEF });
    expect(await a.store.create({ name: "concurrent", def: DEF })).toEqual({ ok: false, reason: "busy" });
    await first;
  });

  it("a browser that refuses storage keeps the pending work for the session and says so", async () => {
    const a = device(USER_A);
    await a.store.load();
    a.storage.failWrites = true;
    a.net.down = true;
    await a.store.create({ name: "Not persisted", def: DEF });
    expect(a.store.getSnapshot().device).toBe("failed");
    expect(a.store.getSnapshot().pending[0]).toMatchObject({ name: "Not persisted", state: "failed" });
  });

  it("refuses an invalid screen before any request", async () => {
    const a = device(USER_A);
    await a.store.load();
    const calls = a.net.calls;
    expect(await a.store.create({ name: "x", def: { ...DEF, where: { all: [{ f: "pe", op: "gte", v: 1 }] } } })).toEqual({ ok: false, reason: "invalid" });
    expect(await a.store.create({ name: "  ", def: DEF })).toEqual({ ok: false, reason: "invalid" });
    expect(a.net.calls).toBe(calls);
  });
});

// ── AC-E04-03: two devices, one account ────────────────────────────────────────────────────

describe("two devices on one account", () => {
  it("round-trips a screen to a second device", async () => {
    const laptop = device(USER_A);
    const phone = device(USER_A);
    await laptop.store.load();
    await laptop.store.create({ name: "Momentum", def: DEF });
    await phone.store.load();
    const [onPhone] = phone.store.getSnapshot().ack!.screens;
    const [onLaptop] = laptop.store.getSnapshot().ack!.screens;
    expect(onPhone).toEqual(onLaptop);
    expect(onPhone.hash).toBe((normalizeDefinition(DEF) as { hash: string }).hash);
  });

  it("turns a stale edit into a conflict the user resolves — overwrite", async () => {
    const laptop = device(USER_A);
    const phone = device(USER_A);
    await laptop.store.load();
    await laptop.store.create({ name: "Momentum", def: DEF });
    await phone.store.load();
    const id = laptop.store.getSnapshot().ack!.screens[0].id;

    expect(await laptop.store.update(id, { name: "Laptop edit" })).toEqual({ ok: true });
    expect(await phone.store.update(id, { name: "Phone edit", def: DEF_2 })).toEqual({ ok: false, reason: "conflict" });
    const [conflict] = phone.store.getSnapshot().pending;
    expect(conflict).toMatchObject({ state: "conflict", name: "Phone edit", current: { rev: 2, name: "Laptop edit" } });
    // The phone's change did not land, and the phone still lists what the account acknowledged.
    expect(rows()[0].value).toMatchObject({ rev: 2, name: "Laptop edit" });
    // A second change to the same screen waits for this one to be resolved.
    expect(await phone.store.update(id, { name: "again" })).toEqual({ ok: false, reason: "pending_exists" });

    expect(await phone.store.overwrite(conflict.opId)).toEqual({ ok: true });
    expect(phone.store.getSnapshot().ack!.screens[0]).toMatchObject({ rev: 3, name: "Phone edit" });
    await laptop.store.refresh();
    expect(laptop.store.getSnapshot().ack!.screens[0]).toMatchObject({ rev: 3, name: "Phone edit" });
  });

  it("turns a stale edit into a conflict the user resolves — keep the account's version", async () => {
    const laptop = device(USER_A);
    const phone = device(USER_A);
    await laptop.store.load();
    await laptop.store.create({ name: "Momentum", def: DEF });
    await phone.store.load();
    const id = laptop.store.getSnapshot().ack!.screens[0].id;
    await laptop.store.update(id, { name: "Laptop edit" });
    await phone.store.update(id, { name: "Phone edit" });
    const [conflict] = phone.store.getSnapshot().pending;
    expect(phone.store.useAccountVersion(conflict.opId)).toEqual({ ok: true });
    expect(phone.store.getSnapshot().pending).toEqual([]);
    expect(phone.store.getSnapshot().ack!.screens[0]).toMatchObject({ rev: 2, name: "Laptop edit" });
  });

  it("an edit to a screen deleted on the other device can be kept as a new screen", async () => {
    const laptop = device(USER_A);
    const phone = device(USER_A);
    await laptop.store.load();
    await laptop.store.create({ name: "Momentum", def: DEF });
    await phone.store.load();
    const id = laptop.store.getSnapshot().ack!.screens[0].id;
    expect(await laptop.store.remove(id)).toEqual({ ok: true });
    expect(await phone.store.update(id, { name: "Kept" })).toEqual({ ok: false, reason: "gone" });
    const [gone] = phone.store.getSnapshot().pending;
    expect(await phone.store.saveAsNew(gone.opId)).toEqual({ ok: true });
    const saved = phone.store.getSnapshot().ack!.screens.filter((screen) => screen.name === "Kept");
    expect(saved).toHaveLength(1);
    expect(saved[0].id).not.toBe(id);
    expect(rows()).toHaveLength(1);
  });

  it("a stale delete learns the newer-format account revision without offering an unusable conflict action", async () => {
    const older = device(USER_A);
    await older.store.load();
    await older.store.create({ name: "Momentum", def: DEF });
    const original = older.store.getSnapshot().ack!.screens[0];
    const upgraded = { ...(rows()[0].value as Record<string, unknown>), schema: 2, rev: 2, extra: { future: true } };
    rows()[0].value = upgraded;
    rows()[0].updated_at = "2026-10-11T10:00:00.000Z";
    expect(await older.store.remove(original.id)).toEqual({ ok: false, reason: "failed" });
    const pending = older.store.getSnapshot().pending[0];
    expect(pending).toMatchObject({ action: "delete", expectedRev: 1, error: "newer_schema", state: "failed" });
    expect(older.store.getSnapshot().ack!.screens).toEqual([]);
    expect(older.store.getSnapshot().ack!.readOnly).toEqual([{ id: original.id, rev: 2, name: "Momentum", schema: 2 }]);
    expect(older.store.useAccountVersion(pending.opId)).toEqual({ ok: false, reason: "not_found" });
    expect(rows()[0].value).toEqual(upgraded);
    older.store.discard(pending.opId);
    expect(await older.store.remove(original.id)).toEqual({ ok: true }); // New explicit delete names v2.
    expect(rows()).toHaveLength(0);
  });

  it("an older Terminal never rewrites a screen a newer one saved; it shows it read-only", async () => {
    const older = device(USER_A);
    await older.store.load();
    await older.store.create({ name: "Momentum", def: DEF });
    const id = older.store.getSnapshot().ack!.screens[0].id;
    // A newer Terminal upgrades the record in the account.
    const upgraded = { ...(rows()[0].value as Record<string, unknown>), schema: 2, rev: 2, extra: { future: true } };
    rows()[0].value = upgraded;
    rows()[0].updated_at = "2026-10-11T10:00:00.000Z";
    expect(await older.store.update(id, { name: "Downgrade" })).toEqual({ ok: false, reason: "failed" });
    expect(older.store.getSnapshot().pending[0]).toMatchObject({ error: "newer_schema" });
    expect(older.store.getSnapshot().ack!.screens).toEqual([]);
    expect(older.store.getSnapshot().ack!.readOnly).toEqual([{ id, rev: 2, name: "Momentum", schema: 2 }]);
    expect(rows()[0].value).toEqual(upgraded);
  });
});

// ── AC-E04-03: account isolation on a shared device ────────────────────────────────────────

describe("account isolation on one browser", () => {
  it("a second account on the same browser sees none of the first account's screens or pending work", async () => {
    const storage = new MemoryStorage();
    const a = device(USER_A, storage);
    await a.store.load();
    await a.store.create({ name: "A's screen", def: DEF });
    a.net.down = true;
    await a.store.create({ name: "A's unsaved", def: DEF });
    const aSlot = JSON.stringify(JSON.parse(storage.getItem(SMART_SCREENS_LOCAL_KEY)!)[a.owner]);

    const b = device(USER_B, storage);
    expect(b.store.getSnapshot()).toMatchObject({ ack: null, pending: [] });
    await b.store.load();
    expect(b.store.getSnapshot().ack!.screens).toEqual([]);
    await b.store.create({ name: "B's screen", def: DEF_2 });
    expect(b.store.getSnapshot().ack!.screens.map((screen) => screen.name)).toEqual(["B's screen"]);
    // B's writes left A's device slot byte-identical.
    expect(JSON.stringify(JSON.parse(storage.getItem(SMART_SCREENS_LOCAL_KEY)!)[a.owner])).toBe(aSlot);
    // And A, back on this browser, still has exactly its own state.
    const aAgain = a.remount();
    expect(aAgain.getSnapshot().ack!.screens.map((screen) => screen.name)).toEqual(["A's screen"]);
    expect(aAgain.getSnapshot().pending.map((op) => op.name)).toEqual(["A's unsaved"]);
  });
});

// ── device copies this version must not touch ──────────────────────────────────────────────

describe("device state owned by someone else", () => {
  it("leaves a newer Terminal's device copy untouched and works from the account", async () => {
    const storage = new MemoryStorage();
    const owner = ownerKeyFor(USER_A);
    const newer = JSON.stringify({ [owner]: { v: 2, somethingNew: [1, 2, 3] } });
    storage.setItem(SMART_SCREENS_LOCAL_KEY, newer);
    const a = device(USER_A, storage);
    expect(a.store.getSnapshot().device).toBe("blocked");
    await a.store.load();
    expect(await a.store.create({ name: "Works", def: DEF })).toEqual({ ok: true });
    expect(a.store.getSnapshot().ack!.screens).toHaveLength(1);
    expect(storage.getItem(SMART_SCREENS_LOCAL_KEY)).toBe(newer);
  });

  it("ignores a corrupt device copy and a tampered pending write instead of sending it", async () => {
    const storage = new MemoryStorage();
    const owner = ownerKeyFor(USER_A);
    storage.setItem(SMART_SCREENS_LOCAL_KEY, JSON.stringify({ [owner]: { v: 1, ack: { readAt: "nope" }, pending: [
      { opId: "x1", action: "create", id: "f".repeat(32), expectedRev: null, name: "Tampered", def: { grammar: 1, where: { all: [{ f: "__proto__", op: "gte", v: 1 }] } }, state: "failed", at: "2026-10-11T00:00:00.000Z" },
    ] } }));
    const a = device(USER_A, storage);
    expect(a.store.getSnapshot()).toMatchObject({ ack: null, pending: [] });
    storage.setItem(SMART_SCREENS_LOCAL_KEY, "{not json");
    expect(device(USER_A, storage).store.getSnapshot()).toMatchObject({ ack: null, pending: [], device: "ok" });
  });

  it("reads the screener's device presets without ever writing them, and adopts one only as a copy", async () => {
    const storage = new MemoryStorage();
    const presets = JSON.stringify({ v: 1, items: [
      { id: "p1", name: "Big US movers", f: { market: "us", move: "up3", liq: 5e6 } },
      { id: "p2", name: "Coerced", f: { market: "mars" } },
      { id: "p3", name: "", f: {} },
    ] });
    storage.setItem(DEVICE_PRESETS_KEY, presets);
    const found = readDevicePresets(storage);
    expect(found.map((preset) => preset.name)).toEqual(["Big US movers"]);
    expect(found[0].filters).toMatchObject({ market: "us", move: "up3", liq: 5e6, asset: "all" });

    const a = device(USER_A, storage);
    await a.store.load();
    const compiled = compileFilters(found[0].filters, { prefsEnabled: null, showAllMarkets: false });
    if (!compiled.ok) throw new Error(compiled.error);
    expect(await a.store.create({ name: found[0].name, def: compiled.def })).toEqual({ ok: true });
    expect(a.store.getSnapshot().ack!.screens[0]).toMatchObject({ name: "Big US movers", def: { scope: { markets: ["us"] } } });
    expect(storage.getItem(DEVICE_PRESETS_KEY)).toBe(presets);
    expect(readDevicePresets(new MemoryStorage())).toEqual([]);
    storage.setItem(DEVICE_PRESETS_KEY, JSON.stringify({ v: 2, items: [{ id: "p", name: "n", f: {} }] }));
    expect(readDevicePresets(storage)).toEqual([]);
  });
});
