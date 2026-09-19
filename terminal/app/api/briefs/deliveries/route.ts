import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  BRIEFS_ROUTE_MESSAGES,
  fillTargetNames,
  parseLimit,
  pinLastReady,
  targetNameFromBody,
  targetNameKey,
  validateBriefBody,
  type BriefCadence,
  type BriefDelivery,
  type BriefDeliveryState,
  type BriefSubscriptionState,
  type BriefTargetKind,
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

function asSub(raw: unknown): Record<string, unknown> | null {
  if (Array.isArray(raw)) return (raw[0] as Record<string, unknown>) ?? null;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return null;
}

function mapDelivery(row: Record<string, unknown>): BriefDelivery | null {
  const sub = asSub(row.brief_subscriptions);
  if (!sub) return null;
  const parsed = validateBriefBody(row.body);
  const body = parsed ?? {};
  const targetName = parsed?.target.name || targetNameFromBody(row.body);
  return {
    deliveryId: String(row.delivery_id),
    subscriptionId: String(row.subscription_id),
    slotAsof: String(row.slot_asof),
    state: row.state as BriefDeliveryState,
    degradedReason: typeof row.degraded_reason === "string" ? row.degraded_reason : null,
    artifactAsof: typeof row.artifact_asof === "string" ? row.artifact_asof : null,
    body,
    createdAt: String(row.created_at),
    subscription: {
      targetKind: sub.target_kind as BriefTargetKind,
      targetId: String(sub.target_id),
      cadence: sub.cadence as BriefCadence,
      state: sub.state as BriefSubscriptionState,
      ...(targetName ? { targetName } : {}),
    },
  };
}

async function lookupTargetNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  refs: Array<{ kind: BriefTargetKind; id: string }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const thesisIds = [...new Set(refs.filter((r) => r.kind === "thesis").map((r) => r.id))];
  const watchlistIds = [...new Set(refs.filter((r) => r.kind === "watchlist").map((r) => r.id))];
  if (watchlistIds.length) {
    const { data } = await supabase
      .from("watchlists")
      .select("id,name")
      .eq("user_id", userId)
      .in("id", watchlistIds);
    for (const row of data || []) {
      if (typeof row.id === "string" && typeof row.name === "string" && row.name.trim()) {
        out.set(targetNameKey("watchlist", row.id), row.name.trim());
      }
    }
  }
  if (thesisIds.length) {
    const { data: heads } = await supabase
      .from("theses")
      .select("id,current_version")
      .eq("user_id", userId)
      .in("id", thesisIds);
    const pairs = (heads || []).filter(
      (h): h is { id: string; current_version: number } =>
        typeof h.id === "string" && typeof h.current_version === "number",
    );
    if (pairs.length) {
      const { data: versions } = await supabase
        .from("thesis_versions")
        .select("thesis_id,version,content")
        .eq("user_id", userId)
        .in("thesis_id", pairs.map((p) => p.id));
      const wanted = new Map(pairs.map((p) => [`${p.id}:${p.current_version}`, p.id]));
      for (const v of versions || []) {
        const id = wanted.get(`${v.thesis_id}:${v.version}`);
        if (!id || !isPlain(v.content) || typeof v.content.title !== "string") continue;
        const title = v.content.title.trim();
        if (title) out.set(targetNameKey("thesis", id), title);
      }
    }
  }
  return out;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function GET(req: Request) {
  if (process.env.TERMINAL_E2E_FIXTURE === "1") {
    return NextResponse.json({ deliveries: [] });
  }
  const { supabase, user } = await uid();
  if (!user) return NextResponse.json(errorBody("not_signed_in"), { status: 401 });
  const limit = parseLimit(new URL(req.url).searchParams.get("limit"));
  const { data, error } = await supabase
    .from("brief_deliveries")
    .select(
      "delivery_id, subscription_id, slot_asof, state, degraded_reason, artifact_asof, body, created_at, brief_subscriptions!inner (subscription_id, user_id, target_kind, target_id, cadence, state)",
    )
    .eq("brief_subscriptions.user_id", user.id)
    .order("slot_asof", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("briefs deliveries GET failed:", error);
    return NextResponse.json(errorBody("unavailable"), { status: 503 });
  }
  const mapped = (data || [])
    .map((row) => mapDelivery(row as Record<string, unknown>))
    .filter((row): row is BriefDelivery => row !== null);
  const withSiblings = fillTargetNames(mapped, new Map());
  const missing = withSiblings.filter((row) => !row.subscription.targetName);
  let named = withSiblings;
  if (missing.length) {
    try {
      const joined = await lookupTargetNames(
        supabase,
        user.id,
        missing.map((row) => ({ kind: row.subscription.targetKind, id: row.subscription.targetId })),
      );
      named = fillTargetNames(withSiblings, joined);
    } catch (err) {
      console.error("briefs deliveries name lookup failed:", err);
    }
  }
  return NextResponse.json({ deliveries: pinLastReady(named) });
}
