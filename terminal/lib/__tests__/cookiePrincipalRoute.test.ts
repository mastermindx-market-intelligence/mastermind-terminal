import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const createClient = vi.fn();
  return { createClient, getUser };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

import * as principalRoute from '@/app/api/auth/principal/route';

const { GET } = principalRoute;

const VALID_ID = '3f9d6a7e-8c1b-4e2a-9d3f-1a2b3c4d5e6f';
const VALID_ID_UPPER = VALID_ID.toUpperCase();
const NO_STORE = 'private, no-store';

// The handler takes no input; the cast only lets a poisoned request prove hints are ignored.
const callGet = async (request?: unknown): Promise<Response> =>
  (GET as unknown as (input?: unknown) => Promise<Response>)(request);

const bodyOf = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.createClient.mockReset();
  mocks.createClient.mockImplementation(async () => ({ auth: { getUser: mocks.getUser } }));
});

describe('GET /api/auth/principal', () => {
  it('pins the nodejs runtime and force-dynamic rendering', () => {
    expect(principalRoute.runtime).toBe('nodejs');
    expect(principalRoute.dynamic).toBe('force-dynamic');
  });

  it('returns 401 unauthenticated for a guest cookie session', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const response = await callGet();

    expect(response.status).toBe(401);
    expect(await bodyOf(response)).toEqual({ error: 'unauthenticated' });
    expect(response.headers.get('cache-control')).toBe(NO_STORE);
    expect(mocks.createClient).toHaveBeenCalledWith();
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });

  it('returns 503 principal_unavailable when getUser reports an auth error', async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'raw supabase failure detail' },
    });

    const response = await callGet();
    const body = await bodyOf(response);

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'principal_unavailable' });
    expect(JSON.stringify(body)).not.toContain('raw supabase failure detail');
    expect(response.headers.get('cache-control')).toBe(NO_STORE);
  });

  it('returns 503 when getUser rejects', async () => {
    mocks.getUser.mockRejectedValueOnce(new Error('cookie store exploded'));

    const response = await callGet();

    expect(response.status).toBe(503);
    expect(await bodyOf(response)).toEqual({ error: 'principal_unavailable' });
    expect(response.headers.get('cache-control')).toBe(NO_STORE);
  });

  it('returns 503 when createClient throws', async () => {
    mocks.createClient.mockRejectedValueOnce(new Error('cookie adapter unavailable'));

    const response = await callGet();

    expect(response.status).toBe(503);
    expect(await bodyOf(response)).toEqual({ error: 'principal_unavailable' });
    expect(response.headers.get('cache-control')).toBe(NO_STORE);
  });

  it.each([
    ['a version nibble outside v1-v5', '3f9d6a7e-8c1b-6e2a-9d3f-1a2b3c4d5e6f'],
    ['a variant nibble outside 8/9/a/b', '3f9d6a7e-8c1b-4e2a-cd3f-1a2b3c4d5e6f'],
    ['a truncated id', '3f9d6a7e-8c1b-4e2a-9d3f-1a2b3c4d5e6'],
    ['a non-uuid string', 'not-a-uuid'],
  ])('returns 503 for %s', async (_label, id) => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id } }, error: null });

    const response = await callGet();

    expect(response.status).toBe(503);
    expect(await bodyOf(response)).toEqual({ error: 'principal_unavailable' });
  });

  it('fails closed with 503 when an auth error accompanies a valid user', async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { id: VALID_ID } },
      error: { message: 'stale session' },
    });

    const response = await callGet();

    expect(response.status).toBe(503);
    expect(await bodyOf(response)).toEqual({ error: 'principal_unavailable' });
  });

  it('returns the normalized principal for an uppercase canonical id', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: VALID_ID_UPPER } }, error: null });

    const response = await callGet();

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      schema: 'mmx.cookie-principal.v1',
      verified: true,
      principalId: VALID_ID,
    });
    expect(response.headers.get('cache-control')).toBe(NO_STORE);
  });

  it('exposes only closed response keys and never secret metadata', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: VALID_ID_UPPER } }, error: null });
    const okBody = await bodyOf(await callGet());
    expect(Object.keys(okBody).sort()).toEqual(['principalId', 'schema', 'verified']);

    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect(Object.keys(await bodyOf(await callGet()))).toEqual(['error']);

    mocks.getUser.mockRejectedValueOnce(new Error('email token session leak attempt'));
    const failedBody = await bodyOf(await callGet());
    expect(Object.keys(failedBody)).toEqual(['error']);
    expect(JSON.stringify(failedBody)).not.toMatch(/email|token|session|secret/i);
  });

  it('sends private no-store on the success, guest and failure paths', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: VALID_ID } }, error: null });
    expect((await callGet()).headers.get('cache-control')).toBe(NO_STORE);

    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await callGet()).headers.get('cache-control')).toBe(NO_STORE);

    mocks.getUser.mockRejectedValueOnce(new Error('down'));
    expect((await callGet()).headers.get('cache-control')).toBe(NO_STORE);
  });

  it('ignores request hints and answers from the cookie client alone', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const poisoned = {
      url: '/api/auth/principal?principalId=' + VALID_ID,
      headers: { 'x-principal-id': VALID_ID, authorization: 'Bearer forged-token' },
      query: { principalId: VALID_ID },
    };

    const response = await callGet(poisoned);

    expect(response.status).toBe(401);
    expect(await bodyOf(response)).toEqual({ error: 'unauthenticated' });
    expect(mocks.createClient).toHaveBeenCalledWith();
  });
});
