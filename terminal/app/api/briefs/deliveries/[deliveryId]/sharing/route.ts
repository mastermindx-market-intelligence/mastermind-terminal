import { isUuid } from "@/lib/briefs";
import { parseSharingCommand, readBriefDeliverySharing, reconcileBriefDeliverySharing,
  shareBriefDelivery, sharingDigest } from "@/lib/briefDeliverySharing";
import { authenticatedSharing, sharingCommandText, sharingFailure } from "@/lib/briefDeliverySharingServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
type Context = { params: Promise<{ deliveryId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { deliveryId } = await context.params;
  const query = new URL(request.url).searchParams;
  if (!isUuid(deliveryId) || Array.from(query).length !== 1) return sharingFailure("invalid_input", 400);
  const team = query.get("team_id"), effect = query.get("expected_effect_sha256");
  if (team && isUuid(team)) return authenticatedSharing(db => readBriefDeliverySharing(db, deliveryId, team));
  if (effect && sharingDigest(effect))
    return authenticatedSharing(db => reconcileBriefDeliverySharing(db, deliveryId, effect));
  return sharingFailure("invalid_input", 400);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { deliveryId } = await context.params;
  if (!isUuid(deliveryId) || new URL(request.url).search)
    return sharingFailure("invalid_input", 400);
  if (request.headers.get("origin") !== new URL(request.url).origin ||
      request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    return sharingFailure("denied", 403);
  const text = await sharingCommandText(request);
  const command = text === null ? null : parseSharingCommand(text);
  if (!command) return sharingFailure("invalid_input", 400);
  const reference = { delivery_id: deliveryId, expected_effect_sha256: command.expected_effect_sha256 };
  return authenticatedSharing((db, principalId) => shareBriefDelivery(db, deliveryId, command.team_id,
    command.expected_content_sha256, command.expected_effect_sha256, principalId), reference);
}
