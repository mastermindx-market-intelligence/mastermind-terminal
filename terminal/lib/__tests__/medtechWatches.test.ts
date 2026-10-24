import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbResult, DbRow, WatchlistDb, WatchlistQuery } from "@/lib/watchlists";
const mocks = vi.hoisted(() => ({ macroRead: vi.fn() }));
vi.mock("@/lib/medtechServer", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/medtechServer")>(), macroRead: mocks.macroRead,
}));
import { MedTechError, type MedTechAuth } from "@/lib/medtechServer";
import { createWatch, deleteWatch, getWatch, listWatches, reviewChange, updateWatch, watchUpdates } from "@/lib/medtechWatches";

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const ID = "20000000-0000-4000-8000-000000000001";
const EVENT = "fda-510k-K260001", SNAPSHOT = "a".repeat(64), REV = "b".repeat(64), NEXT = "c".repeat(64);
const BASELINE = "2026-10-10T12:00:00Z", CHANGED = "2026-10-11T12:00:00Z";
function stored(overrides: DbRow = {}): DbRow {
  return {
    id: ID, user_id: A, subject_type: "event", subject_id: EVENT, triggers: ["record_changed"],
    baseline_generation: SNAPSHOT, baseline_revision: REV, baseline_at: BASELINE,
    created_at: BASELINE, updated_at: BASELINE, version: 1, ...overrides,
  };
}

/** Transport stand-in only; actual RLS, guards and simultaneous quota behavior are tested in PostgreSQL. */
class MemoryDb {
  tables: Record<string, DbRow[]> = { medtech_watches: [], medtech_reviewed_changes: [] };
  writes: Array<{ table: string; op: string; values: DbRow | null }> = [];
  failure: { message: string; code?: string } | null = null;
  from = (table: string): WatchlistQuery => {
    const filters: Array<(row: DbRow) => boolean> = [];
    let op = "select", values: DbRow | null = null, max = Infinity;
    const execute = (): DbResult => {
      if (this.failure) return { data: null, error: this.failure };
      const rows = this.tables[table];
      const selected = rows.filter(row => filters.every(filter => filter(row))).slice(0, max);
      if (op === "select") return { data: structuredClone(selected), error: null };
      this.writes.push({ table, op, values });
      if (op === "insert" || op === "upsert") {
        const duplicate = rows.find(row => table === "medtech_watches"
          ? row.user_id === values!.user_id && row.subject_type === values!.subject_type && row.subject_id === values!.subject_id
          : row.watch_id === values!.watch_id && row.event_id === values!.event_id && row.revision_id === values!.revision_id);
        if (duplicate) return op === "upsert" ? { data: [] } : {
          error: { message: "duplicate", code: "23505" } as { message: string },
        };
        const row = table === "medtech_watches" ? stored(values!) : { ...values, reviewed_at: CHANGED };
        rows.push(row);
        return { data: [structuredClone(row)] };
      }
      if (op === "update") selected.forEach(row => Object.assign(row, values, { version: Number(row.version) + 1 }));
      if (op === "delete") this.tables[table] = rows.filter(row => !selected.includes(row));
      return { data: structuredClone(selected) };
    };
    const builder = {
      select: () => builder, eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return builder; },
      in: (key: string, values: readonly unknown[]) => { filters.push(row => values.includes(row[key])); return builder; },
      order: () => builder, limit: (value: number) => { max = value; return builder; },
      insert: (value: DbRow) => { op = "insert"; values = value; return builder; },
      upsert: (value: DbRow) => { op = "upsert"; values = value; return builder; },
      update: (value: DbRow) => { op = "update"; values = value; return builder; },
      delete: () => { op = "delete"; return builder; },
      maybeSingle: async () => execute(),
      then: <T, U>(resolve?: (value: DbResult) => T | PromiseLike<T>,
        reject?: (reason: unknown) => U | PromiseLike<U>) => Promise.resolve(execute()).then(resolve, reject),
    };
    return builder as unknown as WatchlistQuery;
  };
}
let db: MemoryDb, auth: MedTechAuth;
const request = () => ({ subject_type: "event", subject_id: EVENT, snapshot_id: SNAPSHOT, triggers: ["record_changed"] });
function sourceSubject() {
  return { schema: "medtech.subject/v1", snapshot_id: SNAPSHOT, subject_type: "event", subject_id: EVENT,
    baseline_revision: REV, allowed_triggers: ["record_changed"] };
}
function feed(revisions = [NEXT]) {
  return { schema: "medtech.updates/v1", snapshot_id: SNAPSHOT, subject_type: "event", subject_id: EVENT,
    total: revisions.length, next_offset: null, items: revisions.map(revision_id => ({
      event_id: EVENT, revision_id, trigger: "record_changed", observed_at: CHANGED,
      kind: "source_record_changed", decision_date: "2026-10-01", device_name: "Test fixture",
      changes: [], source_url: "https://www.accessdata.fda.gov/",
    })) };
}
beforeEach(() => {
  db = new MemoryDb(); auth = { db: db as WatchlistDb, userId: A, token: "fixture-session" };
  mocks.macroRead.mockResolvedValue(sourceSubject());
});
afterEach(() => vi.resetAllMocks());

describe("typed MedTech watch account state", () => {
  it("creates only a verified typed subject and lets the database assign its baseline", async () => {
    const result = await createWatch(auth, request());
    expect(result.created).toBe(true);
    expect(result.watch.baseline_at).toBe(BASELINE);
    expect(result.watch).not.toHaveProperty("user_id");
    expect(db.writes[0].values).toEqual({
      user_id: A, subject_type: "event", subject_id: EVENT, triggers: ["record_changed"],
      baseline_generation: SNAPSHOT, baseline_revision: REV,
    });
    expect(mocks.macroRead.mock.calls[0][1]).toBe("/subjects/event/" + EVENT);
  });

  it.each(["fda-510k-DEN230001", "fda-pma-N12345", "fda-pma-N12345-S001"])(
    "saves and reviews the exact retained FDA identifier %s", async subject_id => {
      mocks.macroRead.mockResolvedValueOnce({ ...sourceSubject(), subject_id });
      const result = await createWatch(auth, { ...request(), subject_id });
      expect(result.watch.subject_id).toBe(subject_id);
      const changes = feed();
      mocks.macroRead.mockResolvedValueOnce({
        ...changes, subject_id,
        items: changes.items.map(item => ({ ...item, event_id: subject_id })),
      });
      await reviewChange(auth, ID, { event_id: subject_id, revision_id: NEXT, snapshot_id: SNAPSHOT });
      expect(db.tables.medtech_reviewed_changes[0].event_id).toBe(subject_id);
    },
  );

  it.each([
    { subject_type: "event", subject_id: "fda-510k-K260001-S001" },
    { subject_type: "event", subject_id: "fda-510k-DEN230001-S001" },
    { subject_type: "event", subject_id: "fda-pma-DEN230001" },
    { subject_type: "event", subject_id: "fda-pma-N1234" },
    { subject_type: "event", subject_id: "fda-510k-K260001\n" },
    { subject_type: "pma_application", subject_id: "fda-pma-N12345" },
    { subject_type: "pma_application", subject_id: "fda-pma-P260001-S001" },
    { subject_type: "pma_application", subject_id: "fda-pma-P260001\n" },
  ])("refuses invalid exact records and unsupported application families: %o", async subject => {
    await expect(createWatch(auth, { ...request(), ...subject })).rejects.toMatchObject({ status: 400 });
    expect(db.writes).toHaveLength(0);
    expect(mocks.macroRead).not.toHaveBeenCalled();
  });

  it("preserves an existing subscription on retries after the source generation advances", async () => {
    await createWatch(auth, request());
    mocks.macroRead.mockRejectedValue(new MedTechError(409, "snapshot_changed"));
    const retry = await createWatch(auth, request());
    expect(retry.created).toBe(false);
    expect(retry.watch.baseline_generation).toBe(SNAPSHOT);
    expect(db.writes).toHaveLength(1);
    expect(mocks.macroRead).toHaveBeenCalledTimes(1);
  });

  it("scopes every existing watch read and mutation to the verified account", async () => {
    db.tables.medtech_watches.push(stored());
    const other = { ...auth, userId: B };
    expect((await listWatches(other)).items).toEqual([]);
    await expect(getWatch(other, ID)).rejects.toMatchObject({ status: 404 });
    await expect(updateWatch(other, ID, { version: 1, triggers: ["record_changed"] })).rejects.toMatchObject({ status: 404 });
    await expect(deleteWatch(other, ID, { version: 1 })).rejects.toMatchObject({ status: 404 });
    expect(db.writes).toHaveLength(0);
  });

  it.each([
    { ...request(), user_id: B },
    { ...request(), subject_type: "symbol", subject_id: "EXMD" },
    { ...request(), triggers: ["commercial_launch"] },
    { ...request(), triggers: ["new_supplement"] },
    { ...request(), triggers: ["record_changed", "record_changed"] },
  ])("refuses unsupported ownership, subjects and triggers", async input => {
    await expect(createWatch(auth, input)).rejects.toMatchObject({ status: 400 });
    expect(db.writes).toHaveLength(0);
  });

  it("does not claim a save if source verification or persistence fails", async () => {
    mocks.macroRead.mockRejectedValueOnce(new MedTechError(409, "snapshot_changed"));
    await expect(createWatch(auth, request())).rejects.toMatchObject({ status: 409 });
    expect(db.writes).toHaveLength(0);
    db.failure = { message: "database unavailable" };
    await expect(listWatches(auth)).rejects.toMatchObject({ status: 503, code: "watches_unavailable" });
  });

  it("uses compare-and-set for edits and deletion without resetting the baseline", async () => {
    db.tables.medtech_watches.push(stored());
    const changed = await updateWatch(auth, ID, { version: 1, triggers: ["record_changed"] });
    expect(changed.watch.version).toBe(2);
    expect(changed.watch.baseline_at).toBe(BASELINE);
    await expect(updateWatch(auth, ID, { version: 1, triggers: ["record_changed"] })).rejects.toMatchObject({ status: 409 });
    await expect(deleteWatch(auth, ID, { version: 1 })).rejects.toMatchObject({ status: 409 });
    expect(db.tables.medtech_watches).toHaveLength(1);
    await deleteWatch(auth, ID, { version: 2 });
    expect(db.tables.medtech_watches).toHaveLength(0);
  });

  it("filters updates from the saved baseline and marks only the exact revision reviewed", async () => {
    db.tables.medtech_watches.push(stored());
    db.tables.medtech_reviewed_changes.push({ user_id: A, watch_id: ID, event_id: EVENT, revision_id: REV });
    mocks.macroRead.mockResolvedValue(feed([NEXT, REV]));
    const result = await watchUpdates(auth, ID, new URLSearchParams({ snapshot_id: SNAPSHOT }));
    const query = mocks.macroRead.mock.calls[0][2] as URLSearchParams;
    expect(query.get("since")).toBe(BASELINE);
    expect(query.get("trigger")).toBe("record_changed");
    expect(result.items.map(item => item.reviewed)).toEqual([false, true]);
  });

  it("rejects caller-chosen baselines and source rows outside the watch scope", async () => {
    db.tables.medtech_watches.push(stored());
    await expect(watchUpdates(auth, ID, new URLSearchParams({ since: "1900-01-01" }))).rejects.toMatchObject({ status: 400 });
    const wrong = feed(); wrong.items[0].event_id = "fda-510k-K260002";
    mocks.macroRead.mockResolvedValueOnce(wrong);
    await expect(watchUpdates(auth, ID, new URLSearchParams())).rejects.toMatchObject({ status: 503 });
    const old = feed(); old.items[0].observed_at = BASELINE;
    mocks.macroRead.mockResolvedValueOnce(old);
    await expect(watchUpdates(auth, ID, new URLSearchParams())).rejects.toMatchObject({ status: 503 });
  });

  it("validates review against an exact source revision and preserves duplicate review receipts", async () => {
    db.tables.medtech_watches.push(stored());
    mocks.macroRead.mockResolvedValue(feed());
    const input = { event_id: EVENT, revision_id: NEXT, snapshot_id: SNAPSHOT };
    const first = await reviewChange(auth, ID, input);
    const second = await reviewChange(auth, ID, input);
    expect(first).toEqual(second);
    expect(db.tables.medtech_reviewed_changes).toHaveLength(1);
    expect((mocks.macroRead.mock.calls[0][2] as URLSearchParams).get("revision_id")).toBe(NEXT);
    await expect(reviewChange(auth, ID, { ...input, revision_id: REV })).rejects.toMatchObject({
      status: 409, code: "change_not_available",
    });
  });

  it("preserves failure when the source or review table is unavailable", async () => {
    db.tables.medtech_watches.push(stored());
    mocks.macroRead.mockRejectedValueOnce(new MedTechError(503, "source_unavailable"));
    await expect(watchUpdates(auth, ID, new URLSearchParams())).rejects.toMatchObject({ status: 503 });
    db.failure = { message: "not applied" };
    await expect(listWatches(auth)).rejects.toMatchObject({ status: 503 });
  });
});
