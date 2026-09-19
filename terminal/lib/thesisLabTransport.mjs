/** First-party transport over the existing Thesis Objects owner. No new store or auth. */
export const LAB_SCHEMA = 'mastermind.thesis-lab/v1';
const ORIGINS = new Set(['https://app.mastermind-x.com', 'https://bot.mastermind-x.com']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIMIT = 65536;
const ALLOWED_HEADERS = new Set(['content-type', 'x-mastermind-user']);
export const isUuid = v => typeof v === 'string' && UUID.test(v);

function allowedOrigin(request) {
  const origin = request.headers.get('origin');
  return origin !== null && ORIGINS.has(origin) ? origin : null;
}
function reply(request, body, status = 200) {
  const headers = new Headers({
    'Cache-Control': 'private, no-store, max-age=0', 'Pragma': 'no-cache',
    'Expires': '0', 'Vary': 'Origin, Cookie', 'X-Content-Type-Options': 'nosniff',
  });
  const origin = allowedOrigin(request);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  if (status === 204) {
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Mastermind-User');
    headers.set('Access-Control-Max-Age', '300');
    headers.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
    return new Response(null, {status, headers});
  }
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify({schema: LAB_SCHEMA, ...body}), {status, headers});
}
async function boundedBody(request) {
  const stated = request.headers.get('content-length');
  if (stated !== null && (!/^\d+$/.test(stated) || Number(stated) > LIMIT))
    return {error: 'request_too_large', status: 413};
  if (!request.body) return {error: 'invalid_json', status: 400};
  const reader = request.body.getReader();
  let count = 0; const parts = [];
  try {
    for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      count += value.byteLength;
      if (count > LIMIT) { await reader.cancel(); return {error: 'request_too_large', status: 413}; }
      parts.push(value);
    }
    const buffer = new Uint8Array(count); let offset = 0;
    for (const part of parts) { buffer.set(part, offset); offset += part.byteLength; }
    const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
    return {value};
  } catch { return {error: 'invalid_json', status: 400}; }
  finally { reader.releaseLock(); }
}
/** resolveSession returns closures bound to the authenticated canonical user, never browser identity. */
export async function handleThesisLab(request, resolveSession) {
  const error = (code, status, extra = {}) => reply(request, {error: code, effectUnknown: false, ...extra}, status);
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') {
    const requested = request.headers.get('access-control-request-method');
    const headers = (request.headers.get('access-control-request-headers') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (!allowedOrigin(request) || !['GET', 'POST'].includes(requested) || headers.some(x => !ALLOWED_HEADERS.has(x)))
      return error('origin_or_preflight_refused', 403);
    return reply(request, {}, 204);
  }
  if (!['GET', 'POST'].includes(method)) return error('method_not_allowed', 405);
  const origin = request.headers.get('origin');
  if ((origin !== null && !allowedOrigin(request)) || (method === 'POST' && !allowedOrigin(request)))
    return error('origin_refused', 403);
  if (method === 'POST' && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    return error('json_required', 415);
  let session;
  try { session = await resolveSession(); } catch { return error('identity_unavailable', 503); }
  if (!session) return error('unauthenticated', 401);
  if (!isUuid(session.userId)) return error('identity_unavailable', 503);
  const expected = request.headers.get('x-mastermind-user');
  if (expected !== null && expected.toLowerCase() !== session.userId.toLowerCase()) return error('account_changed', 409);
  const base = {userId: session.userId};
  if (method === 'GET') {
    const p = new URL(request.url).searchParams;
    if ([...p.keys()].some(k => !['view', 'id', 'requestId'].includes(k)) || [...p.keys()].length > 1)
      return error('invalid_query', 400);
    if (p.has('view')) return p.get('view') === 'session' ? reply(request, base) : error('invalid_query', 400);
    // All private detail/list/receipt reads after session discovery are principal-bound.
    if (!expected) return error('expected_account_required', 400);
    try {
      if (p.has('requestId')) {
        const id = p.get('requestId'); if (!isUuid(id)) return error('invalid_request_id', 400);
        const found = await session.receipt(id.toLowerCase());
        if (!found.ok) return error('thesis_store_unavailable', 503);
        const r = found.receipt;
        if (r !== null && (!isUuid(r.thesisId) || !Number.isSafeInteger(r.version) || r.version < 1 || r.clientRequestId !== id.toLowerCase()))
          return error('invalid_receipt', 503);
        return reply(request, {...base, receipt: r});
      }
      if (p.has('id')) {
        const id = p.get('id'); if (!isUuid(id)) return error('invalid_thesis_id', 400);
        const result = await session.read(id.toLowerCase());
        if (result.ok) return reply(request, {...base, thesis: result.thesis});
        return error(result.status === 'not_found' ? 'thesis_not_found' : 'thesis_store_unavailable', result.status === 'not_found' ? 404 : 503);
      }
      const result = await session.list();
      return result.ok ? reply(request, {...base, theses: result.theses, truncated: result.truncated}) : error('thesis_store_unavailable', 503);
    } catch { return error('thesis_store_unavailable', 503); }
  }
  if (!expected || !isUuid(expected)) return error('expected_account_required', 400);
  const parsed = await boundedBody(request);
  if (parsed.error) return error(parsed.error, parsed.status);
  const b = parsed.value;
  const keys = ['action', 'id', 'expectedVersion', 'clientRequestId', 'subject', 'content'];
  if (Object.keys(b).length !== keys.length || Object.keys(b).some(k => !keys.includes(k)) ||
      !['create', 'revise'].includes(b.action) || !isUuid(b.clientRequestId) ||
      !Number.isSafeInteger(b.expectedVersion) ||
      (b.action === 'create' ? (b.id !== null || b.expectedVersion !== 0) : (!isUuid(b.id) || b.expectedVersion < 1)))
    return error('invalid_payload', 400);
  try {
    // The existing owner validates subject/content and calls its sole atomic version RPC.
    const result = await session.apply(b);
    if (result.ok && (!isUuid(result.thesisId) || !Number.isSafeInteger(result.version) || result.version !== b.expectedVersion+1 || typeof result.replayed !== 'boolean' || (b.id && result.thesisId !== b.id))) return error('invalid_receipt', 503, {effectUnknown: true});
    if (result.ok) return reply(request, {...base, thesisId: result.thesisId, version: result.version,
      lifecycleState: result.lifecycleState, replayed: result.replayed, clientRequestId: b.clientRequestId,
      effectUnknown: false, executionAuthority: false, orderSubmitted: false}, result.status === 'created' ? 201 : 200);
    const statuses = {version_conflict: 409, idempotency_conflict: 409, not_found: 404, invalid_transition: 422, invalid_payload: 400};
    if (!(result.status in statuses)) return error('thesis_store_unavailable', 503, {effectUnknown: true});
    return error(result.status, statuses[result.status], result.status === 'version_conflict' ? {currentVersion: result.currentVersion} : {});
  } catch { return error('thesis_store_unavailable', 503, {effectUnknown: true}); }
}
