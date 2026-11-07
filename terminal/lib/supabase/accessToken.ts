import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Verify one access token with Supabase Auth, without any session.
 *
 * The cookie-backed server client (lib/supabase/server.ts) loads the stored
 * session as soon as it is built, and auth-js refreshes a session that is near
 * expiry during that load, even with auto-refresh off. That spends the
 * browser's refresh token. It is harmless inside an ordinary request, whose
 * response carries the rotated cookie, but not inside a response that is
 * already streaming. This client has no stored session, so it can only ask
 * Auth whether the given token is still valid.
 */
let sessionless: SupabaseClient | null = null;

export async function verifyAccessToken(token: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !token) return false;
  sessionless ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    const { data, error } = await sessionless.auth.getUser(token);
    return !error && !!data.user;
  } catch {
    return false;
  }
}
