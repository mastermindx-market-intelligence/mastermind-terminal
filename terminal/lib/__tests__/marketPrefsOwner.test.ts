/**
 * The preference store's OWNER BOUNDARY (E1).
 *
 * The store is module-level, so it outlives the sign-in it was loaded for. Every case here
 * corresponds to a way the previous version let one owner's account state survive into another
 * owner's session, or let a write land somewhere it did not belong:
 *
 *   1. `loadedFor` was the EMAIL, so an address change forked the owner and a reassigned address
 *      inherited one.
 *   2. `load()` set `ready = false` but did NOT publish, so every subscriber kept rendering the
 *      OUTGOING owner's last `ready: true` snapshot for the whole duration of the incoming
 *      account's request.
 *   3. `mm.marketPrefs` was a single UNSCOPED slot that a signed-in account wrote to and any
 *      later owner read back.
 *   4. Supabase resolves an auth failure as `{ data: { user: null }, error }` rather than
 *      rejecting, so a failed read was indistinguishable from "this account has no metadata" —
 *      and the next preference edit pushed a nested blob over an EMPTY merge base, deleting the
 *      account's sibling keys.
 *
 * Reverting any one of those makes exactly one case below go red.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── module mocks ─────────────────────────────────────────────────────────────────────────
// Only the two impure edges. Everything else (markets sanitizer, accountPrefs guards, the
// envelope primitives) runs for real, because those are what the assertions are about.

type GetUserResult = { data: { user: unknown }; error: unknown };
let getUser: () => Promise<GetUserResult> = async () => ({ data: { user: null }, error: new Error("unset") });
const updates: Record<string, unknown>[] = [];
/** Swappable so a case can make the authority resolve `{ error }` or reject. */
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

import { ownerKeyFor, GUEST_OWNER, accountIdentity } from "@/lib/accountIdentity";
import type { MetaPrefs } from "@/lib/accountPrefs";
import {
  __loadOwner, __marketPrefsInternals, __marketPrefsSnapshot, __resetMarketPrefsStore,
  __subscribeMarketPrefs, currentOwnerToken, ownerTokenIsCurrent, persistStartTf, persistUpDown,
  persistMetaPrefs, persistTradeTypes, retryPrefSync,
} from "@/lib/useMarketPrefs";

const UUID_A = "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22";
const UUID_B = "0b6d1f57-3c84-4a11-8e29-6d40cc1b7f93";
const OWNER_A = ownerKeyFor(UUID_A);
const OWNER_B = ownerKeyFor(UUID_B);

const LS_KEY = "mm.marketPrefs.v2";
const LS_KEY_LEGACY = "mm.marketPrefs";

let store: Map<string, string>;

/** A user_metadata payload, as Supabase would hand it back. */
const userWith = (id: string, meta: Record<string, unknown>) => ({
  data: { user: { id, user_metadata: meta } }, error: null,
});

/** Read one owner's slot straight out of the stubbed storage. */
function slot(owner: string): Record<string, unknown> | undefined {
  const raw = store.get(LS_KEY);
  if (!raw) return undefined;
  return (JSON.parse(raw) as Record<string, Record<string, unknown>>)[owner];
}

beforeEach(async () => {
  store = new Map();
  updates.length = 0;
  updateResult = async () => ({ error: null });
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
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.localStorage; delete g.document; delete g.window; delete g.CustomEvent;
});

/** Let the mocked auth promise and its `.then` chain settle. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

// ─────────────────────────────────────────────────────────────────────────────────────────

describe("the owner key is the uuid, never the email", () => {
  it("does NOT reload when the same account changes its email address", async () => {
    let reads = 0;
    getUser = async () => { reads += 1; return userWith(UUID_A, { markets: { enabled: ["us"] } }); };

    const before = accountIdentity(UUID_A, "old@example.com");
    const after = accountIdentity(UUID_A, "new@example.com");
    __loadOwner(ownerKeyFor(UUID_A));
    await settle();
    expect(reads).toBe(1);

    // Same owner key from both identities → the hook's effect never re-fires.
    __loadOwner(ownerKeyFor(before.kind === "account" ? before.userId : ""));
    __loadOwner(ownerKeyFor(after.kind === "account" ? after.userId : ""));
    await settle();
    expect(reads).toBe(1);
    expect(__marketPrefsInternals().owner).toBe(OWNER_A);
  });

  it("DOES reload when a different account arrives at the same address", async () => {
    const seen: string[] = [];
    getUser = async () => { seen.push("read"); return userWith(UUID_A, {}); };
    __loadOwner(OWNER_A);
    await settle();

    getUser = async () => { seen.push("read"); return userWith(UUID_B, {}); };
    __loadOwner(OWNER_B);
    await settle();

    expect(seen).toHaveLength(2);
    expect(__marketPrefsInternals().owner).toBe(OWNER_B);
  });
});

describe("the transition publishes the incoming owner's not-ready snapshot IMMEDIATELY", () => {
  it("erases the outgoing owner's markets synchronously, before the incoming request resolves", async () => {
    getUser = async () => userWith(UUID_A, { markets: { home: "cn", enabled: ["cn", "hk"] } });
    __loadOwner(OWNER_A);
    await settle();
    // A narrowed universe is a visible, load-bearing preference: A sees only CN + HK.
    expect(__marketPrefsInternals().owner).toBe(OWNER_A);

    // B's account request never resolves during this test — it is the in-flight window itself.
    let releaseB: (v: GetUserResult) => void = () => {};
    getUser = () => new Promise<GetUserResult>((res) => { releaseB = res; });

    const published: { owner: string; ready: boolean }[] = [];
    const stop = __subscribeMarketPrefs((s) => published.push({ owner: s.owner, ready: s.ready }));

    __loadOwner(OWNER_B);          // synchronous — nothing awaited

    // The very first thing B's session sees is B's own loading snapshot, not A's last one.
    expect(published[0]).toEqual({ owner: OWNER_B, ready: false });
    const mid = __marketPrefsInternals();
    expect(mid.owner).toBe(OWNER_B);
    expect(mid.ready).toBe(false);
    // …and none of A's account state is still readable or writable under B.
    expect(mid.rawTerminal).toEqual({});
    expect(__marketPrefsSnapshot().metaPrefs).toEqual({});

    releaseB(userWith(UUID_B, {}));
    await settle();
    stop();
  });

  it("ignores a late answer tagged with the outgoing generation", async () => {
    let releaseA: (v: GetUserResult) => void = () => {};
    getUser = () => new Promise<GetUserResult>((res) => { releaseA = res; });
    __loadOwner(OWNER_A);

    getUser = async () => userWith(UUID_B, { terminal: { updown: "east" } });
    __loadOwner(OWNER_B);
    await settle();

    // A's request finally answers — long after A stopped being the owner.
    releaseA(userWith(UUID_A, { terminal: { start_tf: "W", updown: "west" }, markets: { enabled: ["cn"] } }));
    await settle();

    const now = __marketPrefsInternals();
    expect(now.owner).toBe(OWNER_B);
    expect(now.rawTerminal).toEqual({ updown: "east" });   // B's, not A's
  });
});

describe("local persistence is owner-scoped, and the legacy slot belongs to GUEST", () => {
  it("writes an account's cached prefs under its OWN slot, never the unscoped legacy key", async () => {
    getUser = async () => userWith(UUID_A, { markets: { home: "cn", enabled: ["cn", "crypto"] } });
    __loadOwner(OWNER_A);
    await settle();

    expect(slot(OWNER_A)).toBeTruthy();
    expect(store.has(LS_KEY_LEGACY)).toBe(false);
    expect(slot(GUEST_OWNER)).toBeUndefined();
  });

  it("adopts a pre-boundary unscoped payload into GUEST once, then removes it", async () => {
    store.set(LS_KEY_LEGACY, JSON.stringify({ home: "cn", enabled: ["cn"], followed: ["cn"] }));

    getUser = async () => userWith(UUID_A, {});
    __loadOwner(OWNER_A);
    await settle();

    // The account that happened to sign in first does NOT inherit it…
    expect(slot(GUEST_OWNER)).toMatchObject({ home: "cn" });
    expect(store.has(LS_KEY_LEGACY)).toBe(false);
    // …and the account's own slot holds what its account said, not the orphaned payload.
    expect(__marketPrefsInternals().owner).toBe(OWNER_A);
  });

  it("falls back to the SAME owner's cache when its own read fails — never another owner's", async () => {
    // A is cached from a healthy load.
    getUser = async () => userWith(UUID_A, { markets: { home: "cn", enabled: ["cn", "crypto"] } });
    __loadOwner(OWNER_A);
    await settle();
    expect(slot(OWNER_A)).toBeTruthy();

    // B signs in and its read fails. B must not adopt A's narrowed universe.
    getUser = async () => { throw new Error("offline"); };
    __loadOwner(OWNER_B);
    await settle();

    expect(slot(OWNER_B)).toBeUndefined();
    expect(__marketPrefsSnapshot().prefs.enabled).toEqual(
      expect.arrayContaining(["us", "cn", "hk", "ca", "intl", "crypto"]),
    );
  });
});

describe("a read that did not land is not an empty account", () => {
  it("treats Supabase's `{ user: null, error }` as a FAILURE, so no write gets an empty merge base", async () => {
    getUser = async () => ({ data: { user: null }, error: { message: "invalid token" } });
    __loadOwner(OWNER_A);
    await settle();

    const after = __marketPrefsInternals();
    expect(after.ready).toBe(true);        // the UI stops waiting…
    expect(after.baseLoaded).toBe(false);  // …but a nested-blob push is still unsafe

    persistStartTf("W");
    expect(updates).toEqual([]);                                   // nothing pushed
    expect(__marketPrefsInternals().pendingTerminal).toEqual({ start_tf: "W" });
  });

  it("HOLDS the user's intent across a failed hydrate instead of discarding it", async () => {
    getUser = async () => { throw new Error("offline"); };
    __loadOwner(OWNER_A);
    await settle();

    persistUpDown("east");
    const held = __marketPrefsInternals();
    expect(held.pendingTerminal).toEqual({ updown: "east" });
    expect(updates).toEqual([]);
  });

  it("delivers a SHARED preference's atomic half immediately even with no merge base", async () => {
    getUser = async () => { throw new Error("offline"); };
    __loadOwner(OWNER_A);
    await settle();

    // The nested `terminal` blob is held (above), and so is the legacy `prefs` half of this
    // dual write (below) — both need a merge base. `lang`'s ATOMIC half is a top-level key that
    // `updateUser` MERGES, so there is nothing it could clobber and nothing to wait for.
    persistMetaPrefs({ lang: "zh" });
    await settle();
    expect(updates).toEqual([{ lang: "zh" }]);
    expect(__marketPrefsInternals().pendingMetaPrefs).toEqual({ lang: "zh" });
  });

  it("refuses an answer for a DIFFERENT account than the shell resolved", async () => {
    getUser = async () => userWith(UUID_B, { terminal: { start_tf: "W" } });
    __loadOwner(OWNER_A);
    await settle();

    const after = __marketPrefsInternals();
    expect(after.owner).toBe(OWNER_A);
    expect(after.baseLoaded).toBe(false);   // B's blob was NOT adopted as A's merge base
    expect(after.rawTerminal).toEqual({});
  });
});

describe("writes carry the whole nested blob, and stop at the owner boundary", () => {
  it("pushes every sibling key so `updateUser` cannot delete one", async () => {
    getUser = async () => userWith(UUID_A, { terminal: { start_tf: "W", updown: "east" } });
    __loadOwner(OWNER_A);
    await settle();

    persistStartTf("D");
    expect(updates).toEqual([{ terminal: { start_tf: "D", updown: "east" } }]);
  });

  it("never pushes for a guest", async () => {
    __loadOwner(GUEST_OWNER);
    await settle();
    persistStartTf("W");
    persistMetaPrefs({ theme: "light" });
    expect(updates).toEqual([]);
  });

  it("drops a write decided for the OUTGOING owner once the owner has changed", async () => {
    getUser = async () => userWith(UUID_A, { terminal: { start_tf: "W" } });
    __loadOwner(OWNER_A);
    await settle();
    updates.length = 0;

    // A's held edit is flushed only if the generation still matches. Switch owner first.
    getUser = async () => userWith(UUID_B, {});
    __loadOwner(OWNER_B);
    await settle();

    expect(updates.some((u) => JSON.stringify(u).includes('"start_tf":"W"'))).toBe(false);
  });
});

// ── E2: the serialized delivery lane, seen from the store ────────────────────────────────

describe("delivery is serialized, acknowledged, and retryable", () => {
  it("reports `saved` only after the AUTHORITY acknowledges, not when the request is fired", async () => {
    getUser = async () => userWith(UUID_A, { terminal: { start_tf: "W" } });
    __loadOwner(OWNER_A);
    await settle();

    let release: (v: { error?: unknown }) => void = () => {};
    updateResult = () => new Promise((res) => { release = res; });

    persistUpDown("east");
    expect(__marketPrefsSnapshot().sync.phase).toBe("syncing");   // fired, NOT saved

    release({ error: null });
    await settle();
    expect(__marketPrefsSnapshot().sync.phase).toBe("saved");
  });

  it("reports a RESOLVED `{ error }` as a failure — the pane used to call this Saved", async () => {
    getUser = async () => userWith(UUID_A, {});
    __loadOwner(OWNER_A);
    await settle();

    updateResult = async () => ({ error: { message: "row level security" } });
    persistUpDown("east");
    await settle();

    expect(__marketPrefsSnapshot().sync.phase).toBe("failed");
    expect(__marketPrefsInternals().undelivered).toBe(true);
  });

  it("runs ONE write at a time and coalesces the rest into the newest complete blob", async () => {
    getUser = async () => userWith(UUID_A, { terminal: { start_tf: "W", updown: "west" } });
    __loadOwner(OWNER_A);
    await settle();
    updates.length = 0;

    let release: (v: { error?: unknown }) => void = () => {};
    updateResult = () => new Promise((res) => { release = res; });

    persistStartTf("D");            // v1 — goes out
    persistUpDown("east");          // v2 — coalesced behind it
    persistMetaPrefs({ lang: "zh" });
    expect(updates).toHaveLength(1);

    updateResult = async () => ({ error: null });
    release({ error: null });
    await settle();

    // One follow-up carrying the CURRENT value of everything edited — never an older, smaller
    // blob. The shared language is a top-level ATOMIC (E6) AND is dual-written into the legacy
    // `prefs` nested blob (harmless — macro's own reader/writer has already migrated to the
    // atomics; see accountPrefs.ts's FLIP CONDITION note).
    expect(updates).toHaveLength(2);
    expect(updates[1]).toEqual({
      terminal: { start_tf: "D", updown: "east" },
      lang: "zh",
      prefs: { lang: "zh" },
    });
    expect(__marketPrefsSnapshot().sync.phase).toBe("saved");
  });

  it("evicts an acknowledged shared atomic AND the legacy prefs blob — a LATER unrelated edit re-sends neither (M3)", async () => {
    getUser = async () => userWith(UUID_A, { terminal: { start_tf: "W", updown: "west" } });
    __loadOwner(OWNER_A);
    await settle();
    updates.length = 0;

    updateResult = async () => ({ error: null });
    persistMetaPrefs({ lang: "zh" });
    await settle();
    expect(updates).toEqual([{ lang: "zh", prefs: { lang: "zh" } }]);

    persistUpDown("east");
    await settle();

    // Round-2 review MAJOR (M3, now fixed): the shared ATOMIC and the legacy `prefs` blob were
    // BOTH already acknowledged, so an edit that touches neither must not re-send either one.
    // `prefs` is queued one-shot in `persistMetaPrefs` precisely so it does not ride along on
    // every later unrelated write forever — the failure mode this test used to pin as correct.
    expect(updates).toHaveLength(2);
    expect(updates[1]).toEqual({ terminal: { start_tf: "W", updown: "east" } });
  });

  it("evicts the legacy prefs blob delivered through the PENDING-hydrate path too — a LATER unrelated edit re-sends nothing (round-3 review MAJOR 1)", async () => {
    vi.useFakeTimers();
    try {
      getUser = async () => { throw new Error("offline"); };
      __loadOwner(OWNER_A);
      await vi.advanceTimersByTimeAsync(0);   // the initial read fails; a retry is scheduled

      // Edited BEFORE the account read ever answered — held in `pendingMetaPrefs`, a different
      // code path than the M3 test above, which only covers an edit made AFTER hydrate already
      // answered once. The atomic half needs no merge base and ships immediately.
      persistMetaPrefs({ theme: "dark", lang: "zh" });
      await vi.advanceTimersByTimeAsync(0);
      expect(updates).toEqual([{ theme: "dark", lang: "zh" }]);

      // The retried read now answers. `hydrate()` itself flushes the held legacy half
      // (`pendingMetaPrefs`) as `{ prefs: ... }` — THAT delivery must also be queued one-shot,
      // or `prefs` never leaves `desired` once acked and rides along on every later unrelated
      // write forever, exactly the bug M3 fixed for the already-acknowledged path.
      getUser = async () => userWith(UUID_A, { terminal: { start_tf: "W" } });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(updates).toEqual([
        { theme: "dark", lang: "zh" },
        { prefs: { theme: "dark", lang: "zh" } },
      ]);

      persistUpDown("east");
      await vi.advanceTimersByTimeAsync(0);

      expect(updates).toHaveLength(3);
      expect(updates[2]).toEqual({ terminal: { start_tf: "W", updown: "east" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers an intent held through a FAILED hydrate once a retried read answers", async () => {
    vi.useFakeTimers();
    try {
      getUser = async () => { throw new Error("offline"); };
      __loadOwner(OWNER_A);
      await vi.advanceTimersByTimeAsync(0);

      persistStartTf("W");                                  // held: no merge base yet
      expect(updates).toEqual([]);
      expect(__marketPrefsInternals().pendingTerminal).toEqual({ start_tf: "W" });

      // The account comes back. The retry fetches the merge base and the held intent goes out
      // MERGED with the account's own siblings — never as a partial blob.
      getUser = async () => userWith(UUID_A, { terminal: { updown: "east" } });
      await vi.advanceTimersByTimeAsync(5_000);

      expect(updates).toEqual([{ terminal: { updown: "east", start_tf: "W" } }]);
      expect(__marketPrefsInternals().pendingTerminal).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the hydrate retry when the owner changes", async () => {
    vi.useFakeTimers();
    try {
      getUser = async () => { throw new Error("offline"); };
      __loadOwner(OWNER_A);
      await vi.advanceTimersByTimeAsync(0);
      persistStartTf("W");

      getUser = async () => userWith(UUID_B, {});
      __loadOwner(OWNER_B);
      await vi.advanceTimersByTimeAsync(60_000);

      // A's held intent never reaches the authority under B.
      expect(updates.some((u) => JSON.stringify(u).includes("start_tf"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retrySync() re-attempts a failed delivery immediately", async () => {
    getUser = async () => userWith(UUID_A, {});
    __loadOwner(OWNER_A);
    await settle();

    updateResult = async () => ({ error: { message: "down" } });
    persistUpDown("east");
    await settle();
    expect(updates).toHaveLength(1);

    updateResult = async () => ({ error: null });
    retryPrefSync();
    await settle();
    expect(updates).toHaveLength(2);
    expect(__marketPrefsSnapshot().sync.phase).toBe("saved");
  });

  it("a guest reads `local` and never queues a delivery", async () => {
    __loadOwner(GUEST_OWNER);
    await settle();
    persistUpDown("east");
    persistTradeTypes(["stocks"]);
    expect(__marketPrefsSnapshot().sync.phase).toBe("local");
    expect(updates).toEqual([]);
  });
});

describe("a deferred mutation carries its owner (E5)", () => {
  it("recognises its own owner, and stops recognising it after a switch", async () => {
    getUser = async () => userWith(UUID_A, {});
    __loadOwner(OWNER_A);
    await settle();

    const token = currentOwnerToken();
    expect(ownerTokenIsCurrent(token)).toBe(true);

    getUser = async () => userWith(UUID_B, {});
    __loadOwner(OWNER_B);
    await settle();

    // The 500 ms trade-types timer captured this token when the user tapped the chip. Firing
    // now would have written A's answer into B's account.
    expect(ownerTokenIsCurrent(token)).toBe(false);
    expect(ownerTokenIsCurrent(currentOwnerToken())).toBe(true);
  });

  it("routes trade_types through the SAME lane, so it cannot race the other writes", async () => {
    getUser = async () => userWith(UUID_A, { terminal: { updown: "east" } });
    __loadOwner(OWNER_A);
    await settle();
    updates.length = 0;

    let release: (v: { error?: unknown }) => void = () => {};
    updateResult = () => new Promise((res) => { release = res; });

    persistTradeTypes(["stocks", "options"]);
    persistStartTf("W");
    expect(updates).toHaveLength(1);          // one authority, one write in flight

    updateResult = async () => ({ error: null });
    release({ error: null });
    await settle();
    expect(updates[1]).toEqual({
      trade_types: ["stocks", "options"],
      terminal: { updown: "east", start_tf: "W" },
    });
  });
});

describe("an in-flight hydrate cannot answer over a newer local edit", () => {
  it("keeps the market choice the user made while the account read was still out", async () => {
    let release: (v: GetUserResult) => void = () => {};
    getUser = () => new Promise<GetUserResult>((res) => { release = res; });
    __loadOwner(OWNER_A);

    // The user narrows their universe before the account answers.
    const { __persistMarketsForTest } = await import("@/lib/useMarketPrefs");
    __persistMarketsForTest({ home: "cn", enabled: ["cn", "crypto"], autoNarrowed: false, followed: ["cn"] });

    release(userWith(UUID_A, { markets: { home: "us", enabled: ["us", "ca", "hk", "intl", "crypto", "cn"] } }));
    await settle();

    expect(__marketPrefsSnapshot().prefs.enabled).toEqual(["cn", "crypto"]);
  });
});

// ── E6 dual-write: a shared preference edit lands in BOTH representations (M1) ───────────
//
// Macro's own preference writer (templates/theme.js) has ALREADY migrated to the v2 atomics —
// it writes only the top-level keys and never touches the legacy nested `prefs` blob any more
// (round-2 BLOCKER, resolved by flipping the read priority to atomic-first — see
// lib/accountPrefs.ts's FLIP CONDITION note). Terminal still WRITES both representations (the
// legacy write is harmless and keeps any remaining legacy-only reader fed, and it is queued
// one-shot so it never rides along on a later unrelated write — M3), but reads now prefer the
// atomic, matching macro's own priority exactly.

describe("a shared preference edit dual-writes into the legacy `prefs` blob too (E6 flip condition)", () => {
  it("merges the change into the account's OWN nested blob rather than replacing it", async () => {
    getUser = async () => userWith(UUID_A, { prefs: { theme: "dark", themeAuto: "1" } });
    __loadOwner(OWNER_A);
    await settle();
    updates.length = 0;

    persistMetaPrefs({ lang: "zh" });
    await settle();

    // theme / themeAuto are macro's own siblings on the nested blob — a write that forgot them
    // would delete them the moment `updateUser` replaced the object wholesale.
    expect(updates).toEqual([{ lang: "zh", prefs: { theme: "dark", themeAuto: "1", lang: "zh" } }]);
  });

  it("holds the legacy half until the merge base loads, then delivers it merged — never as a partial blob", async () => {
    vi.useFakeTimers();
    try {
      getUser = async () => { throw new Error("offline"); };
      __loadOwner(OWNER_A);
      await vi.advanceTimersByTimeAsync(0);

      persistMetaPrefs({ lang: "zh" });                      // atomic ships now; legacy half held
      expect(updates).toEqual([{ lang: "zh" }]);
      expect(__marketPrefsInternals().pendingMetaPrefs).toEqual({ lang: "zh" });

      // The account comes back holding a sibling field the held edit must not delete.
      getUser = async () => userWith(UUID_A, { prefs: { theme: "dark" } });
      await vi.advanceTimersByTimeAsync(5_000);

      expect(updates).toEqual([{ lang: "zh" }, { prefs: { theme: "dark", lang: "zh" } }]);
      expect(__marketPrefsInternals().pendingMetaPrefs).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads back ATOMIC-first once hydrated — mirrors macro's own atomic-first priority (round-2 BLOCKER, M1)", async () => {
    // The account has a fresher top-level atomic theme (macro's own writer is atomic-only now)
    // and a stale legacy nested sibling. metaPrefs must reflect the atomic, not the stale nested
    // blob — that is the whole round-2 fix: a legacy-first reader would show "light" forever.
    getUser = async () => userWith(UUID_A, { theme: "dark", prefs: { theme: "light", lang: "en" } });
    __loadOwner(OWNER_A);
    await settle();

    expect(__marketPrefsSnapshot().metaPrefs).toEqual({ theme: "dark", lang: "en" });
  });

  it("never dual-writes for a guest, same as the atomic half", async () => {
    __loadOwner(GUEST_OWNER);
    await settle();
    persistMetaPrefs({ lang: "zh" });
    expect(updates).toEqual([]);
  });
});

describe("persistMetaPrefs sanitizes what it PUBLISHES, not just what it sends (round-2 review minor)", () => {
  it("never publishes an invalid value even when the caller's patch is a junk cast", async () => {
    getUser = async () => userWith(UUID_A, { prefs: { theme: "dark" } });
    __loadOwner(OWNER_A);
    await settle();

    // `theme` is invalid, `lang` is valid — the previous code (`{ ...metaPrefs, ...patch }`,
    // no sanitizer) published BOTH, including the junk one, even though only `lang` made it
    // into either written representation. Published state must never claim a value that was
    // never actually persisted.
    persistMetaPrefs({ theme: "purple", lang: "zh" } as unknown as MetaPrefs);
    await settle();

    expect(__marketPrefsSnapshot().metaPrefs).toEqual({ theme: "dark", lang: "zh" });
    expect(updates).toEqual([{ lang: "zh", prefs: { theme: "dark", lang: "zh" } }]);
  });
});

describe("a failed hydrate resets BOTH merge bases, not just rawTerminal (round-2 review nit)", () => {
  it("clears rawMetaPrefs alongside rawTerminal, even after an in-flight edit populated it", async () => {
    getUser = async () => { throw new Error("offline"); };
    __loadOwner(OWNER_A);
    // An edit made WHILE the read is still out mutates rawMetaPrefs unconditionally (it merges
    // the patch in before checking baseLoaded), so this is the reachable non-empty case — not
    // merely the module's already-empty initial value.
    persistMetaPrefs({ lang: "zh" });
    expect(__marketPrefsInternals().rawMetaPrefs).toEqual({ lang: "zh" });

    await settle();   // the read now resolves — as a failure

    expect(__marketPrefsInternals().rawTerminal).toEqual({});
    expect(__marketPrefsInternals().rawMetaPrefs).toEqual({});
  });
});
