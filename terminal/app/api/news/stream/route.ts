import { normalizeCompanyIntelligenceSymbol } from "@/lib/companyIntelligence";
import { rateLimit } from "@/lib/rateLimit";
import {
  authToken,
  mapClientUpstreamError,
  openStream,
  tickerNewsErrorResponse,
  TICKER_NEWS_PRIVATE_HEADERS,
  UpstreamError,
} from "@/lib/server/tickerNews";
import { fixtureChanges } from "@/lib/server/tickerNewsFixture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseAfterSequence(raw: string | null): number | null {
  if (raw === null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export async function GET(req: Request): Promise<Response> {
  const limited = rateLimit(req, { name: "ticker-news", max: 60 });
  if (!limited.ok) {
    return tickerNewsErrorResponse(
      429,
      "rate_limited",
      "Ticker news rate limit reached",
      true,
      { "Retry-After": String(limited.retryAfterSec) },
    );
  }

  const url = new URL(req.url);
  const rawSymbol = url.searchParams.get("symbol");
  if (!rawSymbol) {
    return tickerNewsErrorResponse(400, "invalid_symbol", "Invalid ticker", false);
  }
  const symbol = normalizeCompanyIntelligenceSymbol(rawSymbol);
  if (!symbol || symbol !== rawSymbol) {
    return tickerNewsErrorResponse(400, "invalid_symbol", "Invalid ticker", false);
  }

  const afterSequenceRaw = url.searchParams.get("after_sequence");
  const afterSequence = parseAfterSequence(afterSequenceRaw);
  if (afterSequenceRaw !== null && afterSequenceRaw !== "" && afterSequence === null) {
    return tickerNewsErrorResponse(400, "invalid_request", "Invalid after_sequence", false);
  }

  const fixtureMode = process.env.TERMINAL_E2E_FIXTURE === "1";
  if (fixtureMode) {
    const page = fixtureChanges(symbol);
    if (!page) {
      return tickerNewsErrorResponse(404, "not_found", "Ticker not in qualified news universe", false);
    }
    const body = page.rows.map((row) => {
      const payload = JSON.stringify(row);
      return `event: ${row.kind}\ndata: ${payload}\n\n`;
    }).join("") + ": heartbeat\n\n";
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        ...TICKER_NEWS_PRIVATE_HEADERS,
        "X-Accel-Buffering": "no",
      },
    });
  }

  const token = await authToken();
  if (!token) {
    return tickerNewsErrorResponse(401, "unauthorized", "Sign in to read ticker news", false);
  }

  try {
    const upstream = await openStream(symbol, afterSequence ?? 0, token, req.signal);
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        ...TICKER_NEWS_PRIVATE_HEADERS,
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      return mapClientUpstreamError(err, afterSequenceRaw !== null && afterSequenceRaw !== "");
    }
    return tickerNewsErrorResponse(502, "unavailable", "Ticker news is temporarily unavailable", true);
  }
}
