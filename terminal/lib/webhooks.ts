import crypto from "node:crypto";
import { getCallerRole, isAbsentTableError, listTeams, type TeamRole, type TenancyDb, type TenancyRpcDb } from "@/lib/teams";
import type { DbRow } from "@/lib/watchlists";
import { validateWebhookUrl, type WebhookUrlErr } from "@/lib/webhookUrl";

export const WEBHOOK_ENDPOINTS_TABLE = "webhook_endpoints";
export const WEBHOOK_DELIVERIES_TABLE = "webhook_deliveries";
export const WEBHOOK_ALERT_OPTINS_TABLE = "webhook_alert_optins";
export const ENQUEUE_TEST_FN = "enqueue_test_webhook_delivery";
export const ROTATE_FN = "rotate_webhook_secret";
export const REQUEUE_FN = "requeue_failed_webhook_delivery";
export const LEGAL_EVENT_TYPES = ["webhook.test", "alert.fired"] as const;
export const SAFE_ENDPOINT_COLUMNS =
  "id,team_id,url,enabled,event_filter,created_by,created_at,secret_version,secret_rotated_at";
export const SAFE_DELIVERY_COLUMNS =
  "id,endpoint_id,team_id,event_id,event_type,attempt,status,response_code,last_error,next_retry_at,delivered_at,created_at";
export const MAX_ENDPOINTS = 50;
export const MAX_DELIVERIES = 20;

const ALLOWED_PATCH_KEYS = new Set(["enabled", "url", "event_filter"]);

export type WebhookRouteCode =
  | "not_signed_in"
  | "not_admin"
  | "unavailable"
  | "read_failed"
  | "write_failed"
  | "closed_patch"
  | "invalid_url"
  | "not_https"
  | "private_address"
  | "send_json"
  | "team_required"
  | "endpoint_disabled"
  | "not_found"
  | "test_failed"
  | "invalid_filter"
  | "rotate_failed"
  | "requeue_failed"
  | "not_failed"
  | "optin_failed"
  | "not_member";

export const WEBHOOK_ROUTE_MESSAGES: Record<WebhookRouteCode, [string, string]> = {
  not_signed_in: ["You are not signed in.", "你尚未登录。"],
  not_admin: [
    "Only a team owner or admin can add or change webhook endpoints.",
    "只有团队所有者或管理员才能添加或更改 Webhook 端点。",
  ],
  unavailable: [
    "Webhook endpoints are not set up on this server yet.",
    "此服务器尚未启用 Webhook 端点。",
  ],
  read_failed: ["We could not read webhook endpoints just now.", "我们暂时无法读取 Webhook 端点。"],
  write_failed: ["We could not save that webhook endpoint.", "我们无法保存该 Webhook 端点。"],
  closed_patch: [
    "That change is not allowed. You can only update the address, whether it is active, or the event types.",
    "不允许该更改。你只能更新地址、是否启用或事件类型。",
  ],
  invalid_url: ["Enter an https address on the public internet.", "请输入公网的 https 地址。"],
  not_https: ["Webhook addresses must use https.", "Webhook 地址必须使用 https。"],
  private_address: [
    "Use an https address on the public internet. Private or local addresses are not allowed.",
    "请使用公网的 https 地址。不支持私有或本地地址。",
  ],
  send_json: ["Send a JSON body.", "请发送 JSON 正文。"],
  team_required: ["Choose a team.", "请选择一个团队。"],
  endpoint_disabled: [
    "This endpoint is turned off, so we did not send a test event.",
    "此端点已关闭，因此我们未发送测试事件。",
  ],
  not_found: ["We could not find that webhook endpoint.", "找不到该 Webhook 端点。"],
  test_failed: ["We could not queue a test event just now.", "我们暂时无法排队发送测试事件。"],
  invalid_filter: ["Choose at least one event type that this endpoint accepts.", "请至少选择一种此端点接受的事件类型。"],
  rotate_failed: [
    "We could not rotate this endpoint's signing secret just now.",
    "我们暂时无法更换该端点的签名密钥。",
  ],
  requeue_failed: [
    "We could not queue this delivery again just now.",
    "我们暂时无法重新排队发送这条记录。",
  ],
  not_failed: [
    "This delivery has not given up yet, so it cannot be sent again.",
    "这条送达还没有放弃，因此不能重新发送。",
  ],
  optin_failed: [
    "We could not save your alert-fire setting just now.",
    "我们暂时无法保存你的提醒触发设置。",
  ],
  not_member: ["We could not find that team.", "找不到该团队。"],
};

export type WebhookEndpoint = {
  id: string;
  teamId: string;
  url: string;
  enabled: boolean;
  eventFilter: string[];
  createdBy: string | null;
  createdAt: string | null;
  secretVersion: number;
  secretRotatedAt: string | null;
};

export type WebhookDelivery = {
  id: string;
  endpointId: string;
  teamId: string;
  eventId: string;
  eventType: string;
  attempt: number;
  status: string;
  responseCode: number | null;
  lastError: string | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string | null;
};

function stripSecrets<T extends Record<string, unknown>>(row: T): Omit<T, "secret" | "secret_previous"> {
  const { secret: _secret, secret_previous: _previous, ...rest } = row;
  return rest;
}

export function jsonEndpoint(e: WebhookEndpoint) {
  return {
    id: e.id,
    teamId: e.teamId,
    url: e.url,
    enabled: e.enabled,
    eventFilter: e.eventFilter,
    createdBy: e.createdBy,
    createdAt: e.createdAt,
    secretVersion: e.secretVersion,
    secretRotatedAt: e.secretRotatedAt,
  };
}

function toEndpoint(row: DbRow | null): WebhookEndpoint | null {
  if (!row || typeof row.id !== "string" || typeof row.team_id !== "string" || typeof row.url !== "string") {
    return null;
  }
  const filter = Array.isArray(row.event_filter)
    ? row.event_filter.filter((v): v is string => typeof v === "string")
    : [];
  return {
    id: row.id,
    teamId: row.team_id,
    url: row.url,
    enabled: row.enabled === true,
    eventFilter: filter,
    createdBy: typeof row.created_by === "string" ? row.created_by : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    secretVersion: typeof row.secret_version === "number" ? row.secret_version : 1,
    secretRotatedAt: typeof row.secret_rotated_at === "string" ? row.secret_rotated_at : null,
  };
}

function toDelivery(row: DbRow | null): WebhookDelivery | null {
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    endpointId: typeof row.endpoint_id === "string" ? row.endpoint_id : "",
    teamId: typeof row.team_id === "string" ? row.team_id : "",
    eventId: typeof row.event_id === "string" ? row.event_id : "",
    eventType: typeof row.event_type === "string" ? row.event_type : "",
    attempt: typeof row.attempt === "number" ? row.attempt : 0,
    status: typeof row.status === "string" ? row.status : "pending",
    responseCode: typeof row.response_code === "number" ? row.response_code : null,
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    nextRetryAt: typeof row.next_retry_at === "string" ? row.next_retry_at : null,
    deliveredAt: typeof row.delivered_at === "string" ? row.delivered_at : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
  };
}

export function newWebhookSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function normalizeEventFilter(value: unknown): string[] | null {
  if (value == null) return [...LEGAL_EVENT_TYPES];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    if (!(LEGAL_EVENT_TYPES as readonly string[]).includes(item)) return null;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

export function closedPatchOrReject(body: Record<string, unknown>): Record<string, unknown> | "closed" {
  const extra = Object.keys(body).filter((k) => !ALLOWED_PATCH_KEYS.has(k));
  if (extra.length) return "closed";
  const patch: Record<string, unknown> = {};
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") return "closed";
    patch.enabled = body.enabled;
  }
  if ("url" in body) patch.url = body.url;
  if ("event_filter" in body) patch.event_filter = body.event_filter;
  return patch;
}

export async function listEndpoints(
  db: TenancyDb,
  userId: string,
  teamId: string,
): Promise<
  | { ok: true; endpoints: WebhookEndpoint[]; callerRole: TeamRole; truncated: boolean }
  | { ok: false; reason: "unavailable" | "failed" | "forbidden" | "not_found"; error: string }
> {
  const roleResult = await getCallerRole(db, userId, teamId);
  if (!roleResult.ok) return roleResult;
  if (!roleResult.role) return { ok: false, reason: "not_found", error: "team not found" };

  const result = await db
    .from(WEBHOOK_ENDPOINTS_TABLE)
    .select(SAFE_ENDPOINT_COLUMNS)
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(MAX_ENDPOINTS);
  if (result.error) {
    return isAbsentTableError(result.error)
      ? { ok: false, reason: "unavailable", error: result.error.message || "unavailable" }
      : { ok: false, reason: "failed", error: result.error.message || "read failed" };
  }
  const rows = (Array.isArray(result.data) ? result.data : []) as DbRow[];
  const endpoints = rows
    .map((row) => toEndpoint(stripSecrets(row) as DbRow))
    .filter((e): e is WebhookEndpoint => e !== null);
  return { ok: true, endpoints, callerRole: roleResult.role, truncated: rows.length === MAX_ENDPOINTS };
}

export async function createEndpoint(
  db: TenancyDb,
  userId: string,
  input: { teamId: unknown; url: unknown; event_filter?: unknown },
): Promise<
  | { ok: true; endpoint: WebhookEndpoint; secret: string }
  | { ok: false; code: WebhookRouteCode; status: number; error: string }
> {
  const teamId = typeof input.teamId === "string" ? input.teamId.trim() : "";
  if (!teamId) return { ok: false, code: "team_required", status: 400, error: "team required" };

  const roleResult = await getCallerRole(db, userId, teamId);
  if (!roleResult.ok) {
    return {
      ok: false,
      code: roleResult.reason === "unavailable" ? "unavailable" : "read_failed",
      status: 503,
      error: roleResult.error,
    };
  }
  if (!roleResult.role) return { ok: false, code: "not_found", status: 404, error: "team not found" };
  if (roleResult.role !== "owner" && roleResult.role !== "admin") {
    return { ok: false, code: "not_admin", status: 403, error: "not admin" };
  }

  const urlCheck = validateWebhookUrl(input.url);
  if (!urlCheck.ok) {
    const err = urlCheck as WebhookUrlErr;
    return { ok: false, code: err.code, status: 400, error: err.code };
  }
  const url = (input.url as string).trim();
  const filter = normalizeEventFilter(input.event_filter);
  if (!filter || filter.length === 0) {
    return { ok: false, code: "invalid_filter", status: 400, error: "invalid filter" };
  }

  const secret = newWebhookSecret();
  const result = await db
    .from(WEBHOOK_ENDPOINTS_TABLE)
    .insert({
      team_id: teamId,
      url,
      secret,
      enabled: true,
      event_filter: filter,
      created_by: userId,
    })
    .select(SAFE_ENDPOINT_COLUMNS)
    .maybeSingle();
  if (result.error) {
    if (isAbsentTableError(result.error)) {
      return { ok: false, code: "unavailable", status: 503, error: result.error.message || "unavailable" };
    }
    const code = typeof (result.error as { code?: string }).code === "string" ? (result.error as { code: string }).code : "";
    if (code === "42501" || /permission denied|row-level security/i.test(result.error.message || "")) {
      return { ok: false, code: "not_admin", status: 403, error: "rls" };
    }
    return { ok: false, code: "write_failed", status: 500, error: result.error.message || "insert failed" };
  }
  const endpoint = toEndpoint(stripSecrets((result.data || {}) as DbRow) as DbRow);
  if (!endpoint) return { ok: false, code: "write_failed", status: 500, error: "insert returned no row" };
  return { ok: true, endpoint, secret };
}

export async function patchEndpoint(
  db: TenancyDb,
  userId: string,
  endpointId: string,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; endpoint: WebhookEndpoint }
  | { ok: false; code: WebhookRouteCode; status: number; error: string }
> {
  const closed = closedPatchOrReject(body);
  if (closed === "closed") return { ok: false, code: "closed_patch", status: 400, error: "closed patch" };
  const patch = { ...closed };
  if ("url" in patch) {
    const urlCheck = validateWebhookUrl(patch.url);
    if (!urlCheck.ok) {
      const err = urlCheck as WebhookUrlErr;
      return { ok: false, code: err.code, status: 400, error: err.code };
    }
    patch.url = (patch.url as string).trim();
  }
  if ("event_filter" in patch) {
    const filter = normalizeEventFilter(patch.event_filter);
    if (!filter || filter.length === 0) {
      return { ok: false, code: "invalid_filter", status: 400, error: "invalid filter" };
    }
    patch.event_filter = filter;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, code: "closed_patch", status: 400, error: "empty patch" };
  }

  const existing = await db
    .from(WEBHOOK_ENDPOINTS_TABLE)
    .select(SAFE_ENDPOINT_COLUMNS)
    .eq("id", endpointId)
    .maybeSingle();
  if (existing.error) {
    return isAbsentTableError(existing.error)
      ? { ok: false, code: "unavailable", status: 503, error: existing.error.message || "unavailable" }
      : { ok: false, code: "read_failed", status: 503, error: existing.error.message || "read failed" };
  }
  const current = toEndpoint(stripSecrets((existing.data || {}) as DbRow) as DbRow);
  if (!current) return { ok: false, code: "not_found", status: 404, error: "not found" };

  const roleResult = await getCallerRole(db, userId, current.teamId);
  if (!roleResult.ok) {
    return {
      ok: false,
      code: roleResult.reason === "unavailable" ? "unavailable" : "read_failed",
      status: 503,
      error: roleResult.error,
    };
  }
  if (!roleResult.role) return { ok: false, code: "not_found", status: 404, error: "not found" };
  if (roleResult.role !== "owner" && roleResult.role !== "admin") {
    return { ok: false, code: "not_admin", status: 403, error: "not admin" };
  }

  const result = await db
    .from(WEBHOOK_ENDPOINTS_TABLE)
    .update(patch)
    .eq("id", endpointId)
    .eq("team_id", current.teamId)
    .select(SAFE_ENDPOINT_COLUMNS)
    .maybeSingle();
  if (result.error) {
    if (isAbsentTableError(result.error)) {
      return { ok: false, code: "unavailable", status: 503, error: result.error.message || "unavailable" };
    }
    return { ok: false, code: "write_failed", status: 500, error: result.error.message || "update failed" };
  }
  const endpoint = toEndpoint(stripSecrets((result.data || current) as unknown as DbRow) as DbRow);
  if (!endpoint) return { ok: false, code: "write_failed", status: 500, error: "update returned no row" };
  return { ok: true, endpoint };
}

export async function listDeliveries(
  db: TenancyDb,
  userId: string,
  endpointId: string,
): Promise<
  | { ok: true; deliveries: WebhookDelivery[] }
  | { ok: false; code: WebhookRouteCode; status: number; error: string }
> {
  const existing = await db
    .from(WEBHOOK_ENDPOINTS_TABLE)
    .select(SAFE_ENDPOINT_COLUMNS)
    .eq("id", endpointId)
    .maybeSingle();
  if (existing.error) {
    return isAbsentTableError(existing.error)
      ? { ok: false, code: "unavailable", status: 503, error: existing.error.message || "unavailable" }
      : { ok: false, code: "read_failed", status: 503, error: existing.error.message || "read failed" };
  }
  const endpoint = toEndpoint(stripSecrets((existing.data || {}) as DbRow) as DbRow);
  if (!endpoint) return { ok: false, code: "not_found", status: 404, error: "not found" };

  const roleResult = await getCallerRole(db, userId, endpoint.teamId);
  if (!roleResult.ok) {
    return {
      ok: false,
      code: roleResult.reason === "unavailable" ? "unavailable" : "read_failed",
      status: 503,
      error: roleResult.error,
    };
  }
  if (!roleResult.role) return { ok: false, code: "not_found", status: 404, error: "not found" };

  const result = await db
    .from(WEBHOOK_DELIVERIES_TABLE)
    .select(SAFE_DELIVERY_COLUMNS)
    .eq("endpoint_id", endpointId)
    .eq("team_id", endpoint.teamId)
    .order("created_at", { ascending: false })
    .limit(MAX_DELIVERIES);
  if (result.error) {
    return isAbsentTableError(result.error)
      ? { ok: false, code: "unavailable", status: 503, error: result.error.message || "unavailable" }
      : { ok: false, code: "read_failed", status: 503, error: result.error.message || "read failed" };
  }
  const rows = (Array.isArray(result.data) ? result.data : []) as DbRow[];
  const deliveries = rows.map((row) => toDelivery(row)).filter((d): d is WebhookDelivery => d !== null);
  return { ok: true, deliveries };
}

export async function enqueueTestDelivery(
  db: TenancyRpcDb,
  userId: string,
  endpointId: string,
): Promise<
  | { ok: true; eventId: string }
  | { ok: false; code: WebhookRouteCode; status: number; error: string }
> {
  const existing = await db
    .from(WEBHOOK_ENDPOINTS_TABLE)
    .select(SAFE_ENDPOINT_COLUMNS)
    .eq("id", endpointId)
    .maybeSingle();
  if (existing.error) {
    return isAbsentTableError(existing.error)
      ? { ok: false, code: "unavailable", status: 503, error: existing.error.message || "unavailable" }
      : { ok: false, code: "read_failed", status: 503, error: existing.error.message || "read failed" };
  }
  const endpoint = toEndpoint(stripSecrets((existing.data || {}) as DbRow) as DbRow);
  if (!endpoint) return { ok: false, code: "not_found", status: 404, error: "not found" };

  const roleResult = await getCallerRole(db, userId, endpoint.teamId);
  if (!roleResult.ok) {
    return {
      ok: false,
      code: roleResult.reason === "unavailable" ? "unavailable" : "read_failed",
      status: 503,
      error: roleResult.error,
    };
  }
  if (!roleResult.role) return { ok: false, code: "not_found", status: 404, error: "not found" };
  if (roleResult.role !== "owner" && roleResult.role !== "admin") {
    return { ok: false, code: "not_admin", status: 403, error: "not admin" };
  }

  const result = await db.rpc(ENQUEUE_TEST_FN, { p_endpoint_id: endpointId });
  if (result.error) {
    if (isAbsentTableError(result.error)) {
      return { ok: false, code: "unavailable", status: 503, error: result.error.message || "unavailable" };
    }
    return { ok: false, code: "test_failed", status: 500, error: result.error.message || "rpc failed" };
  }
  const data = result.data as { ok?: boolean; reason?: string; event_id?: string } | null;
  if (!data || data.ok !== true) {
    if (data?.reason === "endpoint_disabled") {
      return { ok: false, code: "endpoint_disabled", status: 409, error: "disabled" };
    }
    return { ok: false, code: "not_found", status: 404, error: data?.reason || "not found" };
  }
  return { ok: true, eventId: String(data.event_id || "") };
}

export async function rotateEndpointSecret(
  db: TenancyRpcDb,
  userId: string,
  endpointId: string,
): Promise<
  | { ok: true; secret: string; secretVersion: number }
  | { ok: false; code: WebhookRouteCode; status: number; error: string }
> {
  const existing = await db
    .from(WEBHOOK_ENDPOINTS_TABLE)
    .select(SAFE_ENDPOINT_COLUMNS)
    .eq("id", endpointId)
    .maybeSingle();
  if (existing.error) {
    return isAbsentTableError(existing.error)
      ? { ok: false, code: "unavailable", status: 503, error: existing.error.message || "unavailable" }
      : { ok: false, code: "read_failed", status: 503, error: existing.error.message || "read failed" };
  }
  const endpoint = toEndpoint(stripSecrets((existing.data || {}) as DbRow) as DbRow);
  if (!endpoint) return { ok: false, code: "not_found", status: 404, error: "not found" };

  const roleResult = await getCallerRole(db, userId, endpoint.teamId);
  if (!roleResult.ok) {
    return {
      ok: false,
      code: roleResult.reason === "unavailable" ? "unavailable" : "read_failed",
      status: 503,
      error: roleResult.error,
    };
  }
  if (!roleResult.role) return { ok: false, code: "not_found", status: 404, error: "not found" };
  if (roleResult.role !== "owner" && roleResult.role !== "admin") {
    return { ok: false, code: "not_admin", status: 403, error: "not admin" };
  }

  const result = await db.rpc(ROTATE_FN, { p_endpoint_id: endpointId });
  if (result.error) {
    if (isAbsentTableError(result.error)) {
      return { ok: false, code: "unavailable", status: 503, error: result.error.message || "unavailable" };
    }
    return { ok: false, code: "rotate_failed", status: 500, error: result.error.message || "rpc failed" };
  }
  const data = result.data as { ok?: boolean; reason?: string; secret?: string; secret_version?: number } | null;
  if (!data || data.ok !== true) {
    return { ok: false, code: "not_found", status: 404, error: data?.reason || "not found" };
  }
  const secret = typeof data.secret === "string" ? data.secret : "";
  const secretVersion = typeof data.secret_version === "number" ? data.secret_version : endpoint.secretVersion + 1;
  return { ok: true, secret, secretVersion };
}

export async function requeueFailedDelivery(
  db: TenancyRpcDb,
  userId: string,
  endpointId: string,
  deliveryId: string,
): Promise<{ ok: true } | { ok: false; code: WebhookRouteCode; status: number; error: string }> {
  const existing = await db
    .from(WEBHOOK_ENDPOINTS_TABLE)
    .select(SAFE_ENDPOINT_COLUMNS)
    .eq("id", endpointId)
    .maybeSingle();
  if (existing.error) {
    return isAbsentTableError(existing.error)
      ? { ok: false, code: "unavailable", status: 503, error: existing.error.message || "unavailable" }
      : { ok: false, code: "read_failed", status: 503, error: existing.error.message || "read failed" };
  }
  const endpoint = toEndpoint(stripSecrets((existing.data || {}) as DbRow) as DbRow);
  if (!endpoint) return { ok: false, code: "not_found", status: 404, error: "not found" };

  const roleResult = await getCallerRole(db, userId, endpoint.teamId);
  if (!roleResult.ok) {
    return {
      ok: false,
      code: roleResult.reason === "unavailable" ? "unavailable" : "read_failed",
      status: 503,
      error: roleResult.error,
    };
  }
  if (!roleResult.role) return { ok: false, code: "not_found", status: 404, error: "not found" };
  if (roleResult.role !== "owner" && roleResult.role !== "admin") {
    return { ok: false, code: "not_admin", status: 403, error: "not admin" };
  }

  const delivery = await db
    .from(WEBHOOK_DELIVERIES_TABLE)
    .select(SAFE_DELIVERY_COLUMNS)
    .eq("id", deliveryId)
    .eq("endpoint_id", endpointId)
    .eq("team_id", endpoint.teamId)
    .maybeSingle();
  if (delivery.error) {
    return isAbsentTableError(delivery.error)
      ? { ok: false, code: "unavailable", status: 503, error: delivery.error.message || "unavailable" }
      : { ok: false, code: "read_failed", status: 503, error: delivery.error.message || "read failed" };
  }
  const row = toDelivery((delivery.data || null) as DbRow | null);
  if (!row) return { ok: false, code: "not_found", status: 404, error: "not found" };

  const result = await db.rpc(REQUEUE_FN, { p_delivery_id: deliveryId });
  if (result.error) {
    if (isAbsentTableError(result.error)) {
      return { ok: false, code: "unavailable", status: 503, error: result.error.message || "unavailable" };
    }
    return { ok: false, code: "requeue_failed", status: 500, error: result.error.message || "rpc failed" };
  }
  const data = result.data as { ok?: boolean; reason?: string } | null;
  if (!data || data.ok !== true) {
    if (data?.reason === "not_failed") {
      return { ok: false, code: "not_failed", status: 409, error: "not failed" };
    }
    return { ok: false, code: "not_found", status: 404, error: data?.reason || "not found" };
  }
  return { ok: true };
}

export async function readAlertOptin(
  db: TenancyDb,
  userId: string,
  teamId: string,
): Promise<
  | { ok: true; enabled: boolean }
  | { ok: false; code: WebhookRouteCode; status: number; error: string }
> {
  const roleResult = await getCallerRole(db, userId, teamId);
  if (!roleResult.ok) {
    return {
      ok: false,
      code: roleResult.reason === "unavailable" ? "unavailable" : "read_failed",
      status: 503,
      error: roleResult.error,
    };
  }
  if (!roleResult.role) return { ok: false, code: "not_member", status: 404, error: "not member" };

  const result = await db
    .from(WEBHOOK_ALERT_OPTINS_TABLE)
    .select("user_id,team_id,enabled")
    .eq("user_id", userId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (result.error) {
    return isAbsentTableError(result.error)
      ? { ok: false, code: "unavailable", status: 503, error: result.error.message || "unavailable" }
      : { ok: false, code: "read_failed", status: 503, error: result.error.message || "read failed" };
  }
  const row = result.data as DbRow | null;
  if (!row) return { ok: true, enabled: false };
  return { ok: true, enabled: row.enabled === true };
}

export async function writeAlertOptin(
  db: TenancyDb,
  userId: string,
  teamId: string,
  enabled: boolean,
): Promise<
  | { ok: true; enabled: boolean }
  | { ok: false; code: WebhookRouteCode; status: number; error: string }
> {
  const roleResult = await getCallerRole(db, userId, teamId);
  if (!roleResult.ok) {
    return {
      ok: false,
      code: roleResult.reason === "unavailable" ? "unavailable" : "read_failed",
      status: 503,
      error: roleResult.error,
    };
  }
  if (!roleResult.role) return { ok: false, code: "not_member", status: 404, error: "not member" };

  const result = await db
    .from(WEBHOOK_ALERT_OPTINS_TABLE)
    .upsert(
      { user_id: userId, team_id: teamId, enabled, updated_at: new Date().toISOString() },
      { onConflict: "user_id,team_id" },
    )
    .select("user_id,team_id,enabled")
    .maybeSingle();
  if (result.error) {
    if (isAbsentTableError(result.error)) {
      return { ok: false, code: "unavailable", status: 503, error: result.error.message || "unavailable" };
    }
    return { ok: false, code: "optin_failed", status: 500, error: result.error.message || "upsert failed" };
  }
  const row = result.data as DbRow | null;
  return { ok: true, enabled: row ? row.enabled === true : enabled };
}

export { listTeams };
