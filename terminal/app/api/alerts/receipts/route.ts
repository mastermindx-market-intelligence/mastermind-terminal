import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Read-only receipts endpoint for the /alerts monitor + delivery surface (B-F08-3).
// Mirrors the honesty contract of app/api/alerts/route.ts: a query error or a
// missing table maps to READ_UNAVAILABLE, never a 200 with an empty array.
// Frozen contract: research/MARKET_ONTOLOGY_F08_ARCHITECTURE_FREEZE_2026-09-05.md §5.
// B-F08-B5-3: the pre-existing keys still mean the alerts_engine lane exactly as
// before. suite_* keys are the second lane's identical shape.

const LANES = ["alerts_engine", "suite_alerts"] as const;

type ReadState = "READ_OK" | "READ_OK_ZERO" | "READ_UNAVAILABLE";

function stateFor(error: { code?: string } | null, rows: unknown[] | null): ReadState {
  if (error) return "READ_UNAVAILABLE";
  if (!rows || rows.length === 0) return "READ_OK_ZERO";
  return "READ_OK";
}

async function readLane(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lane: (typeof LANES)[number],
  runCols: string,
) {
  const { data: runRows, error: runErr } = await supabase
    .from("alert_runs").select(runCols).eq("lane", lane)
    .order("started_at", { ascending: false }).limit(1);
  const runsState = stateFor(runErr as { code?: string } | null, runRows);

  const { data: successRows, error: successErr } = await supabase
    .from("alert_runs").select(runCols).eq("lane", lane).eq("outcome", "success")
    .not("concluded_at", "is", null).order("concluded_at", { ascending: false }).limit(1);
  const successState = stateFor(successErr as { code?: string } | null, successRows);

  if (runErr) console.error(`alerts/receipts ${lane} run read failed:`, runErr);
  if (successErr) console.error(`alerts/receipts ${lane} success read failed:`, successErr);

  return {
    run: runsState === "READ_UNAVAILABLE" ? null : (runRows && runRows[0]) || null,
    runs_state: runsState,
    last_success_at: successState === "READ_UNAVAILABLE" || !successRows?.[0]
      ? null
      : (successRows[0] as unknown as { concluded_at: string | null }).concluded_at,
    // Distinct from last_success_at itself: a null time means EITHER "never had a successful
    // run" (successState READ_OK_ZERO) or "could not confirm one way or the other" (successState
    // READ_UNAVAILABLE) — the client must not render the same "not recorded" copy for both.
    last_success_state: successState,
  };
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const runCols = "lane, run_id, started_at, concluded_at, outcome, evaluated_n, fired_n, unevaluable_n, source_asof, lane_cadence_budget_s, error_class";

  // Distinct from last_success_at itself: a null time means EITHER "never had a successful
  // run" (successState READ_OK_ZERO) or "could not confirm one way or the other" (successState
  // READ_UNAVAILABLE) — the client must not render the same "not recorded" copy for both.
  // Both lanes carry this pair independently; last_success_state is never inferred from the
  // timestamp alone.
  const [engine, suite] = await Promise.all([
    readLane(supabase, "alerts_engine", runCols),
    readLane(supabase, "suite_alerts", runCols),
  ]);

  const { data: outboxRows, error: outboxErr } = await supabase
    .from("alert_outbox")
    .select("alert_id, fire_event_id, status, attempts, last_error, deliver_after, delivered_at, created_at, payload")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const outboxState = stateFor(outboxErr as { code?: string } | null, outboxRows);

  if (outboxErr) console.error("alerts/receipts outbox read failed:", outboxErr);

  return NextResponse.json({
    run: engine.run,
    runs_state: engine.runs_state,
    last_success_at: engine.last_success_at,
    last_success_state: engine.last_success_state,
    suite_run: suite.run,
    suite_runs_state: suite.runs_state,
    suite_last_success_at: suite.last_success_at,
    suite_last_success_state: suite.last_success_state,
    outbox: outboxState === "READ_UNAVAILABLE" ? undefined : (outboxRows || []),
    outbox_state: outboxState,
  });
}
