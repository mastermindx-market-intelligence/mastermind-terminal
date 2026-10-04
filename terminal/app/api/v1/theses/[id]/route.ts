import { handleV1Get } from "@/lib/apiV1Server";

export const runtime = "nodejs";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleV1Get(request, "thesis", { id });
}
