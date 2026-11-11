import { handlePrivateFactRequest } from '@/lib/companyIntelligencePrivateServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Thin Node-runtime bridge to the fixed private product-integration fact read. Decoding
 * a current fact here is not selection-composition permission: that join belongs to the
 * later admitted host, which uses the exported pure assertion.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ factId: string }> },
): Promise<Response> {
  const { factId } = await context.params;
  return handlePrivateFactRequest(request, factId);
}
