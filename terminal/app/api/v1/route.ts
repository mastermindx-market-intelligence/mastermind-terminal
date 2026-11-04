import { handleV1Index } from "@/lib/apiV1Server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleV1Index(request);
}
