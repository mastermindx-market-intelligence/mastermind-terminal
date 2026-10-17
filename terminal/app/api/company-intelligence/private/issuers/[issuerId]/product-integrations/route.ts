import { handlePrivateIssuerRequest } from '@/lib/companyIntelligencePrivateServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Thin Node-runtime bridge to the fixed private issuer selection read. All authority,
 * bounding and sanitizing lives in the server helper; this file adds no query controls,
 * no public fallback and no other method.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ issuerId: string }> },
): Promise<Response> {
  const { issuerId } = await context.params;
  return handlePrivateIssuerRequest(request, issuerId);
}
