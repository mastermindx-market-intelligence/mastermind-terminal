import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPaidTier, isProTier } from "@/lib/entitlement";
import { canonicalizeOptAlertIdentity, optAlertIdentityState } from "@/lib/optionsAlerts";
import { SUITE_ALERT_EVENTS, validateSuiteCondition, validateSuiteSequence } from "@/lib/suiteAlerts";
import { FOREX_WATCH_TYPE, isForexWatch, isWatchUuid, canonicalForexRule, forexRuleInput, forexWatchRow, sameForexRule } from "@/lib/forexWatches";

async function uid() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

// ── condition allow-list ──────────────────────────────────────────────────────
// Anything not named here is rejected at the door: the engine (ingest/alerts_engine.py)
// and the suite lane (Node) only know these types, so an unknown one is a row that can
// never fire — silent dead weight in the user's list.
const LEGACY_TYPES = new Set(["signal", "regime", "price", "rsi"]);
const OPT_TYPES = new Set([
  "opt_gamma_flip", "opt_wall_touch", "opt_premium_burst", "opt_0dte_spike", "opt_surface_pocket",
  // Market Structure Core §8 (2026-08-01): positioning-change alerts.
  "opt_wall_migration", "opt_sign_fragile", "opt_opex_concentration",
]);
const SUITE_TYPE = "suite_event";
const SUITE_SEQ_TYPE = "suite_sequence"; // two-step "A then B within N bars" (same suite lane)

const MAX_ALERTS_PER_USER = 50;

type ForexWriteBody = Record<string, unknown>;
type AlertClient = Awaited<ReturnType<typeof createClient>>;
const WITHOUT_FOREX = "condition->>type.is.null,condition->>type.neq.forex_price_close";

function forexError(error: unknown) {
  const e = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
  const statuses: Record<string, [number, string]> = {
    forex_watch_revision_conflict: [409, "conflict"],
    forex_watch_identity_conflict: [409, "conflict"],
    forex_watch_owner_changed: [409, "session_changed"],
    forex_watch_not_found: [404, "not_found"],
    forex_watch_unauthenticated: [401, "signed_out"],
    forex_watch_invalid_request: [400, "invalid"],
    forex_watch_invalid_condition: [400, "invalid"],
    forex_watch_limit_reached: [400, "limit"],
    forex_activation_unavailable: [409, "unavailable"],
  };
  const known = e.message ? statuses[e.message] : undefined;
  if (known) return NextResponse.json({ error: e.message, state: known[1] }, { status: known[0] });
  if (["PGRST202", "42883", "42501", "PGRST301", "PGRST302"].includes(e.code ?? ""))
    return NextResponse.json({ error: "forex_watch_owner_unavailable", state: "unavailable" }, { status: 503 });
  // A transport or unexpected database reply does not establish that a mutation failed to apply.
  return NextResponse.json({ error: "forex_watch_change_unconfirmed", state: "unconfirmed" }, { status: 503 });
}

async function saveForex(supabase: AlertClient, userId: string, body: ForexWriteBody, creating: boolean) {
  if (body.expected_user_id !== userId)
    return forexError({ message: "forex_watch_owner_changed" });
  const revision = body.expected_revision;
  if (!isWatchUuid(body.id) || typeof revision !== "number" || !Number.isInteger(revision) ||
      revision < (creating ? 0 : 1) || revision > 2147483646 || (creating && revision !== 0) ||
      !isForexWatch(body.condition))
    return forexError({ message: "forex_watch_invalid_request" });
  const rule = canonicalForexRule(forexRuleInput(body.condition));
  if (!rule || body.symbol !== rule.pair)
    return forexError({ message: "forex_watch_invalid_condition" });
  try {
    const { data, error } = await supabase.rpc("save_forex_watch", {
      p_id: body.id, p_expected_revision: revision, p_expected_user_id: userId, p_rule: rule,
    });
    if (error) return forexError(error);
    const row = forexWatchRow(data);
    if (!row || row.id !== body.id || row.user_id !== userId || row.condition.revision !== revision + 1 ||
        !sameForexRule(forexRuleInput(row.condition), rule)) return forexError(null);
    return NextResponse.json({ alert: row });
  } catch { return forexError(null); }
}


export function normalizeStoredAlert(row: unknown): unknown {
  if (!row || typeof row !== "object") return row;
  const alert = row as Record<string, unknown>;
  const condition = alert.condition;
  if (!condition || typeof condition !== "object") return row;
  const type = String((condition as Record<string, unknown>).type ?? "");
  if (!OPT_TYPES.has(type)) return row;
  const symbol = typeof alert.symbol === "string" ? alert.symbol : "";
  const cond = condition as Record<string, unknown>;
  const identity = canonicalizeOptAlertIdentity(symbol, cond);
  const identity_state = optAlertIdentityState(symbol, cond);
  return identity ? { ...alert, ...identity, identity_state } : { ...alert, identity_state };
}

/** Owning tier of a catalog event; unknown event → "pro" so an unlisted event fails CLOSED. */
function eventTier(suite: unknown, event: unknown): "free" | "essential" | "pro" {
  const hit = SUITE_ALERT_EVENTS.find((e) => e.suite === suite && e.event === event);
  if (!hit) return "pro";
  return hit.tier === "free" || hit.tier === "essential" ? hit.tier : "pro";
}

/**
 * The four facts this endpoint can report, and the wire shape of each:
 *
 *   signed out              401 { error: "unauthenticated" }
 *   read OK, zero rows      200 { alerts: [] }
 *   read OK, rows           200 { alerts: [...] }
 *   store did not answer    503 { error: "alerts unavailable" }
 *
 * The last one used to be the second one. `select()` was destructured as `{ data }` with the
 * `error` dropped on the floor, so a failed query answered `200 {alerts: []}` and the client
 * rendered "No alerts yet" — telling a user their alert inventory is empty on the strength of
 * a query that never ran. 503 (not 500) because the correct client response is to retry.
 */
export async function GET() {
  const { supabase, user } = await uid();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data, error } = await supabase.from("alerts").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  if (error) {
    console.error("alerts GET failed:", error);
    return NextResponse.json({ error: "alerts unavailable" }, { status: 503 });
  }
  // Legacy rows predate the MARKET sentinel and the single-root identity law. Normalize
  // them at the read boundary so stored SPY/QQQ labels cannot misdescribe what the
  // evaluator actually reads. No historical trigger evidence is rewritten.
  return NextResponse.json({ alerts: (data || []).map(normalizeStoredAlert) });
}

export async function POST(req: Request) {
  const { supabase, user } = await uid();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = await req.json().catch(() => null);
  const body: ForexWriteBody = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const symbol = body.symbol;
  const condition = body.condition as Record<string, unknown> | undefined;
  if (!symbol || typeof symbol !== "string" || !condition || typeof condition !== "object")
    return NextResponse.json({ error: "bad request" }, { status: 400 });

  const type = condition.type;
  if (isForexWatch(condition)) return saveForex(supabase, user.id, body, true);
  if (typeof type !== "string" || (!LEGACY_TYPES.has(type) && !OPT_TYPES.has(type) && type !== SUITE_TYPE && type !== SUITE_SEQ_TYPE))
    return NextResponse.json({ error: `Unknown alert condition: ${String(type)}` }, { status: 400 });

  if (type === SUITE_TYPE || type === SUITE_SEQ_TYPE) {
    // validators: reason string when malformed, null when well-formed.
    const why = type === SUITE_TYPE ? validateSuiteCondition(condition) : validateSuiteSequence(condition);
    if (why) return NextResponse.json({ error: `Invalid suite alert: ${why}` }, { status: 400 });
    // Gate tier: the single event's tier, or for a sequence the HIGHEST tier across its
    // step events — a sequence is entitled only when every step is. eventTier fails
    // CLOSED ("pro") on any unknown event, and the validator already vetted the steps.
    let tier: "free" | "essential" | "pro";
    if (type === SUITE_TYPE) {
      tier = eventTier(condition.suite, condition.event);
    } else {
      const rank = { free: 0, essential: 1, pro: 2 } as const;
      const steps = Array.isArray(condition.steps) ? (condition.steps as Array<{ event?: unknown }>) : [];
      tier = steps.length ? "free" : "pro"; // empty steps cannot pass validation — fail closed anyway
      for (const s of steps) {
        const st = eventTier(condition.suite, s?.event);
        if (rank[st] > rank[tier]) tier = st;
      }
    }
    if (tier !== "free") {
      // FAIL-CLOSED: uncertainty about entitlement is a refusal, never a grant.
      if (!(await isPaidTier()))
        return NextResponse.json({ error: "This suite alert is included with a paid plan — upgrade to unlock." }, { status: 403 });
      if (tier === "pro" && !(await isProTier()))
        return NextResponse.json({ error: "This suite alert is included with the Pro plan — upgrade to unlock." }, { status: 403 });
    }
  }

  // Per-user cap — a runaway client (or a bored user) must not turn the 5-min cron into a crawl.
  const { count } = await supabase.from("alerts").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((count ?? 0) >= MAX_ALERTS_PER_USER)
    return NextResponse.json({ error: `Alert limit reached (${MAX_ALERTS_PER_USER}). Delete one to add another.` }, { status: 400 });

  const stored = OPT_TYPES.has(type)
    ? canonicalizeOptAlertIdentity(symbol, condition)
    : { symbol, condition };
  if (!stored)
    return NextResponse.json({ error: "Invalid options root" }, { status: 400 });
  const { data, error } = await supabase.from("alerts").insert({ user_id: user.id, ...stored }).select("*").single();
  if (error) {
    console.error("alerts POST failed:", error);
    return NextResponse.json({ error: "Could not create alert" }, { status: 400 });
  }
  return NextResponse.json({ alert: normalizeStoredAlert(data) });
}

// Re-arm a fired alert: the engine (ingest/alerts_engine.py) disarms on trigger and stamps
// condition.triggered; re-arming strips the stamp and flips active back on.
//
// E18 adds exactly one other lifecycle write to this owner: `action: "pause"` turns `active` off
// and leaves the condition untouched (a fired stamp stays on the record). The engine and the suite
// lane read only `active=eq.true` rows, so a paused alert is simply not evaluated — no new cron,
// delivery or trigger path. No `action` (or `"resume"`) is the re-arm, unchanged. Any other action
// is refused before the row is read, so a caller typo can never become a write.
export async function PATCH(req: Request) {
  const { supabase, user } = await uid();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as ForexWriteBody | null;
  const id = body?.id as string | undefined;
  const action = body?.action;
  if (!id || (action !== undefined && action !== "pause" && action !== "resume" && action !== "edit"))
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  // A failed read is not "no such row": only PostgREST's zero-row answer (PGRST116) is a 404. Any
  // other read error means the store did not answer, nothing was written, and the caller must not
  // be told the alert does not exist.
  const { data: row, error: readError } = await supabase.from("alerts").select("*").eq("id", id).eq("user_id", user.id).single();
  if (readError && readError.code !== "PGRST116") {
    console.error("alerts PATCH read failed:", readError);
    return NextResponse.json({ error: "alerts unavailable" }, { status: 503 });
  }
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (isForexWatch(row.condition)) {
    if (action === undefined || action === "resume") return forexError({ message: "forex_activation_unavailable" });
    if (action === "edit") return saveForex(supabase, user.id, { ...body, symbol: body?.symbol ?? row.symbol }, false);
    const saved = forexWatchRow(row);
    return saved && saved.user_id === user.id
      ? NextResponse.json({ alert: saved })
      : forexError({ code: "42501" });
  }
  if (action === "edit") return NextResponse.json({ error: "bad request" }, { status: 400 });
  let patch: Record<string, unknown>;
  if (action === "pause") {
    patch = { active: false };
  } else {
    const cond = { ...(row.condition || {}) };
    delete cond.triggered;
    const identity = canonicalizeOptAlertIdentity(String(row.symbol ?? ""), cond);
    patch = identity
      ? { active: true, symbol: identity.symbol, condition: identity.condition }
      : { active: true, condition: cond };
  }
  const { data, error } = await supabase.from("alerts").update(patch)
    .eq("id", id).eq("user_id", user.id).or(WITHOUT_FOREX).select("*").single();
  if (error) {
    console.error("alerts PATCH failed:", error);
    return NextResponse.json({ error: "Could not update alert" }, { status: 400 });
  }
  return NextResponse.json({ alert: normalizeStoredAlert(data) });
}

/**
 * Delete one owned alert.
 *
 * A delete is successful only when the AUTHORITATIVE store says so. This route used to issue
 * `.delete()`, never look at what came back, and answer `{ok:true}` unconditionally — so an RLS
 * refusal, a dropped connection or a constraint error all read as success to the optimistic
 * client, and the row silently reappeared on the next load.
 *
 * IDEMPOTENCY RULING (deliberate, tested): a delete that matches NO row is a SUCCESS with
 * `deleted:false`, not a 404. The user asked for "this row gone" and that post-condition already
 * holds — the common cause is the same alert deleted in another tab, and answering 404 would make
 * the optimistic UI resurrect a row that does not exist. It also keeps the endpoint from becoming
 * an existence oracle: an id belonging to another account is owner-scoped out and reports exactly
 * what a never-existed id reports.
 *
 * Owner scoping is unchanged and doubled: RLS is the authority, and `.eq("user_id", user.id)` is
 * carried explicitly so a policy regression cannot become a cross-tenant delete.
 */
export async function DELETE(req: Request) {
  const { supabase, user } = await uid();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const id = params.get("id");
  if (!id) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { data: row, error: readError } = await supabase.from("alerts").select("*")
    .eq("id", id).eq("user_id", user.id).single();
  if (readError && readError.code !== "PGRST116")
    return NextResponse.json({ error: "alerts unavailable" }, { status: 503 });
  // Even an already absent Forex intent retains its expected-account fence.
  if (isForexWatch(row?.condition) || params.get("type") === FOREX_WATCH_TYPE) {
    if (params.get("expected_user_id") !== user.id) return forexError({ message: "forex_watch_owner_changed" });
    const rawRevision = params.get("expected_revision");
    const revision = Number(rawRevision);
    if (!isWatchUuid(id) || !rawRevision || !/^[1-9][0-9]*$/.test(rawRevision) ||
        !Number.isSafeInteger(revision) || revision > 2147483647)
      return forexError({ message: "forex_watch_invalid_request" });
    try {
      const { data, error } = await supabase.rpc("delete_forex_watch", {
        p_id: id, p_expected_revision: revision, p_expected_user_id: user.id,
      });
      if (error) return forexError(error);
      if (!data || typeof data !== "object" || Array.isArray(data) || data.id !== id || typeof data.deleted !== "boolean")
        return forexError(null);
      return NextResponse.json({ ok: true, id, deleted: data.deleted });
    } catch { return forexError(null); }
  }
  if (!row) return NextResponse.json({ ok: true, deleted: false });
  // The predicate prevents a pre-read/delete identity race from reaching a Forex row.
  const { data, error } = await supabase.from("alerts").delete()
    .eq("user_id", user.id).eq("id", id).or(WITHOUT_FOREX).select("id");
  if (error) {
    console.error("alerts DELETE failed:", error);
    return NextResponse.json({ error: "Could not delete alert" }, { status: 503 });
  }
  if (!Array.isArray(data) || data.length > 1 || data.some((item) => item?.id !== id))
    return NextResponse.json({ error: "Delete not confirmed", state: "unconfirmed" }, { status: 503 });
  if (!data.length) {
    const { data: current, error: currentError } = await supabase.from("alerts").select("id")
      .eq("id", id).eq("user_id", user.id).single();
    if (currentError && currentError.code !== "PGRST116")
      return NextResponse.json({ error: "Delete not confirmed", state: "unconfirmed" }, { status: 503 });
    if (current) return NextResponse.json({ error: "Alert changed. Reload before deleting.", state: "conflict" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, deleted: data.length > 0 });
}
