import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ThesisDetail, ThesisSummary, ThesisVersion } from "@/lib/theses";
import type { ServerWatchlist } from "@/lib/watchlists";
import type { UserClaim } from "@/lib/personalAccuracy";
import type { Position } from "@/lib/portfolio";

/** Public API v1 contract freeze (B-F12-10 / MO-PAID-055). Version pin is the seat date. */
export const API_V1_VERSION = "2026-09-13";
export const API_V1_CEILING = "read_only_projection" as const;
export const API_KEY_HEAD = "mmx_";
export const API_KEY_SECRET_LEN = 40;
export const API_KEY_PREFIX_LEN = 8;
export const API_KEY_MAX_ACTIVE = 5;
export const API_V1_DEFAULT_LIMIT = 50;
export const API_V1_MAX_LIMIT = 200;
export const API_V1_RATE_LIMIT_MINUTE = 60;
export const API_V1_RATE_LIMIT_DAY = 5_000;

export const API_V1_TRUTH_EN =
  "This API returns what you already see in the Terminal. It originates no signals, rankings or advice.";
export const API_V1_TRUTH_ZH =
  "本接口只返回你在终端里已经能看到的内容。它不产生任何信号、排名或建议。";

export const API_V1_TEAM_KEYS_NULL_EN =
  "Team keys aren't available yet — keys are personal for now.";
export const API_V1_TEAM_KEYS_NULL_ZH =
  "团队密钥暂未开放，目前仅支持个人密钥。";

export const API_V1_BRIEFS_NULL_EN =
  "Briefs are not available on this API yet because the Terminal has no briefs table to read.";
export const API_V1_BRIEFS_NULL_ZH =
  "简报尚未加入此接口，因为终端里还没有可读取的简报表。";

export type ApiV1ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "invalid_request"
  | "server_error";

export const API_V1_ERROR_MESSAGES: Record<ApiV1ErrorCode, [string, string]> = {
  unauthorized: [
    "This request did not include a valid personal API key.",
    "这次请求没有带上有效的个人 API 密钥。",
  ],
  forbidden: [
    "This key cannot read that resource.",
    "此密钥无法读取该资源。",
  ],
  not_found: [
    "Nothing matching that id is visible with this key.",
    "用此密钥看不到与该编号匹配的内容。",
  ],
  rate_limited: [
    "This key has reached its request limit. Wait and try again.",
    "此密钥已达到请求上限，请稍后再试。",
  ],
  invalid_request: [
    "This request could not be read. Check the path, the cursor and the limit.",
    "无法读取这次请求。请检查路径、游标和条数上限。",
  ],
  server_error: [
    "The API could not prepare a safe response. Try again later.",
    "接口无法准备安全的响应。请稍后再试。",
  ],
};

export type ApiV1CoverageNull = { field: string; reason: string };
export type ApiV1Coverage = { rows: number; nulls: ApiV1CoverageNull[] };
export type ApiV1Page = { next_cursor: string | null; limit: number };

export type ApiV1Envelope<T> = {
  schema: string;
  version: typeof API_V1_VERSION;
  asof: string;
  data: T;
  page: ApiV1Page;
  coverage: ApiV1Coverage;
};

export type ApiV1ErrorBody = {
  error: { code: ApiV1ErrorCode; message: string; message_zh: string };
};

/** UI read models cited by R5. Nothing new is computed. */
export type ApiV1Thesis = ThesisSummary;
export type ApiV1ThesisDetail = ThesisDetail;
export type ApiV1ThesisVersion = ThesisVersion;
export type ApiV1Watchlist = ServerWatchlist;
export type ApiV1Claim = UserClaim;
export type ApiV1Position = Position;

export type ApiV1Alert = {
  id: string;
  symbol: string;
  condition: Record<string, unknown>;
  active: boolean;
  createdAt: string | null;
};

export type ApiV1AlertFire = {
  id: string;
  alertId: string;
  fireEventId: string;
  channel: string;
  status: string;
  payload: Record<string, unknown> | null;
  createdAt: string | null;
  deliveredAt: string | null;
};

export type ApiV1Me = {
  userId: string;
  keyPrefix: string;
  scopes: string[];
};

export const API_V1_RESOURCES = [
  { path: "/api/v1", schema: "mm.api.v1.index", version: API_V1_VERSION },
  { path: "/api/v1/me", schema: "mm.api.v1.me", version: API_V1_VERSION },
  { path: "/api/v1/theses", schema: "mm.api.v1.theses", version: API_V1_VERSION },
  { path: "/api/v1/theses/{id}", schema: "mm.api.v1.thesis", version: API_V1_VERSION },
  { path: "/api/v1/theses/{id}/versions", schema: "mm.api.v1.thesis_versions", version: API_V1_VERSION },
  { path: "/api/v1/watchlists", schema: "mm.api.v1.watchlists", version: API_V1_VERSION },
  { path: "/api/v1/watchlists/{id}", schema: "mm.api.v1.watchlist", version: API_V1_VERSION },
  { path: "/api/v1/alerts", schema: "mm.api.v1.alerts", version: API_V1_VERSION },
  { path: "/api/v1/alerts/{id}/fires", schema: "mm.api.v1.alert_fires", version: API_V1_VERSION },
  { path: "/api/v1/claims", schema: "mm.api.v1.claims", version: API_V1_VERSION },
  { path: "/api/v1/positions", schema: "mm.api.v1.positions", version: API_V1_VERSION },
  { path: "/api/v1/openapi.json", schema: "mm.api.v1.openapi", version: API_V1_VERSION },
] as const;

export const FORBIDDEN_API_FIELDS = [
  "confidence",
  "llm_confidence",
  "model_confidence",
  "probability",
  "rank",
  "ranking",
  "score",
  "llm_score",
  "signal_score",
] as const;

const URL_SAFE = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function generateApiKeySecret(): string {
  // 30 bytes → 40 base64url characters. Prefix is mmx_.
  return `${API_KEY_HEAD}${randomBytes(30).toString("base64url")}`;
}

export function isWellFormedApiKey(value: string): boolean {
  if (!value.startsWith(API_KEY_HEAD)) return false;
  const secret = value.slice(API_KEY_HEAD.length);
  return secret.length === API_KEY_SECRET_LEN && URL_SAFE.test(secret);
}

export function hashApiKey(fullKey: string): string {
  return createHash("sha256").update(fullKey, "utf8").digest("hex");
}

export function apiKeyPrefix(fullKey: string): string {
  return fullKey.slice(API_KEY_HEAD.length, API_KEY_HEAD.length + API_KEY_PREFIX_LEN);
}

/** Constant-time compare of two SHA-256 hex hashes. Length mismatch is false. */
export function hashesEqual(a: string, b: string): boolean {
  if (!SHA256_HEX.test(a) || !SHA256_HEX.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function rfc3339Utc(date: Date = new Date()): string {
  return date.toISOString();
}

export function parseLimit(raw: string | null): number | null {
  if (raw == null || raw === "") return API_V1_DEFAULT_LIMIT;
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > API_V1_MAX_LIMIT) return null;
  return n;
}

export function encodeCursor(stamp: string, id: string): string {
  return Buffer.from(`${stamp}|${id}`, "utf8").toString("base64");
}

export function decodeCursor(cursor: string): { stamp: string; id: string } | null {
  try {
    const text = Buffer.from(cursor, "base64").toString("utf8");
    const at = text.indexOf("|");
    if (at < 1) return null;
    const stamp = text.slice(0, at);
    const id = text.slice(at + 1);
    if (!stamp || !id) return null;
    return { stamp, id };
  } catch {
    return null;
  }
}

export function coverageOf(
  rows: Array<Record<string, unknown>>,
  fields: readonly string[],
): ApiV1Coverage {
  const nulls: ApiV1CoverageNull[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const field of fields) {
      if (row[field] == null && !seen.has(field)) {
        seen.add(field);
        nulls.push({
          field,
          reason: "This field was empty on at least one row in the source.",
        });
      }
    }
  }
  return { rows: rows.length, nulls };
}

export function envelope<T>(
  schema: string,
  data: T,
  page: ApiV1Page,
  coverage: ApiV1Coverage,
  asof: string = rfc3339Utc(),
): ApiV1Envelope<T> {
  return {
    schema,
    version: API_V1_VERSION,
    asof,
    data,
    page,
    coverage,
  };
}

export function errorBody(code: ApiV1ErrorCode): ApiV1ErrorBody {
  const [message, message_zh] = API_V1_ERROR_MESSAGES[code];
  return { error: { code, message, message_zh } };
}

export function errorStatus(code: ApiV1ErrorCode): number {
  if (code === "unauthorized") return 401;
  if (code === "forbidden") return 403;
  if (code === "not_found") return 404;
  if (code === "rate_limited") return 429;
  if (code === "server_error") return 500;
  return 400;
}

export function etagFor(payload: unknown): string {
  const json = JSON.stringify(payload);
  return `"${createHash("sha256").update(json).digest("hex")}"`;
}

export function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").map((p) => p.trim()).includes(etag);
}

const FORBIDDEN_RE = new RegExp(
  `(^|[^a-z_])(${FORBIDDEN_API_FIELDS.join("|")})([^a-z_]|$)`,
  "i",
);

/** Walk a JSON value. Returns the first forbidden field name, or null. */
export function firstForbiddenField(value: unknown, path = ""): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = firstForbiddenField(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // User-stated claim probability is the person's own number, not a model score.
      if (key === "stated_probability" || key === "statedProbability") {
        const hit = firstForbiddenField(child, `${path}.${key}`);
        if (hit) return hit;
        continue;
      }
      if (FORBIDDEN_RE.test(key) && FORBIDDEN_API_FIELDS.includes(key.toLowerCase() as typeof FORBIDDEN_API_FIELDS[number])) {
        return path ? `${path}.${key}` : key;
      }
      const hit = firstForbiddenField(child, path ? `${path}.${key}` : key);
      if (hit) return hit;
    }
  }
  return null;
}

export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : null;
}

export function schemaFor(resource: string): string {
  return `mm.api.v1.${resource}`;
}
