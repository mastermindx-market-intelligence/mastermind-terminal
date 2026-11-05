// terminal/lib/frozenNodeSource.ts
//
// Bounded injected transport for one dated Options GEX document.
// This module is SOURCE TRANSPORT ONLY: it decides nothing about admission,
// rights, lifecycle or grants. The caller supplies the transport (fetcher);
// ambient fetch is never used. Exactly one direct object read, no index,
// no latest/date lookup, no fixture, no fallback, no retry.
import { r2Key } from '@/lib/flowSource';
import { R2_BASE } from '@/lib/upstreams';
import { isValidRoot } from '@/lib/flowRoot';

/** Hard ceiling on a frozen node source: advertised and actual bytes. */
export const FROZEN_NODE_MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/** Single-shot fetch timeout for the frozen object read. */
export const FROZEN_NODE_FETCH_TIMEOUT_MS = 2500;

/** Injected transport shape; the ambient global fetch satisfies it structurally. */
export type FrozenNodeFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type FrozenNodeSourceResult =
  | { kind: 'data'; raw: unknown; bytes: Uint8Array }
  | { kind: 'missing' }
  | { kind: 'unavailable'; reason: string };

const SESSION_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Exact real Gregorian YYYY-MM-DD (calendar-correct days, leap years). No normalization. */
function isRealGregorianDate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 10 || !SESSION_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= daysInMonth;
}

function unavailable(reason: string): FrozenNodeSourceResult {
  return { kind: 'unavailable', reason };
}

function errorMessage(err: unknown): string {
  try { return err instanceof Error ? err.message : String(err); }
  catch { return 'unreadable transport error'; }
}

/** Cleanup observes rejection but never makes refusal wait for a transport. */
function bestEffort(action: () => unknown): void {
  try { void Promise.resolve(action()).catch(() => {}); } catch { /* Already closed. */ }
}
function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (body) bestEffort(() => body.cancel());
}

/** Bound even injected promises that ignore AbortSignal. Late fulfillment stays
 * observed; a late response is canceled rather than becoming usable source. */
function untilAbort<T>(operation: () => Promise<T>, signal: AbortSignal, onLate?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const aborted = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    let pending: Promise<T>;
    try { pending = operation(); }
    catch (error) {
      settled = true; signal.removeEventListener('abort', aborted); reject(error); return;
    }
    Promise.resolve(pending).then(value => {
      if (settled || signal.aborted) {
        if (onLate) bestEffort(() => onLate(value));
        aborted(); return;
      }
      settled = true; signal.removeEventListener('abort', aborted); resolve(value);
    }, error => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', aborted); reject(error);
    });
  });
}

/**
 * Read exactly one dated frozen GEX object: gex_at:<root>:<session> under the
 * fixed R2_BASE origin. The fetcher is required; without it the source is
 * unavailable, never silently re-bound to ambient fetch.
 */
export async function readFrozenNodeDatedGex(
  coords: { root: string; session: string },
  opts: { fetcher: FrozenNodeFetcher; baseUrl?: string; signal?: AbortSignal },
): Promise<FrozenNodeSourceResult> {
  // --- coordinate validation, strictly before any transport use ---
  if (!coords || typeof coords !== 'object') return unavailable('missing coordinates');
  const { root, session } = coords;
  // Canonical form only: isValidRoot is already uppercase-exact; never alias,
  // trim, case-fold or otherwise normalize here. Redundant uppercase check is
  // defense in depth against a looser incumbent regex.
  if (typeof root !== 'string' || root.trim() !== root || !isValidRoot(root) || root !== root.toUpperCase()) {
    return unavailable('root is not a canonical valid root');
  }
  if (!isRealGregorianDate(session)) {
    return unavailable('session is not a real Gregorian YYYY-MM-DD date');
  }

  const fetcher = opts && typeof opts === 'object' ? opts.fetcher : undefined;
  if (typeof fetcher !== 'function') return unavailable('missing injected fetcher transport');

  // Explicit origin validation only: the object address below stays fixed on
  // R2_BASE regardless of this option.
  if (opts.baseUrl !== undefined) {
    const allowed: string[] = [R2_BASE, R2_BASE + '/'];
    if (typeof opts.baseUrl !== 'string' || allowed.indexOf(opts.baseUrl) === -1) {
      return unavailable('baseUrl must be exactly the fixed R2 origin (optionally with one trailing slash)');
    }
  }

  // Fixed frozen-object address; no index, no fallback, no retry.
  const url = R2_BASE + '/' + r2Key('gex_at:' + root + ':' + session);

  const callerSignal = opts.signal;
  if (callerSignal !== undefined && !(callerSignal instanceof AbortSignal)) return unavailable('invalid caller signal');
  if (callerSignal && callerSignal.aborted) return unavailable('aborted before fetch');

  const controller = new AbortController();
  let timedOut = false;
  const deadline = performance.now() + FROZEN_NODE_FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FROZEN_NODE_FETCH_TIMEOUT_MS);
  const onCallerAbort = () => {
    controller.abort();
  };
  if (callerSignal) callerSignal.addEventListener('abort', onCallerAbort);

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let streamDone = false, canceled = false, released = false;
  let unreadBody: ReadableStream<Uint8Array> | null = null;
  const cancelUnread = () => { const body = unreadBody; unreadBody = null; cancelBody(body); };
  const cancelReader = () => {
    if (reader && !canceled) { canceled = true; bestEffort(() => reader!.cancel()); }
  };
  const releaseReader = () => {
    if (reader && !released) { try { reader.releaseLock(); released = true; } catch { /* Retry on late read settlement. */ } }
  };
  const requireActive = () => {
    if (performance.now() >= deadline) { timedOut = true; controller.abort(); }
    if (controller.signal.aborted) throw new Error('aborted');
  };
  try {
    const res = await untilAbort(() => fetcher(url, { redirect: 'error', cache: 'no-store', signal: controller.signal }), controller.signal, late => cancelBody(late?.body));
    unreadBody = res?.body ?? null;
    requireActive();
    if (!res || typeof res !== 'object') return unavailable('transport returned no response object');

    if (res.redirected) {
      cancelUnread();
      return unavailable('refusing redirected response');
    }
    const finalUrl = typeof res.url === 'string' ? res.url : '';
    if (finalUrl === '') {
      cancelUnread();
      return unavailable('refusing response with empty final URL');
    }
    if (finalUrl !== url) {
      cancelUnread();
      return unavailable('refusing response whose final URL is not the exact requested object URL');
    }

    if (res.status === 404) {
      cancelUnread();
      return { kind: 'missing' };
    }
    if (res.status !== 200) {
      cancelUnread();
      return unavailable('unexpected status ' + res.status);
    }

    // Advertised bound: malformed/negative/oversize length refuses unread.
    try {
      const lenHeader = res.headers ? res.headers.get('content-length') : null;
      if (lenHeader !== null) {
        if (!/^\d+$/.test(lenHeader) || lenHeader.trim() !== lenHeader) {
          cancelUnread();
          return unavailable('refusing malformed content-length');
        }
        const advertised = Number(lenHeader);
        if (!Number.isSafeInteger(advertised)) {
          cancelUnread();
          return unavailable('refusing malformed content-length');
        }
        if (advertised > FROZEN_NODE_MAX_SOURCE_BYTES) {
          cancelUnread();
          return unavailable('refusing advertised content-length over the source bound');
        }
      }
    } catch {
      cancelUnread();
      return unavailable('refusing unreadable content-length');
    }

    // Actual streamed bound. Never fall back to res.json()/.text()/.arrayBuffer().
    const body = res.body;
    if (!body) return unavailable('refusing response without a streamed body');
    reader = body.getReader();
    unreadBody = null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>;
      try {
        step = await untilAbort(() => reader!.read(), controller.signal, releaseReader);
        requireActive();
      } catch (err) {
        // Read abort state before our own cancel below muddies it.
        const aborted =
          (callerSignal && callerSignal.aborted) || controller.signal.aborted || timedOut;
        controller.abort();
        return unavailable(
          aborted ? 'aborted while reading source' : 'transport error while reading source: ' + errorMessage(err),
        );
      }
      if (step.done) { streamDone = true; break; }
      const chunk = step.value;
      if (!(chunk instanceof Uint8Array)) return unavailable('source stream returned a non-byte chunk');
      const size = chunk.byteLength;
      if (total + size > FROZEN_NODE_MAX_SOURCE_BYTES) {
        controller.abort();
        cancelReader();
        return unavailable('source exceeds the frozen node byte bound while streaming');
      }
      if (chunk && size > 0) {
        chunks.push(chunk);
        total += size;
      }
    }

    const bytes = new Uint8Array(total);
    let at = 0;
    for (let i = 0; i < chunks.length; i++) {
      bytes.set(chunks[i], at);
      at += chunks[i].byteLength;
    }

    let text = '';
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return unavailable('source is not strict UTF-8');
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return unavailable('source is not valid JSON');
    }
    requireActive();
    return { kind: 'data', raw, bytes };
  } catch (err) {
    // Read abort state before our own cancel below muddies it.
    const aborted = (callerSignal && callerSignal.aborted) || controller.signal.aborted || timedOut;
    controller.abort();
    return unavailable(aborted ? 'aborted' : 'transport error: ' + errorMessage(err));
  } finally {
    cancelUnread();
    if (!streamDone) cancelReader();
    releaseReader();
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
  }
}
