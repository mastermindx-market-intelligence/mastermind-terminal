import { rateLimit, tooMany } from "@/lib/rateLimit";
import { normalizeTickerNewsSymbol, TickerNewsContractError } from "@/lib/newsContract";
import { proxyTickerNewsStream, TICKER_NEWS_PRIVATE_HEADERS } from "@/lib/server/tickerNews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const limited = rateLimit(req, { name: "ticker-news-stream", max: 30 });
  if (!limited.ok) return tooMany(limited);

  try {
    const url = new URL(req.url);
    const rawSymbol = url.searchParams.get("symbol");
    if (!rawSymbol) throw new TickerNewsContractError("symbol");
    const symbol = normalizeTickerNewsSymbol(rawSymbol);
    const afterRaw = url.searchParams.get("after_sequence");
    let after = 0;
    if (afterRaw != null && afterRaw !== "") {
      if (!/^\d+$/.test(afterRaw)) throw new TickerNewsContractError("after_sequence");
      after = Number(afterRaw);
      if (!Number.isSafeInteger(after) || after < 0) throw new TickerNewsContractError("after_sequence");
    }
    return proxyTickerNewsStream(
      req,
      `/api/ticker-news/${encodeURIComponent(symbol)}/stream?after_sequence=${after}`,
    );
  } catch (error) {
    if (error instanceof TickerNewsContractError) {
      return Response.json(
        { error: "invalid_request" },
        { status: 400, headers: TICKER_NEWS_PRIVATE_HEADERS },
      );
    }
    throw error;
  }
}