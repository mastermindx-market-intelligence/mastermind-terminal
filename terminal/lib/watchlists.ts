// Canonical registered-watchlist service (W1b).
//
// Before this module the only server-side watchlist path in the product was
// `POST /api/watchlist`, which resolved `.limit(1).single()` — the user's FIRST list — and
// accepted exactly one symbol per `add`. Named lists existed in the schema (`watchlists` has a
// unique `(user_id,name)`) but had NO create/rename/delete path anywhere in either product, so
// every list a Terminal user made lived and died in `mm.wls` localStorage.
//
// Everything a registered user's lists need now lives here: list CRUD, symbol ops targeted by
// list id, and a batched add. The module is deliberately I/O-thin and takes the Supabase client
// as a parameter (the same RLS'd server client `app/api/watchlist/route.ts` already builds via
// `@/lib/supabase/server`), so the planning logic stays pure and unit-testable.
//
// OWNER SCOPING: RLS is the authority — `watchlists_owner` (user_id = auth.uid()) and
// `wls_via_parent` (symbol rows reachable only through an owned list), both in
// `supabase/migrations/0001_init.sql`. Every list query here ALSO carries an explicit
// `.eq("user_id", userId)`, and every symbol op resolves its list through `getOwnedList` first.
// That belt-and-braces matches macro `watchstore.js`'s double `user_id` filter: a policy
// regression must not silently become a cross-tenant read.

/** A row as it comes back over PostgREST: keys are known, value types are not, so every read
 *  below narrows explicitly rather than trusting the wire. */
export type DbRow = Record<string, unknown>;
export type DbResult = { data?: DbRow[] | DbRow | null; error?: { message?: string } | null };

/** Structural view of the Supabase query builder — the subset this service actually calls. Keeps
 *  the module free of the SDK's generics and lets both the e2e fixture transport and unit tests
 *  supply a stand-in that satisfies the same shape. */
export type WatchlistQuery = PromiseLike<DbResult> & {
  select: (fields?: string) => WatchlistQuery;
  eq: (column: string, value: unknown) => WatchlistQuery;
  in: (column: string, values: readonly unknown[]) => WatchlistQuery;
  order: (column: string, options?: { ascending?: boolean }) => WatchlistQuery;
  limit: (count: number) => WatchlistQuery;
  insert: (values: DbRow | DbRow[]) => WatchlistQuery;
  upsert: (values: DbRow | DbRow[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) => WatchlistQuery;
  update: (values: DbRow) => WatchlistQuery;
  delete: () => WatchlistQuery;
  maybeSingle: () => Promise<DbResult>;
};

export type WatchlistDb = { from: (table: string) => WatchlistQuery };

const rows = (result: DbResult): DbRow[] => (Array.isArray(result?.data) ? result.data : []);
const one = (result: DbResult): DbRow | null => {
  const data = result?.data;
  if (Array.isArray(data)) return data[0] ?? null;
  return data && typeof data === "object" ? data : null;
};
const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const num = (value: unknown, fallback: number): number =>
  (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export type WatchlistSymbol = { symbol: string; section: string; position: number };
export type ServerWatchlist = { id: string; name: string; position: number; symbols: WatchlistSymbol[] };

/** A local (`mm.wls`) list as the shell holds it. */
export type LocalWatchlist = { name: string; rows: { symbol: string; section: string }[] };

export const MAX_BATCH = 500;
export const MAX_SYMBOL_LEN = 128;
export const MAX_NAME_LEN = 80;
export const DEFAULT_SECTION = "Watchlist";
/** The one list TRAP-1 owns: `/terminal/page.tsx` seeds it, TerminalShell reconciles it against
 *  the `symbols` prop on mount. The migration never touches it. */
export const DEFAULT_LIST = "Default";

// Same guard the pre-W1b route carried: reject C0 control characters and DEL in any
// user-supplied label or symbol.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Normalize, upper-case and de-duplicate a symbol batch. Returns [] when the batch is empty or
 *  larger than MAX_BATCH so a caller can refuse it whole rather than partially mutating. */
export function normalizeSymbols(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const symbols = [...new Set(raw
    .filter((symbol): symbol is string => typeof symbol === "string")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => !!symbol && symbol.length <= MAX_SYMBOL_LEN && !CONTROL_CHARS.test(symbol)))];
  return symbols.length <= MAX_BATCH ? symbols : [];
}

/**
 * Section label. `null` means UNUSABLE (too long, control characters); `""` is a legitimate
 * value — master #409 ("Make watchlist sections fluid") made the empty string mean "the
 * unsectioned run before the first divider", so callers must test `=== null`, never truthiness.
 * A MISSING section still falls back to `DEFAULT_SECTION`, which keeps the legacy add contract.
 */
export function normalizeSection(value: unknown, fallback: string = DEFAULT_SECTION): string | null {
  const section = typeof value === "string" ? value.trim() : fallback;
  if (section.length > MAX_NAME_LEN || CONTROL_CHARS.test(section)) return null;
  return section;
}

/** List name; `null` means unusable. Comparison is EXACT everywhere — the schema's unique
 *  `(user_id,name)` is case-sensitive, so "AI" and "ai" are two different lists and no fuzzy
 *  matching may be introduced (packet section 4 collision rules). */
export function normalizeListName(value: unknown): string | null {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > MAX_NAME_LEN || CONTROL_CHARS.test(name)) return null;
  return name;
}

// ───────────────────────────── reads ─────────────────────────────

/** Full owner-scoped inventory: every list with its symbols, both ordered by `position`. */
export async function listWatchlists(db: WatchlistDb, userId: string): Promise<ServerWatchlist[]> {
  const listResult = await db.from("watchlists")
    .select("id,name,position").eq("user_id", userId).order("position");
  const lists: ServerWatchlist[] = [];
  for (const [index, row] of rows(listResult).entries()) {
    const id = text(row.id);
    const name = text(row.name);
    if (!id || !name) continue;
    lists.push({ id, name, position: num(row.position, index), symbols: [] });
  }
  if (!lists.length) return lists;

  const byId = new Map(lists.map((list) => [list.id, list]));
  const symbolResult = await db.from("watchlist_symbols")
    .select("watchlist_id,symbol,section,position")
    .in("watchlist_id", [...byId.keys()])
    .order("position");
  for (const row of rows(symbolResult)) {
    const listId = text(row.watchlist_id);
    const list = listId ? byId.get(listId) : undefined;
    const symbol = text(row.symbol);
    if (!list || !symbol || list.symbols.some((existing) => existing.symbol === symbol)) continue;
    list.symbols.push({
      symbol,
      // `null` column = pre-#409 row with no section -> the legacy label. `""` = #409's
      // deliberate unsectioned run -> preserved verbatim, never coerced back to "Watchlist".
      section: typeof row.section === "string" ? row.section.trim() : DEFAULT_SECTION,
      position: num(row.position, list.symbols.length),
    });
  }
  return lists;
}

/** Resolve one owned list. `null` when it does not exist or is not this user's. */
export async function getOwnedList(
  db: WatchlistDb,
  userId: string,
  listId: string,
): Promise<{ id: string; name: string } | null> {
  const row = one(await db.from("watchlists")
    .select("id,name").eq("user_id", userId).eq("id", listId).maybeSingle());
  const id = row ? text(row.id) : null;
  return id ? { id, name: text(row?.name) ?? "" } : null;
}

/** Resolve by exact name (the migration's merge key). */
export async function getOwnedListByName(
  db: WatchlistDb,
  userId: string,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const row = one(await db.from("watchlists")
    .select("id,name").eq("user_id", userId).eq("name", name).maybeSingle());
  const id = row ? text(row.id) : null;
  return id ? { id, name: text(row?.name) ?? name } : null;
}

/** Did the caller name a target list at all? Distinguishes "no target supplied" (the legacy
 *  pre-W1b shape) from "target supplied but unusable" — which must NEVER degrade into the first
 *  list. Presence is the test, not usability: `JSON.parse` never yields `undefined` for a key that
 *  was sent, so an explicit `null` counts as SUPPLIED and resolves to no list rather than to
 *  Default. Nothing legitimately sends `null` here; a client bug that did would otherwise write to
 *  somebody's Default and report success. */
export function hasListTarget(input: { listId?: unknown; listName?: unknown }): boolean {
  return input.listId !== undefined || input.listName !== undefined;
}

/**
 * The list a request targets: explicit id, else exact name, else — ONLY when the caller supplied
 * neither, the pre-W1b call shape — the first list by position.
 *
 * A SUPPLIED-BUT-UNUSABLE target resolves to `null`, never to the first list. Falling back there
 * would silently reinstate exactly the first-list soloism this wave retires: a caller that meant
 * "Gold Miners" and fat-fingered the name would write to Default instead, and the write would
 * report success. The bare-fallback branch is reachable only when no target key was sent at all.
 */
export async function resolveTargetList(
  db: WatchlistDb,
  userId: string,
  input: { listId?: unknown; listName?: unknown },
): Promise<{ id: string; name: string } | null> {
  if (input.listId !== undefined) {
    const listId = typeof input.listId === "string" ? input.listId.trim() : "";
    return listId ? getOwnedList(db, userId, listId) : null;
  }
  if (input.listName !== undefined) {
    const name = normalizeListName(input.listName);
    return name ? getOwnedListByName(db, userId, name) : null;
  }
  const row = one(await db.from("watchlists")
    .select("id,name").eq("user_id", userId).order("position").limit(1).maybeSingle());
  const id = row ? text(row.id) : null;
  return id ? { id, name: text(row?.name) ?? "" } : null;
}

// ───────────────────────────── list CRUD ─────────────────────────────

/**
 * Create a list, or return the existing one with that exact name. Idempotent by construction —
 * `(user_id,name)` is unique, so a concurrent creator (or a re-run migration) converges instead
 * of erroring. New lists land at max(position)+1 so ordering is stable and append-only.
 */
export async function createList(
  db: WatchlistDb,
  userId: string,
  rawName: string,
): Promise<{ list: { id: string; name: string } | null; created: boolean; error?: string }> {
  const name = normalizeListName(rawName);
  if (!name) return { list: null, created: false, error: "invalid name" };

  const existing = await getOwnedListByName(db, userId, name);
  if (existing) return { list: existing, created: false };

  const tail = one(await db.from("watchlists")
    .select("position").eq("user_id", userId).order("position", { ascending: false }).limit(1).maybeSingle());
  const nextPosition = num(tail?.position, -1) + 1;

  const inserted = await db.from("watchlists")
    .insert({ user_id: userId, name, position: nextPosition })
    .select("id,name").maybeSingle();
  const created = one(inserted);
  const createdId = created ? text(created.id) : null;
  if (inserted.error || !createdId) {
    // Lost a create race against another tab/device: the unique index did its job, so read the
    // winner back rather than surfacing a failure for state that now exists.
    const raced = await getOwnedListByName(db, userId, name);
    if (raced) return { list: raced, created: false };
    return { list: null, created: false, error: "create failed" };
  }
  return { list: { id: createdId, name: text(created?.name) ?? name }, created: true };
}

export async function renameList(
  db: WatchlistDb,
  userId: string,
  listId: string,
  rawName: string,
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const name = normalizeListName(rawName);
  if (!name) return { ok: false, error: "invalid name", status: 400 };
  const owned = await getOwnedList(db, userId, listId);
  if (!owned) return { ok: false, error: "list not found", status: 404 };
  if (owned.name === name) return { ok: true };
  const clash = await getOwnedListByName(db, userId, name);
  if (clash) return { ok: false, error: "name already used", status: 409 };
  const { error } = await db.from("watchlists").update({ name }).eq("user_id", userId).eq("id", listId);
  if (error) return { ok: false, error: "watchlist update failed", status: 500 };
  return { ok: true };
}

/** Delete a list. `watchlist_symbols.watchlist_id` cascades (0001_init.sql), so the rows go with it. */
export async function deleteList(
  db: WatchlistDb,
  userId: string,
  listId: string,
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const owned = await getOwnedList(db, userId, listId);
  if (!owned) return { ok: false, error: "list not found", status: 404 };
  const { error } = await db.from("watchlists").delete().eq("user_id", userId).eq("id", listId);
  if (error) return { ok: false, error: "watchlist update failed", status: 500 };
  return { ok: true };
}

// ───────────────────────────── symbol ops (list-targeted) ─────────────────────────────

/**
 * Add a batch to one list. Dedupes against what is already there, appends in the order given,
 * and continues numbering from the list's current tail so `position` never collides.
 * A batch whose symbols all exist is a successful no-op — this is what makes the migration
 * safe to re-run.
 *
 * The read below is an OPTIMISATION (it skips work and picks the append position); it is NOT what
 * makes membership unique. `unique (watchlist_id, symbol)` (migration 0008) is, and the write is an
 * UPSERT against that conflict target. Before the index existed, two writers that both read "NVDA
 * absent" both inserted it and the list held the same symbol twice — a read-then-write with no
 * lock and nothing behind it. `ignoreDuplicates` makes the loser of that race a silent no-op
 * rather than an error, which is the correct outcome: the row the user asked for exists.
 */
export async function addSymbols(
  db: WatchlistDb,
  listId: string,
  symbols: readonly string[],
  section: string,
  sectionBySymbol?: Readonly<Record<string, string>>,
): Promise<{ ok: boolean; added: string[]; error?: string }> {
  if (!symbols.length) return { ok: true, added: [] };
  const existing = await db.from("watchlist_symbols")
    .select("symbol,position").eq("watchlist_id", listId);
  const present = new Set<string>();
  let tail = -1;
  for (const row of rows(existing)) {
    const symbol = text(row.symbol);
    if (symbol) present.add(symbol);
    tail = Math.max(tail, num(row.position, -1));
  }
  const missing = symbols.filter((symbol) => !present.has(symbol));
  if (!missing.length) return { ok: true, added: [] };
  const inserts = missing.map((symbol, index) => ({
    watchlist_id: listId,
    symbol,
    section: sectionBySymbol?.[symbol] ?? section,
    position: tail + 1 + index,
  }));
  if (!await writeMembership(db, inserts)) return { ok: false, added: [], error: "watchlist update failed" };
  // `added` means "absent when this call read, and present now" — the caller's contract is that
  // the symbols are in the list, not that this particular request wrote the row.
  return { ok: true, added: missing };
}

/** Postgres 42P10: "there is no unique or exclusion constraint matching the ON CONFLICT
 *  specification" — i.e. this database has not had migration 0008 applied yet. */
const MISSING_CONFLICT_TARGET = /no unique or exclusion constraint/i;

/**
 * Write membership rows through the `(watchlist_id, symbol)` conflict target, falling back to a
 * plain insert on a database where that index does not exist yet.
 *
 * The fallback exists because the schema change and the code deploy are SEPARATE operations here:
 * `supabase/` is explicitly not deployed (DEPLOY.md), so migrations are applied out of band. An
 * upsert whose conflict target has no matching unique index does not degrade — Postgres refuses
 * the statement outright — so without this, shipping the code before the migration would break
 * every watchlist add in production, and shipping the migration first would be the only safe
 * order. This makes either order safe.
 *
 * It is deliberately LOUD, not silent: while the fallback is in use A2's guarantee does not hold
 * (concurrent adds can still duplicate, exactly as they did before), so the missing migration has
 * to be visible in the server log rather than absorbed.
 */
async function writeMembership(db: WatchlistDb, inserts: DbRow[]): Promise<boolean> {
  const upserted = await db.from("watchlist_symbols")
    .upsert(inserts, { onConflict: "watchlist_id,symbol", ignoreDuplicates: true });
  if (!upserted.error) return true;
  if (!MISSING_CONFLICT_TARGET.test(upserted.error.message ?? "")) return false;
  console.error(
    "[watchlists] unique (watchlist_id, symbol) is MISSING from this database — "
    + "supabase/migrations/0009_watchlist_symbol_unique.sql has not been applied. "
    + "Falling back to a plain insert; concurrent adds can duplicate until it lands.",
  );
  const inserted = await db.from("watchlist_symbols").insert(inserts);
  return !inserted.error;
}

/** Seed a brand-new Default list. Same conflict target, same fallback — the two concurrent
 *  post-signup requests `app/terminal/page.tsx` handles both run through here. */
export function seedMembership(db: WatchlistDb, inserts: DbRow[]): Promise<boolean> {
  return writeMembership(db, inserts);
}

export async function removeSymbols(
  db: WatchlistDb,
  listId: string,
  symbols: readonly string[],
): Promise<{ ok: boolean; error?: string }> {
  if (!symbols.length) return { ok: true };
  let query = db.from("watchlist_symbols").delete().eq("watchlist_id", listId);
  query = symbols.length === 1 ? query.eq("symbol", symbols[0]) : query.in("symbol", symbols);
  const { error } = await query;
  if (error) return { ok: false, error: "watchlist update failed" };
  return { ok: true };
}

export async function moveSymbols(
  db: WatchlistDb,
  listId: string,
  symbols: readonly string[],
  section: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!symbols.length) return { ok: true };
  let query = db.from("watchlist_symbols").update({ section }).eq("watchlist_id", listId);
  query = symbols.length === 1 ? query.eq("symbol", symbols[0]) : query.in("symbol", symbols);
  const { error } = await query;
  if (error) return { ok: false, error: "watchlist update failed" };
  return { ok: true };
}

// ───────────────────────────── migration planning (pure) ─────────────────────────────

export type MigrationListPlan = {
  name: string;
  /** Absent on the server — create it at this position first. `null` once it exists. */
  createAtPosition: number | null;
  serverListId: string | null;
  /** Local rows the server list does not carry yet, in local order. */
  insert: { symbol: string; section: string }[];
};

export type MigrationPlan = {
  lists: MigrationListPlan[];
  /** Names skipped because the marker already records them, or because they are `Default`. */
  skipped: string[];
};

/**
 * `mm.wls` -> server plan (packet section 4, exactly):
 *   for each non-`Default` local list -> find the server list by EXACT name -> create if absent
 *   (position = max+1) -> insert the symbols the server list is missing, in local order,
 *   carrying each row's local `section`; dedupe by symbol.
 *
 * ADDITIVE ONLY. Nothing in the plan can delete or rename a server row, and a server-only list
 * simply never appears in it, so it is kept untouched. `Default` is excluded outright: TRAP-1's
 * mount-side reconcile and guest->signed-in overwrite own that list and must not be duplicated
 * by a second writer.
 *
 * Idempotent by construction — after a successful run every local symbol exists on the server,
 * so a second call over the SAME inputs plans zero creates and zero inserts even with an empty
 * marker (proved in lib/__tests__/watchlists.test.ts, and end-to-end in
 * e2e/watchlist-server-migration.spec.ts).
 */
export function planWatchlistMigration(
  local: readonly LocalWatchlist[],
  server: readonly ServerWatchlist[],
  done: Readonly<Record<string, boolean>> = {},
): MigrationPlan {
  const serverByName = new Map(server.map((list) => [list.name, list]));
  let nextPosition = server.reduce((max, list) => Math.max(max, list.position), -1) + 1;

  const lists: MigrationListPlan[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const list of local) {
    const name = normalizeListName(list.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (name === DEFAULT_LIST || done[name] === true) {
      skipped.push(name);
      continue;
    }
    const serverList = serverByName.get(name);
    const present = new Set(serverList?.symbols.map((row) => row.symbol) ?? []);
    const insert: { symbol: string; section: string }[] = [];
    const queued = new Set<string>();
    for (const row of list.rows) {
      const symbol = typeof row?.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
      if (!symbol || present.has(symbol) || queued.has(symbol)) continue;
      queued.add(symbol);
      const section = normalizeSection(row?.section);
      insert.push({ symbol, section: section === null ? DEFAULT_SECTION : section });
    }
    if (serverList && !insert.length) {
      // Already fully represented on the server — nothing to do, but it IS migrated, so the
      // caller records the marker and stops re-planning it.
      lists.push({ name, createAtPosition: null, serverListId: serverList.id, insert: [] });
      continue;
    }
    lists.push({
      name,
      createAtPosition: serverList ? null : nextPosition++,
      serverListId: serverList?.id ?? null,
      insert,
    });
  }
  return { lists, skipped };
}

/**
 * ORDER-SEMANTICS RULING (commissioning session, W1b round 2) — the one rule the whole Terminal
 * obeys, and the generalisation of what `Default` has always done:
 *
 *   Terminal named lists mirror Default's proven local-wins live semantics, scoped as follows.
 *   Membership and section are server-synced write-through (write paths exist); ORDER is
 *   local-wins everywhere in the Terminal until a position-write path ships (that path is a W5
 *   line item, not W1b's). The mount-time server-adopt is ADDITIVE-ONLY for lists that exist
 *   locally: add server-only symbols, never drop a local row, never reorder local rows, never
 *   overwrite a local section. Lists absent locally adopt wholesale (they are new from another
 *   device or from the Macro side).
 *
 * The reason is the one first recorded for Default in the since-deleted guest-shell module: the server
 * row knows MEMBERSHIP, not ORDER. `watchlist_symbols.position` exists, but nothing in the
 * Terminal writes it after the initial insert, so treating it as canonical renders a user's
 * reordered list in an order they never chose — and, worse, replays their just-deleted rows and
 * their pre-drag sections back over live local state.
 *
 * `alreadyLocal` is the local membership snapshot taken BEFORE the inventory request went out. A
 * server row named there is one the user removed while the request was in flight, so the response
 * is simply stale about it and it must not be re-appended.
 *
 * `deletedLocally` closes the other half — the half W1b accepted as a tradeoff ("an offline-window
 * delete made BEFORE the read can still resurrect"). It is the set of symbols this owner has
 * DELETED without the server confirming it (lib/watchlistOwner.ts tombstones). Additive adoption
 * cannot otherwise tell "another device added AAPL" from "this device deleted AAPL and the DELETE
 * never landed", so it re-appended the row and silently reversed the user's action on the next
 * reload. A tombstoned symbol is never re-adopted; once the delete converges the tombstone clears
 * and a genuinely new server row is adopted normally.
 *
 * ── W5 DISPOSITION OF THE ORDER-SYNC LINE ITEM (third refusal; read this before the fourth) ──
 *
 * W1b ruled order local-wins and called a position-write path "a W5 line item". W5 looked, and is
 * NOT shipping it. The reason is a checkable fact about the schema rather than a preference:
 *
 *   `watchlist_symbols` (supabase/migrations/0001_init.sql:40-48) carries `id` as its only unique
 *   key — there is NO unique constraint or index on `(watchlist_id, symbol)`, only the plain
 *   `wls_watchlist` index on `watchlist_id`. PostgREST's `on_conflict` upsert REQUIRES a unique
 *   constraint, so a whole list's order cannot be rewritten in one request. The only write path
 *   available inside this wave's scope is one `update … where watchlist_id=? and symbol=?` per
 *   row — and every watchlist write in the Terminal is serialized on `wlServerChainRef`, so a
 *   60-name drag would queue 60 requests ahead of the user's next edit and an A-Z sort of a
 *   500-name list would queue 500. That is not an ordering sync; it is a stall with a side effect.
 *
 * Making it real needs new database surface — either a unique index on `(watchlist_id, symbol)`
 * (which is a live-data migration, not a no-op: `addSymbols` dedupes in application code only, so
 * duplicates may exist and would have to be reconciled first) or the atomic ordered-list RPC that
 * master #409's own note already named as the precondition:
 *
 *   > Visual row order remains the established local watchlist preference until the backend has
 *   > an atomic ordered-list RPC.
 *
 * ── STATUS UPDATE (bug sweep A, 2026-08-19): THE SCHEMA HALF OF THAT PRECONDITION IS NOW MET ──
 *
 * `supabase/migrations/0009_watchlist_symbol_unique.sql` created
 * `unique (watchlist_id, symbol)` — for A2 (concurrent adds were duplicating membership), not for
 * ordering, but the index is the index. It is APPLIED to production: the pre-flight census found
 * 269 rows / 269 distinct pairs / 0 duplicates, so the "duplicates may exist and would have to be
 * reconciled first" question above is ANSWERED for that database — there were none, the reconcile
 * deleted nothing, and no survivor had to be chosen. A batched `on_conflict` upsert of a whole
 * list's positions is therefore now expressible in one request.
 *
 * That removes the schema blocker. It does NOT by itself make order-sync correct, and the READ
 * side is still the harder half: making server `position` authoritative on adopt is exactly the
 * construction W1b round 1 was BLOCKED for — a stale inventory response replaying a user's
 * pre-drag order (and their just-deleted rows) over live local state. That fix is what this
 * function is, and a fifth lane still has to answer it before treating server order as truth.
 *
 * So: three independent refusals (W1b's reviewer, master #409, W5), one precondition now HALF
 * satisfied, and the read-side staleness question still open.
 */
export function adoptServerSymbols(
  local: readonly { symbol: string; section: string }[],
  server: readonly { symbol: string; section: string }[],
  alreadyLocal?: ReadonlySet<string>,
  deletedLocally?: ReadonlySet<string>,
): { symbol: string; section: string }[] {
  const adopted: { symbol: string; section: string }[] = [];
  const seen = new Set<string>();
  // Local rows first, untouched: same order, same section. Nothing here may be dropped.
  // `?? DEFAULT_SECTION`, never `|| DEFAULT_SECTION`: an empty section is #409's unsectioned run
  // and must survive adoption, or every unsectioned row silently re-files itself under "Watchlist".
  for (const row of local) {
    if (!row?.symbol || seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    adopted.push({ symbol: row.symbol, section: row.section ?? DEFAULT_SECTION });
  }
  // Then the genuinely server-only rows, appended in server order.
  for (const row of server) {
    if (!row?.symbol || seen.has(row.symbol)) continue;
    if (alreadyLocal?.has(row.symbol)) continue;   // removed locally while the read was in flight
    if (deletedLocally?.has(row.symbol)) continue; // deleted locally; the server has not caught up
    seen.add(row.symbol);
    adopted.push({ symbol: row.symbol, section: row.section ?? DEFAULT_SECTION });
  }
  return adopted;
}

/** Split a batch at the API's per-request cap so a large list is never silently truncated (the
 *  pre-W1b per-symbol fan-out had no size limit; `normalizeSymbols` returns [] above the cap). */
export function chunkSymbols<T>(rows: readonly T[], size = MAX_BATCH): T[][] {
  if (rows.length <= size) return rows.length ? [[...rows]] : [];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}
