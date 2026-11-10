import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { applyInvestigationRevision, listInvestigations, parseInvestigationCommand, readInvestigation, readInvestigationOperation, investigationOwnerFence, investigationFenceRequired, INVESTIGATION_ADMISSION, INVESTIGATION_FENCE_OWNERS, type InvestigationDb } from "@/lib/investigations";
import { qualifyScenarioCaptureSave } from "@/lib/investigationScenarioServer";
import { investigationApiUnavailable } from "@/lib/investigationApiAdmission";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const statuses: Record<string, number> = { found: 200, committed: 200, invalid_payload: 400, unauthenticated: 401, not_found: 404, version_conflict: 409, idempotency_conflict: 409, layout_conflict: 409, invalid_transition: 422, reference_unavailable: 422, limit_reached: 429, owner_mismatch: 412, unavailable: 503 };
// The authenticated subject rides beside the db: a scenario-bearing save must name the SAME
// user in its x-mm-scenario-owner header, so an intent written by another browser identity can
// never be applied under this session. GET keeps RLS as the sole owner authority.
async function session(): Promise<{ db: InvestigationDb; userId: string } | null> {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return null;
  return { db: db as unknown as InvestigationDb, userId: user.id };
}
export async function GET(request: Request) {
  const unavailable = investigationApiUnavailable();
  if (unavailable) return unavailable;
  try {
    const authed = await session();
    if (!authed) return respond({ status: "unauthenticated" }, 401);
    const db = authed.db;
    const claimedOwner = request.headers.get("x-mm-investigation-owner");
    const params = new URL(request.url).searchParams;
    const keys = [...params.keys()];
    if (!keys.length) {
      // Expected-actor fence for the list RPC: a present header must name the
      // authenticated user; a legacy client without one keeps compatible behavior.
      if (investigationOwnerFence(claimedOwner, authed.userId, false).status !== "ok") return respond({ status: "owner_mismatch" }, 412);
      const result=await listInvestigations(db);
      return respond(result,result.status==="listed"?200:503);
    }
    if (keys.includes("admission")) {
      const parts = (params.get("admission") ?? "").split(":");
      const owner = parts[0] ?? ""; const objectType = parts[1] ?? "";
      const registered = (INVESTIGATION_ADMISSION.evidence ?? []).some(adapter => adapter.owner === owner && adapter.object_types.includes(objectType));
      if (keys.length !== 1 || parts.length !== 2 || !owner || !objectType || !registered) return respond({ status: "invalid_payload" }, 400);
      // Sector/GMI admission probes are Sector use: the fence is required outright.
      if (investigationOwnerFence(claimedOwner, authed.userId, INVESTIGATION_FENCE_OWNERS.includes(owner)).status !== "ok") return respond({ status: "owner_mismatch" }, 412);
      const { data, error } = await db.rpc("investigation_evidence_admitted_v2", { owner, object_type: objectType });
      if (error || typeof data !== "boolean") return respond({ status: "unavailable" }, 503);
      return respond({ status: "admission", admitted: data });
    }
    if (keys.includes("subject_admission")) {
      // Narrow subject-admission probe through the same owner: the UI save
      // availability readback needs schema AND subject admission, and the RPC is
      // absent (honest 503) until migration 0049 is applied by the operator.
      const parts = (params.get("subject_admission") ?? "").split(":");
      const owner = parts.slice(0, parts.length - 1).join(":");
      const kind = parts[parts.length - 1] ?? "";
      const registered = (INVESTIGATION_ADMISSION.subjects ?? []).some(adapter => adapter.owner === owner && adapter.kinds.includes(kind));
      if (keys.length !== 1 || parts.length < 2 || !owner || !kind || !registered) return respond({ status: "invalid_payload" }, 400);
      if (investigationOwnerFence(claimedOwner, authed.userId, INVESTIGATION_FENCE_OWNERS.includes(owner)).status !== "ok") return respond({ status: "owner_mismatch" }, 412);
      const { data, error } = await db.rpc("investigation_subject_admitted_v2", { owner, kind });
      if (error || typeof data !== "boolean") return respond({ status: "unavailable" }, 503);
      return respond({ status: "subject_admission", admitted: data });
    }
    if (new Set(keys).size !== keys.length || keys.some(k => !["id", "revision", "operation_id"].includes(k))) return respond({ status: "invalid_payload" }, 400);
    const operation = params.get("operation_id");
    if (operation !== null) {
      if (keys.length !== 1) return respond({ status: "invalid_payload" }, 400);
      // Status receipt reads sit behind the same expected-actor fence.
      if (investigationOwnerFence(claimedOwner, authed.userId, false).status !== "ok") return respond({ status: "owner_mismatch" }, 412);
      const result = await readInvestigationOperation(db, operation);
      return respond(result, statuses[result.status] ?? 503);
    }
    const id = params.get("id");
    if (!id) return respond({ status: "invalid_payload" }, 400);
    // Read RPCs sit behind the same expected-actor fence.
    if (investigationOwnerFence(claimedOwner, authed.userId, false).status !== "ok") return respond({ status: "owner_mismatch" }, 412);
    const rawRevision = params.get("revision");
    if (rawRevision !== null && !/^[1-9][0-9]{0,9}$/.test(rawRevision)) return respond({ status: "invalid_payload" }, 400);
    const result = await readInvestigation(db, id, rawRevision === null ? null : Number(rawRevision));
    return respond(result, statuses[String(result.status)] ?? 503);
  } catch { return respond({ status: "unavailable" }, 503); }
}
export async function POST(request: Request) {
  const unavailable = investigationApiUnavailable();
  if (unavailable) return unavailable;
  const limit = rateLimit(request, { name: "investigations-save", max: 30 });
  if (!limit.ok) {
    const response = tooMany(limit);
    Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  }
  try {
    const authed = await session();
    if (!authed) return respond({ status: "unauthenticated" }, 401);
    const { db, userId } = authed;
    // Same parsed-JSON request convention as the existing authenticated Thesis route.
    const maxBytes = 132 * 1024;
    const stated = Number(request.headers.get("content-length"));
    if (Number.isFinite(stated) && stated > maxBytes) return respond({ status: "invalid_payload" }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) return respond({ status: "invalid_payload" }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return respond({ status: "invalid_payload" }, 400); }
    const command = parseInvestigationCommand(body);
    if (!command) return respond({ status: "invalid_payload" }, 400);
    // x-mm-investigation-owner expected-actor fence (packet §3.3), BEFORE the save
    // preflight and the apply RPC: a present header must name the authenticated user,
    // and Sector/GMI commands require it outright. A mismatch performs no database I/O,
    // never joins the definitive-save-failure set, and leaves the original actor's
    // journal untouched for reconciliation when that actor returns.
    if (investigationOwnerFence(request.headers.get("x-mm-investigation-owner"), userId, investigationFenceRequired(command.manifest)).status !== "ok") {
      return respond({ status: "owner_mismatch" }, 412);
    }
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
    const result = await applyInvestigationRevision(db, command);
    return respond(result, statuses[result.status] ?? 503);
  } catch { return respond({ status: "unavailable" }, 503); }
}
