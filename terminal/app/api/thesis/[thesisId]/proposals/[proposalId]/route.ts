import { NextResponse } from "next/server";
import { isUuid } from "@/lib/theses";
import { isPatchableState, MESSAGES } from "@/lib/thesisAmendmentProposals";
import { jsonError, ownedThesis, resolveDb } from "../_session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 64 * 1024;

async function readBoundedJson(request: Request): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: "request_too_large" | "invalid_json" }
> {
  const stated = Number(request.headers.get("content-length"));
  if (Number.isFinite(stated) && stated > MAX_REQUEST_BYTES) return { ok: false, error: "request_too_large" };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return { ok: false, error: "request_too_large" };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "invalid_json" };
    return { ok: true, body: value as Record<string, unknown> };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ thesisId: string; proposalId: string }> },
) {
  const session = await resolveDb();
  if (!session) return jsonError("unauthenticated", 401);
  const { thesisId, proposalId } = await ctx.params;
  if (!isUuid(thesisId) || !isUuid(proposalId)) return jsonError("not_found", 404);
  const owns = await ownedThesis(session.db, thesisId, session.userId);
  if (!owns) return jsonError("not_found", 404);

  // H1 (Round-1 heal): bind the proposal to BOTH keys the URL names before the rpc call.
  // The function already enforces owner-only access at the database side, but a caller
  // who owns two theses could otherwise accept/reject a proposal on thesis B through
  // `/api/thesis/<A>/proposals/<id>`. A missing row or a query error answers 404 and the
  // RPC is never invoked.
  const proposalLookup = await session.db.from("thesis_amendment_proposals")
    .select("proposal_id")
    .eq("proposal_id", proposalId)
    .eq("thesis_id", thesisId)
    .maybeSingle();
  if (proposalLookup.error) return jsonError("not_found", 404);
  const proposalRow = proposalLookup.data as { proposal_id?: string } | null;
  if (!proposalRow || proposalRow.proposal_id !== proposalId) {
    return jsonError("not_found", 404);
  }

  const parsed = await readBoundedJson(request);
  if (!parsed.ok) return jsonError(parsed.error, 400, MESSAGES.sendJson);
  if (!isPatchableState(parsed.body.state)) {
    return jsonError("invalid_transition", 400, MESSAGES.invalidState);
  }

  const rpc = await session.db.rpc("set_thesis_amendment_state", {
    p_proposal_id: proposalId,
    p_new_state: parsed.body.state,
  });
  if (rpc.error) {
    console.error("thesis proposal state change failed");
    return jsonError("unavailable", 503);
  }
  const rows = Array.isArray(rpc.data) ? rpc.data : rpc.data ? [rpc.data] : [];
  const row = (rows[0] ?? null) as { status?: string; proposal_id?: string; state?: string } | null;
  if (!row || row.status === "not_found") return jsonError("not_found", 404);
  if (row.status !== "ok") return jsonError("invalid_transition", 400, MESSAGES.invalidState);
  return NextResponse.json({ proposalId: row.proposal_id, state: row.state });
}
