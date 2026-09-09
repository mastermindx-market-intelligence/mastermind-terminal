import { beforeEach, describe, expect, it } from "vitest";
import type { DbResult, DbRow, WatchlistDb, WatchlistQuery } from "@/lib/watchlists";
import {
  MAX_SAVED_VIEWS,
  createSavedView,
  deleteSavedView,
  listSavedViews,
  renameSavedView,
  savedViewSettingsKey,
} from "@/lib/savedViews";
import type { SavedView, ViewFilter } from "@/lib/rmsViews";

type Write = { mode: "insert" | "upsert" | "update" | "delete"; table: string; row: DbRow; eqs: Record<string, unknown> };

const FILTER: ViewFilter = { lifecycle: "active", staleDays: 30 };

class FakeQuery implements WatchlistQuery {
  private predicates: ((row: DbRow) => boolean)[] = [];
  private eqs: Record<string, unknown> = {};
  private mode: "read" | "insert" | "upsert" | "update" | "delete" = "read";
  private payload: DbRow[] = [];

  constructor(
    private table: string,
    private rows: DbRow[],
    private writes: Write[],
    private fault: string | null,
  ) {}

  select(): WatchlistQuery { return this; }
  eq(column: string, value: unknown): WatchlistQuery {
    this.eqs[column] = value;
    this.predicates.push((row) => row[column] === value);
    return this;
  }
  in(): WatchlistQuery { return this; }
  order(): WatchlistQuery { return this; }
  limit(): WatchlistQuery { return this; }
  insert(values: DbRow | DbRow[]): WatchlistQuery {
    this.mode = "insert";
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }
  upsert(values: DbRow | DbRow[]): WatchlistQuery {
    this.mode = "upsert";
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }
  update(values: DbRow): WatchlistQuery {
    this.mode = "update";
    this.payload = [values];
    return this;
  }
  delete(): WatchlistQuery {
    this.mode = "delete";
    return this;
  }
  maybeSingle(): Promise<DbResult> {
    return Promise.resolve(this.run()).then((result) => ({
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null,
      error: result.error ?? null,
    }));
  }
  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private matched(): DbRow[] {
    return this.rows.filter((row) => this.predicates.every((p) => p(row)));
  }

  private run(): DbResult {
    if (this.mode !== "read") {
      const rows = this.payload.length ? this.payload : [{}];
      for (const row of rows) {
        this.writes.push({
          mode: this.mode,
          table: this.table,
          row: { ...row },
          eqs: { ...this.eqs },
        });
      }
    }
    if (this.fault === "read" && this.mode === "read") {
      return { data: null, error: { message: "fixture: workspace_settings unavailable" } };
    }
    if (this.fault === "write" && this.mode !== "read") {
      return { data: null, error: { message: "fixture: workspace_settings write failed" } };
    }
    if (this.mode === "insert" || this.mode === "upsert") {
      for (const row of this.payload) this.rows.push({ ...row, id: row.id ?? `row-${this.rows.length}` });
      return { data: this.payload, error: null };
    }
    if (this.mode === "update") {
      const targets = this.matched();
      for (const row of targets) Object.assign(row, this.payload[0] ?? {});
      return { data: targets, error: null };
    }
    if (this.mode === "delete") {
      const targets = new Set(this.matched());
      const kept = this.rows.filter((row) => !targets.has(row));
      this.rows.splice(0, this.rows.length, ...kept);
      return { data: null, error: null };
    }
    return { data: this.matched().map((row) => ({ ...row })), error: null };
  }
}

function makeDb(fault: string | null = null) {
  const rows: DbRow[] = [];
  const writes: Write[] = [];
  const db: WatchlistDb = {
    from: (table: string) => new FakeQuery(table, rows, writes, fault),
  };
  return { db, rows, writes };
}

function assertUserScoped(writes: Write[]) {
  expect(writes.length).toBeGreaterThan(0);
  for (const write of writes) {
    if (write.mode === "insert" || write.mode === "upsert") {
      expect(write.row.scope).toBe("user");
    } else {
      expect(write.eqs.scope).toBe("user");
    }
    expect(Object.prototype.hasOwnProperty.call(write.row, "team_id")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(write.eqs, "team_id")).toBe(false);
  }
}

describe("savedViews CRUD (per-row workspace_settings)", () => {
  let owner: string;

  beforeEach(() => {
    owner = "11111111-1111-4111-8111-111111111111";
  });

  it("creates a view with a client id, stores one row per view, and lists it", async () => {
    const { db, rows, writes } = makeDb();
    const id = "22222222-2222-4222-8222-222222222222";
    const result = await createSavedView(db, owner, { id, name: "  Check on this  ", filter: FILTER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.name).toBe("Check on this");
    expect(result.view.id).toBe(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(savedViewSettingsKey(id));
    expect(rows[0].key).toMatch(/^rms_saved_view\.[0-9a-f]{32}$/);
    expect(rows[0].scope).toBe("user");
    expect(Object.prototype.hasOwnProperty.call(rows[0], "team_id")).toBe(false);
    const listed = await listSavedViews(db, owner);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.views).toHaveLength(1);
    expect(listed.views[0].name).toBe("Check on this");
    assertUserScoped(writes);
  });

  it("renames and deletes atomically by row", async () => {
    const { db, writes } = makeDb();
    const created = await createSavedView(db, owner, { name: "Alpha", filter: FILTER });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const renamed = await renameSavedView(db, owner, created.view.id, "Alpha renamed");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.view.name).toBe("Alpha renamed");
    const deleted = await deleteSavedView(db, owner, created.view.id);
    expect(deleted.ok).toBe(true);
    const listed = await listSavedViews(db, owner);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.views).toEqual([]);
    assertUserScoped(writes);
  });

  it("rejects empty, over-long, and control-character names", async () => {
    const { db, writes } = makeDb();
    expect((await createSavedView(db, owner, { name: "   ", filter: FILTER })).ok).toBe(false);
    expect((await createSavedView(db, owner, { name: "x".repeat(81), filter: FILTER })).ok).toBe(false);
    expect((await createSavedView(db, owner, { name: "bad\u0000name", filter: FILTER })).ok).toBe(false);
    const listed = await listSavedViews(db, owner);
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.views).toEqual([]);
    expect(writes.filter((write) => write.mode !== "read" as never)).toEqual([]);
  });

  it("enforces MAX_SAVED_VIEWS = 50", async () => {
    const { db } = makeDb();
    for (let i = 0; i < MAX_SAVED_VIEWS; i += 1) {
      const result = await createSavedView(db, owner, { name: `View ${i}`, filter: FILTER });
      expect(result.ok).toBe(true);
    }
    const overflow = await createSavedView(db, owner, { name: "One more", filter: FILTER });
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.status).toBe("limit_reached");
  });

  it("every write including error paths uses scope user and never sends team_id", async () => {
    const failing = makeDb("write");
    const created = await createSavedView(failing.db, owner, { name: "Will fail", filter: FILTER });
    expect(created.ok).toBe(false);
    assertUserScoped(failing.writes);

    const ok = makeDb();
    const made = await createSavedView(ok.db, owner, { name: "Keep", filter: FILTER });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const renameFail = makeDb("write");
    // Seed the failing db with the same row shape so rename attempts a write.
    renameFail.rows.push({
      scope: "user",
      user_id: owner,
      key: savedViewSettingsKey(made.view.id),
      value: made.view,
    });
    const renamed = await renameSavedView(renameFail.db, owner, made.view.id, "Nope");
    expect(renamed.ok).toBe(false);
    assertUserScoped(renameFail.writes);

    const deleteFail = makeDb("write");
    deleteFail.rows.push({
      scope: "user",
      user_id: owner,
      key: savedViewSettingsKey(made.view.id),
      value: made.view,
    });
    const deleted = await deleteSavedView(deleteFail.db, owner, made.view.id);
    expect(deleted.ok).toBe(false);
    expect(deleteFail.writes.some((w) => w.mode === "delete")).toBe(true);
    for (const write of deleteFail.writes) {
      expect(write.table).toBe("workspace_settings");
    }
  });
});

// Keep the type import live so a missing SavedView export fails this file at load.
export type _AssertSavedView = SavedView;

// Round-2 review of PR #546 — Opus minors 2 and 3.
describe("savedViews CRUD — round-2 repairs", () => {
  const owner = "11111111-1111-4111-8111-111111111111";

  // minor 2: `deleteSavedView` answered { ok: true } for an id that never existed,
  // so the route's 404 branch was unreachable.
  it("delete of an id with no row answers not_found, not ok", async () => {
    const { db } = makeDb();
    const result = await deleteSavedView(db, owner, "99999999-9999-4999-8999-999999999999");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("not_found");
  });

  it("delete of a row that exists still answers ok", async () => {
    const { db } = makeDb();
    const id = "88888888-8888-4888-8888-888888888888";
    const made = await createSavedView(db, owner, { id, name: "Keep", filter: FILTER });
    expect(made.ok).toBe(true);
    const result = await deleteSavedView(db, owner, id);
    expect(result.ok).toBe(true);
    const after = await listSavedViews(db, owner);
    expect(after.ok && after.views).toHaveLength(0);
  });

  // minor 3: rows past the 50th were silently dropped from the read with no signal,
  // so a user could hold a saved view that is invisible and undeletable.
  it("list reports truncation when more rows exist than the cap shows", async () => {
    const { db, rows } = makeDb();
    for (let i = 0; i < MAX_SAVED_VIEWS + 2; i += 1) {
      const id = `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`;
      const view: SavedView = {
        id,
        name: `View ${i}`,
        filter: FILTER,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: `2026-09-01T00:00:${String(i).padStart(2, "0")}.000Z`,
      };
      rows.push({ scope: "user", user_id: owner, key: savedViewSettingsKey(id), value: view });
    }
    const result = await listSavedViews(db, owner);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.views).toHaveLength(MAX_SAVED_VIEWS);
    expect(result.truncated).toBe(true);
  });

  it("list reports no truncation under the cap", async () => {
    const { db } = makeDb();
    const made = await createSavedView(db, owner, {
      id: "66666666-6666-4666-8666-666666666666",
      name: "One",
      filter: FILTER,
    });
    expect(made.ok).toBe(true);
    const result = await listSavedViews(db, owner);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(false);
  });
});
