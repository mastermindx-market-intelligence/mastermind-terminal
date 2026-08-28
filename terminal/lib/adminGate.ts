import { createClient } from "@/lib/supabase/server";

// Owner gate for the /admin plane (page + APIs).
//
// Admin = any of:
//   1. profiles.is_admin — seeded for the owner in supabase/migrations/0003_search_events.sql;
//   2. email listed in ADMIN_EMAILS (comma-separated, terminal/.env.local) — fallback that
//      works before the migration seed, or for a second owner account;
//   3. dev escape hatch: ADMIN_DEV=1 AND NODE_ENV !== production — local guest-mode preview
//      has no auth server at all, so nothing else can grant access. Never set on the VPS.
//
// ── Why this returns a verdict rather than a boolean ──
// It used to answer `{ admin: boolean }`, computed as `!!data?.is_admin` from a query whose
// `error` was never destructured. So "the authority says you are not an admin" and "the authority
// did not answer" both collapsed into `admin: false`, and the callers turned that single false
// into a 404 / `notFound()`. During a Supabase blip the owner was told their own console does not
// exist — a lie the client then latched as a terminal state.
//
// The three outcomes are now distinct. FAIL-CLOSED IS PRESERVED: `unavailable` never grants
// access. It only changes what the caller is allowed to *say* — 503 "try again", not 404 "no such
// thing".
export type AdminVerdict =
  | { status: "admin"; email: string | null }
  | { status: "anonymous"; email: null }
  | { status: "denied"; email: string | null }
  | { status: "unavailable"; email: string | null };

// `getUser()` reports "no session" as an error too, so a bare `if (error)` would turn every
// logged-out visitor into an outage. A missing session is a definitive answer (anonymous); a
// transport failure or a 5xx from GoTrue is not, and must never bounce a signed-in admin to
// /login as though their session had ended.
function isMissingSession(err: { name?: string; status?: number } | null): boolean {
  if (!err) return false;
  return err.name === "AuthSessionMissingError" || err.status === 400 || err.status === 401;
}

export async function isAdminRequest(): Promise<AdminVerdict> {
  // Require a POSITIVE dev signal (=== "development"), not merely "not production": a stray
  // process launched without NODE_ENV pinned (custom node server, PM2) must NOT satisfy this.
  if (process.env.NODE_ENV === "development" && process.env.ADMIN_DEV === "1") {
    return { status: "admin", email: "dev@local" };
  }
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user ?? null;
  if (!user) {
    if (userErr && !isMissingSession(userErr)) {
      console.error("[adminGate] auth lookup failed:", userErr.message);
      return { status: "unavailable", email: null };
    }
    return { status: "anonymous", email: null };
  }

  const email = user.email?.toLowerCase() ?? null;
  const allow = (process.env.ADMIN_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // An env allow-list hit is authority on its own and needs no database round-trip, so an
  // allow-listed owner still reaches the console while `profiles` is unreachable.
  if (email && allow.includes(email)) return { status: "admin", email };

  // RLS profiles_self lets a user read their own row with the cookie-auth'd client.
  const { data, error } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  if (error) {
    // PGRST116 = "no rows returned" from .single(). That IS a definitive answer: the user has no
    // profile row, so they are not an admin. Anything else — connection refused, 5xx, timeout —
    // means the authority never spoke, and must not be reported as a denial.
    if (error.code === "PGRST116") return { status: "denied", email };
    console.error("[adminGate] is_admin lookup failed:", error.message);
    return { status: "unavailable", email };
  }
  return { status: data?.is_admin ? "admin" : "denied", email };
}
