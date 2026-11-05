import { isUuid } from "@/lib/briefs";
import { readSharedBriefDelivery } from "@/lib/briefDeliverySharing";
import { authenticatedSharing, sharingFailure } from "@/lib/briefDeliverySharingServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(request: Request, context: { params: Promise<{ deliveryId: string }> }): Promise<Response> {
  const { deliveryId } = await context.params;
  if (!isUuid(deliveryId) || new URL(request.url).search) return sharingFailure("invalid_input", 400);
  return authenticatedSharing(db => readSharedBriefDelivery(db, deliveryId));
}
