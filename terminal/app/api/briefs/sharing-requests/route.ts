import { authenticatedSharing, sharingFailure } from "@/lib/briefDeliverySharingServer";
import { readSharingRequestFeed } from "@/lib/briefSharingRequests";
import { terminalPrincipalScope } from "@/lib/briefSharingRequestsServer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export function GET(request: Request): Promise<Response> | Response {
  if (new URL(request.url).search || request.headers.has("authorization")) return sharingFailure("invalid_input", 400);
  return authenticatedSharing((db, id) => readSharingRequestFeed(db, { principal_scope: terminalPrincipalScope(id) }));
}
