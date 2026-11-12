'use client';

/**
 * usePrivateCompanyIntelligence - Terminal F04 private controller hook.
 * Stable operation: mo-a-f04-private-controller-01a128b5-v1.
 *
 * Consumes the mounted fixed same-origin private boundary exactly as the source owner
 * published it (contract b536aeaa). Three GETs, in order, with no other transport:
 *
 *   1. /api/company-intelligence/private/company-context?symbol=<exact supplied query>
 *   2. /api/company-intelligence/private/issuers/<decoded issuer id>/product-integrations
 *   3. /api/company-intelligence/private/product-integrations/<selected exact fact id>
 *
 * The BFF is the fresh grant authority: authentication, the company_intelligence_private_read
 * feature and every admission are re-decided per read and are never mirrored, cached or
 * pre-checked client-side. Ownership is the account UUID via identityOwnerKey/isAccountOwner;
 * an email is presentation only and can never key or transfer this projection.
 *
 * Deliberately absent: retry, poll, reconnect, cache, local/session storage, analytics, the
 * public projection, any historical or as_of path, inferred issuer mapping, alias
 * normalization (BRK.B and BRK-B stay distinct), external URLs, a /api/me reader, an
 * entitlement store, and all UI. Only the supplied pure decoders decide contract shape, and
 * only decoded, bound and composed values ever reach a READY projection.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { AccountIdentity } from './accountIdentity';
import { identityOwnerKey, isAccountOwner } from './accountIdentity';
import type {
  PrivateCompanyContext,
  PrivateIssuerSelections,
  PrivateProductIntegration,
  PrivateSelectionEntry,
} from './companyIntelligencePrivate';
import {
  PrivateDecodeError,
  assertPrivateComposition,
  assertPrivateContextSelection,
  decodePrivateCompanyContext,
  decodePrivateError,
  decodePrivateIssuerSelections,
  decodePrivateProductIntegration,
  isPrivateCompanySymbol,
} from './companyIntelligencePrivate';
import type {
  PrivateCompanyPassiveStatus,
  PrivateCompanyViewState,
} from './companyIntelligencePrivateView';

/** Consumer response policy: at most 32 KiB of streamed bytes per JSON document. */
const RESPONSE_CAP_BYTES = 32 * 1024;
/** One budget for the initial full chain, or a later explicit fact selection. */
const REQUEST_DEADLINE_MS = 10 * 1000;

type Stage = 'context' | 'selection' | 'fact';

/** The controller's private record. Raw codes, payloads and error text never enter it. */
interface PublishedPassive {
  readonly kind: 'passive';
  readonly ownerKey: string;
  readonly query: string | null;
  readonly status: PrivateCompanyPassiveStatus;
  readonly revision: number;
  readonly ticket: number | null;
}

interface PublishedSelecting {
  readonly kind: 'selecting';
  readonly ownerKey: string;
  readonly query: string | null;
  readonly status: 'selecting';
  readonly revision: number;
  readonly ticket: number | null;
  readonly context: PrivateCompanyContext;
  readonly selection: PrivateIssuerSelections;
  readonly selectedFactId: string;
}

interface PublishedReady {
  readonly kind: 'ready';
  readonly ownerKey: string;
  readonly query: string | null;
  readonly status: 'ready';
  readonly revision: number;
  readonly ticket: number | null;
  readonly context: PrivateCompanyContext;
  readonly selection: PrivateIssuerSelections;
  readonly selectedFactId: string;
  readonly fact: PrivateProductIntegration;
}

type PublishedRecord = PublishedPassive | PublishedSelecting | PublishedReady;

interface Lane {
  readonly revision: number;
  readonly inputsKey: string;
  readonly record: PublishedRecord;
}

/** One selected-fact read: the chain's own, or a user selection on a released lane. */
interface FactLane {
  readonly inputsKey: string;
  readonly ownerKey: string;
  readonly symbol: string;
  readonly ticket: number | null;
  readonly context: PrivateCompanyContext;
  readonly selection: PrivateIssuerSelections;
  readonly entry: PrivateSelectionEntry;
  readonly controller: AbortController;
  readonly laneLive: () => boolean;
  readonly release: () => void;
  readonly deadlineEpoch: number;
}

const INVALID = Symbol('companyIntelligencePrivate.invalidLane');
const FAILED = Symbol('companyIntelligencePrivate.transportFailed');

function deriveStatusOf(account: boolean, enabled: boolean, symbol: string | null): PrivateCompanyPassiveStatus {
  if (!account) return 'guest';
  if (!enabled) return 'unselected';
  if (symbol === null) return 'unselected';
  if (!isPrivateCompanySymbol(symbol)) return 'unsupported';
  return 'loading';
}

function contextPath(symbol: string): string {
  return '/api/company-intelligence/private/company-context?symbol=' + encodeURIComponent(symbol);
}

function selectionsPath(issuerId: string): string {
  return '/api/company-intelligence/private/issuers/' + encodeURIComponent(issuerId) + '/product-integrations';
}

function factPath(factId: string): string {
  return '/api/company-intelligence/private/product-integrations/' + encodeURIComponent(factId);
}

function passiveRecord(
  ownerKey: string,
  query: string | null,
  status: PrivateCompanyPassiveStatus,
  revision: number,
  ticket: number | null,
): PublishedRecord {
  return Object.freeze({ kind: 'passive', ownerKey, query, status, revision, ticket });
}

/** Passive states echo the supplied query string verbatim; this never normalizes. */
function toView(record: PublishedRecord): PrivateCompanyViewState {
  const viewKey = 'pki-' + String(record.revision);
  if (record.kind === 'passive') {
    return { status: record.status, viewKey, query: record.query };
  }
  if (record.kind === 'selecting') {
    return {
      status: 'selecting', viewKey, query: record.query,
      context: record.context, selection: record.selection, selectedFactId: record.selectedFactId,
    };
  }
  return {
    status: 'ready', viewKey, query: record.query,
    context: record.context, selection: record.selection,
    selectedFactId: record.selectedFactId, fact: record.fact,
  };
}

function nextTimestamp(): number {
  return Date.now();
}

function remainingMs(deadlineEpoch: number): number {
  return Math.max(0, deadlineEpoch - nextTimestamp());
}

function safeAbort(controller: AbortController): void {
  try {
    controller.abort();
  } catch {
    /* the owned transport is already gone */
  }
}

/** The declared Content-Length is consulted only for an early refusal above the cap. */
function declaredTooLarge(response: Response): boolean {
  const raw = response.headers.get('content-length');
  if (raw === null || !/^[0-9]{1,20}$/.test(raw)) return false;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > RESPONSE_CAP_BYTES;
}

function usableResponse(value: unknown): Response | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as {
    ok?: unknown;
    status?: unknown;
    headers?: { get?: unknown } | null;
    body?: { getReader?: unknown } | null;
    arrayBuffer?: unknown;
  };
  if (typeof candidate.status !== 'number' || typeof candidate.ok !== 'boolean') return null;
  if (!candidate.headers || typeof candidate.headers.get !== 'function') return null;
  const streamed = candidate.body !== null && candidate.body !== undefined
    && typeof candidate.body.getReader === 'function';
  if (!streamed && typeof candidate.arrayBuffer !== 'function') return null;
  return value as Response;
}

interface BoundedBody {
  readonly parsed: boolean;
  readonly value: unknown;
}

/** Strictly bounded streamed JSON: incremental byte counting, fatal UTF-8, one parse. */
async function readBoundedJson(response: Response, signal: AbortSignal): Promise<BoundedBody> {
  if (declaredTooLarge(response)) return { parsed: false, value: null };
  const body = (response as { body?: { getReader?: () => unknown } }).body;
  if (!body || typeof body.getReader !== 'function') return { parsed: false, value: null };
  const reader = body.getReader() as {
    read: () => Promise<{ done?: boolean; value?: unknown }>;
    cancel?: (reason?: unknown) => Promise<unknown> | unknown;
    releaseLock?: () => void;
  };
  let total = 0;
  const chunks: Uint8Array[] = [];
  const cancel = (): void => {
    try {
      const pending = reader.cancel?.();
      if (pending && typeof (pending as Promise<unknown>).catch === 'function') {
        void (pending as Promise<unknown>).catch(() => undefined);
      }
    } catch { /* cancellation is best effort and cannot extend the deadline */ }
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done === true) break;
        const chunk = result.value;
        if (chunk === null || chunk === undefined || typeof (chunk as Uint8Array).byteLength !== 'number') {
          return { parsed: false, value: null };
        }
        total += (chunk as Uint8Array).byteLength;
        if (total > RESPONSE_CAP_BYTES) return { parsed: false, value: null };
        chunks.push(chunk as Uint8Array);
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      cancel();
      try {
        if (typeof reader.releaseLock === 'function') reader.releaseLock();
      } catch {
        /* nothing to release */
      }
    }
  } catch {
    return { parsed: false, value: null };
  }
  if (signal.aborted) return { parsed: false, value: null };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { parsed: true, value: JSON.parse(text) as unknown };
  } catch {
    return { parsed: false, value: null };
  }
}

async function requestJson(pathAndQuery: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(pathAndQuery, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal,
  });
  const usable = usableResponse(response);
  if (usable === null) throw new Error('company_intelligence_private_unusable_response');
  return usable;
}

/**
 * Race real work against a finite deadline and lane invalidation. The deadline is a race,
 * not only an abort, so a fetch, body, or digest promise that never settles still lets the
 * chain settle; the never-settling loser can never publish afterwards. rejectMode 'rethrow'
 * keeps an actual PrivateDecodeError visible to the caller for exact classification, while
 * 'fail' (transport positions) maps every rejection to the coarse source_unavailable.
 */
async function guardAsync<T>(
  work: (signal: AbortSignal) => Promise<T> | T,
  owned: AbortController,
  deadlineMs: number,
  laneLive: () => boolean,
  rejectMode: 'fail' | 'rethrow',
): Promise<T | typeof INVALID | typeof FAILED> {
  if (owned.signal.aborted || !laneLive()) return INVALID;
  if (deadlineMs <= 0) { safeAbort(owned); return FAILED; }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<typeof FAILED>(resolve => {
    timer = setTimeout(() => resolve(FAILED), deadlineMs);
  });
  let invalidate: () => void = () => {};
  const invalidated = new Promise<typeof INVALID>(resolve => {
    invalidate = () => resolve(INVALID);
    owned.signal.addEventListener('abort', invalidate, { once: true });
    queueMicrotask(() => {
      if (!laneLive()) resolve(INVALID);
    });
  });
  const tracked = (async () => work(owned.signal))();
  void tracked.catch(() => undefined);
  let winner: T | typeof FAILED | typeof INVALID;
  try {
    winner = await Promise.race([tracked, timeout, invalidated]);
  } catch (error) {
    if (timer !== null) clearTimeout(timer);
    owned.signal.removeEventListener('abort', invalidate);
    const invalid = !laneLive() || owned.signal.aborted;
    safeAbort(owned);
    if (invalid) return INVALID;
    if (rejectMode === 'rethrow' && error instanceof PrivateDecodeError) throw error;
    return FAILED;
  }
  if (timer !== null) clearTimeout(timer);
  owned.signal.removeEventListener('abort', invalidate);
  if (winner === FAILED || winner === INVALID) {
    safeAbort(owned);
    return winner;
  }
  if (!laneLive() || owned.signal.aborted) {
    safeAbort(owned);
    return INVALID;
  }
  return winner;
}

type FetchJson =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'http'; readonly status: number; readonly ok: boolean; readonly value: unknown };

async function fetchJsonStage(
  pathAndQuery: string,
  laneSignal: AbortSignal,
  claimMs: number,
  chainUntil: number,
  laneLive: () => boolean,
): Promise<FetchJson> {
  const controller = new AbortController();
  if (laneSignal.aborted) controller.abort();
  else laneSignal.addEventListener('abort', () => controller.abort(), { once: true });
  if (!laneLive()) return { kind: 'invalid' };
  const claim = await guardAsync(
    signal => requestJson(pathAndQuery, signal), controller,
    Math.min(claimMs, remainingMs(chainUntil)), laneLive, 'fail');
  if (claim === INVALID || claim === FAILED) return { kind: claim === INVALID ? 'invalid' : 'failed' };
  const body = await guardAsync(
    signal => readBoundedJson(claim, signal), controller, remainingMs(chainUntil), laneLive, 'fail');
  if (body === INVALID || body === FAILED) return { kind: body === INVALID ? 'invalid' : 'failed' };
  if (!body.parsed) return { kind: 'failed' };
  return { kind: 'http', status: claim.status, ok: claim.ok, value: body.value };
}

function classifyDecodedCode(code: string, stage: Stage): PrivateCompanyPassiveStatus {
  switch (code) {
    case 'AUTHENTICATION_REQUIRED':
      return 'guest';
    case 'ENTITLEMENT_REQUIRED':
      return 'missing_feature';
    case 'AUTHENTICATION_UNAVAILABLE':
      return 'access_unknown';
    case 'REQUEST_INVALID':
      return 'unsupported';
    case 'SOURCE_NOT_ADMITTED':
    case 'SOURCE_RUNTIME_UNAVAILABLE':
    case 'PRIVATE_SOURCE_UNAVAILABLE':
      return stage === 'selection' ? 'metadata_only' : 'source_unavailable';
    case 'PRIVATE_SERVICE_UNAVAILABLE':
    default:
      return 'source_unavailable';
  }
}

/** A non-2xx answer is only meaningful through the closed bounded error decoder. */
function errorStatusOf(status: number, value: unknown, stage: Stage): PrivateCompanyPassiveStatus {
  try {
    return classifyDecodedCode(decodePrivateError(value, status).code, stage);
  } catch {
    return 'source_unavailable';
  }
}

/** Context/selection binding and selection/fact composition drift invalidate the join. */
function decodeFailureStatus(error: unknown, stage: Stage): PrivateCompanyPassiveStatus {
  if (error instanceof PrivateDecodeError
    && (stage === 'selection' || stage === 'fact')
    && (error.reason === 'BINDING' || error.reason === 'COMPOSITION')) {
    return 'selection_changed';
  }
  return 'source_unavailable';
}

function entryFor(selection: PrivateIssuerSelections, factId: string): PrivateSelectionEntry | null {
  for (const entry of selection.selections) {
    if (entry.fact_id === factId) return entry;
  }
  return null;
}

export function usePrivateCompanyIntelligence(
  identity: AccountIdentity,
  symbol: string | null,
  enabled = true,
): { state: PrivateCompanyViewState; selectFact: (factId: string) => void } {
  const currentOwnerKey = identityOwnerKey(identity);
  const account = isAccountOwner(currentOwnerKey);
  const currentQuery: string | null = symbol;
  const symbolValid = symbol !== null && isPrivateCompanySymbol(symbol);
  const requested = account && enabled && symbolValid;
  // Email is deliberately absent: same UUID + new email is the same owner and must not
  // refetch; same email + new UUID is a different owner and clears synchronously at render.
  const inputsKey = JSON.stringify([currentOwnerKey, symbol, enabled]);
  const [inputScope, setInputScope] = useState(() => ({ inputsKey, epoch: 0 }));
  if (inputScope.inputsKey !== inputsKey) {
    setInputScope({ inputsKey, epoch: inputScope.epoch + 1 });
  }
  const scopeRef = useRef<typeof inputScope | null>(null);

  const sequenceRef = useRef(0);
  const revisionRef = useRef(0);
  const liveRef = useRef<{ ticket: number; abort: () => void } | null>(null);
  const pendingUserFactRef = useRef<{ ticket: number; selectedFactId: string; abort: () => void } | null>(null);
  const runIdRef = useRef(0);
  const cancelRef = useRef(false);
  const inputsRef = useRef(inputsKey);
  const recordRef = useRef<PublishedRecord | null>(null);
  const armedRef = useRef<{ runId: number; record: PublishedRecord | null } | null>(null);

  const [lane, setLane] = useState<Lane>(() => ({
    revision: 0,
    inputsKey,
    record: passiveRecord(currentOwnerKey, currentQuery, deriveStatusOf(account, enabled, symbol), 0, null),
  }));

  const bumpRevision = useCallback((): number => {
    revisionRef.current += 1;
    return revisionRef.current;
  }, []);

  /**
   * The refs are the authoritative lane view at queue time, because a promise chain can
   * run past its next await before React renders again. A rejected publication keeps the
   * identical frozen record, changes nothing and schedules nothing; revisions ascend only.
   */
  const queueLane = useCallback((next: Lane): void => {
    const previousRecord = recordRef.current;
    if (previousRecord === null) return;
    if (next.record === previousRecord && next.inputsKey === inputsRef.current) return;
    if (next.revision < revisionRef.current) return;
    revisionRef.current = next.revision;
    inputsRef.current = next.inputsKey;
    recordRef.current = next.record;
    setLane(next);
  }, []);

  const abortLive = useCallback((): void => {
    const live = liveRef.current;
    if (live !== null) {
      liveRef.current = null;
      try {
        live.abort();
      } catch {
        /* the owned transport is already gone */
      }
    }
    const pending = pendingUserFactRef.current;
    if (pending !== null) {
      pendingUserFactRef.current = null;
      try {
        pending.abort();
      } catch {
        /* the owned transport is already gone */
      }
    }
  }, []);

  // Derive the safe projection during render. Speculative renders do not abort
  // committed work or mutate refs; cancellation and guard rebinding occur at commit.
  let visibleRecord = lane.record;
  if (lane.inputsKey !== inputsKey) {
    const revision = lane.revision + 1;
    const record = passiveRecord(
      currentOwnerKey, currentQuery, deriveStatusOf(account, enabled, symbol), revision, null);
    visibleRecord = record;
    setLane({ revision, inputsKey, record });
  }
  useLayoutEffect(() => {
    if (scopeRef.current !== inputScope) abortLive();
    scopeRef.current = inputScope;
    inputsRef.current = inputsKey;
    recordRef.current = lane.record;
    revisionRef.current = Math.max(revisionRef.current, lane.revision);
  }, [inputScope, inputsKey, lane, abortLive]);

  /**
   * Publication is a guarded compare on the authoritative lane, not a timestamp race: a
   * replacement, a timeout that already published, a newer selection, an unmount or a
   * StrictMode remount silently drops an older continuation - including stale errors and
   * finalizers. Releasing owned resources runs after scheduling and never feeds the guard.
   */
  const publishIfLaneIntact = useCallback((
    expectInputsKey: string,
    gate: (previous: PublishedRecord) => boolean,
    record: PublishedRecord,
    release: (() => void) | null,
  ): void => {
    const previous = recordRef.current;
    if (previous !== null && inputsRef.current === expectInputsKey && gate(previous)) {
      queueLane({ revision: record.revision, inputsKey: expectInputsKey, record });
    }
    if (release !== null) release();
  }, [queueLane]);

  const runFactStage = useCallback(async (laneSpec: FactLane): Promise<void> => {
    const { inputsKey: key, ownerKey, symbol: querySymbol, ticket, context, selection, entry, controller } = laneSpec;
    const holds = (previous: PublishedRecord): boolean =>
      previous.ownerKey === ownerKey && previous.query === querySymbol
      && previous.status === 'selecting' && previous.ticket === ticket
      && previous.selectedFactId === entry.fact_id;
    const failClosed = (status: PrivateCompanyPassiveStatus): void => {
      publishIfLaneIntact(key, holds,
        passiveRecord(ownerKey, querySymbol, status, bumpRevision(), null), laneSpec.release);
    };
    try {
      // The first fact shares the initial chain deadline; an explicit user selection
      // supplies a fresh deadline, while every stage consumes only its remainder.
      const factUntil = laneSpec.deadlineEpoch;
      const result = await fetchJsonStage(factPath(entry.fact_id), controller.signal,
        REQUEST_DEADLINE_MS, factUntil, laneSpec.laneLive);
      if (result.kind === 'failed') {
        failClosed('source_unavailable');
        return;
      }
      if (result.kind !== 'http') return;
      if (!result.ok) {
        failClosed(errorStatusOf(result.status, result.value, 'fact'));
        return;
      }
      let fact: PrivateProductIntegration;
      try {
        const decoded = await guardAsync(
          () => decodePrivateProductIntegration(result.value, entry.fact_id),
          controller, remainingMs(factUntil), laneSpec.laneLive, 'rethrow');
        if (decoded === INVALID || decoded === FAILED) {
          if (decoded === FAILED) failClosed('source_unavailable');
          return;
        }
        fact = decoded;
        assertPrivateComposition(selection, entry, fact);
      } catch (error) {
        failClosed(decodeFailureStatus(error, 'fact'));
        return;
      }
      if (!laneSpec.laneLive()) return;
      publishIfLaneIntact(key, holds, Object.freeze({
        kind: 'ready', ownerKey, query: querySymbol, status: 'ready',
        revision: bumpRevision(), ticket, context, selection,
        selectedFactId: entry.fact_id, fact,
      }), laneSpec.release);
    } catch {
      // Never an infinite chain: an unexpected failure is terminal and bounded.
      failClosed('source_unavailable');
    }
  }, [publishIfLaneIntact, bumpRevision]);

  const startRead = useCallback((key: string, ownerKey: string, querySymbol: string): void => {
    abortLive();
    sequenceRef.current += 1;
    const ticket = sequenceRef.current;
    const controller = new AbortController();
    liveRef.current = { ticket, abort: () => controller.abort() };
    const runId = runIdRef.current;

    const laneLive = (): boolean => {
      if (cancelRef.current || runIdRef.current !== runId || inputsRef.current !== key) return false;
      const live = liveRef.current;
      if (live === null || live.ticket !== ticket) return false;
      const record = recordRef.current;
      if (record === null || record.ownerKey !== ownerKey || record.query !== querySymbol) return false;
      if (record.status === 'loading') return record.ticket === null;
      if (record.status === 'selecting') return record.ticket === ticket;
      return false;
    };
    const holdsLoading = (previous: PublishedRecord): boolean =>
      !cancelRef.current && runIdRef.current === runId && liveRef.current?.ticket === ticket
      && previous.ownerKey === ownerKey && previous.query === querySymbol
      && previous.status === 'loading' && previous.ticket === null;
    const releaseChain = (): void => {
      if (liveRef.current !== null && liveRef.current.ticket === ticket) liveRef.current = null;
      safeAbort(controller);
    };
    const publishLoadingFailure = (status: PrivateCompanyPassiveStatus): void => {
      publishIfLaneIntact(key, holdsLoading,
        passiveRecord(ownerKey, querySymbol, status, bumpRevision(), null), releaseChain);
    };

    void (async (): Promise<void> => {
      try {
        // Stage 1: company-context read, bounded streamed decode, real async receipt digest.
        const contextChainUntil = nextTimestamp() + REQUEST_DEADLINE_MS;
        const contextResult = await fetchJsonStage(contextPath(querySymbol), controller.signal,
          REQUEST_DEADLINE_MS, contextChainUntil, laneLive);
        if (contextResult.kind === 'failed') {
          publishLoadingFailure('source_unavailable');
          return;
        }
        if (contextResult.kind !== 'http') return;
        if (!contextResult.ok) {
          publishLoadingFailure(errorStatusOf(contextResult.status, contextResult.value, 'context'));
          return;
        }
        let context: PrivateCompanyContext;
        try {
          const decoded = await guardAsync(
            () => decodePrivateCompanyContext(contextResult.value, querySymbol),
            controller, remainingMs(contextChainUntil), laneLive, 'rethrow');
          if (decoded === INVALID || decoded === FAILED) {
            if (decoded === FAILED) publishLoadingFailure('source_unavailable');
            return;
          }
          context = decoded;
        } catch (error) {
          publishLoadingFailure(decodeFailureStatus(error, 'context'));
          return;
        }
        if (!laneLive()) return;

        // Stage 2: issuer selections for the decoded issuer id only - never an inferred one.
        const issuerId = context.issuer_binding.issuer_id;
        const selectionChainUntil = contextChainUntil;
        const selectionResult = await fetchJsonStage(selectionsPath(issuerId), controller.signal,
          REQUEST_DEADLINE_MS, selectionChainUntil, laneLive);
        if (selectionResult.kind === 'failed') {
          publishLoadingFailure('source_unavailable');
          return;
        }
        if (selectionResult.kind !== 'http') return;
        if (!selectionResult.ok) {
          publishLoadingFailure(errorStatusOf(selectionResult.status, selectionResult.value, 'selection'));
          return;
        }
        let selection: PrivateIssuerSelections;
        try {
          const decodedSelection = await guardAsync(
            () => decodePrivateIssuerSelections(selectionResult.value, issuerId),
            controller, remainingMs(selectionChainUntil), laneLive, 'rethrow');
          if (decodedSelection === INVALID || decodedSelection === FAILED) {
            if (decodedSelection === FAILED) publishLoadingFailure('source_unavailable');
            return;
          }
          selection = decodedSelection;
          assertPrivateContextSelection(context, selection);
        } catch (error) {
          publishLoadingFailure(decodeFailureStatus(error, 'selection'));
          return;
        }
        if (!laneLive()) return;

        // A qualified empty generation is final; it never becomes metadata_only or unsupported.
        if (selection.selections.length === 0) {
          publishLoadingFailure('empty');
          return;
        }
        // The source ordering contract is exact sorted unique order, so the first entry
        // is the first selected fact id. No ranking, recency or inference is applied here.
        const entry = selection.selections[0];
        const holdsForSelecting = (previous: PublishedRecord): boolean =>
          holdsLoading(previous)
          || (previous.ownerKey === ownerKey && previous.query === querySymbol
            && previous.status === 'selecting' && previous.ticket === ticket);
        publishIfLaneIntact(key, holdsForSelecting, Object.freeze({
          kind: 'selecting', ownerKey, query: querySymbol, status: 'selecting',
          revision: bumpRevision(), ticket, context, selection, selectedFactId: entry.fact_id,
        }), null);
        // Stage 3: the selected fact.
        await runFactStage({
          inputsKey: key, ownerKey, symbol: querySymbol, ticket, context, selection, entry,
          controller, laneLive, release: releaseChain, deadlineEpoch: contextChainUntil,
        });
      } catch {
        // Fail closed: an unexpected internal error terminates this read; it never loops.
        publishLoadingFailure('source_unavailable');
      }
    })();
  }, [abortLive, publishIfLaneIntact, bumpRevision, runFactStage]);

  // Identity lifetime: an unmount (or StrictMode's simulated unmount) cancels every owned
  // transport and forbids any later publication by a closure of that lifetime.
  useLayoutEffect(() => {
    cancelRef.current = false;
    runIdRef.current += 1;
    return () => {
      cancelRef.current = true;
      abortLive();
    };
  }, [abortLive]);

  // Arming is keyed to the record identity, so an unrelated re-render (for example the
  // same UUID with a new email, or a discarded-render republish) can neither refetch nor
  // double-claim, while a remount re-arms because the lifetime id advanced. No implicit
  // refresh: only a fresh lane whose record is the input-derived loading state can start
  // a read; terminal refusals stay terminal.
  useEffect(() => {
    if (cancelRef.current) return;
    const record = lane.record;
    if (record.status !== 'loading' || record.ticket !== null || !requested) return;
    const armed = armedRef.current;
    if (armed !== null && armed.runId === runIdRef.current && armed.record === record) return;
    armedRef.current = { runId: runIdRef.current, record };
    startRead(lane.inputsKey, currentOwnerKey, currentQuery as string);
  }, [lane, requested, currentOwnerKey, currentQuery, startRead]);

  const selectFact = useCallback((factId: string): void => {
    const record = recordRef.current;
    if (record === null) return;
    if (cancelRef.current || inputsRef.current !== inputsKey || scopeRef.current !== inputScope) return;
    if (record.ownerKey !== currentOwnerKey || record.query !== currentQuery) return;
    if (record.status !== 'ready' && record.status !== 'selecting') return;
    // Only a fact id of the CURRENT decoded selection may be selected. Arbitrary,
    // injected, or stale-callback ids simply match nothing and are ignored.
    const entry = entryFor(record.selection, factId);
    if (entry === null) return;
    const context = record.context;
    const selection = record.selection;
    const ownerKey = record.ownerKey;
    const querySymbol = record.query;
    if (querySymbol === null) return;
    const holdsSelectable = (previous: PublishedRecord): boolean =>
      previous.ownerKey === ownerKey && previous.query === querySymbol
      && (previous.status === 'ready' || previous.status === 'selecting')
      && previous.context === context && previous.selection === selection
      && previous.selection.selections.some(candidate => candidate.fact_id === factId);
    if (!holdsSelectable(record)) return;
    // A replaced chain lane or a previous user read is owned work: cancel it on replacement.
    abortLive();
    const controller = new AbortController();
    const ticket = ++sequenceRef.current;
    const pendingSlot = { ticket, selectedFactId: factId, abort: () => controller.abort() };
    pendingUserFactRef.current = pendingSlot;
    const runId = runIdRef.current;
    const laneLive = (): boolean => {
      if (cancelRef.current || runIdRef.current !== runId || inputsRef.current !== inputsKey) return false;
      // The slot is the epoch: selectFact and replacement/derivation update it
      // synchronously, so this is correct even before the committed record lands.
      return !controller.signal.aborted && pendingUserFactRef.current === pendingSlot;
    };
    const release = (): void => {
      const pending = pendingUserFactRef.current;
      if (pending === pendingSlot) {
        pendingUserFactRef.current = null;
        safeAbort(controller);
      }
    };
    // Synchronous reset to selecting: the same current decoded context and selection and
    // the full current options remain, the old fact is gone, and the new revision changes
    // viewKey so the host resets its details.
    publishIfLaneIntact(inputsKey, holdsSelectable, Object.freeze({
      kind: 'selecting', ownerKey, query: querySymbol, status: 'selecting',
      revision: bumpRevision(), ticket, context, selection, selectedFactId: factId,
    }), null);
    void runFactStage({
      inputsKey, ownerKey, symbol: querySymbol, ticket, context, selection, entry,
      controller, laneLive, release, deadlineEpoch: nextTimestamp() + REQUEST_DEADLINE_MS,
    });
  }, [inputScope, inputsKey, currentOwnerKey, currentQuery, abortLive, bumpRevision, publishIfLaneIntact, runFactStage]);

  return { state: toView(visibleRecord), selectFact };
}
