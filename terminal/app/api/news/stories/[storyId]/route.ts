import { rateLimit } from "@/lib/rateLimit";
import {
  authToken,
  fetchStory,
  jsonOk,
  mapClientUpstreamError,
  tickerNewsErrorResponse,
  UpstreamError,
} from "@/lib/server/tickerNews";
import { fixtureStoryDetail } from "@/lib/server/tickerNewsFixture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ storyId: string }> },
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

  const { storyId } = await params;
  if (!STORY_ID_PATTERN.test(storyId)) {
    return tickerNewsErrorResponse(400, "invalid_symbol", "Invalid story id", false);
  }

  const fixtureMode = process.env.TERMINAL_E2E_FIXTURE === "1";
  if (fixtureMode) {
    const detail = fixtureStoryDetail(storyId);
    if (!detail) {
      return tickerNewsErrorResponse(404, "not_found", "Ticker news story not found", false);
    }
    return jsonOk(detail);
  }

  const token = await authToken();
  if (!token) {
    return tickerNewsErrorResponse(401, "unauthorized", "Sign in to read ticker news", false);
  }

  try {
    const detail = await fetchStory(storyId, token, req.signal);
    return jsonOk(detail);
  } catch (err) {
    if (err instanceof UpstreamError) {
      return mapClientUpstreamError(err, false);
    }
    return tickerNewsErrorResponse(502, "unavailable", "Ticker news is temporarily unavailable", true);
  }
}
