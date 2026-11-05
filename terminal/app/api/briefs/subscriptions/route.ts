import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  BRIEFS_ROUTE_MESSAGES,
  isBriefCadence,
  isBriefTargetKind,
  isUuid,
  targetNameKey,
  type BriefSubscription,
  type BriefsRouteCode,
  type BriefTargetKind,
} from "@/lib/briefs";
import { lookupBriefTargetNames } from "@/lib/briefTargetNamesServer";

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

function mapRow(row: Record<string, unknown>, targetName?: string): BriefSubscription {
  return {
    subscriptionId: row.subscription_id,
    userId: row.user_id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    cadence: row.cadence,
    delivery: row.delivery,
    state: row.state,
    createdAt: String(row.created_at),
    ...(targetName ? { targetName } : {}),
  } as BriefSubscription;
}

export async function GET(req: Request) {
  if (process.env.TERMINAL_E2E_FIXTURE === "1") {
    return NextResponse.json({ subscriptions: [] });
  }
  const { supabase, user } = await uid();
  if (!user) return NextResponse.json(errorBody("not_signed_in"), { status: 401 });
  const url = new URL(req.url);
  const targetKind = url.searchParams.get("target_kind");
  const targetId = url.searchParams.get("target_id");
  let q = supabase
    .from("brief_subscriptions")
    .select("subscription_id, user_id, target_kind, target_id, cadence, delivery, state, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (targetKind) {
    if (!isBriefTargetKind(targetKind)) return NextResponse.json(errorBody("bad_request"), { status: 400 });
    q = q.eq("target_kind", targetKind);
  }
  if (targetId) {
    if (!isUuid(targetId)) return NextResponse.json(errorBody("bad_request"), { status: 400 });
    q = q.eq("target_id", targetId);
  }
  const { data, error } = await q;
  if (error) {
    console.error("briefs subscriptions GET failed:", error);
    return NextResponse.json(errorBody("unavailable"), { status: 503 });
  }
  const rows = (data || []) as Record<string, unknown>[];
  let names = new Map<string, string>();
  if (rows.length) {
    try {
      names = await lookupBriefTargetNames(
        supabase,
        user.id,
        rows.map((row) => ({
          kind: row.target_kind as BriefTargetKind,
          id: String(row.target_id),
        })),
      );
    } catch (err) {
      console.error("briefs subscriptions name lookup failed:", err);
    }
  }
  return NextResponse.json({
    subscriptions: rows.map((row) => mapRow(
      row,
      names.get(targetNameKey(row.target_kind as BriefTargetKind, String(row.target_id))),
    )),
  });
}

export async function POST(req: Request) {
  const { supabase, user } = await uid();
  if (!user) return NextResponse.json(errorBody("not_signed_in"), { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json(errorBody("bad_request"), { status: 400 });
  const targetKind = body.target_kind;
  const targetId = body.target_id;
  const cadence = body.cadence;
  if (!isBriefTargetKind(targetKind) || !isUuid(targetId) || !isBriefCadence(cadence)) {
    return NextResponse.json(errorBody("bad_request"), { status: 400 });
  }
  // MAJOR (heal h_t579): verify the caller owns this target before inserting.
  // maybeSingle() scoped to auth.uid() — same pattern as thesis/watchlist routes.
  // Returns 404 (never 403) to avoid leaking existence.
  const { data: ownerRow, error: ownerError } = await supabase
    .from(targetKind === "thesis" ? "theses" : "watchlists")
    .select("id")
    .eq("id", targetId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (ownerError || !ownerRow) {
    return NextResponse.json(errorBody("not_found"), { status: 404 });
  }
  const { data, error } = await supabase
    .from("brief_subscriptions")
    .insert({
      user_id: user.id,
      target_kind: targetKind,
      target_id: targetId,
      cadence,
      ...(targetKind === "thesis"
        ? { target_thesis_id: targetId }
        : { target_watchlist_id: targetId }),
    })
    .select("subscription_id, user_id, target_kind, target_id, cadence, delivery, state, created_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(errorBody("duplicate"), { status: 409 });
    }
    console.error("briefs subscriptions POST failed:", error);
    return NextResponse.json(errorBody("unavailable"), { status: 503 });
  }
  return NextResponse.json({ subscription: mapRow(data as Record<string, unknown>) }, { status: 201 });
}
