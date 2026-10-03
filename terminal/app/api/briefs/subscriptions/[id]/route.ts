import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  BRIEFS_ROUTE_MESSAGES,
  isBriefPatchState,
  isUuid,
  patchStateToRow,
  type BriefsRouteCode,
} from "@/lib/briefs";

export const runtime = "nodejs";

async function uid() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

function errorBody(code: BriefsRouteCode) {
  const [message, messageZh] = BRIEFS_ROUTE_MESSAGES[code];
  return { error: code.toUpperCase(), message, messageZh };
}

function mapRow(row: Record<string, unknown>) {
  return {
    subscriptionId: row.subscription_id,
    userId: row.user_id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    cadence: row.cadence,
    delivery: row.delivery,
    state: row.state,
    createdAt: row.created_at,
  };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await uid();
  if (!user) return NextResponse.json(errorBody("not_signed_in"), { status: 401 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json(errorBody("not_found"), { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !isBriefPatchState(body.state)) {
    return NextResponse.json(errorBody("invalid_state"), { status: 400 });
  }
  const { data, error } = await supabase
    .from("brief_subscriptions")
    .update({ state: patchStateToRow(body.state) })
    .eq("subscription_id", id)
    .eq("user_id", user.id)
    .select("subscription_id, user_id, target_kind, target_id, cadence, delivery, state, created_at")
    .maybeSingle();
  if (error) {
    console.error("briefs subscriptions PATCH failed:", error);
    return NextResponse.json(errorBody("unavailable"), { status: 503 });
  }
  if (!data) return NextResponse.json(errorBody("not_found"), { status: 404 });
  return NextResponse.json({ subscription: mapRow(data as Record<string, unknown>) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await uid();
  if (!user) return NextResponse.json(errorBody("not_signed_in"), { status: 401 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json(errorBody("not_found"), { status: 404 });
  const { data, error } = await supabase
    .from("brief_subscriptions")
    .delete()
    .eq("subscription_id", id)
    .eq("user_id", user.id)
    .select("subscription_id");
  if (error) {
    console.error("briefs subscriptions DELETE failed:", error);
    return NextResponse.json(errorBody("unavailable"), { status: 503 });
  }
  const removed = Array.isArray(data) ? data.length : 0;
  if (removed === 0) return NextResponse.json(errorBody("not_found"), { status: 404 });
  return NextResponse.json({ ok: true, deleted: true });
}
