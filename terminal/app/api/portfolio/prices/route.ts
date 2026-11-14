import { NextResponse } from "next/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { NW_BASE } from "@/lib/upstreams";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };
// Both resources are public quote projections. Do not forward any account cookie or bearer.
export async function GET(req: Request) {
  const limit = rateLimit(req, { name: "portfolio-public-prices", max: 60 });
  if (!limit.ok) return tooMany(limit);
  const query = new URL(req.url).searchParams;
  const symbols = (query.get("symbols") || "").split(",");
  const extended = query.get("session") === "extended";
  if (symbols.length > (extended ? 1 : 24) || symbols.some(s => !/^[A-Z][A-Z0-9.-]{0,10}$/.test(s))) {
    return NextResponse.json({ error: "invalid_symbols" }, { status: 400, headers: HEADERS });
  }
  const path = extended ? "/api/dossier-quote/" + symbols[0] :
    "/api/intelligence-hub/market-pulse?symbols=" + encodeURIComponent(symbols.join(","));
  try {
    const response = await fetch(new URL(path, NW_BASE), { cache: "no-store", redirect: "error",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(3500)]) });
    if (response.ok) {
      const body = await response.json();
      if (extended && body.schema === "dossier_quote_public.v1" && body.ticker === symbols[0]) {
        return NextResponse.json({ ticker: body.ticker, extended: body.extended_quote ?? null }, { headers: HEADERS });
      }
      if (!extended && body.schema === "intelligence_hub.market_pulse.v1" && Array.isArray(body.items)) {
        const prices: Record<string, unknown> = {};
        for (const row of body.items) {
          if (!row || !symbols.includes(row.symbol) || row.currency !== "USD" || !Number.isFinite(row.price) || row.price <= 0 ||
            !Number.isFinite(row.change_pct) || !["delayed", "live"].includes(row.freshness) ||
            !["regular", "pre", "post", "closed"].includes(row.session) || typeof row.observed_at !== "string") continue;
          const asOfMs = Date.parse(row.observed_at);
          if (!Number.isFinite(asOfMs) || asOfMs > Date.now()) continue;
          prices[row.symbol] = {last: row.price, chg: row.change_pct, currency: row.currency,
            asOfMs, basis: row.freshness === "live" ? "LIVE" : "DELAYED", session: row.session };
        }
        return NextResponse.json({ prices }, { headers: HEADERS });
      }
    }
  } catch { /* The regular quote read remains independently usable. */ }
  return NextResponse.json({ error: "prices_unavailable" }, { status: 503, headers: HEADERS });
}
