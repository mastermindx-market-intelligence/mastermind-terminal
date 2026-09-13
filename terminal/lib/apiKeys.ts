import type { DbResult, WatchlistDb, WatchlistQuery } from "@/lib/watchlists";
import {
  API_KEY_MAX_ACTIVE,
  apiKeyPrefix,
  generateApiKeySecret,
  hashApiKey,
  isWellFormedApiKey,
} from "@/lib/apiV1";

export type ApiKeysDb = WatchlistDb;

export type ApiKeyMeta = {
  keyId: string;
  keyPrefix: string;
  label: string;
  scopes: string[];
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const META_FIELDS = "key_id,key_prefix,label,scopes,created_at,last_used_at,revoked_at";

const rows = (result: DbResult): Record<string, unknown>[] =>
  (Array.isArray(result?.data) ? result.data : []) as Record<string, unknown>[];
const one = (result: DbResult): Record<string, unknown> | null => {
  const data = result?.data;
  if (Array.isArray(data)) return (data[0] ?? null) as Record<string, unknown> | null;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
};
const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

function rowToMeta(row: Record<string, unknown>): ApiKeyMeta | null {
  const keyId = text(row.key_id);
  const keyPrefix = text(row.key_prefix);
  const label = text(row.label);
  if (!keyId || !keyPrefix || !label) return null;
  const scopes = Array.isArray(row.scopes)
    ? row.scopes.filter((s): s is string => typeof s === "string")
    : ["read"];
  return {
    keyId,
    keyPrefix,
    label,
    scopes,
    createdAt: text(row.created_at),
    lastUsedAt: text(row.last_used_at),
    revokedAt: text(row.revoked_at),
  };
}

function queryHasHash(select: string | undefined): boolean {
  if (!select) return false;
  return /(^|[, ])key_hash([, ]|$)/.test(select.replace(/\s+/g, " "));
}

export function assertNoHashInSelect(select: string): void {
  if (queryHasHash(select)) {
    throw new Error("api_keys hash must never be selected for a client");
  }
}

export async function listApiKeys(db: ApiKeysDb, userId: string): Promise<
  { ok: true; keys: ApiKeyMeta[] } | { ok: false; error: string }
> {
  assertNoHashInSelect(META_FIELDS);
  const result = await db
    .from("api_keys")
    .select(META_FIELDS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (result.error) return { ok: false, error: result.error.message || "unavailable" };
  const keys: ApiKeyMeta[] = [];
  for (const row of rows(result)) {
    const meta = rowToMeta(row);
    if (meta) keys.push(meta);
  }
  return { ok: true, keys };
}

export type MintResult =
  | { ok: true; key: ApiKeyMeta; secret: string }
  | { ok: false; status: "limit" | "unavailable" | "invalid_label"; error: string };

const LABEL_MAX = 80;
const CONTROL = /[\u0000-\u001f\u007f]/;

export function normalizeKeyLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim();
  if (!label || label.length > LABEL_MAX || CONTROL.test(label)) return null;
  return label;
}

export async function mintApiKey(
  db: ApiKeysDb,
  userId: string,
  labelRaw: unknown,
): Promise<MintResult> {
  const label = normalizeKeyLabel(labelRaw);
  if (!label) return { ok: false, status: "invalid_label", error: "invalid_label" };

  const listed = await listApiKeys(db, userId);
  if (!listed.ok) return { ok: false, status: "unavailable", error: listed.error };
  const active = listed.keys.filter((k) => !k.revokedAt).length;
  if (active >= API_KEY_MAX_ACTIVE) {
    return { ok: false, status: "limit", error: "active_key_limit" };
  }

  const secret = generateApiKeySecret();
  if (!isWellFormedApiKey(secret)) {
    return { ok: false, status: "unavailable", error: "key_generate_failed" };
  }
  const key_hash = hashApiKey(secret);
  const key_prefix = apiKeyPrefix(secret);

  const insert = await (db.from("api_keys") as WatchlistQuery)
    .insert({
      user_id: userId,
      key_hash,
      key_prefix,
      label,
      scopes: ["read"],
    })
    .select(META_FIELDS)
    .maybeSingle();
  if (insert.error) {
    const msg = insert.error.message || "";
    if (msg.includes("active_key_limit")) {
      return { ok: false, status: "limit", error: "active_key_limit" };
    }
    return { ok: false, status: "unavailable", error: msg || "unavailable" };
  }
  const meta = insert.data && typeof insert.data === "object" && !Array.isArray(insert.data)
    ? rowToMeta(insert.data as Record<string, unknown>)
    : null;
  if (!meta) return { ok: false, status: "unavailable", error: "mint_unconfirmed" };
  if ("key_hash" in (insert.data as object)) {
    return { ok: false, status: "unavailable", error: "hash_leaked" };
  }
  return { ok: true, key: meta, secret };
}

export type RevokeResult =
  | { ok: true; key: ApiKeyMeta }
  | { ok: false; status: "not_found" | "unavailable"; error: string };

export async function revokeApiKey(
  db: ApiKeysDb,
  userId: string,
  keyId: string,
): Promise<RevokeResult> {
  const id = typeof keyId === "string" ? keyId.trim() : "";
  if (!id) return { ok: false, status: "not_found", error: "not_found" };
  const updated = await (db.from("api_keys") as WatchlistQuery)
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("key_id", id)
    .select(META_FIELDS)
    .maybeSingle();
  if (updated.error) return { ok: false, status: "unavailable", error: updated.error.message || "unavailable" };
  const meta = updated.data && typeof updated.data === "object" && !Array.isArray(updated.data)
    ? rowToMeta(updated.data as Record<string, unknown>)
    : null;
  if (!meta) return { ok: false, status: "not_found", error: "not_found" };
  return { ok: true, key: meta };
}
