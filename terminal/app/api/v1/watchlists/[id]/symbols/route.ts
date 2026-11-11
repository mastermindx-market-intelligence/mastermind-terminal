import { handleV1WatchlistAdd } from "@/lib/apiV1WatchlistWrite";
export const runtime = "nodejs";
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleV1WatchlistAdd(request, (await ctx.params).id);
}
