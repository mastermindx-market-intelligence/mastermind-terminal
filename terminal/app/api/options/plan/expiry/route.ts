import { NextResponse } from "next/server";
import { billingAuthResult, BILLING_BASE } from "@/app/api/billing/gateway";
import { preparePlanExpiryRequest, readPlanPayoff } from "@/lib/optionsPlanPayoff";
import { rateLimit, tooMany } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie", "X-Content-Type-Options": "nosniff" };
const respond = (status: number, reason: string) => NextResponse.json({ status: "UNAVAILABLE", reason }, { status, headers: HEADERS });
const MAX_BYTES = 64 * 1024;

async function boundedBody(response: Response, maximum: number): Promise<string> {
  if (!response.body) throw new Error("missing_body");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("body_limit");
      chunks.push(value);
    }
  } catch (e) { await reader.cancel().catch(() => undefined); throw e; }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(result);
}

export async function POST(request: Request): Promise<Response> {
  const limit = rateLimit(request, { name: "options-plan-expiry", max: 5 });
  if (!limit.ok) {
    const response = tooMany(limit);
    Object.entries(HEADERS).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }
  const auth = await billingAuthResult();
  if (auth.status !== "ok") return respond(auth.status === "denied" ? 401 : 503, "authentication_unavailable");
  if (request.headers.get("content-type")?.split(";", 1)[0].toLowerCase() !== "application/json") return respond(415, "invalid_plan_request");
  let payload: unknown;
  try { payload = JSON.parse(await boundedBody(new Response(request.body), MAX_BYTES)); }
  catch { return respond(422, "invalid_plan_request"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || Object.keys(payload).sort().join(",") !== "draft,payoff_basis,schema,spots") return respond(422, "invalid_plan_request");
  const body = payload as Record<string, unknown>;
  const checked = preparePlanExpiryRequest(body.draft);
  if (!checked.ok || body.schema !== checked.value.schema || JSON.stringify(body.spots) !== JSON.stringify(checked.value.spots)
    || !body.payoff_basis || typeof body.payoff_basis !== "object" || Array.isArray(body.payoff_basis)
    || Object.keys(body.payoff_basis).sort().join(",") !== "expiration,kind"
    || (body.payoff_basis as Record<string, unknown>).kind !== checked.value.payoff_basis.kind
    || (body.payoff_basis as Record<string, unknown>).expiration !== checked.value.payoff_basis.expiration) return respond(422, "invalid_plan_request");
  try {
    const upstream = await fetch(`${BILLING_BASE}/api/options/plan/expiry`, {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(checked.value),
    });
    if (!upstream.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return respond(502, "contract_terms_unavailable");
    const raw: unknown = JSON.parse(await boundedBody(upstream, 192 * 1024));
    if (!upstream.ok) return respond([401, 403, 422, 429, 503].includes(upstream.status) ? upstream.status : 502, "contract_terms_unavailable");
    if (!readPlanPayoff(raw, checked.value)) return respond(422, "contract_terms_unavailable");
    return NextResponse.json(raw, { headers: HEADERS });
  } catch { return respond(503, "contract_terms_unavailable"); }
}
