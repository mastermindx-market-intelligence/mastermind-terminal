import { isUuid } from "@/lib/briefs";
import { executeSharingRequest, parseSharingRequestCommand, readSharingRequest } from "@/lib/briefSharingRequests";
import { authenticatedSharingRequest } from "@/lib/briefSharingRequestsServer";
import { sharingCommandText, sharingFailure, sharingOriginAllowed } from "@/lib/briefDeliverySharingServer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
type Context = { params: Promise<{ deliveryId: string }> };
export async function GET(request: Request, context: Context): Promise<Response> {
  const { deliveryId } = await context.params, query = new URL(request.url).searchParams;
  const requestRef = query.get("request_ref");
  if (!isUuid(deliveryId) || deliveryId !== deliveryId.toLowerCase() || !isUuid(requestRef) || requestRef !== requestRef.toLowerCase() || Array.from(query).length !== 2 || query.get("revision") !== "1" || request.headers.has("authorization")) return sharingFailure("invalid_input", 400);
  const selected = { delivery_id: deliveryId, request_ref: requestRef, revision: 1 as const };
  return authenticatedSharingRequest(db => readSharingRequest(db, selected), selected, false);
}
export async function POST(request: Request, context: Context): Promise<Response> {
  const { deliveryId } = await context.params;
  if (!isUuid(deliveryId) || deliveryId !== deliveryId.toLowerCase() || new URL(request.url).search || request.headers.has("authorization")) return sharingFailure("invalid_input", 400);
  if (!sharingOriginAllowed(request) || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return sharingFailure("denied", 403);
  const text = await sharingCommandText(request), command = text === null ? null : parseSharingRequestCommand(text);
  if (!command) return sharingFailure("invalid_input", 400);
  const selected = { delivery_id: deliveryId, request_ref: command.request_ref, revision: 1 as const };
  return authenticatedSharingRequest(db => executeSharingRequest(db, deliveryId, command), selected, true);
}
