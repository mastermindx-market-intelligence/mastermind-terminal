import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPaidTier } from "@/lib/entitlement";
import { nextSavedAtIso } from "@/lib/savedScriptStamp";

// Save a Pine script — PAID-gated SERVER-SIDE against the macro-api entitlement
// (any paid tier via /api/me), NOT profiles.is_pro (a UI hint; see AGENTS.md).
//
// Updates are compare-and-swap on `updated_at`. The client sends the exact DB token it last
// observed; we `.eq("updated_at", expected)` so a concurrent writer yields zero rows (409),
// and we write the next stamp ourselves (`updated_at` is timestamptz NOT NULL default now(),
// no overriding trigger). Inserts have no prior token and skip CAS. The response carries the
// actual row receipt (`id`, `updated_at`) so the next save can send that token. Ownership
// filters match /api/scripts/delete; this path never pre-reads rows (including on a CAS miss).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!(await isPaidTier())) return NextResponse.json({ error: "pro_required" }, { status: 403 });

  const { id, name, source, lang = "pine", params = {}, expected_updated_at } = await req.json();

  if (id) {
    const nextAt = nextSavedAtIso(expected_updated_at);
    if (nextAt == null) {
      return NextResponse.json({ error: "malformed expected_updated_at" }, { status: 400 });
    }
    // The `user_id` filter matches /api/scripts/delete: RLS already refuses a cross-owner write, and
    // the update path should say whose row it means rather than leaning on the policy to find out.
    const res = await supabase
      .from("saved_scripts")
      .update({ name, source, params, updated_at: nextAt })
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("updated_at", expected_updated_at)
      .select("id, updated_at")
      .maybeSingle();
    if (res.error) {
      console.error("scripts/save POST failed:", res.error);
      return NextResponse.json({ error: "Could not save script" }, { status: 400 });
    }
    if (!res.data) {
      return NextResponse.json({ error: "conflict" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id: res.data.id, updated_at: res.data.updated_at });
  }

  const res = await supabase
    .from("saved_scripts")
    .insert({ user_id: user.id, name, source, lang, params })
    .select("id, updated_at")
    .single();
  if (res.error) {
    console.error("scripts/save POST failed:", res.error);
    return NextResponse.json({ error: "Could not save script" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: res.data.id, updated_at: res.data.updated_at });
}
