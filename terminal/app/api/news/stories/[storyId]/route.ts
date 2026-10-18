import { rateLimit, tooMany } from "@/lib/rateLimit";
import { parseTickerNewsStory, TickerNewsContractError } from "@/lib/newsContract";
import { proxyTickerNewsJson, TICKER_NEWS_PRIVATE_HEADERS } from "@/lib/server/tickerNews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeStoryId(raw: string): string {
  const value = raw.trim();
  if (!/^ev2_[A-Za-z0-9._-]{1,240}$/.test(value)) {
    throw new TickerNewsContractError("story_id");
  }
  return value;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ storyId: string }> },
): Promise<Response> {
  const limited = rateLimit(req, { name: "ticker-news-story", max: 120 });
  if (!limited.ok) return tooMany(limited);
  try {
    const { storyId: raw } = await params;
    const storyId = normalizeStoryId(raw);
    return proxyTickerNewsJson(
      req,
      `/api/ticker-news/stories/${encodeURIComponent(storyId)}`,
      parseTickerNewsStory,
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