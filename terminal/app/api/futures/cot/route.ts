import { NextResponse } from "next/server";
import { hasLiveOptions } from "@/lib/entitlement";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { readCotTff, type CotPair } from "@/lib/futuresCot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };

export async function GET(req: Request): Promise<Response> {
  const rl = rateLimit(req, { name: "futures-cot" });
  if (!rl.ok) {
    const response = tooMany(rl);
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  }
  // This is a public CFTC weekly report, not a waiver of the existing Options
  // entitlement. It must never bypass auth in a dev/fixture environment.
  let allowed = false;
  try { allowed = await hasLiveOptions(); } catch { /* deny when identity is not established */ }
  if (!allowed) return NextResponse.json({ error: "access_required" }, { status: 403, headers });

  const url = new URL(req.url);
  const values = url.searchParams.getAll("pair");
  if (url.searchParams.size !== 1 || values.length !== 1 ||
      (values[0] !== "ES" && values[0] !== "NQ"))
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });

  try {
    const report = await readCotTff(values[0] as CotPair);
    if (!report) return NextResponse.json({ error: "cot_unavailable" }, { status: 503, headers });
    return NextResponse.json(report, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: "cot_unavailable" }, { status: 503, headers });
  }
}
