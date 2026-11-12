/**
 * The two snapshot fields the Sync card's claim stands on (F12, macro#6819 C2):
 *
 *   base  pending | loaded | retrying — whether this owner's merge base is actually known
 *   held  an edit is waiting OUTSIDE the delivery pump for that base
 *
 * Both are derived in `publish()` from state the store already kept privately (`baseLoaded`,
 * `pendingTerminal`, `pendingMetaPrefs`), plus one flag for a failed read. The cases that matter
 * are the ones where the OLD store would have published nothing at all: a terminal-blob hold is
 * set AFTER its caller's publish, and a legacy-prefs hold after persistMetaPrefs's own — so
 * without the two added publishes a subscriber never learned an edit was being held.
 *
 * Same harness as marketPrefsOwner.test.ts: only the two impure edges are mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type GetUserResult = { data: { user: unknown }; error: unknown };
let getUser: () => Promise<GetUserResult> = async () => ({ data: { user: null }, error: new Error("unset") });
const updates: Record<string, unknown>[] = [];
let updateResult: () => Promise<{ error?: unknown }> = async () => ({ error: null });

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => getUser(),
      updateUser: ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return updateResult();
      },
    },
  }),
}));
vi.mock("@/lib/i18n", () => ({ applyLang: vi.fn() }));

import { GUEST_OWNER, ownerKeyFor } from "@/lib/accountIdentity";
import {
  __loadOwner, __marketPrefsSnapshot, __resetMarketPrefsStore, __subscribeMarketPrefs,
  persistMetaPrefs, persistStartTf, type AccountPrefsSnapshot,
} from "@/lib/useMarketPrefs";

const UUID_A = "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22";
const UUID_B = "0b6d1f57-3c84-4a11-8e29-6d40cc1b7f93";
const OWNER_A = ownerKeyFor(UUID_A);
const OWNER_B = ownerKeyFor(UUID_B);
const TF = "D";

let store: Map<string, string>;

const userWith = (id: string, meta: Record<string, unknown>): GetUserResult => ({
  data: { user: { id, user_metadata: meta } }, error: null,
});

function deferredRead() {
  let resolve!: (v: GetUserResult) => void;
  let reject!: (e: unknown) => void;
  getUser = () => new Promise<GetUserResult>((res, rej) => { resolve = res; reject = rej; });
  return { resolve: (v: GetUserResult) => resolve(v), reject: (e: unknown) => reject(e) };
}

beforeEach(() => {
  store = new Map();
  updates.length = 0;
  updateResult = async () => ({ error: null });
  getUser = async () => ({ data: { user: null }, error: new Error("unset") });
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  const attrs: Record<string, string> = {};
  g.document = {
    documentElement: {
      getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
      setAttribute: (k: string, v: string) => { attrs[k] = v; },
    },
  };
  g.window = { dispatchEvent: () => true };
  g.CustomEvent = class { type: string; constructor(t: string) { this.type = t; } };
  __resetMarketPrefsStore();
});

afterEach(() => {
  __resetMarketPrefsStore();
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.localStorage; delete g.document; delete g.window; delete g.CustomEvent;
});

const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const snap = () => __marketPrefsSnapshot();
const truth = (s: AccountPrefsSnapshot) => ({ owner: s.owner, base: s.base, held: s.held, ready: s.ready });

// ──────────────────────────────────────────────────────────────────────────────

describe("base — whether the merge base is known", () => {
  it("starts pending; a guest's base is the local slot, so loading a guest is loaded at once", () => {
    expect(truth(snap())).toEqual({ owner: GUEST_OWNER, base: "pending", held: false, ready: false });
    __loadOwner(GUEST_OWNER);
    expect(truth(snap())).toEqual({ owner: GUEST_OWNER, base: "loaded", held: false, ready: true });
  });

  it("an account is pending while its read is in flight and loaded once it answers", async () => {
    const read = deferredRead();
    __loadOwner(OWNER_A);
    expect(truth(snap())).toEqual({ owner: OWNER_A, base: "pending", held: false, ready: false });
    read.resolve(userWith(UUID_A, {}));
    await settle();
    expect(truth(snap())).toEqual({ owner: OWNER_A, base: "loaded", held: false, ready: true });
  });

  it("a failed read is retrying (ready, but the base is NOT known); the next successful read clears it", async () => {
    const read = deferredRead();
    __loadOwner(OWNER_A);
    read.reject(new Error("network"));
    await settle();
    expect(truth(snap())).toEqual({ owner: OWNER_A, base: "retrying", held: false, ready: true });

    // The store's own backoff timer would re-read later; drive a successful read by hand.
    getUser = async () => userWith(UUID_A, {});
    __resetMarketPrefsStore();
    __loadOwner(OWNER_A);
    await settle();
    expect(snap().base).toBe("loaded");
  });

  it("an owner switch starts the incoming owner at pending, never inheriting 'retrying'", async () => {
    const readA = deferredRead();
    __loadOwner(OWNER_A);
    readA.reject(new Error("network"));
    await settle();
    expect(snap().base).toBe("retrying");

    deferredRead();
    __loadOwner(OWNER_B);
    expect(truth(snap())).toEqual({ owner: OWNER_B, base: "pending", held: false, ready: false });
  });
});

describe("held — an edit waiting outside the pump, PUBLISHED when it starts waiting", () => {
  it("a terminal-blob edit before the read answers publishes held=true, and flushes to held=false", async () => {
    const seen: boolean[] = [];
    const unsub = __subscribeMarketPrefs((s) => { seen.push(s.held); });
    const read = deferredRead();
    __loadOwner(OWNER_A);

    persistStartTf(TF);
    expect(snap().held).toBe(true);            // guards against a silently-dropped timeframe too
    expect(seen).toContain(true);              // a SUBSCRIBER saw the hold (the added publish)
    expect(updates).toHaveLength(0);           // nothing was sent — it is held

    read.resolve(userWith(UUID_A, {}));
    await settle();
    expect(snap().held).toBe(false);
    expect(updates.some((u) => "terminal" in u)).toBe(true);
    unsub();
  });

  it("a legacy-prefs edit before the read answers publishes held=true (persistMetaPrefs's own publish ran earlier)", async () => {
    const seen: boolean[] = [];
    const unsub = __subscribeMarketPrefs((s) => { seen.push(s.held); });
    const read = deferredRead();
    __loadOwner(OWNER_A);

    persistMetaPrefs({ theme: "dark" });
    expect(snap().held).toBe(true);
    expect(seen).toContain(true);

    read.resolve(userWith(UUID_A, {}));
    await settle();
    expect(snap().held).toBe(false);
    unsub();
  });

  it("a hold survives a failed read (intent is not discarded) and is still reported", async () => {
    const read = deferredRead();
    __loadOwner(OWNER_A);
    persistStartTf(TF);
    read.reject(new Error("network"));
    await settle();
    expect(truth(snap())).toEqual({ owner: OWNER_A, base: "retrying", held: true, ready: true });
    expect(updates).toHaveLength(0);
  });

  it("an owner switch drops the outgoing owner's hold from the published truth", async () => {
    deferredRead();
    __loadOwner(OWNER_A);
    persistStartTf(TF);
    expect(snap().held).toBe(true);

    deferredRead();
    __loadOwner(OWNER_B);
    expect(truth(snap())).toEqual({ owner: OWNER_B, base: "pending", held: false, ready: false });
  });
});
