// POST /api/alerts/dry-run { symbol, condition } → DryRunResult (lib/alertDryRunContract.ts)
//
// "Would this suite alert trigger right now?" — evaluated by the canonical evaluator over the
// same daily-bar file and module-defaults compute the firing lane uses, for an alert that is NOT
// created. READ-ONLY: this handler reads the caller's session, asks the billing authority whether
// the plan admits the condition's tier, and reads public/data/<SYM>.json. It never queries or
// writes the alerts table, trigger history or the run/outbox receipts (it never calls
// supabase.from), never writes a file, and never sends a notification.
//
// Gate order: rate limit → session → admission → plan → data. A refusal at any step is an
// explicit cannot_evaluate / unsupported verdict, never "not met".

export const runtime = "nodejs";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPaidTier, isProTier } from "@/lib/entitlement";
import { rateLimit } from "@/lib/rateLimit";
import { isPaidSubscriptionTier, normalizeSubscriptionTier } from "@/lib/subscriptionTier";
import { DryRunAborted, dryRunResult, runAlertDryRun } from "@/lib/alertDryRun";
import type { DryRunResult, DryRunTier } from "@/lib/alertDryRun";
import { parseSuiteDailyBars, suiteEventsAtDefaults } from "@/lib/suiteAlertInputs";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const MAX_BODY_BYTES = 4096;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Deterministic browser-test identity (same guard as app/api/me): inert unless a non-production
 * server explicitly opts in. Lets the responsive e2e exercise THIS handler's real file read.
 */
function e2eFixtureIdentity(): { tier: string } | null {
  if (
    process.env.NODE_ENV !== "production"
    && process.env.TERMINAL_E2E_FIXTURE === "1"
    && process.env.TERMINAL_E2E_EMAIL
    && process.env.TERMINAL_E2E_ENTITLEMENT
  ) {
    return { tier: process.env.TERMINAL_E2E_ENTITLEMENT };
  }
  return null;
}

function statusFor(r: DryRunResult): number {
  switch (r.reason) {
    case "signed_out": return 401;
    case "plan_not_confirmed": return 403;
    case "rate_limited": return 429;
    case "malformed":
    case "invalid_symbol": return 400;
    default: return 200;
  }
}

const reply = (r: DryRunResult, headers: Record<string, string> = {}) =>
  NextResponse.json(r, { status: statusFor(r), headers: { ...NO_STORE, ...headers } });

/** Mirrors the POST route's gate: paid for a non-free tier, and Pro on top for a pro tier. */
async function planAdmitsLive(tier: DryRunTier): Promise<boolean> {
  if (tier === "free") return true;
  if (!(await isPaidTier())) return false;
  if (tier === "pro" && !(await isProTier())) return false;
  return true;
}

function planAdmitsFixture(raw: string, tier: DryRunTier): boolean {
  if (tier === "free") return true;
  if (!isPaidSubscriptionTier(raw)) return false;
  return tier !== "pro" || normalizeSubscriptionTier(raw) === "pro";
}

async function readSymbolDoc(symbol: string): Promise<{ doc: unknown; asOfMs: number | null } | null> {
  // `symbol` is already admitted (normalizeDryRunSymbol: [A-Z0-9._-] with an optional leading
  // "^", no "..", no separators);
  // re-check containment anyway so a future admission change cannot widen the read.
  const file = path.join(DATA_DIR, `${symbol}.json`);
  if (path.dirname(file) !== DATA_DIR) return null;
  try {
    const [raw, st] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    return { doc: JSON.parse(raw), asOfMs: Number.isFinite(st.mtimeMs) ? st.mtimeMs : null };
  } catch {
    return null; // absent or unreadable → no_data (cannot evaluate), never "no event"
  }
}

export async function POST(req: Request) {
  const limit = rateLimit(req, { name: "alerts-dry-run", max: 30 });
  if (!limit.ok) {
    return reply(dryRunResult("cannot_evaluate", { reason: "rate_limited" }), {
      "Retry-After": String(limit.retryAfterSec),
    });
  }

  const fixture = e2eFixtureIdentity();
  if (!fixture) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return reply(dryRunResult("cannot_evaluate", { reason: "signed_out" }));
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) throw new Error("body too large");
    body = JSON.parse(text);
  } catch {
    return reply(dryRunResult("cannot_evaluate", { reason: "malformed", detail: "body must be JSON {symbol, condition}" }));
  }

  try {
    const result = await runAlertDryRun(body, {
      readSymbolDoc,
      parseBars: parseSuiteDailyBars,
      computeEvents: suiteEventsAtDefaults,
      planAdmits: (tier) => (fixture ? Promise.resolve(planAdmitsFixture(fixture.tier, tier)) : planAdmitsLive(tier)),
      nowMs: () => Date.now(),
      signal: req.signal,
    });
    return reply(result);
  } catch (e) {
    if (e instanceof DryRunAborted) return new NextResponse(null, { status: 499, headers: NO_STORE });
    console.error("alerts/dry-run failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "dry_run_unavailable" }, { status: 500, headers: NO_STORE });
  }
}
