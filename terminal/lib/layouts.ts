// ── Saved-layout storage service ────────────────────────────────────────────────────────────────
// The authoritative read/write path for `chart_layouts` (S6: per-user persisted chart workspaces),
// split out of `app/api/layouts/route.ts` so the route is a thin HTTP shell and the rules below are
// unit-testable against a stand-in transport — the same shape `lib/watchlists.ts` uses.
//
// The one law this module exists to enforce: **unavailable is not empty, and a failed mutation is
// not success.** The previous implementation read `data` and dropped `error` on the floor in three
// places, so a Supabase outage rendered as `200 {layouts: []}` ("you have no saved layouts") and a
// failed UPDATE/DELETE rendered as `{ok:true}`. Every function here returns a discriminated result
// and never collapses a transport failure into an empty collection.
//
// ── Name identity and the (user_id, name) invariant ──
// A layout is identified to the user by its NAME: saving over an existing name is an intentional
// overwrite. The route comment has claimed "one named layout per user" since 0001, but the schema
// never enforced it and the write path was a read-then-insert pseudo-upsert — two tabs (or one
// double-click) could both miss the SELECT and both INSERT. `supabase/migrations/
// 0008_chart_layouts_unique_name.sql` adds the real invariant, `unique (user_id, name)`.
//
// That DDL is an operator action (the estate has no DDL credential path — see the migration
// header). Legacy overwrite is a schema-null conditional UPDATE, then insert-only create; a 23505
// on that insert retries the same fenced UPDATE once (a concurrent unversioned create) and never
// upserts over a stored schema. Without the unique index, concurrent creates of a free name can
// still duplicate — this module does not fabricate that guarantee. Exactness is deliberate:
// lookups have always been exact-name, so the constraint is exact-name too. Case-folding would be
// a separate product ruling and would silently merge existing names.

import { canonicalJson } from "./workspaceLayout";

export type LayoutRow = Record<string, unknown>;
export type LayoutDbError = { code?: string; message?: string } | null;
export type LayoutDbResult = { data?: LayoutRow[] | LayoutRow | null; error?: LayoutDbError };

/** Structural view of the Supabase query builder — only the subset this service calls, so the e2e
 *  fixture transport and unit tests can supply a stand-in that satisfies the same shape.
 *
 *  `neq`/`is` were added for the W2-A workspace CAS paths (contract §4/§6): a numbered UPDATE
 *  binds `.eq("config->>revision", String(expected))` AND `.eq("config->>schema", WORKSPACE_SCHEMA)`
 *  plus a supported floor (`.eq("config->requires->>floor", "1")` or `.is(..., null)`; absent means
 *  1) so an older writer cannot consume a future schema or floor. Migrate-on-write matches only an
 *  unversioned legacy row (`.is("config->>schema", null)`), never an explicitly unknown stored
 *  schema. Postgres NULL never satisfies `eq`/`neq`. */
export type LayoutQuery = PromiseLike<LayoutDbResult> & {
  select: (fields?: string) => LayoutQuery;
  eq: (column: string, value: unknown) => LayoutQuery;
  neq: (column: string, value: unknown) => LayoutQuery;
  is: (column: string, value: null | boolean) => LayoutQuery;
  order: (column: string, options?: { ascending?: boolean }) => LayoutQuery;
  insert: (values: LayoutRow) => LayoutQuery;
  update: (values: LayoutRow) => LayoutQuery;
  upsert: (values: LayoutRow, options?: { onConflict?: string }) => LayoutQuery;
  delete: () => LayoutQuery;
  maybeSingle: () => Promise<LayoutDbResult>;
};

export type LayoutDb = { from: (table: string) => LayoutQuery };

export const LAYOUTS_TABLE = "chart_layouts";
// Amendment A2 ruling 14 (reviewer ruling M8): unified with the frozen contract's own name law
// (§5 normalizeLayoutName: trim, collapse whitespace, <=60) — one name law for both the legacy and
// workspace save paths, since both route through this same function.
export const LAYOUT_NAME_MAX = 60;
/** The prefix auto-generated names use. Exported so the client and its tests agree on one string. */
export const AUTO_LAYOUT_PREFIX = "Layout";

/** PostgREST/Postgres codes this module reasons about. */
const CODE_UNIQUE_VIOLATION = "23505";

export type SavedLayout = {
  id: string;
  name: string;
  config: unknown;
  updated_at: string | null;
  userId?: string | null;
  teamId?: string | null;
  visibility?: string | null;
};

export type ListLayoutsResult =
  | { ok: true; layouts: SavedLayout[] }
  | { ok: false; reason: "unavailable" };

export type SaveLayoutResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; reason: "unavailable" | "name_taken" | "invalid_name" };

export type DeleteLayoutResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "not_found" | "forbidden" };

/** "create" refuses to touch an existing name (used by blank-name auto-save, which must never
 *  overwrite an unrelated layout); "overwrite" is the user explicitly typing an existing name. */
export type SaveMode = "create" | "overwrite";

const errOf = (result: LayoutDbResult): LayoutDbError => result?.error ?? null;
const rowsOf = (result: LayoutDbResult): LayoutRow[] =>
  Array.isArray(result?.data) ? result.data : result?.data ? [result.data as LayoutRow] : [];
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Trim + collapse internal whitespace runs to a single space + length-cap a user-supplied layout
 *  name; `null` when it is not a usable name at all. Reviewer ruling M8: unified with the frozen
 *  contract's own §5 name law (the same normalization `workspaceLayout.ts`'s wire-mode validator
 *  expects on export/import) — a name with doubled internal whitespace previously round-tripped
 *  through export/import as two DIFFERENT strings depending on which law inspected it. */
export function normalizeLayoutName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = raw.trim().replace(/\s+/g, " ").slice(0, LAYOUT_NAME_MAX);
  return collapsed ? collapsed : null;
}

/**
 * First UNUSED `Layout N`, scanning upward from 1.
 *
 * The bug this replaces: the shell auto-named a blank save `Layout ${layouts.length + 1}`, and the
 * server treats name as update identity. With Layouts 1/2/3 saved, deleting Layout 2 leaves length
 * 2 -> the next blank save generated "Layout 3" and OVERWROTE the surviving Layout 3. Counting is
 * not naming: the only safe generator is one that inspects the taken names.
 */
export function nextLayoutName(existing: Iterable<unknown>): string {
  const taken = new Set<string>();
  for (const n of existing) { const s = str(n); if (s) taken.add(s); }
  // Guaranteed to terminate: at most `taken.size` candidates can collide, so index size+1 is free.
  for (let i = 1; i <= taken.size + 1; i++) {
    const candidate = `${AUTO_LAYOUT_PREFIX} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  /* c8 ignore next */
  return `${AUTO_LAYOUT_PREFIX} ${taken.size + 1}`;
}

const toSavedLayout = (row: LayoutRow): SavedLayout | null => {
  const id = str(row.id);
  const name = str(row.name);
  if (!id || name === null) return null;
  return {
    id,
    name,
    config: row.config ?? {},
    updated_at: str(row.updated_at),
    userId: str(row.user_id),
    teamId: str(row.team_id),
    visibility: typeof row.visibility === "string" ? row.visibility : null,
  };
};

function isMissingShareColumn(error: LayoutDbError): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const msg = (error.message || "").toLowerCase();
  return msg.includes("visibility") || msg.includes("team_id");
}

function isTeamShared(row: LayoutRow | undefined | null): boolean {
  return !!row && row.visibility === "team" && typeof row.team_id === "string" && row.team_id.length > 0;
}

async function roleForTeam(db: LayoutDb, userId: string, teamId: string): Promise<"owner" | "admin" | "member" | null> {
  const result = await db.from("team_members").select("role").eq("team_id", teamId).eq("user_id", userId).maybeSingle();
  if (errOf(result)) return null;
  const role = rowsOf(result)[0]?.role;
  if (role === "owner" || role === "admin" || role === "member") return role;
  return null;
}

async function refuseSharedIfNotWriter(
  db: LayoutDb,
  userId: string,
  row: LayoutRow | undefined | null,
): Promise<{ ok: false; reason: "forbidden" | "unavailable" } | null> {
  if (!isTeamShared(row)) return null;
  const role = await roleForTeam(db, userId, String(row!.team_id));
  if (role === "owner" || role === "admin") return null;
  return { ok: false, reason: "forbidden" };
}

function storeWriteReason(error: LayoutDbError | null): WorkspaceFailureReason {
  if (error?.code === "42501") return "forbidden";
  if (error?.code === CODE_UNIQUE_VIOLATION) return "name_conflict";
  return "unavailable";
}

/** Owner-scoped UPDATE first; if that matches nothing and the caller named a row id, a second
 *  UPDATE scoped to `visibility = 'team'` lets an owner/admin overwrite a shared workspace they
 *  did not create. A SELECT-before-write would poison the numbered-revision path when a `list`
 *  fault is injected (W2-A unavailable e2e: the fenced UPDATE must still land, and only the
 *  trailing library refresh is allowed to fail). RLS/fixture 42501 maps to `forbidden`. */
async function applyWorkspaceUpdate(
  db: LayoutDb,
  userId: string,
  values: LayoutRow,
  workspaceName: string,
  expectedId: string | undefined,
  extra: (query: LayoutQuery) => LayoutQuery,
): Promise<LayoutDbResult> {
  const run = (teamShared: boolean) => {
    let query = db.from(LAYOUTS_TABLE).update(values);
    query = teamShared ? query.eq("visibility", "team") : query.eq("user_id", userId);
    query = extra(query.eq("name", workspaceName));
    if (expectedId) query = query.eq("id", expectedId);
    return query.select("id");
  };
  const ownerWrite = await run(false);
  if (errOf(ownerWrite) || rowsOf(ownerWrite).length || !expectedId) return ownerWrite;
  return run(true);
}

/** Owner-scoped read. A transport error is `unavailable` — never an empty library. */
export async function listLayouts(db: LayoutDb, userId: string): Promise<ListLayoutsResult> {
  let result = await db
    .from(LAYOUTS_TABLE)
    .select("id,name,config,updated_at,user_id,team_id,visibility")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (errOf(result) && isMissingShareColumn(errOf(result))) {
    // DDL 0022 is shipped unapplied: a missing-column error must not 503 every personal library.
    result = await db
      .from(LAYOUTS_TABLE)
      .select("id,name,config,updated_at,user_id")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
  }
  if (errOf(result)) return { ok: false, reason: "unavailable" };
  const layouts = rowsOf(result).map(toSavedLayout).filter((l): l is SavedLayout => l !== null);
  return { ok: true, layouts };
}

/** Insert-only write. Used by blank-name auto-save so a stale client list can never overwrite. */
async function createLayout(db: LayoutDb, userId: string, name: string, config: unknown): Promise<SaveLayoutResult> {
  // Best-effort pre-check. With the unique index applied this is belt-and-braces (the INSERT's
  // 23505 is what actually closes the race); without it, this is the only guard there is.
  const existing = await db.from(LAYOUTS_TABLE).select("id").eq("user_id", userId).eq("name", name).maybeSingle();
  if (errOf(existing)) return { ok: false, reason: "unavailable" };
  if (rowsOf(existing).length) return { ok: false, reason: "name_taken" };

  const inserted = await db
    .from(LAYOUTS_TABLE)
    .insert({ user_id: userId, name, config, updated_at: new Date().toISOString() })
    .select("id");
  const error = errOf(inserted);
  if (error) return { ok: false, reason: error.code === CODE_UNIQUE_VIOLATION ? "name_taken" : "unavailable" };
  const id = str(rowsOf(inserted)[0]?.id);
  return id ? { ok: true, id, created: true } : { ok: false, reason: "unavailable" };
}

/** Overwrite only an unversioned (schema-null) row. Never upsert over a stored schema. A 23505 on
 *  the follow-up INSERT retries this same fenced UPDATE once — a concurrent unversioned create —
 *  and never retries unconditionally. A versioned occupant (0-row retry) is `unavailable`. */
async function overwriteUnversioned(db: LayoutDb, userId: string, name: string, config: unknown): Promise<SaveLayoutResult> {
  const stamp = () => ({ config, updated_at: new Date().toISOString() });
  const fencedUpdate = () =>
    db.from(LAYOUTS_TABLE).update(stamp()).eq("user_id", userId).eq("name", name).is("config->>schema", null).select("id");

  const updated = await fencedUpdate();
  if (errOf(updated)) return { ok: false, reason: "unavailable" };
  const updatedId = str(rowsOf(updated)[0]?.id);
  if (updatedId) return { ok: true, id: updatedId, created: false };

  // Keep the best-effort name read before an insert while migration 0008 is
  // unapplied. A present versioned row must never gain a duplicate legacy row.
  // The database unique index remains the authority for a concurrent first create.
  const created = await createLayout(db, userId, name, config);
  if (created.ok) return { ...created, created: false };
  if (created.reason !== "name_taken") return created;

  const retried = await fencedUpdate();
  if (errOf(retried)) return { ok: false, reason: "unavailable" };
  const retryId = str(rowsOf(retried)[0]?.id);
  return retryId ? { ok: true, id: retryId, created: false } : { ok: false, reason: "unavailable" };
}

/**
 * Authoritative save. `overwrite` mode is a schema-null conditional UPDATE then insert-only create;
 * `create` mode refuses an existing name outright.
 */
// Legacy overwrite is NOT extended onto versioned rows. It never sets visibility or team_id, so
// every legacy write lands private by the column default (or stays owner-only while 0022 is unapplied).
export async function saveLayout(
  db: LayoutDb,
  userId: string,
  input: { name: unknown; config: unknown; mode?: SaveMode },
): Promise<SaveLayoutResult> {
  const name = normalizeLayoutName(input.name);
  if (!name) return { ok: false, reason: "invalid_name" };
  const config = input.config ?? {};
  if (input.mode === "create") return createLayout(db, userId, name, config);
  return overwriteUnversioned(db, userId, name, config);
}

/**
 * Owner-scoped delete. Returns `not_found` when the statement matched no row, so the client can
 * tell "already gone" from "the store refused" instead of optimistically dropping it either way.
 */
export async function deleteLayout(db: LayoutDb, userId: string, id: unknown): Promise<DeleteLayoutResult> {
  const layoutId = str(id);
  if (!layoutId) return { ok: false, reason: "not_found" };
  const deleted = await db.from(LAYOUTS_TABLE).delete().eq("user_id", userId).eq("id", layoutId).select("id");
  if (errOf(deleted)) {
    if (errOf(deleted)?.code === "42501") return { ok: false, reason: "forbidden" };
    return { ok: false, reason: "unavailable" };
  }
  if (rowsOf(deleted).length) return { ok: true };
  const existing = await db.from(LAYOUTS_TABLE).select("id,user_id,visibility,team_id").eq("id", layoutId).maybeSingle();
  if (errOf(existing)) return { ok: false, reason: "unavailable" };
  const row = rowsOf(existing)[0];
  if (!row) return { ok: false, reason: "not_found" };
  const refused = await refuseSharedIfNotWriter(db, userId, row);
  if (refused) return refused;
  if (!isTeamShared(row)) return { ok: false, reason: "not_found" };
  const teamDeleted = await db.from(LAYOUTS_TABLE).delete().eq("id", layoutId).select("id");
  if (errOf(teamDeleted)) {
    if (errOf(teamDeleted)?.code === "42501") return { ok: false, reason: "forbidden" };
    return { ok: false, reason: "unavailable" };
  }
  return rowsOf(teamDeleted).length ? { ok: true } : { ok: false, reason: "forbidden" };
}

// ── W2-A workspace evolution ─────────────────────────────────────────────────────────────────────
// Frozen contract: research/DEEPVUE_W2A_WORKSPACE_LAYOUT_CONTRACT_2026-08-26.md (Macro repo) §4/§5/
// §6. `chart_layouts` stays the ONE canonical named-workspace store (archaeology §0.3) — no second
// table, no DDL, no blind upsert of a `workspace_layout.v1` payload. Every write below is a single
// atomic conditional statement; "0 rows changed" is always resolved by a NAMED follow-up read, never
// guessed. `envelope`/`name` are validated by the CALLER (`workspaceLayout.validateEnvelope` — the
// route boundary, contract §11 "the client is not trusted") before any function here is invoked;
// these functions persist an already-validated payload and reason only about the store's response.

const WORKSPACE_SCHEMA = "workspace_layout.v1";

const isRecordLike = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export type WorkspaceFailureReason = "unavailable" | "invalid_name" | "name_conflict" | "stale_revision" | "not_found" | "forbidden";

export type SaveWorkspaceResult =
  | { ok: true; id: string; revision: number }
  | { ok: false; reason: WorkspaceFailureReason };

export type RenameWorkspaceResult =
  | { ok: true; revision: number }
  | { ok: false; reason: WorkspaceFailureReason };

export type DuplicateWorkspaceResult =
  | { ok: true; id: string; name: string }
  | { ok: false; reason: WorkspaceFailureReason };

/**
 * Save a `workspace_layout.v1` envelope under `name` for `userId`.
 *
 * `expectedRevision === null` covers BOTH real cases where the caller has no revision to fence on:
 * a brand-new name (CREATE — insert-only, fenced by the existing `(user_id, name)` unique index)
 * and the FIRST workspace-format write over a row that still holds an unversioned legacy payload
 * (migrate-on-write, contract §6 — fenced by `config->>schema` IS NULL, so an explicitly unknown
 * stored schema is never treated as convertible). If that guard touches zero rows, a follow-up read
 * tells CREATE (no row at all) apart from a stale attempt (a concurrent writer already produced a
 * versioned row under this name).
 *
 * `expectedRevision` as a number is the ordinary save-over path: atomic conditional UPDATE gated on
 * revision AND stored `workspace_layout.v1` AND supported `requires.floor` (1, or omitted meaning
 * 1). No pre-read: writes must still land when list reads fail. Zero rows updated is resolved by a
 * follow-up read (contract §4, amended by A3 rulings 4/5 below).
 *
 * `expectedId`, when supplied, is the uuid of the row the caller believes it is targeting (loaded
 * via an earlier read) — Amendment A3 ruling 5 (completing A2 ruling 9's ABA fence): the id
 * predicate is added to the conversion attempt and both numbered floor attempts, so a
 * delete-recreate of the same name under a NEW row can never be silently matched by a stale
 * caller's write. A pure CREATE (brand-new name, nothing loaded) has no id to supply.
 */
export async function saveWorkspace(
  db: LayoutDb,
  userId: string,
  name: unknown,
  envelope: Record<string, unknown>,
  expectedRevision: number | null,
  expectedId?: string,
): Promise<SaveWorkspaceResult> {
  const workspaceName = normalizeLayoutName(name);
  if (!workspaceName) return { ok: false, reason: "invalid_name" };
  const nowIso = () => new Date().toISOString();

  if (typeof expectedRevision === "number") {
    const nextRevision = expectedRevision + 1;
    const payload = { ...envelope, name: null, revision: nextRevision };
    const values = { config: payload, updated_at: nowIso() };
    const bindNumbered = (query: LayoutQuery) =>
      query.eq("config->>revision", String(expectedRevision)).eq("config->>schema", WORKSPACE_SCHEMA);
    // Disjoint floor attempts: stored 1 vs omitted (NULL means 1). Never pre-read.
    const withFloor = await applyWorkspaceUpdate(
      db, userId, values, workspaceName, expectedId,
      (query) => bindNumbered(query).eq("config->requires->>floor", "1"),
    );
    if (errOf(withFloor)) return { ok: false, reason: storeWriteReason(errOf(withFloor)) };
    if (rowsOf(withFloor).length) {
      const id = str(rowsOf(withFloor)[0]?.id);
      return id ? { ok: true, id, revision: nextRevision } : { ok: false, reason: "unavailable" };
    }
    const withOmittedFloor = await applyWorkspaceUpdate(
      db, userId, values, workspaceName, expectedId,
      (query) => bindNumbered(query).is("config->requires->>floor", null),
    );
    if (errOf(withOmittedFloor)) return { ok: false, reason: storeWriteReason(errOf(withOmittedFloor)) };
    if (rowsOf(withOmittedFloor).length) {
      const id = str(rowsOf(withOmittedFloor)[0]?.id);
      return id ? { ok: true, id, revision: nextRevision } : { ok: false, reason: "unavailable" };
    }
    return resolveZeroRowUpdate(db, userId, workspaceName, payload, nextRevision, expectedId);
  }

  const payload = { ...envelope, name: null, revision: 1 };

  // Migrate-on-write: only an unversioned legacy row (`config->>schema` IS NULL). An explicit
  // unknown schema (including a future identifier) must not convert. A3 ruling 5: id fence applies.
  const attempt1 = await applyWorkspaceUpdate(
    db, userId, { config: payload, updated_at: nowIso() }, workspaceName, expectedId,
    (query) => query.is("config->>schema", null),
  );
  if (errOf(attempt1)) return { ok: false, reason: storeWriteReason(errOf(attempt1)) };
  if (rowsOf(attempt1).length) {
    const id = str(rowsOf(attempt1)[0]?.id);
    return id ? { ok: true, id, revision: 1 } : { ok: false, reason: "unavailable" };
  }

  // Guarded update touched no row. Resolve via the shared retry/ABA-aware read; a genuine
  // CREATE (no expectedId, nothing there at all) falls through to a plain INSERT.
  const resolved = await resolveZeroRowUpdate(db, userId, workspaceName, payload, 1, expectedId);
  if (resolved.ok) return resolved;
  if (resolved.reason === "not_found" && !expectedId) {
    const inserted = await db
      .from(LAYOUTS_TABLE)
      .insert({ user_id: userId, name: workspaceName, config: payload, updated_at: nowIso() })
      .select("id");
    const error = errOf(inserted);
    if (error) return { ok: false, reason: storeWriteReason(error) };
    const id = str(rowsOf(inserted)[0]?.id);
    return id ? { ok: true, id, revision: 1 } : { ok: false, reason: "unavailable" };
  }
  return resolved;
}

/**
 * Shared "0 rows updated" resolver for a conditional-UPDATE CAS path (contract §4, Amendment A3
 * rulings 4/5 — M9 retry idempotency + the ABA fence's follow-up-read half):
 *
 * - **M9 (retry idempotency):** a retried HTTP call whose FIRST attempt actually landed server-side
 *   sees 0 rows on the retry (the WHERE clause consumed the prior revision) — read the row and, if
 *   its revision already equals `targetRevision` AND its canonical content equals exactly what THIS
 *   call attempted to write, the write already succeeded: report success, never `stale_revision`.
 * - **A3 ruling 4:** the follow-up read is by the loaded row's stable `id` when one was supplied,
 *   NEVER by `(user_id, name)` alone — a concurrent RENAME of the same physical row would make a
 *   name-keyed read miss it entirely and misreport `not_found` instead of the true `stale_revision`.
 * - **ABA (ruling 5, ruling 9 completed):** if the id-keyed read finds nothing, a SEPARATE name-only
 *   read distinguishes "genuinely gone" (`not_found`) from "a delete-recreate put a DIFFERENT row
 *   under this name" (`stale_revision`, never silently treated as if nothing were there).
 */
async function resolveZeroRowUpdate(
  db: LayoutDb, userId: string, name: string,
  attemptedPayload: Record<string, unknown>, targetRevision: number,
  expectedId: string | undefined,
): Promise<{ ok: true; id: string; revision: number } | { ok: false; reason: WorkspaceFailureReason }> {
  const retryEchoOrConflict = (row: LayoutRow): { ok: true; id: string; revision: number } | { ok: false; reason: WorkspaceFailureReason } => {
    const id = str(row.id);
    const config = row.config;
    if (
      row.name === name &&
      isRecordLike(config) &&
      config.revision === targetRevision &&
      canonicalJson(config) === canonicalJson(attemptedPayload)
    ) {
      return id ? { ok: true, id, revision: targetRevision } : { ok: false, reason: "unavailable" };
    }
    return { ok: false, reason: "stale_revision" };
  };

  if (expectedId) {
    const byId = await db.from(LAYOUTS_TABLE).select("id,name,config,visibility,team_id,user_id").eq("id", expectedId).maybeSingle();
    if (errOf(byId)) return { ok: false, reason: "unavailable" };
    const row = rowsOf(byId)[0];
    if (row && !( !isTeamShared(row) && str(row.user_id) && str(row.user_id) !== userId )) {
      const refused = await refuseSharedIfNotWriter(db, userId, row);
      if (refused) return refused;
      return retryEchoOrConflict(row);
    }
    // The loaded row is gone by id — distinguish "nothing there" from "something else has this
    // name now" (delete-recreate ABA) via a name-only read.
    const byName = await db.from(LAYOUTS_TABLE).select("id").eq("user_id", userId).eq("name", name).maybeSingle();
    if (errOf(byName)) return { ok: false, reason: "unavailable" };
    // Reviewer ruling N10 (hostile review of head 37251687): flagged this `not_found`, adjudicated
    // ACCEPTED-AS-IS — the name-only read found nothing either, so the row is not merely stale (a
    // rename/ABA case) but genuinely gone. This matches the blessed A3 ruling 5 replay exactly:
    // an id-scoped follow-up read that misses AND whose name-only fallback also misses reports
    // `not_found`, never `stale_revision` (there is nothing to be stale relative to). No behavior
    // change was made for N10 — comment only.
    return { ok: false, reason: rowsOf(byName).length ? "stale_revision" : "not_found" };
  }

  const existing = await db.from(LAYOUTS_TABLE).select("id,name,config,visibility,team_id,user_id").eq("user_id", userId).eq("name", name).maybeSingle();
  if (errOf(existing)) return { ok: false, reason: "unavailable" };
  const row = rowsOf(existing)[0];
  if (!row) return { ok: false, reason: "not_found" };
  const refused = await refuseSharedIfNotWriter(db, userId, row);
  if (refused) return refused;
  return retryEchoOrConflict(row);
}

/**
 * Rename = one atomic conditional UPDATE setting `name` AND bumping `revision`, still fenced by
 * `expectedRevision` (contract §5). The row's full config is read first so the rest of the payload
 * (widgets, link_groups, migration) rides along unchanged — only `name`/`revision` are touched —
 * but the ACTUAL mutation is gated by the same `config->>'revision' = expected` WHERE clause as
 * `saveWorkspace`, so a revision that moved between the read and the write is caught, not trusted.
 * A unique-index violation on the new name — including one that lands DURING this call, since the
 * UPDATE statement itself is what the database checks — answers `name_conflict`.
 *
 * `expectedId` (A3 ruling 5 / M10): both the initial read and the UPDATE are scoped by the loaded
 * row's id when supplied, so a delete-recreate under the old name is never silently renamed.
 */
export async function renameWorkspace(
  db: LayoutDb,
  userId: string,
  oldName: unknown,
  newName: unknown,
  expectedRevision: number,
  expectedId?: string,
): Promise<RenameWorkspaceResult> {
  const from = normalizeLayoutName(oldName);
  const to = normalizeLayoutName(newName);
  if (!from || !to) return { ok: false, reason: "invalid_name" };

  let initialQuery = db.from(LAYOUTS_TABLE).select("id,config,visibility,team_id,user_id");
  initialQuery = expectedId ? initialQuery.eq("id", expectedId) : initialQuery.eq("user_id", userId).eq("name", from);
  const current = await initialQuery.maybeSingle();
  if (errOf(current)) return { ok: false, reason: "unavailable" };
  const row = rowsOf(current)[0];
  if (row && !isTeamShared(row) && str(row.user_id) && str(row.user_id) !== userId) return { ok: false, reason: "not_found" };
  if (!row) {
    if (!expectedId) return { ok: false, reason: "not_found" };
    // ABA: the loaded row is gone by id — does the OLD name now resolve to a DIFFERENT row
    // (delete-recreate) rather than genuinely nothing?
    const byName = await db.from(LAYOUTS_TABLE).select("id").eq("user_id", userId).eq("name", from).maybeSingle();
    if (errOf(byName)) return { ok: false, reason: "unavailable" };
    // Reviewer ruling N10: this `not_found` (both the id read and the name-only fallback miss) is
    // the correct A3 ruling 5 outcome, not a bug — see `resolveZeroRowUpdate`'s fuller comment above.
    return { ok: false, reason: rowsOf(byName).length ? "stale_revision" : "not_found" };
  }
  const rowId = str(row.id);
  if (!rowId) return { ok: false, reason: "unavailable" };
  const refused = await refuseSharedIfNotWriter(db, userId, row);
  if (refused) return refused;

  const nextRevision = expectedRevision + 1;
  const config: Record<string, unknown> = isRecordLike(row.config) ? { ...row.config } : {};
  config.name = null;
  config.revision = nextRevision;

  let updatedQuery = db
    .from(LAYOUTS_TABLE)
    .update({ name: to, config, updated_at: new Date().toISOString() })
    .eq("id", rowId)
    .eq("name", from)
    .eq("config->>revision", String(expectedRevision));
  if (!isTeamShared(row)) updatedQuery = updatedQuery.eq("user_id", userId);
  const updated = await updatedQuery.select("id");
  const error = errOf(updated);
  if (error) return { ok: false, reason: storeWriteReason(error) };
  if (rowsOf(updated).length) return { ok: true, revision: nextRevision };

  // 0 rows: retry-echo (our own earlier attempt already renamed it) vs a genuine conflict,
  // resolved by the STABLE row id (A3 ruling 4) rather than either name. Reviewer ruling N11:
  // tightened to a full canonical CONTENT match (like saveWorkspace's resolveZeroRowUpdate), not
  // just name+revision — two different renames landing on the same target name and revision number
  // (e.g. two devices racing DIFFERENT new names that happen to collide, or unrelated config drift)
  // must not be conflated into a false "success" echo.
  let diagQuery = db.from(LAYOUTS_TABLE).select("id,name,config").eq("id", rowId);
  if (!isTeamShared(row)) diagQuery = diagQuery.eq("user_id", userId);
  const diag = await diagQuery.maybeSingle();
  if (errOf(diag)) return { ok: false, reason: "unavailable" };
  const diagRow = rowsOf(diag)[0];
  if (!diagRow) return { ok: false, reason: "not_found" }; // deleted entirely between read and write
  if (
    diagRow.name === to &&
    isRecordLike(diagRow.config) &&
    diagRow.config.revision === nextRevision &&
    canonicalJson(diagRow.config) === canonicalJson(config)
  ) {
    return { ok: true, revision: nextRevision };
  }
  return { ok: false, reason: "stale_revision" };
}

/**
 * Duplicate = read source -> INSERT a new row (new uuid, new name; `revision` reset to 1, migration
 * provenance carried over verbatim — contract §5). A name-conflict on the INSERT (an explicit
 * caller-supplied `newName` that collides) answers `name_conflict`; when `newName` is omitted the
 * free name comes from the existing collision-free `nextLayoutName` generator, so that path cannot
 * conflict under normal operation. Independence is structural: the new row is a separate INSERT, so
 * any later edit to the source cannot reach it.
 *
 * `sourceId` (A3 ruling 5 / M10 "duplicate-source reads"): when supplied, the source read is scoped
 * by the loaded row's id — a delete-recreate under the same name between listing and the duplicate
 * click answers `stale_revision` (the object moved), never a silent duplicate of the WRONG row.
 */
export async function duplicateWorkspace(
  db: LayoutDb,
  userId: string,
  sourceName: unknown,
  newName?: unknown,
  sourceId?: string,
): Promise<DuplicateWorkspaceResult> {
  const from = normalizeLayoutName(sourceName);
  if (!from) return { ok: false, reason: "invalid_name" };

  let sourceQuery = db.from(LAYOUTS_TABLE).select("id,name,config,user_id,visibility,team_id");
  sourceQuery = sourceId ? sourceQuery.eq("id", sourceId) : sourceQuery.eq("user_id", userId).eq("name", from);
  const current = await sourceQuery.maybeSingle();
  if (errOf(current)) return { ok: false, reason: "unavailable" };
  const row = rowsOf(current)[0];
  if (!row) {
    if (!sourceId) return { ok: false, reason: "not_found" };
    const byName = await db.from(LAYOUTS_TABLE).select("id").eq("user_id", userId).eq("name", from).maybeSingle();
    if (errOf(byName)) return { ok: false, reason: "unavailable" };
    // Reviewer ruling N10: this `not_found` (both the id read and the name-only fallback miss) is
    // the correct A3 ruling 5 outcome, not a bug — see `resolveZeroRowUpdate`'s fuller comment
    // (this file, saveWorkspace's shared CAS resolver).
    return { ok: false, reason: rowsOf(byName).length ? "stale_revision" : "not_found" };
  }
  if (row.name !== from) return { ok: false, reason: "stale_revision" }; // moved out from under the id we loaded
  if (!isTeamShared(row) && str(row.user_id) && str(row.user_id) !== userId) return { ok: false, reason: "not_found" };

  let target = normalizeLayoutName(newName);
  if (!target) {
    const listed = await listLayouts(db, userId);
    if (!listed.ok) return { ok: false, reason: "unavailable" };
    target = nextLayoutName(listed.layouts.map((l) => l.name));
  }

  // Reviewer ruling N9: the name/revision stamp is a WORKSPACE-envelope concept (contract §5) — a
  // legacy (non-`workspace_layout.v1`) source row has neither field in its own contract, and
  // stamping them in unconditionally would inject foreign keys into otherwise-pristine legacy
  // bytes. Only a genuine workspace envelope gets its identity reset for the new row.
  const config: Record<string, unknown> = isRecordLike(row.config) ? { ...row.config } : {};
  if (config.schema === WORKSPACE_SCHEMA) {
    config.name = null;
    config.revision = 1;
  }

  let inserted = await db
    .from(LAYOUTS_TABLE)
    .insert({ user_id: userId, name: target, config, updated_at: new Date().toISOString(), visibility: "private", team_id: null })
    .select("id");
  if (errOf(inserted) && isMissingShareColumn(errOf(inserted))) {
    inserted = await db
      .from(LAYOUTS_TABLE)
      .insert({ user_id: userId, name: target, config, updated_at: new Date().toISOString() })
      .select("id");
  }
  const error = errOf(inserted);
  if (error) return { ok: false, reason: error.code === CODE_UNIQUE_VIOLATION ? "name_conflict" : "unavailable" };
  const id = str(rowsOf(inserted)[0]?.id);
  return id ? { ok: true, id, name: target } : { ok: false, reason: "unavailable" };
}
