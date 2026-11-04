import "server-only";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sharingFailure, sharingResponse } from "./briefDeliverySharingServer";
import { readSharingRequestFeed, type TerminalRequestViewer } from "./briefSharingRequests";
import type { SharingDb } from "./briefDeliverySharing";
const TERMINAL_AUTH_ORIGIN = "https://fsldfzlxyavsuwqbceod.supabase.co";
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const hash = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
export function terminalPrincipalScope(id: string): string {
  if (!uuid(id)) throw new Error("terminal_identity_unavailable");
  return hash("mastermind.terminal.principal.v1:" + id);
}
/** Claims are association preconditions only. Auth.getUser(token) AND the RPC's
 * own verified JWT remain mandatory. This parser never authenticates a token. */
export function terminalTokenSelection(token: string, now: number): ({ userId: string; expiresAt: number } & TerminalRequestViewer) | null {
  try {
    if (token.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
    const p = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (!p || typeof p !== "object" || !uuid(p.sub) || !uuid(p.session_id) || p.iss !== TERMINAL_AUTH_ORIGIN + "/auth/v1" || (p.aud !== "authenticated" && !(Array.isArray(p.aud) && p.aud.length === 1 && p.aud[0] === "authenticated")) || !Number.isSafeInteger(p.exp) || p.exp <= now) return null;
    return { userId: p.sub, expiresAt: p.exp, principal_scope: terminalPrincipalScope(p.sub), session_scope: hash("mastermind.terminal.session.v1:" + p.sub + ":" + p.session_id) };
  } catch { return null; }
}
function nativeDb(token: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url?.replace(/\/$/, "") !== TERMINAL_AUTH_ORIGIN || !key) return null;
  return createClient(TERMINAL_AUTH_ORIGIN, key, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
/** Separate fixed native bearer reader. Cookie/Acquisition/Auth0 never supplies identity. */
export async function readNativeSharingRequestFeed(request: Request): Promise<Response> {
  if (new URL(request.url).search || request.headers.has("cookie")) return sharingFailure("invalid_input", 400);
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return sharingFailure("not_signed_in", 401);
  const token = auth.slice(7), selected = terminalTokenSelection(token, Math.floor(Date.now() / 1000));
  if (!selected) return sharingFailure("not_signed_in", 401);
  let db: SupabaseClient;
  try {
    const client = nativeDb(token);
    if (!client) return sharingFailure("unavailable", 503);
    db = client;
    const before = await db.auth.getUser(token);
    if (before.error || before.data.user?.id !== selected.userId) return sharingFailure("not_signed_in", 401);
  } catch { return sharingFailure("not_signed_in", 401); }
  const result = await readSharingRequestFeed(db as unknown as SharingDb, selected);
  try {
    const after = await db.auth.getUser(token);
    if (after.error || after.data.user?.id !== selected.userId || !terminalTokenSelection(token, Math.floor(Date.now() / 1000))) return sharingFailure("denied", 403);
  } catch { return sharingFailure("denied", 403); }
  return result.ok ? sharingResponse(result.value) : sharingFailure(result.code, result.code === "denied" ? 403 : 503);
}
