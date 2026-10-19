import { handleProphetObservationRequest } from "@/lib/prophetObservationsServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: Request): Promise<Response> {
  return handleProphetObservationRequest(request);
}
