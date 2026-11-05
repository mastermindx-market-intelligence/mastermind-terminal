import { rateLimit, tooMany } from "@/lib/rateLimit";
import { normalizeTickerNewsSymbol, parseTickerNewsSnapshot, requireRequestedEditorialView, tickerNewsViewQuery, TickerNewsContractError } from "@/lib/newsContract";
import { proxyTickerNewsJson, TICKER_NEWS_PRIVATE_HEADERS } from "@/lib/server/tickerNews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400, headers: TICKER_NEWS_PRIVATE_HEADERS });
}

function boundedInt(raw: string | null, name: string, min: number, max: number): number | null {
  if (raw == null || raw === "") return null;
  if (!/^\d+$/.test(raw)) throw new TickerNewsContractError(name);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TickerNewsContractError(name);
  return value;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const limited = rateLimit(req, { name: "ticker-news-snapshot", max: 120 });
  if (!limited.ok) return tooMany(limited);

  try {
    const { symbol: raw } = await params;
    const symbol = normalizeTickerNewsSymbol(raw);
    const url = new URL(req.url);
    const limit = boundedInt(url.searchParams.get("limit"), "limit", 1, 200);
    const cursor = boundedInt(url.searchParams.get("cursor"), "cursor", 1, Number.MAX_SAFE_INTEGER);
    const query = tickerNewsViewQuery(url.searchParams);
    if (limit !== null) query.set("limit", String(limit));
    if (cursor !== null) query.set("cursor", String(cursor));
    const suffix = query.size ? `?${query.toString()}` : "";
    return proxyTickerNewsJson(
      req,
      `/api/ticker-news/${encodeURIComponent(symbol)}${suffix}`,
      (value) => {
        const snapshot = parseTickerNewsSnapshot(value);
        if (snapshot.ticker !== symbol) throw new TickerNewsContractError("snapshot_ticker_mismatch");
        requireRequestedEditorialView(query, snapshot.editorial_view);
        return snapshot;
      },
    );
  } catch (error) {
    if (error instanceof TickerNewsContractError) return badRequest("invalid_request");
    throw error;
  }
}