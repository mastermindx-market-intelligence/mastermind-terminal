import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseUserClaim } from "@/lib/personalAccuracyStore";
import { rowToPosition } from "@/lib/portfolio";
import {
  API_V1_BRIEFS_NULL_EN,
  API_V1_BRIEFS_NULL_ZH,
  API_V1_DEFAULT_LIMIT,
  API_V1_RATE_LIMIT_MINUTE,
  API_V1_RESOURCES,
  API_V1_TEAM_KEYS_NULL_EN,
  API_V1_TEAM_KEYS_NULL_ZH,
  API_V1_TRUTH_EN,
  API_V1_TRUTH_ZH,
  API_V1_VERSION,
  bearerToken,
  coverageOf,
  decodeCursor,
  firstForbiddenField,
  encodeCursor,
  envelope,
  errorBody,
  errorStatus,
  etagFor,
  apiKeyDigest,
  apiKeyDigestEqual,
  apiKeyPrefix,
  ifNoneMatchHits,
  isWellFormedApiKey,
  parseLimit,
  rfc3339Utc,
  schemaFor,
  type ApiV1Alert,
  type ApiV1AlertFire,
  type ApiV1Claim,
  type ApiV1ErrorCode,
  type ApiV1Me,
  type ApiV1Page,
  type ApiV1Position,
  type ApiV1Thesis,
  type ApiV1Watchlist,
} from "@/lib/apiV1";

export type ApiKeyAuth = {
  userId: string;
  keyId: string;
  keyPrefix: string;
  scopes: string[];
  limit: number;
  remaining: number;
  retryAfter: number | null;
  rateLimited: boolean;
};

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
  from?: (table: string) => unknown;
};

export type ApiV1Deps = {
  service: RpcClient | null;
};

const AUTHENTICATE_FN = "api_key_authenticate";
const READ_FN = "api_v1_read_as_user";
const KEY_SALT_FN = "api_key_salt_for_prefix";

function rateHeaders(limit: number, remaining: number, retryAfter?: number | null): HeadersInit {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(Math.max(0, remaining)),
  };
  if (retryAfter != null) headers["Retry-After"] = String(retryAfter);
  return headers;
}

function jsonError(
  code: ApiV1ErrorCode,
  extra?: { retryAfter?: number | null; limit?: number; remaining?: number },
) {
  const status = errorStatus(code);
  const limit = extra?.limit ?? API_V1_RATE_LIMIT_MINUTE;
  const remaining = extra?.remaining ?? 0;
  return NextResponse.json(errorBody(code), {
    status,
    headers: rateHeaders(limit, remaining, extra?.retryAfter),
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRows(value: unknown): Record<string, unknown>[] {
  const rec = asRecord(value);
  const rows = rec?.rows;
  return Array.isArray(rows)
    ? rows.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
    : [];
}

function sqlCursorOf(
  rows: Record<string, unknown>[],
  limit: number,
  stampKey: string,
  idKey: string,
): string | null {
  const boundary = rows[limit - 1];
  if (!boundary) return null;
  return encodeCursor(String(boundary[stampKey] ?? ""), String(boundary[idKey] ?? ""));
}

export async function authenticateApiKey(
  request: Request,
  deps?: ApiV1Deps,
): Promise<{ ok: true; auth: ApiKeyAuth } | { ok: false; response: NextResponse }> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token || !isWellFormedApiKey(token)) {
    return { ok: false, response: jsonError("unauthorized") };
  }
  const service = deps?.service ?? createServiceClient();
  if (!service) {
    return { ok: false, response: jsonError("unauthorized") };
  }
  const saltResult = await service.rpc(KEY_SALT_FN, { p_key_prefix: apiKeyPrefix(token) });
  const saltRow = asRecord(saltResult.data);
  const salt = typeof saltRow?.key_salt === "string" ? saltRow.key_salt : "";
  if (saltResult.error || !salt || !/^[A-Za-z0-9+/]{22}==$/.test(salt)) {
    return { ok: false, response: jsonError("unauthorized") };
  }
  const digest = apiKeyDigest(token, salt);
  const result = await service.rpc(AUTHENTICATE_FN, {
    p_key_prefix: apiKeyPrefix(token),
    p_key_digest: digest,
  });
  if (result.error || result.data == null) {
    return { ok: false, response: jsonError("unauthorized") };
  }
  const row = asRecord(result.data);
  if (!row) {
    return { ok: false, response: jsonError("unauthorized") };
  }
  const userId = typeof row.user_id === "string" ? row.user_id : "";
  const keyId = typeof row.key_id === "string" ? row.key_id : "";
  if (!userId || !keyId) {
    return { ok: false, response: jsonError("unauthorized") };
  }
  const storedDigest = typeof row.key_digest === "string" ? row.key_digest : digest;
  if (!apiKeyDigestEqual(token, salt, storedDigest)) {
    return { ok: false, response: jsonError("unauthorized") };
  }
  const limit = typeof row.limit === "number" ? row.limit : API_V1_RATE_LIMIT_MINUTE;
  const remaining = typeof row.remaining === "number" ? row.remaining : 0;
  const retryAfter = typeof row.retry_after === "number" ? row.retry_after : null;
  const rateLimited = row.rate_limited === true;
  const auth: ApiKeyAuth = {
    userId,
    keyId,
    keyPrefix: token.slice(4, 12),
    scopes: ["read"],
    limit,
    remaining,
    retryAfter,
    rateLimited,
  };
  if (rateLimited) {
    return {
      ok: false,
      response: jsonError("rate_limited", { retryAfter, limit, remaining: 0 }),
    };
  }
  return { ok: true, auth };
}

export async function readAsUser(
  auth: ApiKeyAuth,
  resource: string,
  args: Record<string, unknown>,
  deps?: ApiV1Deps,
): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; code: ApiV1ErrorCode }> {
  const service = deps?.service ?? createServiceClient();
  if (!service) return { ok: false, code: "unauthorized" };
  const result = await service.rpc(READ_FN, {
    p_user_id: auth.userId,
    p_resource: resource,
    p_args: args,
  });
  if (result.error) return { ok: false, code: "invalid_request" };
  const rec = asRecord(result.data);
  if (rec?.ok === false) {
    const err = rec.error === "not_found" ? "not_found" : rec.error === "unauthorized" ? "unauthorized" : "invalid_request";
    return { ok: false, code: err };
  }
  return { ok: true, rows: asRows(result.data) };
}

function pageOf(rows: Record<string, unknown>[], limit: number, stampKey: string, idKey: string): {
  pageRows: Record<string, unknown>[];
  page: ApiV1Page;
} {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const next = hasMore
    ? sqlCursorOf(rows, limit, stampKey, idKey)
    : null;
  return { pageRows, page: { next_cursor: next, limit } };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Throw if any forbidden field is present in the value (MAJOR-1+4 fix). */
function assertNoForbiddenFields(value: unknown): void {
  const hit = firstForbiddenField(value);
  if (hit) {
    throw new Error(`forbidden field: ${hit}`);
  }
}

function mapThesisSummary(row: Record<string, unknown>): ApiV1Thesis | null {
  const id = text(row.id);
  if (!id) return null;
  const content = asRecord(row.content);
  const subject = (row.subject_ref ?? row.subject) as ApiV1Thesis["subject"];
  return {
    id,
    currentVersion: typeof row.current_version === "number" ? row.current_version : 0,
    lifecycleState: (text(row.lifecycle_state) || "active") as ApiV1Thesis["lifecycleState"],
    subject,
    title: text(content?.title) || "",
    updatedAt: text(row.updated_at),
  };
}

function mapWatchlist(row: Record<string, unknown>): ApiV1Watchlist | null {
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name) return null;
  const symbols = Array.isArray(row.symbols)
    ? row.symbols
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s, i) => ({
        symbol: text(s.symbol),
        section: typeof s.section === "string" ? s.section : "",
        position: typeof s.position === "number" ? s.position : i,
      }))
      .filter((s) => s.symbol)
    : [];
  return {
    id,
    name,
    position: typeof row.position === "number" ? row.position : 0,
    symbols,
  };
}

function mapAlert(row: Record<string, unknown>): ApiV1Alert | null {
  const id = text(row.id);
  if (!id) return null;
  const condition = asRecord(row.condition) ?? {};
  return {
    id,
    symbol: text(row.symbol),
    condition,
    active: row.active !== false,
    createdAt: text(row.created_at) || null,
  };
}

function mapFire(row: Record<string, unknown>): ApiV1AlertFire | null {
  const id = text(row.id);
  if (!id) return null;
  return {
    id,
    alertId: text(row.alert_id),
    fireEventId: text(row.fire_event_id),
    channel: text(row.channel) || "email",
    status: text(row.status),
    payload: asRecord(row.payload),
    createdAt: text(row.created_at) || null,
    deliveredAt: text(row.delivered_at) || null,
  };
}

function mapClaim(row: Record<string, unknown>): ApiV1Claim | null {
  return parseUserClaim(row);
}

function mapPosition(row: Record<string, unknown>): ApiV1Position | null {
  return rowToPosition(row);
}

async function handleV1GetInternal(
  request: Request,
  resource: string,
  opts: { id?: string; extraArgs?: Record<string, unknown> } = {},
  deps?: ApiV1Deps,
): Promise<NextResponse> {
  const authResult = await authenticateApiKey(request, deps);
  if (!authResult.ok) return authResult.response;
  const { auth } = authResult;

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  if (limit == null) {
    return jsonError("invalid_request", { limit: auth.limit, remaining: auth.remaining });
  }
  const cursor = url.searchParams.get("cursor");
  if (cursor && !decodeCursor(cursor)) {
    return jsonError("invalid_request", { limit: auth.limit, remaining: auth.remaining });
  }
  const args: Record<string, unknown> = {
    limit,
    ...(cursor ? { cursor } : {}),
    ...(opts.id ? { id: opts.id } : {}),
    ...(opts.extraArgs ?? {}),
  };

  const read = await readAsUser(auth, resource, args, deps);
  if (!read.ok) {
    return jsonError(read.code, { limit: auth.limit, remaining: auth.remaining });
  }
  for (const row of read.rows) assertNoForbiddenFields(row);

  let data: unknown;
  let page: ApiV1Page = { next_cursor: null, limit };
  let coverageRows: Record<string, unknown>[] = [];
  let coverageFields: string[] = [];
  const schema = schemaFor(resource === "thesis" ? "thesis" : resource === "watchlist" ? "watchlist" : resource);

  if (resource === "theses") {
    const sliced = pageOf(read.rows, limit, "updated_at", "id");
    const mapped = sliced.pageRows.map(mapThesisSummary).filter((v): v is ApiV1Thesis => v != null);
    for (const t of mapped) assertNoForbiddenFields(t);
    data = mapped;
    page = sliced.page;
    coverageRows = mapped as unknown as Record<string, unknown>[];
    coverageFields = ["id", "title", "updatedAt", "subject"];
  } else if (resource === "thesis") {
    if (read.rows.length === 0) {
      return jsonError("not_found", { limit: auth.limit, remaining: auth.remaining });
    }
    const versions = await readAsUser(auth, "thesis_versions", { id: opts.id, limit: 500 }, deps);
    if (versions.ok) {
      for (const version of versions.rows) assertNoForbiddenFields(version);
    }
    const head = read.rows[0];
    const summary = mapThesisSummary(head);
    if (!summary) return jsonError("not_found", { limit: auth.limit, remaining: auth.remaining });
    const history = versions.ok
      ? versions.rows.map((row) => ({
        id: text(row.id),
        thesisId: text(row.thesis_id),
        version: typeof row.version === "number" ? row.version : 0,
        previousVersion: typeof row.previous_version === "number" ? row.previous_version : null,
        transition: text(row.transition),
        lifecycleState: text(row.lifecycle_state),
        subject: row.subject_ref,
        content: row.content,
        clientRequestId: text(row.client_request_id),
        systemRecordedAt: text(row.system_recorded_at),
        effectiveAt: text(row.effective_at) || null,
      }))
      : [];
    for (const h of history) assertNoForbiddenFields(h);
    const current = history[0] ?? null;
    data = {
      ...summary,
      createdAt: text(head.created_at),
      current,
      history,
      historyTruncated: versions.ok && versions.rows.length > 500,
    };
    coverageRows = [data as Record<string, unknown>];
    coverageFields = ["title", "createdAt", "current"];
  } else if (resource === "thesis_versions") {
    if (read.rows.length === 0) {
      const head = await readAsUser(auth, "thesis", { id: opts.id }, deps);
      if (!head.ok || head.rows.length === 0) {
        return jsonError("not_found", { limit: auth.limit, remaining: auth.remaining });
      }
    }
    const sliced = pageOf(read.rows, limit, "version", "id");
    data = sliced.pageRows.map((row) => ({
      id: text(row.id),
      thesisId: text(row.thesis_id),
      version: typeof row.version === "number" ? row.version : 0,
      previousVersion: typeof row.previous_version === "number" ? row.previous_version : null,
      transition: text(row.transition),
      lifecycleState: text(row.lifecycle_state),
      subject: row.subject_ref,
      content: row.content,
      clientRequestId: text(row.client_request_id),
      systemRecordedAt: text(row.system_recorded_at),
      effectiveAt: text(row.effective_at) || null,
    }));
    for (const v of data as Record<string, unknown>[]) assertNoForbiddenFields(v);
    page = sliced.page;
    coverageRows = data as Record<string, unknown>[];
    coverageFields = ["effectiveAt", "previousVersion"];
  } else if (resource === "watchlists") {
    const sliced = pageOf(read.rows, limit, "position", "id");
    const mapped = sliced.pageRows.map(mapWatchlist).filter((v): v is ApiV1Watchlist => v != null);
    for (const w of mapped) assertNoForbiddenFields(w);
    data = mapped;
    page = sliced.page;
    coverageRows = mapped as unknown as Record<string, unknown>[];
    coverageFields = ["id", "name", "symbols"];
  } else if (resource === "watchlist") {
    if (read.rows.length === 0) {
      return jsonError("not_found", { limit: auth.limit, remaining: auth.remaining });
    }
    const mapped = mapWatchlist(read.rows[0]);
    if (!mapped) return jsonError("not_found", { limit: auth.limit, remaining: auth.remaining });
    assertNoForbiddenFields(mapped);
    data = mapped;
    coverageRows = [mapped as unknown as Record<string, unknown>];
    coverageFields = ["symbols"];
  } else if (resource === "alerts") {
    const sliced = pageOf(read.rows, limit, "created_at", "id");
    const mapped = sliced.pageRows.map(mapAlert).filter((v): v is ApiV1Alert => v != null);
    for (const a of mapped) assertNoForbiddenFields(a);
    data = mapped;
    page = sliced.page;
    coverageRows = mapped as unknown as Record<string, unknown>[];
    coverageFields = ["symbol", "createdAt"];
  } else if (resource === "alert_fires") {
    const sliced = pageOf(read.rows, limit, "created_at", "id");
    const mapped = sliced.pageRows.map(mapFire).filter((v): v is ApiV1AlertFire => v != null);
    for (const f of mapped) assertNoForbiddenFields(f);
    data = mapped;
    page = sliced.page;
    coverageRows = mapped as unknown as Record<string, unknown>[];
    coverageFields = ["deliveredAt", "payload"];
  } else if (resource === "claims") {
    const sliced = pageOf(read.rows, limit, "stated_at", "claim_id");
    const mapped = sliced.pageRows.map(mapClaim).filter((v): v is ApiV1Claim => v != null);
    for (const c of mapped) assertNoForbiddenFields(c);
    data = mapped;
    page = sliced.page;
    coverageRows = mapped as unknown as Record<string, unknown>[];
    coverageFields = ["stated_probability", "resolution", "supersedes"];
  } else if (resource === "positions") {
    const sliced = pageOf(read.rows, limit, "created_at", "id");
    const mapped = sliced.pageRows.map(mapPosition).filter((v): v is ApiV1Position => v != null);
    for (const p of mapped) assertNoForbiddenFields(p);
    data = mapped;
    page = sliced.page;
    coverageRows = mapped as unknown as Record<string, unknown>[];
    coverageFields = ["shares", "entryPrice", "entryDate", "notes"];
  } else if (resource === "me") {
    const me: ApiV1Me = { userId: auth.userId, keyPrefix: auth.keyPrefix, scopes: auth.scopes };
    data = me;
    coverageRows = [me as unknown as Record<string, unknown>];
    coverageFields = ["keyPrefix"];
  } else {
    return jsonError("not_found", { limit: auth.limit, remaining: auth.remaining });
  }

  const body = envelope(schema, data, page, coverageOf(coverageRows, coverageFields));
  const etag = etagFor({ schema: body.schema, version: body.version, data: body.data, page: body.page, coverage: body.coverage });
  if (ifNoneMatchHits(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: { ...rateHeaders(auth.limit, auth.remaining), ETag: etag },
    });
  }
  return NextResponse.json(body, {
    status: 200,
    headers: { ...rateHeaders(auth.limit, auth.remaining), ETag: etag },
  });
}

export async function handleV1Get(
  request: Request,
  resource: string,
  opts: { id?: string; extraArgs?: Record<string, unknown> } = {},
  deps?: ApiV1Deps,
): Promise<NextResponse> {
  try {
    return await handleV1GetInternal(request, resource, opts, deps);
  } catch {
    return jsonError("server_error");
  }
}

export async function handleV1Index(request: Request, deps?: ApiV1Deps): Promise<NextResponse> {
  const authResult = await authenticateApiKey(request, deps);
  if (!authResult.ok) return authResult.response;
  const { auth } = authResult;
  const data = {
    ceiling: "read_only_projection",
    truth: { en: API_V1_TRUTH_EN, zh: API_V1_TRUTH_ZH },
    team_keys: { available: false, message: API_V1_TEAM_KEYS_NULL_EN, message_zh: API_V1_TEAM_KEYS_NULL_ZH },
    briefs: { available: false, message: API_V1_BRIEFS_NULL_EN, message_zh: API_V1_BRIEFS_NULL_ZH },
    rate_limit: { per_minute: API_V1_RATE_LIMIT_MINUTE, per_day: 5000 },
    version: API_V1_VERSION,
    resources: API_V1_RESOURCES,
  };
  assertNoForbiddenFields(data);
  const body = envelope(schemaFor("index"), data, { next_cursor: null, limit: API_V1_DEFAULT_LIMIT }, { rows: 1, nulls: [] });
  const etag = etagFor({ schema: body.schema, version: body.version, data: body.data });
  if (ifNoneMatchHits(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: { ...rateHeaders(auth.limit, auth.remaining), ETag: etag },
    });
  }
  return NextResponse.json(body, {
    status: 200,
    headers: { ...rateHeaders(auth.limit, auth.remaining), ETag: etag },
  });
}

export function asofNow(): string {
  return rfc3339Utc();
}
