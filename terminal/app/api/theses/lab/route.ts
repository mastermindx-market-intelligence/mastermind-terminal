import { createClient } from '@/lib/supabase/server';
import { applyThesisVersion, listTheses, readThesis, type ThesisDb, type ThesisMutationInput } from '@/lib/theses';
import { handleThesisLab, type LabSession } from '@/lib/thesisLabTransport.mjs';

export const dynamic = 'force-dynamic';

async function resolveSession(): Promise<LabSession | null> {
  // Same identity and RLS client as /api/theses. No service-role credential or fixture bypass.
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error) {
    if (error.name === 'AuthSessionMissingError' || error.status === 401) return null;
    throw new Error('identity_unavailable');
  }
  if (!user) return null;
  const db = client as unknown as ThesisDb;
  return {
    userId: user.id,
    list: () => listTheses(db, user.id, 200),
    read: id => readThesis(db, user.id, id),
    apply: input => applyThesisVersion(db, user.id, input as ThesisMutationInput),
    receipt: async requestId => {
      // Existing (user_id, client_request_id) unique index; a read, not a new receipt store.
      const { data, error: lookupError } = await client.from('thesis_versions')
        .select('thesis_id,version,client_request_id')
        .eq('user_id', user.id).eq('client_request_id', requestId).limit(2);
      if (lookupError || !Array.isArray(data) || data.length > 1) return {ok: false};
      if (!data.length) return {ok: true, receipt: null};
      return {ok: true, receipt: {thesisId: data[0].thesis_id, version: data[0].version, clientRequestId: data[0].client_request_id}};
    },
  };
}

export const GET = (request: Request) => handleThesisLab(request, resolveSession);
export const POST = (request: Request) => handleThesisLab(request, resolveSession);
export const OPTIONS = (request: Request) => handleThesisLab(request, resolveSession);
