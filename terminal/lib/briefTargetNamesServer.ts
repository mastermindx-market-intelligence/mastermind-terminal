import type { createClient } from "@/lib/supabase/server";
import { targetNameKey, type BriefTargetKind } from "@/lib/briefs";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Resolve owner-scoped human names for Brief targets without exposing raw IDs
 * to the product UI. The subscription/delivery tables remain the canonical
 * schedule state; this helper only projects names from the existing target owners.
 */
export async function lookupBriefTargetNames(
  supabase: SupabaseClient,
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
      const wanted = new Map(pairs.map((p) => [p.id + ":" + p.current_version, p.id]));
      for (const v of versions || []) {
        const id = wanted.get(String(v.thesis_id) + ":" + String(v.version));
        if (!id || !isPlain(v.content) || typeof v.content.title !== "string") continue;
        const title = v.content.title.trim();
        if (title) out.set(targetNameKey("thesis", id), title);
      }
    }
  }
  return out;
}
