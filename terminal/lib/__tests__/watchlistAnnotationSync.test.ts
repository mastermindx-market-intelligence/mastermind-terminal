import { beforeEach, describe, expect, it } from "vitest";
import type { StoragePort } from "@/lib/ownerStorage";
import { supabaseAnnotationStore } from "@/lib/watchlistAnnotationsStore";
import { createFixtureAnnotationDb, resetFixtureAnnotationStores, FAULT_ANNOTATIONS_WRITE } from "@/lib/watchlistAnnotationsFixtureDb";
import type { AnnotationRecord, AnnotationWriteResult } from "@/lib/watchlistAnnotations";
import {
  applyToMap,
  applyWriteResults,
  buildWriteBatches,
  clearImports,
  detectLocalEdits,
  dismissImport,
  emptyLedger,
  fieldKey,
  guestImportOffer,
  keepMine,
  readLedger,
  reconcileServer,
  recordImport,
  settledImports,
  syncStatus,
  takeTheirs,
  writeLedger,
  ANNOTATION_SYNC_KEY,
  type LocalMaps,
  type SyncLedger,
  type SyncSignals,
} from "@/lib/watchlistAnnotationSync";

// E05 — the client sync engine. Pure functions, so every acceptance rule is pinned here and the
// two-device journeys at the bottom run the engine against the SHIPPED store adapter.

const maps = (notes: Record<string, string> = {}, flags: Record<string, string> = {}): LocalMaps => ({ notes, flags });
const rec = (symbol: string, partial: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  symbol, note: null, noteRevision: 0, noteUpdatedAt: null, flag: null, flagRevision: 0, flagUpdatedAt: null, ...partial,
});
const ok = (symbol: string, field: "note" | "flag", revision: number, value: string | null): AnnotationWriteResult => ({ symbol, field, status: "ok", revision, value, updatedAt: "t" });
const signals = (partial: Partial<SyncSignals> = {}): SyncSignals => ({
  readOk: true, readFailed: false, writeFailed: false, unavailable: false, unauthenticated: false, inFlight: false, ...partial,
});
const acked = (entries: Record<string, [number, string | null]>): SyncLedger => {
  const ledger = emptyLedger();
  for (const [key, [rev, value]] of Object.entries(entries)) ledger.acked[key] = { rev, value };
  return ledger;
};

function memoryStorage(): StoragePort & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("local edits become pending writes", () => {
  it("tracks a new note, a flag, and a clear of an acknowledged value", () => {
    const ledger = acked({ "MSFT|flag": [2, "#f23645"] });
    const next = detectLocalEdits(ledger, maps({ AAPL: "earnings" }, { NVDA: "#089981" }));
    expect(next.pending).toEqual({
      "AAPL|note": { value: "earnings", base: 0 },
      "NVDA|flag": { value: "#089981", base: 0 },
      "MSFT|flag": { value: null, base: 2 },
    });
  });

  it("returns the same ledger when nothing changed (no storage write)", () => {
    const ledger = acked({ "AAPL|note": [1, "x"] });
    expect(detectLocalEdits(ledger, maps({ AAPL: "x" }))).toBe(ledger);
  });

  it("keeps the base of a pending edit while the text keeps changing", () => {
    let ledger = detectLocalEdits(acked({ "AAPL|note": [3, "a"] }), maps({ AAPL: "ab" }));
    ledger = detectLocalEdits(ledger, maps({ AAPL: "abc" }));
    expect(ledger.pending["AAPL|note"]).toEqual({ value: "abc", base: 3 });
  });

  it("leaves a symbol the server could never key as local-only", () => {
    expect(detectLocalEdits(emptyLedger(), maps({ "aapl ": "lower-case key" })).pending).toEqual({});
  });

  it("chunks pending writes to the route's batch limit, skipping invalid ones", () => {
    const notes: Record<string, string> = {};
    for (let index = 0; index < 205; index++) notes[`S${String(index).padStart(3, "0")}`] = "n";
    const ledger = detectLocalEdits(emptyLedger(), maps(notes));
    ledger.pending["S000|note"] = { ...ledger.pending["S000|note"], invalid: true };
    expect(buildWriteBatches(ledger).map((batch) => batch.length)).toEqual([100, 100, 4]);
  });
});

describe("reconciling a server read", () => {
  it("applies a remote change on top of acknowledged state", () => {
    const ledger = acked({ "AAPL|note": [1, "old"] });
    const { ledger: next, applies } = reconcileServer(ledger, [rec("AAPL", { note: "from phone", noteRevision: 2 })], true);
    expect(applies).toEqual([{ symbol: "AAPL", field: "note", from: "old", to: "from phone" }]);
    expect(next.acked["AAPL|note"]).toEqual({ rev: 2, value: "from phone" });
  });

  it("never applies a server value over an unacknowledged local edit (AC-E05-04)", () => {
    const ledger = detectLocalEdits(acked({ "AAPL|note": [1, "old"] }), maps({ AAPL: "my unsaved text" }));
    const { ledger: next, applies } = reconcileServer(ledger, [rec("AAPL", { note: "old", noteRevision: 1 })], true);
    expect(applies).toEqual([]);
    expect(next.pending["AAPL|note"]).toEqual({ value: "my unsaved text", base: 1 });
  });

  it("turns a pending edit whose base moved into a visible conflict (AC-E05-03)", () => {
    const ledger = detectLocalEdits(acked({ "AAPL|note": [1, "old"] }), maps({ AAPL: "desktop text" }));
    const { ledger: next, applies } = reconcileServer(ledger, [rec("AAPL", { note: "phone text", noteRevision: 2, noteUpdatedAt: "t2" })], true);
    expect(applies).toEqual([]);
    expect(next.pending).toEqual({});
    expect(next.conflicts["AAPL|note"]).toEqual({ mine: "desktop text", theirs: "phone text", theirsRev: 2, theirsAt: "t2" });
  });

  it("merges disjoint fields: a pending note stays, a remote flag change applies", () => {
    const ledger = detectLocalEdits(acked({ "AAPL|note": [1, "a"], "AAPL|flag": [1, "#f23645"] }), maps({ AAPL: "b" }, { AAPL: "#f23645" }));
    const { ledger: next, applies } = reconcileServer(ledger, [rec("AAPL", { note: "a", noteRevision: 1, flag: "#2962ff", flagRevision: 2 })], true);
    expect(applies).toEqual([{ symbol: "AAPL", field: "flag", from: "#f23645", to: "#2962ff" }]);
    expect(next.pending["AAPL|note"]).toEqual({ value: "b", base: 1 });
  });

  it("acknowledges a pending edit the server already holds", () => {
    const ledger = detectLocalEdits(emptyLedger(), maps({ AAPL: "same" }));
    const { ledger: next } = reconcileServer(ledger, [rec("AAPL", { note: "same", noteRevision: 4 })], true);
    expect(next.pending).toEqual({});
    expect(next.acked["AAPL|note"]).toEqual({ rev: 4, value: "same" });
  });

  it("never reads an absent row as 'clear my copy' — it re-sends instead", () => {
    const { ledger: next, applies } = reconcileServer(acked({ "AAPL|note": [3, "keep me"] }), [], true);
    expect(applies).toEqual([]);
    expect(next.pending["AAPL|note"]).toEqual({ value: "keep me", base: 0 });
  });

  it("leaves keys missing from an INCOMPLETE read exactly as they are", () => {
    const ledger = acked({ "AAPL|note": [3, "keep me"] });
    const { ledger: next, applies } = reconcileServer(ledger, [rec("MSFT", { flag: "#089981", flagRevision: 1 })], false);
    expect(next.acked["AAPL|note"]).toEqual({ rev: 3, value: "keep me" });
    expect(next.pending).toEqual({});
    expect(applies).toEqual([{ symbol: "MSFT", field: "flag", from: null, to: "#089981" }]);
  });

  it("resolves a conflict that another device settled on this device's text", () => {
    const ledger = emptyLedger();
    ledger.conflicts["AAPL|note"] = { mine: "mine", theirs: "theirs", theirsRev: 2, theirsAt: null };
    const { ledger: next } = reconcileServer(ledger, [rec("AAPL", { note: "mine", noteRevision: 3 })], true);
    expect(next.conflicts).toEqual({});
    expect(next.acked["AAPL|note"]).toEqual({ rev: 3, value: "mine" });
  });
});

describe("write results", () => {
  const sent = [{ symbol: "AAPL", field: "note" as const, value: "v1", baseRevision: 1 }];
  const pendingLedger = () => detectLocalEdits(acked({ "AAPL|note": [1, "v0"] }), maps({ AAPL: "v1" }));

  it("ok acknowledges and clears the pending write", () => {
    const next = applyWriteResults(pendingLedger(), sent, [ok("AAPL", "note", 2, "v1")]);
    expect(next.pending).toEqual({});
    expect(next.acked["AAPL|note"]).toEqual({ rev: 2, value: "v1" });
  });

  it("ok while the user typed further rebases the newer text onto the new revision", () => {
    const typedMore = detectLocalEdits(pendingLedger(), maps({ AAPL: "v1 and more" }));
    const next = applyWriteResults(typedMore, sent, [ok("AAPL", "note", 2, "v1")]);
    expect(next.pending["AAPL|note"]).toEqual({ value: "v1 and more", base: 2 });
  });

  it("conflict keeps both texts", () => {
    const next = applyWriteResults(pendingLedger(), sent, [{ ...ok("AAPL", "note", 5, "phone"), status: "conflict" }]);
    expect(next.conflicts["AAPL|note"]).toMatchObject({ mine: "v1", theirs: "phone", theirsRev: 5 });
    expect(next.pending).toEqual({});
  });

  it("error or no answer leaves the write pending exactly as it was (AC-E05-04)", () => {
    const before = pendingLedger();
    expect(applyWriteResults(before, sent, [{ ...ok("AAPL", "note", 0, null), status: "error" }]).pending).toEqual(before.pending);
    expect(applyWriteResults(before, sent, []).pending).toEqual(before.pending);
    expect(applyWriteResults(before, sent, []).acked).toEqual(before.acked);
  });

  it("invalid marks the write so it is not resent, and the status says it cannot sync", () => {
    const next = applyWriteResults(pendingLedger(), sent, [{ ...ok("AAPL", "note", 0, null), status: "invalid" }]);
    expect(next.pending["AAPL|note"]).toMatchObject({ invalid: true });
    expect(buildWriteBatches(next)).toEqual([]);
    expect(syncStatus(next, signals())).toEqual({ kind: "rejected", count: 1 });
  });
});

describe("status never claims Synced without proof (AC-E05-04)", () => {
  const pending = detectLocalEdits(emptyLedger(), maps({ AAPL: "x" }));

  it("is synced only after a read, with nothing pending, in flight or failed", () => {
    expect(syncStatus(emptyLedger(), signals())).toEqual({ kind: "synced" });
    expect(syncStatus(emptyLedger(), signals({ readOk: false }))).toEqual({ kind: "checking" });
    expect(syncStatus(emptyLedger(), signals({ inFlight: true }))).toEqual({ kind: "saving" });
    expect(syncStatus(pending, signals())).toEqual({ kind: "saving" });
  });

  it("names every failure instead", () => {
    expect(syncStatus(pending, signals({ writeFailed: true }))).toEqual({ kind: "retrying", count: 1 });
    expect(syncStatus(emptyLedger(), signals({ readFailed: true }))).toEqual({ kind: "readFailed" });
    expect(syncStatus(pending, signals({ unavailable: true }))).toEqual({ kind: "unavailable" });
    expect(syncStatus(pending, signals({ unauthenticated: true }))).toEqual({ kind: "auth" });
    const conflicted = emptyLedger();
    conflicted.conflicts["AAPL|note"] = { mine: "a", theirs: "b", theirsRev: 2, theirsAt: null };
    expect(syncStatus(conflicted, signals())).toEqual({ kind: "conflict", count: 1 });
  });

  it("no failure-signal combination with pending work reports synced", () => {
    for (const readOk of [true, false]) for (const readFailed of [true, false]) for (const writeFailed of [true, false]) for (const inFlight of [true, false]) {
      expect(syncStatus(pending, signals({ readOk, readFailed, writeFailed, inFlight })).kind).not.toBe("synced");
    }
  });
});

describe("conflict resolution", () => {
  const conflicted = () => {
    const ledger = emptyLedger();
    ledger.conflicts["AAPL|note"] = { mine: "desktop", theirs: "phone", theirsRev: 4, theirsAt: null };
    return ledger;
  };

  it("keep mine becomes a write based on the revision now known", () => {
    expect(keepMine(conflicted(), "AAPL|note").pending["AAPL|note"]).toEqual({ value: "desktop", base: 4 });
  });

  it("take theirs acknowledges their value and applies it locally", () => {
    const { ledger, apply } = takeTheirs(conflicted(), "AAPL|note");
    expect(ledger.acked["AAPL|note"]).toEqual({ rev: 4, value: "phone" });
    expect(apply).toEqual({ symbol: "AAPL", field: "note", from: "desktop", to: "phone" });
    expect(applyToMap({ AAPL: "desktop" }, [apply!], "note")).toEqual({ AAPL: "phone" });
  });

  it("applyToMap skips a key the user changed meanwhile, and returns the same map when idle", () => {
    const map = { AAPL: "typed after the read" };
    expect(applyToMap(map, [{ symbol: "AAPL", field: "note", from: "old", to: "remote" }], "note")).toBe(map);
    expect(applyToMap({ AAPL: "old" }, [{ symbol: "AAPL", field: "note", from: "old", to: null }], "note")).toEqual({});
  });
});

describe("guest import (AC-E05-01, AC-E05-02)", () => {
  const guest = maps({ AAPL: "guest note", MSFT: "guest msft", TSLA: "same" }, { NVDA: "#ec7fa9", BAD: "not-a-colour" });
  const account = maps({ MSFT: "account msft", TSLA: "same" });

  it("offers only what the account lacks, lists collisions, never offers an invalid value", () => {
    const offer = guestImportOffer(guest, account, emptyLedger());
    expect(offer.items).toEqual([
      { symbol: "AAPL", field: "note", value: "guest note" },
      { symbol: "NVDA", field: "flag", value: "#ec7fa9" },
    ]);
    expect(offer.collisions).toEqual([{ symbol: "MSFT", field: "note", value: "guest msft", accountValue: "account msft" }]);
    expect(offer.fingerprint).toBe(guestImportOffer(guest, account, emptyLedger()).fingerprint);
  });

  it("does not offer an import twice, and remembers 'Not now' per offer", () => {
    const offer = guestImportOffer(guest, account, emptyLedger());
    const imported = recordImport(emptyLedger(), offer.items);
    expect(guestImportOffer(guest, account, imported).items).toEqual([]);
    const dismissed = dismissImport(emptyLedger(), offer.fingerprint);
    expect(dismissed.importDismissed).toBe(offer.fingerprint);
    expect(dismissImport(dismissed, offer.fingerprint)).toBe(dismissed);
  });

  it("keeps the guest original until the server acknowledges exactly that value", () => {
    const items = [{ symbol: "AAPL", field: "note" as const, value: "guest note" }];
    let ledger = recordImport(emptyLedger(), items);
    ledger = detectLocalEdits(ledger, maps({ AAPL: "guest note" }));
    expect(settledImports(ledger)).toEqual({ retire: [], forget: [] });
    // The save fails: still journaled, original still recoverable.
    ledger = applyWriteResults(ledger, buildWriteBatches(ledger)[0], [{ ...ok("AAPL", "note", 0, null), status: "error" }]);
    expect(settledImports(ledger)).toEqual({ retire: [], forget: [] });
    ledger = applyWriteResults(ledger, buildWriteBatches(ledger)[0], [ok("AAPL", "note", 1, "guest note")]);
    expect(settledImports(ledger)).toEqual({ retire: items, forget: [] });
    expect(clearImports(ledger, [fieldKey("AAPL", "note")]).imports).toEqual({});
  });

  it("forgets (without retiring the original) an import that settled on another value", () => {
    const ledger = recordImport(emptyLedger(), [{ symbol: "AAPL", field: "note", value: "guest note" }]);
    ledger.acked["AAPL|note"] = { rev: 2, value: "edited later" };
    expect(settledImports(ledger)).toEqual({ retire: [], forget: ["AAPL|note"] });
  });
});

describe("ledger persistence", () => {
  it("is owner-scoped and drops malformed entries", () => {
    const storage = memoryStorage();
    const ledger = detectLocalEdits(acked({ "AAPL|note": [1, "a"] }), maps({ AAPL: "b" }));
    expect(writeLedger(storage, "account:alice", ledger)).toBe(true);
    expect(readLedger(storage, "account:alice")).toEqual(ledger);
    expect(readLedger(storage, "account:bob")).toEqual(emptyLedger());

    const envelope = JSON.parse(storage.data.get(ANNOTATION_SYNC_KEY)!) as Record<string, Record<string, Record<string, unknown>>>;
    expect(Object.keys(envelope)).toEqual(["account:alice"]);
    envelope["account:alice"].acked["BAD"] = { rev: 1, value: "no field" };
    envelope["account:alice"].pending["MSFT|note"] = { value: "x", base: -1 };
    envelope["account:alice"].conflicts["TSLA|flag"] = "not an object" as unknown as Record<string, unknown>;
    storage.data.set(ANNOTATION_SYNC_KEY, JSON.stringify(envelope));
    const read = readLedger(storage, "account:alice");
    expect(read.acked).toEqual(ledger.acked);
    expect(read.pending).toEqual(ledger.pending);
    expect(read.conflicts).toEqual({});
  });
});

// ─────────── two devices over the shipped store adapter ───────────

const USER = "e2e-user-sync";
const store = () => supabaseAnnotationStore(createFixtureAnnotationDb("sync"));

/** One device: its maps and ledger, and the same read/write steps the client component runs. */
class Device {
  ledger = emptyLedger();
  constructor(public local: LocalMaps = maps()) {}
  edit(next: LocalMaps) {
    this.local = next;
    this.ledger = detectLocalEdits(this.ledger, this.local);
  }
  async read() {
    this.ledger = detectLocalEdits(this.ledger, this.local);
    const listed = await store().list(USER);
    if (!listed.ok) throw new Error("read failed");
    const { ledger, applies } = reconcileServer(this.ledger, listed.records, listed.complete);
    this.ledger = ledger;
    this.local = { notes: applyToMap(this.local.notes, applies, "note"), flags: applyToMap(this.local.flags, applies, "flag") };
  }
  async write(faults: string[] = []) {
    const s = supabaseAnnotationStore(createFixtureAnnotationDb("sync", new Set(faults)));
    for (const batch of buildWriteBatches(this.ledger)) {
      const results: AnnotationWriteResult[] = [];
      for (const write of batch) {
        const result = await s.write(USER, write, "2026-10-11T00:00:00Z");
        if (result.status !== "unavailable") results.push(result);
      }
      this.ledger = applyWriteResults(this.ledger, batch, results);
    }
  }
}

describe("two-device journeys", () => {
  beforeEach(() => resetFixtureAnnotationStores());

  it("a note and a flag written on one device are read on another (AC-E05-06)", async () => {
    const desktop = new Device();
    desktop.edit(maps({ "600519.SS": "茅台：等待回调至 1600" }, { "600519.SS": "#f23645" }));
    await desktop.write();
    const phone = new Device();
    await phone.read();
    expect(phone.local).toEqual(maps({ "600519.SS": "茅台：等待回调至 1600" }, { "600519.SS": "#f23645" }));
    expect(syncStatus(phone.ledger, signals())).toEqual({ kind: "synced" });
  });

  it("disjoint edits from two devices both land (AC-E05-03 merge)", async () => {
    const a = new Device();
    a.edit(maps({ AAPL: "base" }, { AAPL: "#2962ff" }));
    await a.write();
    const b = new Device();
    await b.read();

    a.edit(maps({ AAPL: "note from A" }, { AAPL: "#2962ff" }));
    b.edit(maps({ AAPL: "base" }, { AAPL: "#089981" }));
    await a.write();
    await b.write();
    await a.read();
    await b.read();
    expect(a.local).toEqual(maps({ AAPL: "note from A" }, { AAPL: "#089981" }));
    expect(b.local).toEqual(a.local);
    expect(a.ledger.conflicts).toEqual({});
    expect(b.ledger.conflicts).toEqual({});
  });

  it("same-field edits surface a conflict; neither text vanishes (AC-E05-03)", async () => {
    const a = new Device();
    a.edit(maps({ AAPL: "base" }));
    await a.write();
    const b = new Device();
    await b.read();

    a.edit(maps({ AAPL: "A's newer text" }));
    b.edit(maps({ AAPL: "B's newer text" }));
    await a.write();
    await b.write();
    expect(b.ledger.conflicts["AAPL|note"]).toMatchObject({ mine: "B's newer text", theirs: "A's newer text" });
    expect(b.local.notes.AAPL).toBe("B's newer text");
    expect(syncStatus(b.ledger, signals())).toEqual({ kind: "conflict", count: 1 });

    // B keeps its own: it is written over A's KNOWN revision, and A then reads it.
    b.ledger = keepMine(b.ledger, "AAPL|note");
    await b.write();
    await a.read();
    expect(a.local.notes.AAPL).toBe("B's newer text");
    expect(syncStatus(b.ledger, signals())).toEqual({ kind: "synced" });
  });

  it("a failed save stays pending and is never overwritten by a read (AC-E05-04)", async () => {
    const a = new Device();
    a.edit(maps({ AAPL: "acknowledged" }));
    await a.write();
    a.edit(maps({ AAPL: "unsaved edit" }));
    await a.write([FAULT_ANNOTATIONS_WRITE]);
    expect(syncStatus(a.ledger, signals({ writeFailed: true }))).toEqual({ kind: "retrying", count: 1 });
    await a.read();
    expect(a.local.notes.AAPL).toBe("unsaved edit");
    await a.write();
    const b = new Device();
    await b.read();
    expect(b.local.notes.AAPL).toBe("unsaved edit");
  });
});
