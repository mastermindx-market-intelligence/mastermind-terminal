import { beforeEach, describe, expect, it } from "vitest";
import {
  applyAnnotationWrites,
  isSchemaMissing,
  supabaseAnnotationStore,
  type AnnotationDb,
  type AnnotationStore,
} from "@/lib/watchlistAnnotationsStore";
import {
  createFixtureAnnotationDb,
  fixtureAnnotationRows,
  resetFixtureAnnotationStores,
  FAULT_ANNOTATIONS_READ,
  FAULT_ANNOTATIONS_UNAVAILABLE,
  FAULT_ANNOTATIONS_WRITE,
  FAULT_ANNOTATIONS_WRITE_UNCERTAIN,
} from "@/lib/watchlistAnnotationsFixtureDb";
import type { AnnotationWrite } from "@/lib/watchlistAnnotations";

// E05 — the shipped Supabase adapter, run over the fixture transport (no RLS: one physical row set
// for every actor of a database key, so the adapter's own user_id filter is what is under test).

const ALICE = "e2e-user-db::alice";
const BOB = "e2e-user-db::bob";
const NOW = "2026-10-11T00:00:00.000Z";
const LATER = "2026-10-11T00:05:00.000Z";

const storeFor = (key: string, ...faults: string[]): AnnotationStore => supabaseAnnotationStore(createFixtureAnnotationDb(key, new Set(faults)));
const note = (symbol: string, value: string | null, baseRevision: number): AnnotationWrite => ({ symbol, field: "note", value, baseRevision });
const flag = (symbol: string, value: string | null, baseRevision: number): AnnotationWrite => ({ symbol, field: "flag", value, baseRevision });

beforeEach(() => resetFixtureAnnotationStores());

describe("ownership (AC-E05-01)", () => {
  it("lists only the caller's rows although both actors share one row set", async () => {
    await storeFor("db::alice").write(ALICE, note("AAPL", "alice's note", 0), NOW);
    await storeFor("db::bob").write(BOB, note("AAPL", "bob's note", 0), NOW);
    await storeFor("db::bob").write(BOB, flag("MSFT", "#f23645", 0), NOW);

    expect(fixtureAnnotationRows("db")).toHaveLength(3);
    const alice = await storeFor("db::alice").list(ALICE);
    const bob = await storeFor("db::bob").list(BOB);
    expect(alice.ok && alice.records.map((record) => [record.symbol, record.note, record.flag])).toEqual([["AAPL", "alice's note", null]]);
    expect(bob.ok && bob.records.map((record) => [record.symbol, record.note, record.flag])).toEqual([
      ["AAPL", "bob's note", null],
      ["MSFT", null, "#f23645"],
    ]);
  });

  it("never updates another actor's row of the same symbol", async () => {
    await storeFor("db::alice").write(ALICE, note("AAPL", "alice v1", 0), NOW);
    // Bob writes at base 1 — the revision Alice's row holds. Without the user_id filter this CAS
    // would match Alice's row and overwrite her text.
    const result = await storeFor("db::bob").write(BOB, note("AAPL", "bob", 1), LATER);
    expect(result).toMatchObject({ status: "conflict", revision: 0, value: null });
    const rows = fixtureAnnotationRows("db");
    expect(rows).toEqual([expect.objectContaining({ user_id: ALICE, note: "alice v1", note_revision: 1 })]);
  });
});

describe("field-level compare-and-set", () => {
  it("creates a record on the first write and advances one field at a time", async () => {
    const store = storeFor("db::alice");
    expect(await store.write(ALICE, note("NVDA", "watch 120", 0), NOW)).toEqual({ symbol: "NVDA", field: "note", status: "ok", revision: 1, value: "watch 120", updatedAt: NOW });
    // The other field of the same row: its revision is still 0, so the compare-and-set lands.
    expect(await store.write(ALICE, flag("NVDA", "#089981", 0), LATER)).toMatchObject({ status: "ok", revision: 1, value: "#089981" });
    expect(await store.write(ALICE, note("NVDA", "watch 125", 1), LATER)).toMatchObject({ status: "ok", revision: 2, value: "watch 125" });
    const listed = await store.list(ALICE);
    expect(listed.ok && listed.records).toEqual([
      { symbol: "NVDA", note: "watch 125", noteRevision: 2, noteUpdatedAt: LATER, flag: "#089981", flagRevision: 1, flagUpdatedAt: LATER },
    ]);
  });

  it("reports a stale base as a conflict carrying the current text, and changes nothing", async () => {
    const store = storeFor("db::alice");
    await store.write(ALICE, note("TSLA", "device A text", 0), NOW);
    await store.write(ALICE, note("TSLA", "device A newer", 1), NOW);
    const stale = await store.write(ALICE, note("TSLA", "device B text", 1), LATER);
    expect(stale).toEqual({ symbol: "TSLA", field: "note", status: "conflict", revision: 2, value: "device A newer", updatedAt: NOW });
    expect(fixtureAnnotationRows("db")[0]).toMatchObject({ note: "device A newer", note_revision: 2 });
  });

  it("a first write racing an existing value is a conflict, not an overwrite", async () => {
    await storeFor("db::alice").write(ALICE, note("AMD", "phone wrote this", 0), NOW);
    const desktop = await storeFor("db::alice").write(ALICE, note("AMD", "desktop wrote this", 0), LATER);
    expect(desktop).toMatchObject({ status: "conflict", revision: 1, value: "phone wrote this" });
  });

  it("recognises a write whose value is already there as applied (ok at the existing revision)", async () => {
    const store = storeFor("db::alice");
    await store.write(ALICE, note("META", "same", 0), NOW);
    expect(await store.write(ALICE, note("META", "same", 0), LATER)).toMatchObject({ status: "ok", revision: 1, value: "same", updatedAt: NOW });
  });

  it("clears a field without dropping its revision, and clearing nothing is already true", async () => {
    const store = storeFor("db::alice");
    await store.write(ALICE, flag("GOOG", "#9c27b0", 0), NOW);
    expect(await store.write(ALICE, flag("GOOG", null, 1), LATER)).toMatchObject({ status: "ok", revision: 2, value: null });
    expect(await store.write(ALICE, note("NONE", null, 0), LATER)).toMatchObject({ status: "ok", revision: 0, value: null });
    expect(fixtureAnnotationRows("db").map((row) => row.symbol)).toEqual(["GOOG"]);
  });
});

describe("failures are never content (AC-E05-04)", () => {
  it("a missing table is unavailable on read and write", async () => {
    expect(await storeFor("db::alice", FAULT_ANNOTATIONS_UNAVAILABLE).list(ALICE)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await storeFor("db::alice", FAULT_ANNOTATIONS_UNAVAILABLE).write(ALICE, note("AAPL", "x", 0), NOW)).toMatchObject({ status: "unavailable" });
    expect(isSchemaMissing({ code: "PGRST205" })).toBe(true);
    expect(isSchemaMissing({ message: "Could not find the table 'public.watchlist_annotations' in the schema cache" })).toBe(true);
    expect(isSchemaMissing({ code: "57014", message: "statement timeout" })).toBe(false);
  });

  it("a failed read is an error, not an empty list", async () => {
    await storeFor("db::alice").write(ALICE, note("AAPL", "kept", 0), NOW);
    expect(await storeFor("db::alice", FAULT_ANNOTATIONS_READ).list(ALICE)).toMatchObject({ ok: false, reason: "error" });
  });

  it("a driver that throws is an error on read and write", async () => {
    const throwing: AnnotationDb = { from: () => { throw new Error("socket closed"); } };
    expect(await supabaseAnnotationStore(throwing).list(ALICE)).toMatchObject({ ok: false, reason: "error" });
    expect(await supabaseAnnotationStore(throwing).write(ALICE, note("AAPL", "x", 0), NOW)).toMatchObject({ status: "error" });
  });

  it("a failed write lands nothing and answers error", async () => {
    expect(await storeFor("db::alice", FAULT_ANNOTATIONS_WRITE).write(ALICE, note("AAPL", "x", 0), NOW)).toMatchObject({ status: "error" });
    expect(fixtureAnnotationRows("db")).toEqual([]);
  });

  it("an uncertain write (landed, response lost) answers error, and its retry resolves ok without a second revision", async () => {
    const lost = await storeFor("db::alice", FAULT_ANNOTATIONS_WRITE_UNCERTAIN).write(ALICE, note("BABA", "阿里：云业务", 0), NOW);
    expect(lost).toMatchObject({ status: "error" });
    expect(fixtureAnnotationRows("db")).toEqual([expect.objectContaining({ note: "阿里：云业务", note_revision: 1 })]);
    // Same base, same value — exactly what the client re-sends. Even with the fault still on,
    // nothing changes, so nothing is lost and the retry is recognised as already applied.
    const retried = await storeFor("db::alice", FAULT_ANNOTATIONS_WRITE_UNCERTAIN).write(ALICE, note("BABA", "阿里：云业务", 0), LATER);
    expect(retried).toMatchObject({ status: "ok", revision: 1, value: "阿里：云业务" });
    expect(fixtureAnnotationRows("db")[0]).toMatchObject({ note_revision: 1 });
  });
});

describe("applyAnnotationWrites", () => {
  it("keeps invalid answers, applies the rest in order", async () => {
    const outcome = await applyAnnotationWrites(
      storeFor("db::alice"),
      ALICE,
      [note("AAPL", "a", 0), flag("AAPL", "#f23645", 0)],
      [{ symbol: "MSFT", field: "flag", status: "invalid", revision: 0, value: null, updatedAt: null }],
      NOW,
    );
    expect(outcome.kind).toBe("results");
    expect(outcome.kind === "results" && outcome.results.map((result) => `${result.symbol}|${result.field}|${result.status}`)).toEqual([
      "MSFT|flag|invalid",
      "AAPL|note|ok",
      "AAPL|flag|ok",
    ]);
  });

  it("is `failed` when every write errored and `unavailable` when the table is missing", async () => {
    const failed = await applyAnnotationWrites(storeFor("db::alice", FAULT_ANNOTATIONS_WRITE), ALICE, [note("AAPL", "a", 0)], [], NOW);
    expect(failed).toMatchObject({ kind: "failed", results: [expect.objectContaining({ status: "error" })] });
    const missing = await applyAnnotationWrites(storeFor("db::alice", FAULT_ANNOTATIONS_UNAVAILABLE), ALICE, [note("AAPL", "a", 0)], [], NOW);
    expect(missing.kind).toBe("unavailable");
  });

  it("an all-invalid batch is answered, not failed", async () => {
    const outcome = await applyAnnotationWrites(storeFor("db::alice"), ALICE, [], [{ symbol: "X", field: "note", status: "invalid", revision: 0, value: null, updatedAt: null }], NOW);
    expect(outcome.kind).toBe("results");
  });
});
