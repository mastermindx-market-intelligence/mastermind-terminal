// Explicit grants service (packet B-F12-B5-1).
//
// Shape authority is `supabase/migrations/0021_resource_grants.sql` (NOT APPLIED — the seat
// applies it out of band). Mirrors `terminal/lib/teams.ts`: I/O-thin, takes the db as a
// parameter, returns discriminated results. RLS is the authority; decideTenantScope is the
// application-side second gate and never replaces it.
//
// Absence is a FACT, never an empty result: a missing relation is `"unavailable"`, any other
// read error is `"failed"`, and neither is collapsed into `{ok:true, shared:[]}`.

import type { DbResult, DbRow, WatchlistDb, WatchlistQuery } from "@/lib/watchlists";
import { decideTenantScope, type Grant } from "@/lib/tenantScope";

export const GRANTS_TABLE = "resource_grants";
export const RESOURCE_KIND_WATCHLIST = "watchlist";

export type GrantRouteCode =
  | "not_signed_in"
  | "send_json"
  | "unrecognised_action"
  | "list_required"
  | "list_not_found"
  | "account_required"
  | "invalid_account"
  | "cannot_share_with_self"
  | "email_not_supported"
  | "already_shared"
  | "grant_not_found"
  | "not_owner"
  | "unavailable"
  | "read_failed"
  | "write_failed";

export const GRANT_ROUTE_MESSAGES: Record<GrantRouteCode, [string, string]> = {
  not_signed_in: ["You are not signed in.", "你尚未登录。"],
  send_json: ["Send a JSON body.", "请发送 JSON 正文。"],
  unrecognised_action: ["We do not recognise that action.", "我们无法识别该操作。"],
  list_required: ["Choose a list to share.", "请选择要共享的清单。"],
  list_not_found: ["We could not find that list in your account.", "在你的账户中找不到该清单。"],
  account_required: ["Enter the account ID of the person you want to share with.", "请输入要共享给的对方账户 ID。"],
  invalid_account: ["That account ID is not valid.", "该账户 ID 无效。"],
  cannot_share_with_self: [
    "This list is already yours, so there is nothing to share with yourself.",
    "此清单本就属于你，无需共享给自己。",
  ],
  email_not_supported: [
    "Sharing by email is not available yet. Ask them to sign in to Mastermind first, then share with their account ID.",
    "目前还不能通过电子邮件共享。请先让对方登录 Mastermind，然后使用其账户 ID 共享。",
  ],
  already_shared: ["This list is already shared with that account.", "此清单已共享给该账户。"],
  grant_not_found: ["That share has already ended.", "该共享已结束。"],
  not_owner: ["Only the person who made a list can share it.", "只有清单的创建者才能共享它。"],
  unavailable: [
    "Sharing is not set up on this server yet, so we cannot answer. Nothing was changed.",
    "此服务器尚未启用共享功能，因此我们无法作答。未更改任何内容。",
  ],
  read_failed: ["We could not read your shared lists just now.", "我们暂时无法读取你的共享清单。"],
  write_failed: ["We could not save that change.", "我们无法保存该更改。"],
};

export type GrantsQuery = WatchlistQuery & {
  is: (column: string, value: null) => GrantsQuery;
};
export type GrantsDb = { from: (table: string) => GrantsQuery };

type PgError = { message?: string; code?: string } | null | undefined;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAbsentTableError(error: PgError): boolean {
  if (!error || !error.code) return false;
  return error.code === "42P01" || error.code === "PGRST205";
}

function looksLikeEmail(value: string): boolean {
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  return domain.includes(".");
}

export function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !UUID_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function asRow(result: DbResult): DbRow | null {
  const data = result?.data;
  if (Array.isArray(data)) return (data[0] as DbRow | undefined) ?? null;
  return data && typeof data === "object" ? (data as DbRow) : null;
}

function asRows(result: DbResult): DbRow[] {
  return Array.isArray(result?.data) ? (result.data as DbRow[]) : [];
}

function live(q: GrantsQuery): GrantsQuery {
  if (typeof q.is === "function") return q.is("revoked_at", null);
  return q.eq("revoked_at", null) as GrantsQuery;
}

function classifyReadError(result: DbResult): { ok: false; reason: "unavailable" | "failed"; error: string } | null {
  const error = result.error as PgError;
  if (error) {
    return isAbsentTableError(error)
      ? { ok: false, reason: "unavailable", error: error.message || "table unavailable" }
      : { ok: false, reason: "failed", error: error.message || "read failed" };
  }
  if (result.data !== null && result.data !== undefined && !Array.isArray(result.data) && typeof result.data !== "object") {
    return { ok: false, reason: "failed", error: "malformed response" };
  }
  return null;
}

export type SharedGrant = {
  id: string;
  resourceKind: "watchlist";
  resourceId: string;
  resourceName: string;
  granteeUserId: string;
  createdAt: string | null;
  revokedAt: null;
};

export type ReceivedGrant = {
  id: string;
  resourceKind: "watchlist";
  resourceId: string;
  resourceName: string;
  grantedBy: string;
  symbolCount: number;
  createdAt: string | null;
};

export type SharedWatchlist = {
  id: string;
  name: string;
  sharedBy: string;
  symbols: { symbol: string; section: string; position: number }[];
};

export type ReadFail = { ok: false; reason: "unavailable" | "failed"; error: string };
export type GrantsListRead =
  | { ok: true; shared: SharedGrant[]; sharedWithMe: ReceivedGrant[] }
  | ReadFail;

export type ShareOk =
  | { ok: true; status: 201; grant: SharedGrant }
  | { ok: true; status: 200; grant: SharedGrant; code: "already_shared" };
export type ShareFail = {
  ok: false;
  status: number;
  code: GrantRouteCode;
  error: string;
};
export type ShareResult = ShareOk | ShareFail;

export type RevokeResult =
  | { ok: true }
  | { ok: false; status: number; code: GrantRouteCode; error: string };

export type SharedWatchlistsRead =
  | { ok: true; lists: SharedWatchlist[] }
  | ReadFail;

/** Map a grant row into the tenantScope Grant shape with no renaming, no defaulting and no
 *  coercion: `revoked_at` is passed through as-is so `isRevoked`'s fail-closed treatment of an
 *  empty string still applies. */
export function toTenantGrants(
  rows: ReadonlyArray<{ resource_id: unknown; grantee_user_id: unknown; revoked_at?: unknown }>,
): Grant[] {
  return rows.map((row) => ({
    resourceId: row.resource_id as Grant["resourceId"],
    granteeUserId: row.grantee_user_id as Grant["granteeUserId"],
    revokedAt: row.revoked_at as Grant["revokedAt"],
  }));
}

function toSharedGrant(row: DbRow, resourceName: string): SharedGrant | null {
  const id = typeof row.id === "string" ? row.id : null;
  const resourceId = typeof row.resource_id === "string" ? row.resource_id : null;
  const granteeUserId = typeof row.grantee_user_id === "string" ? row.grantee_user_id : null;
  if (!id || !resourceId || !granteeUserId) return null;
  return {
    id,
    resourceKind: "watchlist",
    resourceId,
    resourceName,
    granteeUserId,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    revokedAt: null,
  };
}

async function watchlistNamesById(
  db: GrantsDb,
  ids: string[],
): Promise<Map<string, { name: string; userId: string | null }> | ReadFail> {
  const names = new Map<string, { name: string; userId: string | null }>();
  if (ids.length === 0) return names;
  const result = await db.from("watchlists").select("id,name,user_id").in("id", ids);
  const fail = classifyReadError(result);
  if (fail) return fail;
  for (const row of asRows(result)) {
    const id = typeof row.id === "string" ? row.id : null;
    const name = typeof row.name === "string" ? row.name : null;
    if (!id || !name) continue;
    names.set(id, { name, userId: typeof row.user_id === "string" ? row.user_id : null });
  }
  return names;
}

async function symbolsByListId(
  db: GrantsDb,
  ids: string[],
): Promise<Map<string, SharedWatchlist["symbols"]> | ReadFail> {
  const byList = new Map<string, SharedWatchlist["symbols"]>();
  if (ids.length === 0) return byList;
  const result = await db
    .from("watchlist_symbols")
    .select("watchlist_id,symbol,section,position")
    .in("watchlist_id", ids)
    .order("position");
  const fail = classifyReadError(result);
  if (fail) return fail;
  for (const row of asRows(result)) {
    const listId = typeof row.watchlist_id === "string" ? row.watchlist_id : null;
    const symbol = typeof row.symbol === "string" ? row.symbol : null;
    if (!listId || !symbol) continue;
    const list = byList.get(listId) ?? [];
    if (list.some((existing) => existing.symbol === symbol)) continue;
    list.push({
      symbol,
      section: typeof row.section === "string" ? row.section : "",
      position: typeof row.position === "number" && Number.isFinite(row.position) ? row.position : list.length,
    });
    byList.set(listId, list);
  }
  return byList;
}

export async function listGrants(db: GrantsDb, callerId: string): Promise<GrantsListRead> {
  const madeResult = await live(
    db.from(GRANTS_TABLE).select("id,resource_kind,resource_id,grantee_user_id,granted_by,created_at,revoked_at").eq("granted_by", callerId) as GrantsQuery,
  );
  const madeFail = classifyReadError(madeResult);
  if (madeFail) return madeFail;

  const receivedResult = await live(
    db.from(GRANTS_TABLE).select("id,resource_kind,resource_id,grantee_user_id,granted_by,created_at,revoked_at").eq("grantee_user_id", callerId) as GrantsQuery,
  );
  const receivedFail = classifyReadError(receivedResult);
  if (receivedFail) return receivedFail;

  const madeRows = asRows(madeResult);
  const receivedRows = asRows(receivedResult);
  const ids = [
    ...new Set(
      [...madeRows, ...receivedRows]
        .map((row) => (typeof row.resource_id === "string" ? row.resource_id : null))
        .filter((id): id is string => !!id),
    ),
  ];
  const names = await watchlistNamesById(db, ids);
  if (!(names instanceof Map)) return names;
  const symbols = await symbolsByListId(db, receivedRows.map((row) => (typeof row.resource_id === "string" ? row.resource_id : "")).filter(Boolean));
  if (!(symbols instanceof Map)) return symbols;

  const shared: SharedGrant[] = [];
  for (const row of madeRows) {
    const resourceId = typeof row.resource_id === "string" ? row.resource_id : null;
    const meta = resourceId ? names.get(resourceId) : undefined;
    if (!resourceId || !meta) continue;
    const grant = toSharedGrant(row, meta.name);
    if (grant) shared.push(grant);
  }

  const sharedWithMe: ReceivedGrant[] = [];
  const tenantGrants = toTenantGrants(
    receivedRows.map((row) => ({
      resource_id: row.resource_id,
      grantee_user_id: row.grantee_user_id,
      revoked_at: row.revoked_at,
    })),
  );
  for (const row of receivedRows) {
    const resourceId = typeof row.resource_id === "string" ? row.resource_id : null;
    const meta = resourceId ? names.get(resourceId) : undefined;
    const grantId = typeof row.id === "string" ? row.id : null;
    const grantedBy = typeof row.granted_by === "string" ? row.granted_by : null;
    if (!resourceId || !meta || !grantId || !grantedBy) continue;
    const decision = decideTenantScope(
      { userId: callerId },
      [], // watchlists carry no team_id, so no membership can bear on this decision
      { id: resourceId, ownerId: meta.userId, teamId: null, visibility: "private" },
      tenantGrants,
    );
    if (!(decision.allow && decision.reason === "explicit_grant")) {
      console.error("grant-fed watchlist dropped:", decision.reason);
      continue;
    }
    sharedWithMe.push({
      id: grantId,
      resourceKind: "watchlist",
      resourceId,
      resourceName: meta.name,
      grantedBy,
      symbolCount: (symbols.get(resourceId) ?? []).length,
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
    });
  }

  return { ok: true, shared, sharedWithMe };
}

export async function listSharedWatchlistsForCaller(db: GrantsDb, callerId: string): Promise<SharedWatchlistsRead> {
  const receivedResult = await live(
    db.from(GRANTS_TABLE).select("id,resource_kind,resource_id,grantee_user_id,granted_by,created_at,revoked_at").eq("grantee_user_id", callerId) as GrantsQuery,
  );
  const receivedFail = classifyReadError(receivedResult);
  if (receivedFail) return receivedFail;
  const receivedRows = asRows(receivedResult);
  const ids = receivedRows.map((row) => (typeof row.resource_id === "string" ? row.resource_id : null)).filter((id): id is string => !!id);
  const names = await watchlistNamesById(db, ids);
  if (!(names instanceof Map)) return names;
  const symbols = await symbolsByListId(db, ids);
  if (!(symbols instanceof Map)) return symbols;
  const tenantGrants = toTenantGrants(
    receivedRows.map((row) => ({
      resource_id: row.resource_id,
      grantee_user_id: row.grantee_user_id,
      revoked_at: row.revoked_at,
    })),
  );
  const lists: SharedWatchlist[] = [];
  for (const row of receivedRows) {
    const resourceId = typeof row.resource_id === "string" ? row.resource_id : null;
    const meta = resourceId ? names.get(resourceId) : undefined;
    const grantedBy = typeof row.granted_by === "string" ? row.granted_by : null;
    if (!resourceId || !meta || !grantedBy) continue;
    const decision = decideTenantScope(
      { userId: callerId },
      [], // watchlists carry no team_id, so no membership can bear on this decision
      { id: resourceId, ownerId: meta.userId, teamId: null, visibility: "private" },
      tenantGrants,
    );
    if (!(decision.allow && decision.reason === "explicit_grant")) {
      console.error("grant-fed watchlist dropped:", decision.reason);
      continue;
    }
    lists.push({
      id: resourceId,
      name: meta.name,
      sharedBy: grantedBy,
      symbols: symbols.get(resourceId) ?? [],
    });
  }
  return { ok: true, lists };
}

export async function createGrant(
  db: GrantsDb,
  callerId: string,
  body: Record<string, unknown>,
): Promise<ShareResult> {
  if (body.action !== undefined && body.action !== "share") {
    return { ok: false, status: 400, code: "unrecognised_action", error: "unrecognised action" };
  }
  if (body.resourceKind !== undefined && body.resourceKind !== RESOURCE_KIND_WATCHLIST) {
    return { ok: false, status: 400, code: "unrecognised_action", error: "unrecognised action" };
  }
  const resourceIdRaw = typeof body.resourceId === "string" ? body.resourceId.trim() : "";
  if (!resourceIdRaw || !UUID_RE.test(resourceIdRaw)) {
    return { ok: false, status: 400, code: "list_required", error: "list required" };
  }
  const resourceId = resourceIdRaw.toLowerCase();

  if (body.granteeUserId === undefined || body.granteeUserId === null || body.granteeUserId === "") {
    return { ok: false, status: 400, code: "account_required", error: "account required" };
  }
  if (typeof body.granteeUserId !== "string") {
    return { ok: false, status: 400, code: "invalid_account", error: "invalid account" };
  }
  const granteeRaw = body.granteeUserId.trim();
  if (!granteeRaw) return { ok: false, status: 400, code: "account_required", error: "account required" };
  if (looksLikeEmail(granteeRaw)) {
    return { ok: false, status: 400, code: "email_not_supported", error: "email not supported" };
  }
  if (!UUID_RE.test(granteeRaw)) {
    return { ok: false, status: 400, code: "invalid_account", error: "invalid account" };
  }
  const granteeUserId = granteeRaw.toLowerCase();

  // Frozen order: self-check before ownership check, so the response can never be used to
  // probe whether a stranger's list id exists.
  if (granteeUserId === callerId) {
    return { ok: false, status: 400, code: "cannot_share_with_self", error: "cannot share with self" };
  }

  const owned = await db.from("watchlists").select("id,name").eq("id", resourceId).eq("user_id", callerId).maybeSingle();
  const ownedError = owned.error as PgError;
  if (ownedError) {
    if (isAbsentTableError(ownedError)) {
      return { ok: false, status: 503, code: "unavailable", error: ownedError.message || "unavailable" };
    }
    if (ownedError.code === "42501") {
      return { ok: false, status: 404, code: "list_not_found", error: "list not found" };
    }
    return { ok: false, status: 500, code: "write_failed", error: ownedError.message || "read failed" };
  }
  const ownedRow = asRow(owned);
  if (!ownedRow || typeof ownedRow.id !== "string") {
    return { ok: false, status: 404, code: "list_not_found", error: "list not found" };
  }
  const resourceName = typeof ownedRow.name === "string" ? ownedRow.name : "";

  const inserted = await db
    .from(GRANTS_TABLE)
    .insert({
      resource_kind: RESOURCE_KIND_WATCHLIST,
      resource_id: resourceId,
      grantee_user_id: granteeUserId,
      granted_by: callerId,
    })
    .select("id,resource_kind,resource_id,grantee_user_id,granted_by,created_at,revoked_at")
    .maybeSingle();
  const insertError = inserted.error as PgError;
  if (insertError) {
    if (isAbsentTableError(insertError)) {
      return { ok: false, status: 503, code: "unavailable", error: insertError.message || "unavailable" };
    }
    if (insertError.code === "23505") {
      const existing = await live(
        db
          .from(GRANTS_TABLE)
          .select("id,resource_kind,resource_id,grantee_user_id,granted_by,created_at,revoked_at")
          .eq("resource_id", resourceId)
          .eq("grantee_user_id", granteeUserId)
          .eq("granted_by", callerId) as GrantsQuery,
      ).maybeSingle();
      const existingRow = asRow(existing);
      const grant = existingRow ? toSharedGrant(existingRow, resourceName) : null;
      if (!grant) {
        return { ok: false, status: 500, code: "write_failed", error: "duplicate live share could not be read back" };
      }
      return { ok: true, status: 200, grant, code: "already_shared" };
    }
    if (insertError.code === "42501") {
      return { ok: false, status: 404, code: "list_not_found", error: "list not found" };
    }
    return { ok: false, status: 500, code: "write_failed", error: insertError.message || "insert failed" };
  }
  const row = asRow(inserted);
  const grant = row ? toSharedGrant(row, resourceName) : null;
  if (!grant) return { ok: false, status: 500, code: "write_failed", error: "insert returned no row" };
  return { ok: true, status: 201, grant };
}

export async function revokeGrant(
  db: GrantsDb,
  callerId: string,
  body: Record<string, unknown>,
): Promise<RevokeResult> {
  let query = db.from(GRANTS_TABLE).update({ revoked_at: new Date().toISOString() }).eq("granted_by", callerId) as GrantsQuery;
  const grantId = normalizeUuid(body.grantId);
  if (grantId) {
    query = query.eq("id", grantId) as GrantsQuery;
  } else {
    if (body.resourceKind !== undefined && body.resourceKind !== RESOURCE_KIND_WATCHLIST) {
      return { ok: false, status: 400, code: "unrecognised_action", error: "unrecognised action" };
    }
    const resourceId = normalizeUuid(body.resourceId);
    const granteeUserId = normalizeUuid(body.granteeUserId);
    if (!resourceId || !granteeUserId) {
      return { ok: false, status: 404, code: "grant_not_found", error: "grant not found" };
    }
    query = query.eq("resource_id", resourceId).eq("grantee_user_id", granteeUserId).eq("resource_kind", RESOURCE_KIND_WATCHLIST) as GrantsQuery;
  }
  const updated = await live(query).select("id").maybeSingle();
  const updateError = updated.error as PgError;
  if (updateError) {
    if (isAbsentTableError(updateError)) {
      return { ok: false, status: 503, code: "unavailable", error: updateError.message || "unavailable" };
    }
    return { ok: false, status: 500, code: "write_failed", error: updateError.message || "update failed" };
  }
  const row = asRow(updated);
  if (!row || typeof row.id !== "string") {
    return { ok: false, status: 404, code: "grant_not_found", error: "grant not found" };
  }
  return { ok: true };
}

export type { WatchlistDb };
