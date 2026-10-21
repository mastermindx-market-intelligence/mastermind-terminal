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
  // Invalid/revoked sessions are not recoverable with an offline retry.
  return typeof error.status === "number" &&
    error.status >= 400 && error.status < 500 &&
    error.status !== 408 && error.status !== 429;
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
    const { user, error } = await verify();
    if (error) return definitivelySignedOut(error) ? "guest" : "unavailable";
    if (!user) return "guest";
    try { storage?.setItem(RECOVERY_KEY, String(now)); } catch { /* best effort */ }
    navigate();
    return "restoring";
  } catch {
    // Network errors are not proof the account signed out.
    return "unavailable";
  }
}
