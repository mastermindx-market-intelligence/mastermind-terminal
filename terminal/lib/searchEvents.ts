// searchEvents.ts — storage plane for universal ticker-search tracking.
//
// Two backends behind one interface:
//   - Supabase `search_events` via the service-role client (production; deny-all RLS table,
//     see supabase/migrations/0003_search_events.sql).
//   - An in-memory ring buffer when the service key is absent (local guest-mode dev). Same
//     module-level-state pattern as lib/rateLimit.ts: `next start` is a single node process.
//
// Both the write path (/api/track/search) and the admin read path (/api/admin/searches) go
// through this module so dev and prod exercise identical filter/aggregate logic.

import { createServiceClient } from "@/lib/supabase/service";

export interface SearchEvent {
  id: number;
  created_at: string; // ISO timestamptz
  symbol: string;
  query: string | null;
  source: string;
  user_id: string | null;
  anon_id: string | null;
  ip: string | null;
  ua: string | null;
}

export type SearchEventInput = Omit<SearchEvent, "id" | "created_at">;

export interface ListFilters {
  limit: number; // caller caps
  beforeId?: number; // cursor: return rows with id < beforeId (newest-first pages)
  symbol?: string; // exact match, uppercased
  source?: string;
  visitor?: string; // matches user_id OR anon_id OR ip exactly
}

export interface SearchStats {
  total: number;
  today: number; // since UTC midnight
  visitors7d: number; // distinct (user_id || anon_id || ip) over trailing 7 days
  topSymbols7d: { symbol: string; count: number }[]; // top 20
  perDay14d: { day: string; count: number }[]; // UTC days, oldest first, zero-filled
  /**
   * True only when these numbers are UNDERSTATED — the in-process fallback ran AND its 14-day
   * window hit STATS_FETCH_CAP, so the oldest days are truncated. False means exact, whether that
   * came from the database function or from an in-process aggregate that never reached the cap.
   * The console must not present a `true` as a fact.
   */
  partial: boolean;
}

// ── Read contracts: a read that did not land is NOT an empty result ────────────────────────────
// Both readers used to log their error and return `[]` / zeroed stats, so a Supabase outage was
// indistinguishable from "nobody has searched yet" — the admin console rendered "No searches
// logged yet." and a `0` KPI row over an unread table. Callers now get a discriminated result and
// decide, the same shape `lib/layouts.ts` and `lib/portfolio.ts` use.
//
// Events and stats are answered SEPARATELY on purpose: they are two independent reads, and a
// failed aggregate must not take the usable log down with it.
export type EventsResult =
  | { ok: true; events: SearchEvent[] }
  | { ok: false; error: string };

export type StatsResult =
  | { ok: true; stats: SearchStats }
  | { ok: false; error: string };

// ---------- dev fallback (memory ring) ----------
const DEV_MAX = 2000;
const devRows: SearchEvent[] = [];
let devId = 0;
let warned = false;

function devWarnOnce() {
  if (!warned) {
    warned = true;
    console.warn("[searchEvents] SUPABASE_SERVICE_ROLE_KEY absent — events held in memory only (dev mode)");
  }
}

const visitorKey = (e: Pick<SearchEvent, "user_id" | "anon_id" | "ip">) =>
  e.user_id || e.anon_id || e.ip || "unknown";

// ---------- write ----------
export async function recordSearchEvent(evt: SearchEventInput): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) {
    devWarnOnce();
    devRows.push({ ...evt, id: ++devId, created_at: new Date().toISOString() });
    if (devRows.length > DEV_MAX) devRows.splice(0, devRows.length - DEV_MAX);
    return;
  }
  const { error } = await supabase.from("search_events").insert(evt);
  if (error) console.error("[searchEvents] insert failed:", error.message);
}

// ---------- read (admin) ----------
export async function listSearchEvents(f: ListFilters): Promise<EventsResult> {
  const supabase = createServiceClient();
  if (!supabase) {
    devWarnOnce();
    let rows = [...devRows].reverse(); // newest first
    if (f.beforeId != null) rows = rows.filter((r) => r.id < f.beforeId!);
    if (f.symbol) rows = rows.filter((r) => r.symbol === f.symbol);
    if (f.source) rows = rows.filter((r) => r.source === f.source);
    if (f.visitor) rows = rows.filter((r) => r.user_id === f.visitor || r.anon_id === f.visitor || r.ip === f.visitor);
    return { ok: true, events: rows.slice(0, f.limit) };
  }
  let q = supabase.from("search_events").select("*").order("id", { ascending: false }).limit(f.limit);
  if (f.beforeId != null) q = q.lt("id", f.beforeId);
  if (f.symbol) q = q.eq("symbol", f.symbol);
  if (f.source) q = q.eq("source", f.source);
  if (f.visitor) {
    // Strip PostgREST or() syntax chars, and only compare against the uuid-typed user_id
    // when the value IS a uuid — a bare IP/anon string there is a Postgres cast error.
    const v = f.visitor.replace(/[,()]/g, "");
    const parts = [`anon_id.eq.${v}`, `ip.eq.${v}`];
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
      parts.unshift(`user_id.eq.${v}`);
    }
    q = q.or(parts.join(","));
  }
  const { data, error } = await q;
  if (error) {
    console.error("[searchEvents] list failed:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, events: (data || []) as SearchEvent[] };
}

// ── Resolve user_ids → emails for the admin table ──────────────────────────────────────────────
// GoTrue admin lookups, cached. The cache used to be a bare `Map` with no TTL and no size limit,
// justified by "auth.users emails are effectively immutable here". Two problems with that:
//
//   * they are NOT immutable — the Terminal supports changing an account's email, and a
//     process-lifetime memo meant the admin console kept showing the OLD address until the next
//     deploy. `next start` is one long-lived process, so "process lifetime" can be weeks.
//   * unbounded growth. One entry per distinct user_id ever seen; nothing ever removed one.
//
// Now: finite TTL on BOTH a hit and a definitive null, a hard entry ceiling with LRU eviction
// (expired entries preferred as victims), and one in-flight lookup per id so a page of 100 rows
// from the same user does not stampede GoTrue with 100 identical requests.
const EMAIL_TTL_MS = 10 * 60_000;
const EMAIL_CACHE_MAX = 5_000;

type EmailEntry = { email: string | null; expires: number };
// Map preserves insertion order, which is what makes it usable as an LRU: re-inserting on read
// moves an entry to the end, so the first key is always the least recently used.
const emailCache = new Map<string, EmailEntry>();
// id -> the single outstanding lookup for that id (request coalescing).
const emailInFlight = new Map<string, Promise<string | null>>();

function emailCacheGet(id: string, now: number): { hit: boolean; email: string | null } {
  const entry = emailCache.get(id);
  if (!entry) return { hit: false, email: null };
  if (now >= entry.expires) {
    emailCache.delete(id);
    return { hit: false, email: null };
  }
  emailCache.delete(id);
  emailCache.set(id, entry); // LRU touch
  return { hit: true, email: entry.email };
}

function emailCacheSet(id: string, email: string | null, now: number): void {
  if (emailCache.has(id)) {
    emailCache.delete(id);
  } else if (emailCache.size >= EMAIL_CACHE_MAX) {
    // Reclaim expired entries first — evicting a live one when dead entries are sitting there
    // would throw away a useful answer for nothing.
    for (const [k, v] of emailCache) {
      if (now >= v.expires) emailCache.delete(k);
      if (emailCache.size < EMAIL_CACHE_MAX) break;
    }
    // Still full: drop the least recently used.
    if (emailCache.size >= EMAIL_CACHE_MAX) {
      const oldest = emailCache.keys().next().value;
      if (oldest !== undefined) emailCache.delete(oldest);
    }
  }
  emailCache.set(id, { email, expires: now + EMAIL_TTL_MS });
}

type AdminAuth = { auth: { admin: { getUserById: (id: string) => Promise<{ data: { user: { email?: string | null } | null } | null; error?: unknown }> } } };

function lookupEmail(supabase: AdminAuth, id: string): Promise<string | null> {
  const cached = emailCacheGet(id, Date.now());
  if (cached.hit) return Promise.resolve(cached.email);

  const flying = emailInFlight.get(id);
  if (flying) return flying; // someone is already asking — wait on their answer

  const pending = (async () => {
    try {
      const { data, error } = await supabase.auth.admin.getUserById(id);
      // Cache a DEFINITIVE answer only. `error`, a throw, or a missing user all mean the authority
      // did not answer, and memoising that as "no email" would blank the column until the TTL
      // expired for a reason that had nothing to do with the user.
      if (error || !data?.user) return null;
      const email = data.user.email ?? null;
      emailCacheSet(id, email, Date.now());
      return email;
    } catch {
      return null; // transient — deliberately not cached
    } finally {
      emailInFlight.delete(id);
    }
  })();

  emailInFlight.set(id, pending);
  return pending;
}

export async function resolveUserEmails(ids: string[]): Promise<Record<string, string>> {
  const supabase = createServiceClient();
  const out: Record<string, string> = {};
  if (!supabase) return out;
  const distinct = [...new Set(ids)].filter(Boolean);
  await Promise.all(
    distinct.map(async (id) => {
      const email = await lookupEmail(supabase as unknown as AdminAuth, id);
      if (email) out[id] = email;
    }),
  );
  return out;
}

/** Test seams for the cache bound and TTL. Not part of the runtime contract. */
export function __resetEmailCache(): void {
  emailCache.clear();
  emailInFlight.clear();
}
export function __emailCacheSize(): number {
  return emailCache.size;
}

// ── Aggregates ──────────────────────────────────────────────────────────────────────────────────
// Preferred path: `search_event_stats()` counts every row in the database, uncapped
// (supabase/migrations/0010_search_event_stats.sql).
//
// Fallback path: pull the trailing 14 days and aggregate in process, bounded by STATS_FETCH_CAP.
// The cap is a CORRECTNESS limit, not a performance knob. Rows come back `order by id desc`, so
// once the window exceeds the cap the newest 20k are kept and the OLDEST days of perDay14d decay
// toward zero — a tidy, entirely fictional ramp with nothing in the payload admitting it.
//
// So the fallback reports whether it was actually truncated. Note that hitting the fallback does
// NOT by itself make the numbers approximate: below the cap the in-process aggregate is exact, and
// production today holds 686 rows total. `partial` is true only when the window really did hit the
// cap — claiming approximation when the answer is exact would be its own small lie.
const STATS_FETCH_CAP = 20_000;

// PostgREST's "function not found in the schema cache" — the migration has not been applied yet.
// Schema migrations here land out of band and are not coupled to the app deploy, so BOTH orders
// have to work: app-before-DDL falls back, DDL-before-app is simply unused until this ships.
const MISSING_RPC = /PGRST202/;

function isMissingRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || MISSING_RPC.test(error.message ?? "");
}

/** Shape the SQL function returns — identical to SearchStats minus the `partial` flag. */
type RpcStats = Omit<SearchStats, "partial">;

export async function searchStats(): Promise<StatsResult> {
  const supabase = createServiceClient();
  const since14 = new Date(Date.now() - 14 * 86_400_000).toISOString();

  let total = 0;
  let recent: Pick<SearchEvent, "created_at" | "symbol" | "user_id" | "anon_id" | "ip">[];

  if (!supabase) {
    devWarnOnce();
    total = devRows.length;
    recent = devRows.filter((r) => r.created_at >= since14);
  } else {
    // Exact, uncapped, computed where the rows live.
    const rpc = await supabase.rpc("search_event_stats");
    if (!rpc.error) {
      const s = rpc.data as RpcStats | null;
      if (s && typeof s.total === "number") {
        return { ok: true, stats: { ...s, topSymbols7d: s.topSymbols7d ?? [], perDay14d: s.perDay14d ?? [], partial: false } };
      }
      console.error("[searchEvents] search_event_stats returned an unusable shape; falling back");
    } else if (!isMissingRpc(rpc.error)) {
      // The function exists and failed. That is a store failure, not a deploy-order gap — do not
      // quietly downgrade to the capped path and present it as the same thing.
      console.error("[searchEvents] stats rpc failed:", rpc.error.message);
      return { ok: false, error: rpc.error.message };
    }
    const [countRes, windowRes] = await Promise.all([
      supabase.from("search_events").select("*", { count: "exact", head: true }),
      supabase
        .from("search_events")
        .select("created_at,symbol,user_id,anon_id,ip")
        .gte("created_at", since14)
        .order("id", { ascending: false })
        .limit(STATS_FETCH_CAP),
    ]);
    // BOTH queries are load-bearing and BOTH can fail independently. The count error used to be
    // dropped on the floor entirely (`{ count }` destructured without `error`), so a failed count
    // rendered as a confident `0` in the "Total searches" KPI.
    const failure = countRes.error ?? windowRes.error;
    if (failure) {
      console.error("[searchEvents] stats failed:", failure.message);
      return { ok: false, error: failure.message };
    }
    total = countRes.count ?? 0;
    recent = (windowRes.data || []) as typeof recent;
  }

  const now = Date.now();
  const since7 = new Date(now - 7 * 86_400_000).toISOString();
  const todayStart = new Date().toISOString().slice(0, 10); // UTC midnight prefix

  const last7 = recent.filter((r) => r.created_at >= since7);
  const today = recent.filter((r) => r.created_at.slice(0, 10) >= todayStart).length;

  const visitors = new Set(last7.map(visitorKey));

  const symCounts = new Map<string, number>();
  for (const r of last7) symCounts.set(r.symbol, (symCounts.get(r.symbol) || 0) + 1);
  const topSymbols7d = [...symCounts.entries()]
    .map(([symbol, count]) => ({ symbol, count }))
    .sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol))
    .slice(0, 20);

  const dayCounts = new Map<string, number>();
  for (const r of recent) {
    const day = r.created_at.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
  }
  const perDay14d: { day: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    perDay14d.push({ day, count: dayCounts.get(day) || 0 });
  }

  // Truncated only if the window fetch actually reached the cap. The dev ring never does.
  const partial = recent.length >= STATS_FETCH_CAP;
  if (partial) {
    console.warn(
      `[searchEvents] the 14-day window hit STATS_FETCH_CAP (${STATS_FETCH_CAP}); per-day counts for the `
      + "oldest days are UNDERSTATED. Apply supabase/migrations/0010_search_event_stats.sql for exact aggregates.",
    );
  }
  return { ok: true, stats: { total, today, visitors7d: visitors.size, topSymbols7d, perDay14d, partial } };
}
