import { NextResponse } from "next/server";
import { isUuid } from "@/lib/theses";
import {
  amendedFromValue,
  evidenceRefsError,
  findJudgementKey,
  mapProposalRow,
  MESSAGES,
  normalizeBody,
} from "@/lib/thesisAmendmentProposals";
import { jsonError, ownedThesis, resolveDb, versionForThesis } from "./_session";

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

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ thesisId: string }> },
) {
  const session = await resolveDb();
  if (!session) return jsonError("unauthenticated", 401);
  const { thesisId } = await ctx.params;
  if (!isUuid(thesisId)) return jsonError("not_found", 404);
  const owns = await ownedThesis(session.db, thesisId, session.userId);
  if (!owns) return jsonError("not_found", 404);

  const listed = await session.db.from("thesis_amendment_proposals")
    .select("proposal_id, thesis_id, amended_from, body, evidence_refs, proposed_by, state, created_at")
    .eq("thesis_id", thesisId)
    .order("created_at", { ascending: false });
  if (listed.error) {
    console.error("thesis proposal list failed");
    return jsonError("unavailable", 503);
  }
  const raw = Array.isArray(listed.data) ? listed.data : [];
  const proposals = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const versionId = typeof row.amended_from === "string" ? row.amended_from : "";
    const version = versionId ? await versionForThesis(session.db, thesisId, versionId) : null;
    const mapped = mapProposalRow(row, version);
    if (mapped) proposals.push(mapped);
  }
  return NextResponse.json({ proposals });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ thesisId: string }> },
) {
  const session = await resolveDb();
  if (!session) return jsonError("unauthenticated", 401);
  const { thesisId } = await ctx.params;
  if (!isUuid(thesisId)) return jsonError("not_found", 404);
  const owns = await ownedThesis(session.db, thesisId, session.userId);
  if (!owns) return jsonError("not_found", 404);

  const parsed = await readBoundedJson(request);
  if (!parsed.ok) return jsonError(parsed.error, 400, MESSAGES.sendJson);

  if (findJudgementKey(parsed.body)) {
    return jsonError("judgement_forbidden", 400, MESSAGES.judgement);
  }

  const amendedFrom = amendedFromValue(parsed.body.amended_from);
  if (!amendedFrom) return jsonError("invalid_amended_from", 400, MESSAGES.missingAmendedFrom);

  const refsError = evidenceRefsError(parsed.body.evidence_refs);
  if (refsError === "judgement") return jsonError("judgement_forbidden", 400, MESSAGES.judgement);
  if (refsError === "payload") return jsonError("payload_copy", 400, MESSAGES.payloadCopy);

  const body = normalizeBody(parsed.body.body);
  if (!body) return jsonError("empty_body", 400, MESSAGES.emptyBody);

  const version = await versionForThesis(session.db, thesisId, amendedFrom);
  if (!version) return jsonError("invalid_amended_from", 400, MESSAGES.missingAmendedFrom);

  const insert = await session.db.from("thesis_amendment_proposals")
    .insert({
      thesis_id: thesisId,
      amended_from: amendedFrom,
      body,
      evidence_refs: Array.isArray(parsed.body.evidence_refs) ? parsed.body.evidence_refs : [],
      proposed_by: "assistant",
      state: "proposed",
    })
    .select("proposal_id, thesis_id, amended_from, body, evidence_refs, proposed_by, state, created_at")
    .maybeSingle();
  if (insert.error || !insert.data || typeof insert.data !== "object") {
    console.error("thesis proposal insert failed");
    return jsonError("unavailable", 503);
  }
  const mapped = mapProposalRow(insert.data as Record<string, unknown>, version);
  if (!mapped) return jsonError("unavailable", 503);
  return NextResponse.json({ proposal: mapped }, { status: 201 });
}
