import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apiV1Server";
import { openApiDocument } from "@/lib/apiV1Openapi";
import { API_V1_RATE_LIMIT_MINUTE } from "@/lib/apiV1";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.ok) return authResult.response;
  const origin = new URL(request.url).origin;
  return NextResponse.json(openApiDocument(origin), {
    status: 200,
    headers: {
      "X-RateLimit-Limit": String(authResult.auth.limit ?? API_V1_RATE_LIMIT_MINUTE),
      "X-RateLimit-Remaining": String(authResult.auth.remaining),
    },
  });
}
