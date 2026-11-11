import { NextResponse } from "next/server";
import { hasLiveOptions } from "@/lib/entitlement";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { parseFuturesRequest } from "@/lib/futuresRequest";
import { readFuturesSource } from "@/lib/futuresSourceRead";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(req: Request): Promise<Response> {
  const rl = rateLimit(req, { name: "futures" });
  if (!rl.ok) { const r = tooMany(rl); r.headers.set("Cache-Control", "private, no-store"); return r; }
  // Reuse the canonical options feature authority. A subscription is NOT a CME license;
  // the capture publisher separately supplies its permitted-distribution publication.
  // Never exempt this API for FLOW_FIXTURE, a cookie, a query, or NODE_ENV.
  let allowed = false;
  try { allowed = await hasLiveOptions(); } catch { /* authority unavailable means no data */ }
  if (!allowed) return NextResponse.json({ error: "access_required" }, { status: 403, headers });
  const request = parseFuturesRequest(new URL(req.url).searchParams);
  if (!request) return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
  try {
    const result = await readFuturesSource(request);
    if (result.status !== "data") return NextResponse.json({ error: result.reason }, { status: 503, headers });
    return NextResponse.json(result.data, { headers });
  } catch { return NextResponse.json({ error: "source_unavailable" }, { status: 503, headers }); }
}
