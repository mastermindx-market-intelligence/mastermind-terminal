import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { R2_BASE } from "@/lib/upstreams";
import { normalizeCompanyIntelligenceSymbol, resolveCurrentEventWorkspaceFromR2, resolveRetainedEventWorkspaceFromR2, type RetainedEventWorkspacePin } from "@/lib/eventWorkspace";
import { createSelectedIssuerReleaseReadOptions, resolveInvestigationIssuerRelease } from "@/lib/investigationIssuerRelease";
import { investigationApiUnavailable } from "@/lib/investigationApiAdmission";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
export async function GET(request: Request) {
  // Closed-mode admission gate, before auth or any R2/DB work.
  const closed = investigationApiUnavailable();
  if (closed) return closed;
  try {
    const db = await createClient();
    const { data: { user }, error } = await db.auth.getUser();
    if (error || !user) return response({ status: "unauthenticated" }, 401);
    const query = new URL(request.url).searchParams;
    const keys = [...query.keys()];
    if (new Set(keys).size !== keys.length) return response({ status: "invalid_payload" }, 400);
    const scope = query.get("scope");
    if (scope !== null && scope !== "company_context") return response({ status: "invalid_payload" }, 400);
    const selectors = keys.filter(key => key !== "scope");
    let pin: RetainedEventWorkspacePin;
    const symbol = query.get("symbol");
    if (symbol !== null) {
      if (selectors.length !== 1 || normalizeCompanyIntelligenceSymbol(symbol) !== symbol) return response({ status: "invalid_payload" }, 400);
      const current = await resolveCurrentEventWorkspaceFromR2(symbol, R2_BASE, { signal: request.signal });
      if (!current.ok || current.state === "stale") return response({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "current_owner_unavailable" }, 503);
      if (!current.workspace.issuer.listings.some(listing=>listing.ticker===symbol)) return response({ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"subject_mismatch"},503);
      pin = { event_id: current.workspace.event_id, generation_id: current.workspace.generation_id, company_id: current.workspace.issuer.company_id };
    } else {
      if (selectors.length !== 4 || selectors.some(k => !["event_id", "generation_id", "company_id", "fingerprint"].includes(k))) return response({ status: "invalid_payload" }, 400);
      pin = { event_id: query.get("event_id")!, generation_id: query.get("generation_id")!, company_id: query.get("company_id")!, fingerprint: query.get("fingerprint")! };
    }
    if (scope === "company_context") {
      // A full Company context and an issuer-release selection have different
      // payloads and rights scopes. This selects the existing whole owner only;
      // it does not grant access. With no qualified current authorizer wired,
      // that owner fails closed before fetching retained generation bytes.
      const result = await resolveRetainedEventWorkspaceFromR2(pin, R2_BASE, { signal: request.signal });
      if (!result.ok) return response(result, result.reason === "invalid_reference" ? 400 : 503);
      return response({ ...result, reference: {
        owner: "earnings.workspace_generation", object_type: "event_workspace", object_id: result.receipt.event_id,
        mode: "pinned", version_ref: result.receipt.generation_id, fingerprint: result.receipt.fingerprint,
      } });
    }
    // Existing no-scope IW2 callers retain their selected-release contract.
    // Only a qualified selected receipt can earn this principal's read decision.
    // Neither scope borrows public-primary labels or the other scope's grant.
    const result = await resolveInvestigationIssuerRelease(pin, R2_BASE, createSelectedIssuerReleaseReadOptions(user.id,request.signal));
    if (!result.ok) return response(result, result.reason === "invalid_reference" ? 400 : 503);
    return response(result);
  } catch { return response({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "owner_unavailable" }, 503); }
}
