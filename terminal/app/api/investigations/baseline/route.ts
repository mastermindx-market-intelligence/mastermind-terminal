import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { R2_BASE } from "@/lib/upstreams";
import { normalizeCompanyIntelligenceSymbol, resolveCurrentEventWorkspaceFromR2, type RetainedEventWorkspacePin } from "@/lib/eventWorkspace";
import { resolveInvestigationIssuerRelease } from "@/lib/investigationIssuerRelease";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
export async function GET(request: Request) {
  try {
    const db = await createClient();
    const { data: { user }, error } = await db.auth.getUser();
    if (error || !user) return response({ status: "unauthenticated" }, 401);
    const query = new URL(request.url).searchParams;
    const keys = [...query.keys()];
    if (new Set(keys).size !== keys.length) return response({ status: "invalid_payload" }, 400);
    let pin: RetainedEventWorkspacePin;
    const symbol = query.get("symbol");
    if (symbol !== null) {
      if (keys.length !== 1 || normalizeCompanyIntelligenceSymbol(symbol) !== symbol) return response({ status: "invalid_payload" }, 400);
      const current = await resolveCurrentEventWorkspaceFromR2(symbol, R2_BASE, { signal: request.signal });
      if (!current.ok || current.state === "stale") return response({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "current_owner_unavailable" }, 503);
      if (!current.workspace.issuer.listings.some(listing=>listing.ticker===symbol)) return response({ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"subject_mismatch"},503);
      pin = { event_id: current.workspace.event_id, generation_id: current.workspace.generation_id, company_id: current.workspace.issuer.company_id };
    } else {
      if (keys.length !== 4 || keys.some(k => !["event_id", "generation_id", "company_id", "fingerprint"].includes(k))) return response({ status: "invalid_payload" }, 400);
      pin = { event_id: query.get("event_id")!, generation_id: query.get("generation_id")!, company_id: query.get("company_id")!, fingerprint: query.get("fingerprint")! };
    }
    // Production remains default-deny until the existing rights owner supplies a
    // current SEC decision. Never substitute historical public-primary labels.
    const result = await resolveInvestigationIssuerRelease(pin, R2_BASE, { signal: request.signal });
    if (!result.ok) return response(result, result.reason === "invalid_reference" ? 400 : 503);
    return response(result);
  } catch { return response({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "owner_unavailable" }, 503); }
}
