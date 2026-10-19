import { handleV1Get } from "@/lib/apiV1Server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleV1Get(request, "watchlists");
}
