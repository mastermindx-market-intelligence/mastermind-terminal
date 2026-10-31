import "server-only";
import { createClient } from "./supabase/server";

export type ScenarioSession =
  | { status: "ok"; userId: string; token: string }
  | { status: "denied" | "unavailable" };

function retryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; status?: unknown };
  return e.name === "AuthRetryableFetchError" || (typeof e.status === "number"
    && (e.status === 0 || e.status === 429 || e.status >= 500));
}

/** Verify the exact cookie-session token that the private native caller will use.
 * Never read an incoming Authorization header or infer identity from token claims.
 * expectedPrincipal comes from an already-verified server save session, never a client field.
 */
export async function readScenarioSession(expectedPrincipal?: string): Promise<ScenarioSession> {
  try {
    const db = await createClient();
    const session = await db.auth.getSession();
    if (session.error) return { status: retryable(session.error) ? "unavailable" : "denied" };
    const token = session.data.session?.access_token;
    if (typeof token !== "string" || !token || token.length > 16384 || /\s/.test(token)) return { status: "denied" };
    const verified = await db.auth.getUser(token);
    if (verified.error) return { status: retryable(verified.error) ? "unavailable" : "denied" };
    const user = verified.data.user;
    if (!user || user.is_anonymous === true || typeof user.id !== "string" || !user.id
      || (expectedPrincipal !== undefined && user.id !== expectedPrincipal)) return { status: "denied" };
    return { status: "ok", userId: user.id, token };
  } catch { return { status: "unavailable" }; }
}
