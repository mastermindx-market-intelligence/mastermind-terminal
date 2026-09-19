import type { DbResult, WatchlistDb, WatchlistQuery } from "@/lib/watchlists";
import {
  API_KEY_MAX_ACTIVE,
  apiKeyDigest,
  apiKeyPrefix,
  generateApiKeySecret,
  newApiKeySalt,
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
  const key_salt = newApiKeySalt();
  const key_digest = apiKeyDigest(secret, key_salt);
  const key_prefix = apiKeyPrefix(secret);

  const insert = await (db.from("api_keys") as WatchlistQuery)
    .insert({
      user_id: userId,
      key_digest,
      key_salt,
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
  | { ok: false; status: "not_found" | "unavailable" | "forbidden"; error: string };

/**
 * Revokes an API key exclusively through the SECURITY DEFINER function
 * revoke_api_key(uuid). This is the only permitted revoke path after MAJOR-2:
 * direct UPDATE on revoked_at is forbidden for authenticated, and a BEFORE UPDATE
 * trigger rejects any unrevoke attempt. The function enforces ownership via the
 * api_keys_update_own policy (auth.uid() = user_id).
 *
 * @param callerId - the authenticated user's ID, passed as p_caller so the SQL function
 *                    can assert auth.uid() = callerId and return 'unauthorized' if null.
 * @param service - a service-role client with an rpc() method, e.g. createServiceClient().
 */
export async function revokeApiKey(
  db: ApiKeysDb,
  userId: string,
  keyId: string,
  callerId: string,
  service?: { rpc: (fn: string, args: Record<string, unknown>) => unknown },
): Promise<RevokeResult> {
  const id = typeof keyId === "string" ? keyId.trim() : "";
  if (!id) return { ok: false, status: "not_found", error: "not_found" };

  if (!service) {
    return { ok: false, status: "unavailable", error: "service_unavailable" };
  }

  const raw = await service.rpc("revoke_api_key", { p_key_id: id, p_caller: callerId });
  const result = (
    raw && typeof raw === "object" && "then" in raw
      ? await raw
      : raw
  ) as { data?: { ok?: boolean; error?: string } | null; error?: { message?: string } | null };

  if (result.error) {
    return { ok: false, status: "unavailable", error: result.error.message || "unavailable" };
  }
  const row = result.data as { ok?: boolean; error?: string } | null;
  if (!row || row.ok === false) {
    const err = (result.data as { error?: string } | null)?.error;
    if (err === "forbidden") {
      return { ok: false, status: "forbidden", error: "forbidden" };
    }
    return { ok: false, status: "not_found", error: "not_found" };
  }

  // Re-fetch the updated key for the response
  const listed = await listApiKeys(db, userId);
  if (!listed.ok) return { ok: false, status: "unavailable", error: "unavailable" };
  const meta = listed.keys.find((k) => k.keyId === id) ?? null;
  if (!meta) return { ok: false, status: "not_found", error: "not_found" };
  return { ok: true, key: meta };
}
