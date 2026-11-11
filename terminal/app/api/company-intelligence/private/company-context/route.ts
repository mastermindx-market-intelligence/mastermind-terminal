import { handlePrivateCompanyContextRequest } from '@/lib/companyIntelligencePrivateServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/** The helper owns authentication, fresh entitlement and the fixed current query. */
export async function GET(request: Request): Promise<Response> {
  return handlePrivateCompanyContextRequest(request);
}
