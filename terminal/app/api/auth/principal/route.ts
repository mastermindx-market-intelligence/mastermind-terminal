import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRINCIPAL_SCHEMA = 'mmx.cookie-principal.v1';
const CACHE_CONTROL = 'private, no-store';

// Canonical, case-insensitive UUID v1-v5 with RFC 4122 variant nibble 8/9/a/b.
const PRINCIPAL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PrincipalUser = { id: unknown };

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: { 'cache-control': CACHE_CONTROL } });
}

/**
 * Same-origin principal probe for Terminal F11. Identity is resolved only
 * through the cookie-backed Supabase client: the handler reads no request,
 * query or header input, emits closed JSON envelopes without raw error text
 * or identity metadata, and disables caching on every path.
 */
export async function GET(): Promise<NextResponse> {
  let user: PrincipalUser | null = null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      return jsonError(503, 'principal_unavailable');
    }
    user = data?.user ?? null;
  } catch {
    return jsonError(503, 'principal_unavailable');
  }

  if (!user) {
    return jsonError(401, 'unauthenticated');
  }

  const id = typeof user.id === 'string' ? user.id : '';
  if (!PRINCIPAL_ID_PATTERN.test(id)) {
    return jsonError(503, 'principal_unavailable');
  }

  return NextResponse.json(
    { schema: PRINCIPAL_SCHEMA, verified: true, principalId: id.toLowerCase() },
    { headers: { 'cache-control': CACHE_CONTROL } },
  );
}
