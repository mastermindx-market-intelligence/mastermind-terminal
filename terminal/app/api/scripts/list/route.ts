import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { readFixtureScripts, SCRIPTS_FAULT_COOKIE, SCRIPTS_STORE_COOKIE } from "@/lib/scriptsFixtureDb";

// List the SIGNED-IN USER'S saved Pine scripts. Not Pro-gated: reading/experimenting is free
// (mirrors the scripts page, which lets free accounts view scripts — only SAVE is Pro-gated
// server-side).
//
// ── C6: `user_id = <me>` is NOT redundant with RLS ──
// `saved_scripts` carries TWO policies (supabase/migrations/0001_init.sql): the owner may do
// anything with their own row, AND **any caller may SELECT a row with `is_public = true`**. The
// second one is lawful — it is what a future public-script discovery surface will read — but it
// means an unfiltered `select()` here returns "every row this user is ALLOWED to see", which is a
// different set from "this user's scripts". RLS answers *may this user read this row?*; it does not
// answer *does this row belong in My Scripts?* Only the application query can answer that, so the
// owner filter below is load-bearing, not belt-and-braces.
//
// Not currently leaking: a production census on 2026-08-19 found 4 rows across 2 owners with
// `is_public = false` on every one, and no writer anywhere in the estate ever sets the flag. The
// contract is wrong regardless, and it would start leaking the moment one public script exists —
// which is exactly what a sharing feature would do. Public discovery, if it ships, gets its own
// explicit query and its own surface; it does not arrive by accident through this one.
//
// ── C7: a storage failure is not an empty library ──
// 503 with a machine-readable reason, so the client can say "unavailable, retry" instead of
// rendering the user's custom scripts as though they had none. A guest gets 401 for the same
// reason: guests keep their scripts in localStorage and never call this route, so answering
// `{scripts: []}` would be inventing an empty library for a caller whose library lives elsewhere.
export async function GET() {
  // Deterministic transport for the Playwright dev server; unreachable in production.
  if (process.env.TERMINAL_E2E_FIXTURE === "1") {
    const jar = await cookies();
    const result = readFixtureScripts(
      jar.get(SCRIPTS_STORE_COOKIE)?.value || "default",
      !!jar.get(SCRIPTS_FAULT_COOKIE)?.value,
    );
    return result.ok
      ? NextResponse.json({ scripts: result.scripts })
      : NextResponse.json({ error: "scripts_unavailable" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data, error } = await supabase
    .from("saved_scripts")
    .select("id,name,source,lang,params,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("scripts/list GET failed:", error);
    return NextResponse.json({ error: "scripts_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ scripts: data || [] });
}
