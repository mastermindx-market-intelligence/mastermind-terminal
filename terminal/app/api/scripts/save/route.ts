import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPaidTier } from "@/lib/entitlement";

// Save a Pine script — PAID-gated SERVER-SIDE against the macro-api entitlement
// (any paid tier via /api/me), NOT profiles.is_pro (a UI hint; see AGENTS.md).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!(await isPaidTier())) return NextResponse.json({ error: "pro_required" }, { status: 403 });

  const { id, name, source, lang = "pine", params = {} } = await req.json();
  // The `user_id` filter matches /api/scripts/delete: RLS already refuses a cross-owner write, and
  // the update path should say whose row it means rather than leaning on the policy to find out.
  const res = id
    ? await supabase.from("saved_scripts").update({ name, source, params, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id).select("id").single()
    : await supabase.from("saved_scripts").insert({ user_id: user.id, name, source, lang, params }).select("id").single();
  if (res.error) {
    console.error("scripts/save POST failed:", res.error);
    return NextResponse.json({ error: "Could not save script" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: res.data.id });
}
