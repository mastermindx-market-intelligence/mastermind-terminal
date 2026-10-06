import { normalizeCompanyIntelligenceSymbol } from "@/lib/companyIntelligence";
import { rateLimit } from "@/lib/rateLimit";
import {
  authToken,
  fetchChanges,
  fetchSnapshot,
  jsonOk,
  mapClientUpstreamError,
  tickerNewsErrorResponse,
  UpstreamError,
} from "@/lib/server/tickerNews";
import {
  fixtureChanges,
  fixtureSnapshot,
} from "@/lib/server/tickerNewsFixture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseLimit(raw: string | null, min: number, max: number, fallback: number): number | null {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function parseAfterSequence(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function parseCursor(raw: string | null): number | undefined | null {
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> },
): Promise<Response> {
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

  const { symbol: rawSymbol } = await params;
  const symbol = normalizeCompanyIntelligenceSymbol(rawSymbol);
  if (!symbol || symbol !== rawSymbol) {
    return tickerNewsErrorResponse(400, "invalid_symbol", "Invalid ticker", false);
  }

  const url = new URL(req.url);
  const afterSequenceRaw = url.searchParams.get("after_sequence");
  const afterSequence = parseAfterSequence(afterSequenceRaw);
  if (afterSequenceRaw !== null && afterSequenceRaw !== "" && afterSequence === null) {
    return tickerNewsErrorResponse(400, "invalid_request", "Invalid after_sequence", false);
  }

  const isChanges = afterSequence !== null;
  const limit = isChanges
    ? parseLimit(url.searchParams.get("limit"), 1, 500, 100)
    : parseLimit(url.searchParams.get("limit"), 1, 200, 50);
  if (limit === null) {
    return tickerNewsErrorResponse(400, "invalid_request", "Invalid limit", false);
  }

  const cursorRaw = url.searchParams.get("cursor");
  const cursor = parseCursor(cursorRaw);
  if (cursorRaw !== null && cursorRaw !== "" && cursor === null) {
    return tickerNewsErrorResponse(400, "invalid_request", "Invalid cursor", false);
  }

  const fixtureMode = process.env.TERMINAL_E2E_FIXTURE === "1";
  if (fixtureMode) {
    if (isChanges) {
      const page = fixtureChanges(symbol);
      if (!page) {
        return tickerNewsErrorResponse(404, "not_found", "Ticker not in qualified news universe", false);
      }
      return jsonOk(page);
    }
    const snap = fixtureSnapshot(symbol);
    if (!snap) {
      return tickerNewsErrorResponse(404, "not_found", "Ticker not in qualified news universe", false);
    }
    return jsonOk(snap);
  }

  const token = await authToken();
  if (!token) {
    return tickerNewsErrorResponse(401, "unauthorized", "Sign in to read ticker news", false);
  }

  try {
    if (isChanges) {
      const page = await fetchChanges(
        symbol,
        { afterSequence: afterSequence!, limit },
        token,
        req.signal,
      );
      return jsonOk(page);
    }
    const snap = await fetchSnapshot(
      symbol,
      { limit, ...(typeof cursor === "number" ? { cursor } : {}) },
      token,
      req.signal,
    );
    return jsonOk(snap);
  } catch (err) {
    if (err instanceof UpstreamError) {
      return mapClientUpstreamError(err, isChanges || cursor !== undefined);
    }
    return tickerNewsErrorResponse(502, "unavailable", "Ticker news is temporarily unavailable", true);
  }
}
