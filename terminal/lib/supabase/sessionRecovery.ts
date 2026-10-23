/** A server-denied member page may still have a renewable Supabase cookie.
 * Verify it with Auth before showing sign-up. Never infer identity from a cookie.
 */
const RECOVERY_KEY = "mmx-member-session-restore";
const RECOVERY_COOLDOWN_MS = 30_000;

interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
type AuthResult = { user: boolean; error?: { status?: number; name?: string } | null };
export type RecoveryResult = "guest" | "restoring" | "unavailable";

export function hasSupabaseAuthCookie(cookieHeader: string): boolean {
  return cookieHeader.split(";").some((part) =>
    /^sb-[a-z0-9]+-auth-token(?:\.\d+)?=/.test(part.trim()));
}

function definitivelySignedOut(error: AuthResult["error"]): boolean {
  if (!error) return false;
  if (error.name === "AuthSessionMissingError") return true;
  // Only an authoritative Auth unauthorized/forbidden error is revocation.
  // 409 (lost concurrent refresh), 400, 404, 408 and 429 must not force
  // a new login, nor should an unrelated proxy error.
  return error.status === 401 || error.status === 403;
}

export async function recoverMemberSession({
  cookieHeader, verify, navigate, storage, now = Date.now(), manualRetry = false,
}: {
  cookieHeader: string;
  verify: () => Promise<AuthResult>;
  navigate: () => void;
  storage?: RecoveryStorage;
  now?: number;
  manualRetry?: boolean;
}): Promise<RecoveryResult> {
  if (!hasSupabaseAuthCookie(cookieHeader)) return "guest";

  // One successful verification can reload this route once; a broken server
  // refresh path must not create an infinite redirect or a login loop.
  try {
    const last = Number(storage?.getItem(RECOVERY_KEY) || "0");
    if (!manualRetry && last > 0 && now - last >= 0 && now - last < RECOVERY_COOLDOWN_MS) {
      return "unavailable";
    }
  } catch { /* storage may be unavailable in a hardened browser */ }

  try {
    let result = await verify();
    // auth-js 2.108 can briefly report no session when another tab has already
    // rotated the shared cookie (fixed upstream in 2.117.1, which requires
    // Node >=22; production currently runs Node 20). Re-read the existing Auth
    // client ONCE before treating that ambiguous state as logout. Never retry
    // authoritative invalid-token 4xx or transient 5xx failures, and never
    // grant workspace access unless the recheck actually verifies a user.
    if (!result.user && (!result.error ||
      result.error.name === "AuthSessionMissingError" ||
      result.error.name === "AuthRefreshDiscardedError")) {
      result = await verify();
    }
    const { user, error } = result;
    if (error) return definitivelySignedOut(error) ? "guest" : "unavailable";
    // A cookie-bearing visitor with no user AND no Auth error remains
    // unverified, not signed out. Preserve the retry state instead of
    // incorrectly advertising account creation on an inconclusive refresh.
    if (!user) return "unavailable";
    // Without a durable per-tab guard, navigation can reload the same
    // still-guest server response forever. Do not navigate unless the marker
    // was written and read back successfully in this browser.
    if (!storage) return "unavailable";
    try {
      storage.setItem(RECOVERY_KEY, String(now));
      if (storage.getItem(RECOVERY_KEY) !== String(now)) return "unavailable";
    } catch {
      return "unavailable";
    }
    navigate();
    return "restoring";
  } catch {
    // Network errors are not proof the account signed out.
    return "unavailable";
  }
}
