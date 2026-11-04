import { handleV1EventImpact } from "@/lib/apiV1EventImpactServer";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleV1EventImpact(request);
}
