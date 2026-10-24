import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { investigationApiUnavailable } from "@/lib/investigationApiAdmission";
import { applyInvestigationRevision, listInvestigations, parseInvestigationCommand, readInvestigation, readInvestigationOperation, reconcileInvestigationOperation, type InvestigationDb } from "@/lib/investigations";
import { qualifyScenarioCaptureSave } from "@/lib/investigationScenarioServer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const statuses: Record<string, number> = { found: 200, committed: 200, not_applied: 200, invalid_payload: 400, unauthenticated: 401, not_found: 404, version_conflict: 409, idempotency_conflict: 409, layout_conflict: 409, screen_conflict: 409, invalid_transition: 422, reference_unavailable: 422, limit_reached: 429, unavailable: 503 };
async function session(): Promise<{db:InvestigationDb;userId:string} | null> {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return null;
  return {db:db as unknown as InvestigationDb,userId:user.id};
}
export async function GET(request: Request) {
  // Closed-mode admission gate: one request-time env read, before any auth, DB or RPC work.
  const closed = investigationApiUnavailable();
  if (closed) return closed;
  try {
    const authed = await session();
    if (!authed) return respond({ status: "unauthenticated" }, 401);
    const {db} = authed;
    const params = new URL(request.url).searchParams;
    const keys = [...params.keys()];
    if (!keys.length) {
      const result=await listInvestigations(db);
      return respond(result,result.status==="listed"?200:503);
    }
    if (new Set(keys).size !== keys.length || keys.some(k => !["id", "revision", "operation_id"].includes(k))) return respond({ status: "invalid_payload" }, 400);
    const operation = params.get("operation_id");
    if (operation !== null) {
      if (keys.length !== 1) return respond({ status: "invalid_payload" }, 400);
      const result = await readInvestigationOperation(db, operation);
      return respond(result, statuses[result.status] ?? 503);
    }
    const id = params.get("id");
    if (!id) return respond({ status: "invalid_payload" }, 400);
    const rawRevision = params.get("revision");
    if (rawRevision !== null && !/^[1-9][0-9]{0,9}$/.test(rawRevision)) return respond({ status: "invalid_payload" }, 400);
    const result = await readInvestigation(db, id, rawRevision === null ? null : Number(rawRevision));
    return respond(result, statuses[String(result.status)] ?? 503);
  } catch { return respond({ status: "unavailable" }, 503); }
}
export async function POST(request: Request) { return mutate(request, false); }
export async function PUT(request: Request) { return mutate(request, true); }
async function mutate(request: Request, reconcile: boolean) {
  // Same gate, ahead of rate limiting, auth and any body read. POST/PUT delegate here unchanged.
  const closed = investigationApiUnavailable();
  if (closed) return closed;
  const limit = rateLimit(request, { name: "investigations-save", max: 30 });
  if (!limit.ok) return tooMany(limit);
  try {
    const authed = await session();
    if (!authed) return respond({ status: "unauthenticated" }, 401);
    const {db,userId} = authed;
    // Same parsed-JSON request convention as the existing authenticated Thesis route.
    const maxBytes = 132 * 1024;
    const stated = Number(request.headers.get("content-length"));
    if (Number.isFinite(stated) && stated > maxBytes) return respond({ status: "invalid_payload" }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) return respond({ status: "invalid_payload" }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return respond({ status: "invalid_payload" }, 400); }
    const command = parseInvestigationCommand(body, reconcile);
    // A legacy POST retry may already have committed. Only the reconciliation
    // owner can compare the full original request and return its receipt or fence.
    // Never normalize or apply a request that fails the current write contract.
    const recovery = !command && !reconcile ? parseInvestigationCommand(body, true) : null;
    if (!command && !recovery) return respond({ status: "invalid_payload" }, 400);
    // Owner reconciliation never reacquires or retains scenario evidence. Only
    // a strict NEW POST may run the canonical scenario preflight below.
    if (!reconcile && !recovery && command) {
      // Scenario captures carry a deliberate owner binding: the header must name the exact
      // authenticated user, refused BEFORE the preflight and the apply RPC. Legacy non-scenario
      // saves are unchanged and never require the header. The refusal reuses the existing
      // definitive invalid_payload contract so a retained client draft stays rejected, never
      // "unknown".
      if (command.manifest.scenario_capture !== undefined) {
        const claimed = request.headers.get("x-mm-scenario-owner");
        if (claimed === null || claimed.trim() !== userId) return respond({ status: "invalid_payload" }, 400);
      }
      // Before canonical CAS, qualify this exact prospective owner/revision/operation through
      // the private native source reader and existing TS engine. Real current source-use and
      // destination bindings must still qualify; no retained reference is authority by itself.
      // Paid basis/results never enter the command or the apply RPC. remove/restore keep the reference metadata and the
      // owner controls without acquiring the source, so they need no preflight.
      if (command.manifest.scenario_capture !== undefined && (command.action === "create" || command.action === "revise")) {
        const captureMode = request.headers.get("x-mm-scenario-capture");
        if (captureMode !== null && captureMode !== "initial" && captureMode !== "recover") return respond({ status: "invalid_payload" }, 400);
        const qualified = await qualifyScenarioCaptureSave(command.manifest.scenario_capture, userId, {
          id: command.id, expected_revision: command.expected_revision, operation_id: command.operation_id, action: command.action, initial_capture: captureMode === "initial",
        });
        // A private retention effect can precede a lost response/read/CAS failure.
        // Keep the original operation UNKNOWN, never definitive "nothing changed".
        if (!qualified.ok) return respond({ status: "unavailable", reason: qualified.reason }, 503);
      }
    }
    const result = recovery ? await reconcileInvestigationOperation(db, recovery)
      : await (reconcile ? reconcileInvestigationOperation(db, command!) : applyInvestigationRevision(db, command!));
    return respond(result, statuses[result.status] ?? 503);
  } catch { return respond({ status: "unavailable" }, 503); }
}
