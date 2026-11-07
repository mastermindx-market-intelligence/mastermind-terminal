// Server-only daytime cache for 24H charts. Overnight snapshots never enter this cache.
// The route owns authentication and registers the bounded refresh with Next's after().
import { fetchIntraday, fetchUsEquityDateStudyBars } from "./intradaySources";
import { withStoredHistory } from "./intradayStore";
import type { Bar6 } from "./intradayShared";
import type { IntradayAssemblyTrace } from "./intradayEvidence";
import { hasUnexpectedHistoryContraction } from "./intradayHistoryCoverage";

const TTL_MS = 45_000;
const FAILED_RETRY_COOLDOWN_MS = 2_500;
const FOREGROUND_MS = 1_200;
const STUDY_FOREGROUND_MS = 10_000;
const UPSTREAM_MS = 8_000;
const MAX_ENTRIES = 128;
const MAX_PENDING = 32;
type Snapshot = { bars: Bar6[]; trace: IntradayAssemblyTrace; assembledAtMs: number; storeError: string | null; assemblyComplete: boolean };
type Entry = { snapshot: Snapshot; checkedAtMs: number; error: string | null; reused: boolean };
type Flight = { local: Promise<Snapshot>; result: Promise<Entry>; controller: AbortController };
export type OvernightDaytimeRead = {
  snapshot: Snapshot;
  cacheState: "new_assembly" | "cache" | "stale_cache";
  checkedAtMs: number | null;
  error: string | null;
  refreshPending: boolean;
  // Acquisition succeeded; selected-date studies may use precise local observations alone.
  // This is neither market-data freshness nor certification of full-session coverage.
  assemblyComplete: boolean;
};
const CACHE = new Map<string, Entry>();
const PENDING = new Map<string, Flight>();
const message = (error: unknown) => error instanceof Error ? error.message : "daytime refresh failed";

function emptySnapshot(): Snapshot {
  return { bars: [], trace: { origins: [], storeReads: [] }, assembledAtMs: Date.now(),
    storeError: null, assemblyComplete: false };
}

async function assemble(sym: string, tf: string, live: Bar6[], upstreamComplete = false, studyDate?: string): Promise<Snapshot> {
  let trace: IntradayAssemblyTrace = { origins: live.map(bar => [bar[0], "live_tail"]), storeReads: [] };
  // A store failure must not discard validated upstream bars or the independent BOATS leg.
  let bars = live;
  let storeError: string | null = null;
  try { bars = await withStoredHistory(sym, tf, true, live, captured => { trace = captured; }, true, studyDate); }
  catch (failure) { storeError = message(failure); }
  return { bars, trace, assembledAtMs: Date.now(), storeError,
    assemblyComplete: upstreamComplete && storeError === null };
}

async function fetchDaytime(sym: string, tf: string, controller: AbortController, studyDate?: string): Promise<Bar6[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error("daytime upstream deadline exceeded");
      controller.abort(error); // Abort the actual fetch and response body, not just its waiter.
      reject(error);
    }, UPSTREAM_MS);
  });
  try {
    const acquisition = studyDate
      ? fetchUsEquityDateStudyBars(sym, tf, true, studyDate, controller.signal)
      : fetchIntraday(sym, tf, true, undefined, true, controller.signal);
    return await Promise.race([acquisition, deadline]);
  } finally { clearTimeout(timer); }
}

function remember(key: string, entry: Entry) {
  CACHE.delete(key);
  CACHE.set(key, entry);
  while (CACHE.size > MAX_ENTRIES) CACHE.delete(CACHE.keys().next().value!);
}

async function foreground(result: Promise<Entry>, budget = FOREGROUND_MS): Promise<Entry | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([result, new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), budget);
    })]);
  } finally { clearTimeout(timer); }
}

/** The key includes symbol, timeframe, session/date, source/basis and access scope. */
export async function readOvernightDaytime(
  cacheKey: string, sym: string, tf: string, retain: (work: Promise<void>) => void, studyDate?: string,
): Promise<OvernightDaytimeRead> {
  // Same CACHE/PENDING owner, separate acquisition extent; never reuse a normal-chart flight.
  const key = studyDate ? `${cacheKey}|study:returns:${studyDate}` : cacheKey;
  const prior = CACHE.get(key);
  // A failed cold assembly cannot masquerade as a warm authoritative cache entry.
  // Retry it on the next request rather than trapping provisional bars for 45 seconds.
  if (prior?.snapshot.assemblyComplete && Date.now() >= prior.checkedAtMs && Date.now() - prior.checkedAtMs < TTL_MS) {
    remember(key, prior);
    return { snapshot: prior.snapshot, cacheState: prior.reused ? "stale_cache" : "cache",
      checkedAtMs: prior.checkedAtMs, error: prior.error, refreshPending: false,
      assemblyComplete: prior.snapshot.assemblyComplete };
  }
  // Short negative cache for a *failed* cold assembly only. It prevents an
  // outage/rate limit from triggering one upstream call per viewer/poll while
  // still returning the independently updated BOATS history from the route.
  // A complete retained baseline continues to use its existing 45-second TTL.
  if (prior && !prior.snapshot.assemblyComplete && prior.error
      && Date.now() >= prior.checkedAtMs
      && Date.now() - prior.checkedAtMs < FAILED_RETRY_COOLDOWN_MS) {
    remember(key, prior);
    return { snapshot: prior.snapshot, cacheState: prior.reused ? "stale_cache" : "new_assembly",
      checkedAtMs: prior.checkedAtMs, error: prior.error, refreshPending: false,
      assemblyComplete: false };
  }
  let flight = PENDING.get(key);
  if (!flight) {
    if (PENDING.size >= MAX_PENDING) {
      return { snapshot: prior?.snapshot ?? (studyDate ? emptySnapshot() : await assemble(sym, tf, [])),
        cacheState: prior ? "stale_cache" : "new_assembly", checkedAtMs: prior?.checkedAtMs ?? null,
        error: "daytime refresh capacity reached", refreshPending: false,
        assemblyComplete: prior?.snapshot.assemblyComplete ?? false };
    }
    const controller = new AbortController();
    // Refresh selected-date storage itself: an expired prior is a retained baseline, not a new read.
    const local = !studyDate && prior?.snapshot.bars.length ? Promise.resolve(prior.snapshot) : assemble(sym, tf, [], false, studyDate);
    // Identity fences publication; an evicted cache or later request cannot authorize an
    // older flight to overwrite a replacement. Single-flight also bounds provider fan-out.
    const owned: Flight = { local, controller, result: undefined! };
    owned.result = (async () => {
      let snapshot: Snapshot;
      let error: string | null = null;
      let reused = false;
      try {
        const stored = studyDate ? await local : null;
        snapshot = stored?.bars.length && !stored.storeError
          ? { ...stored, assemblyComplete: true }
          : await assemble(sym, tf, await fetchDaytime(sym, tf, controller, studyDate), true, studyDate);
        error = snapshot.storeError;
        if (error && prior?.snapshot.bars.length) {
          snapshot = prior.snapshot;
          reused = true;
        } else if (snapshot.assemblyComplete && prior?.snapshot.assemblyComplete
            && hasUnexpectedHistoryContraction(prior.snapshot.bars.length, snapshot.bars.length)) {
          // A successful HTTP request is not proof of complete historical
          // coverage. Never replace a long accepted baseline with a thin
          // provider/store tail for this same cache identity.
          error = `daytime historical coverage regressed (${snapshot.bars.length} of ${prior.snapshot.bars.length} bars)`;
          snapshot = prior.snapshot;
          reused = true;
        }
      } catch (failure) {
        snapshot = prior?.snapshot.bars.length ? prior.snapshot : await local;
        error = message(failure);
        reused = Boolean(prior?.snapshot.bars.length);
      }
      const entry = { snapshot, checkedAtMs: Date.now(), error, reused };
      if (PENDING.get(key) === owned) remember(key, entry);
      return entry;
    })().finally(() => {
      if (PENDING.get(key) === owned) PENDING.delete(key);
    });
    flight = owned;
    PENDING.set(key, owned);
    try { retain(owned.result.then(() => undefined)); }
    catch (failure) {
      controller.abort(failure);
      PENDING.delete(key);
      throw failure;
    }
  }
  // Only a previously successful assembly can be shown instantly as a retained
  // baseline. Cold failures may contain a short provider tail or local-only bars:
  // wait for the new foreground budget instead of instantly repeating that fragment.
  if (!studyDate && prior?.snapshot.assemblyComplete) return { snapshot: prior.snapshot, cacheState: "stale_cache",
    checkedAtMs: prior.checkedAtMs, error: prior.error, refreshPending: true,
    assemblyComplete: prior.snapshot.assemblyComplete };
  const ready = await foreground(flight.result, studyDate ? STUDY_FOREGROUND_MS : FOREGROUND_MS);
  if (ready) return { snapshot: ready.snapshot, cacheState: studyDate && ready.reused ? "stale_cache" : "new_assembly",
    checkedAtMs: ready.checkedAtMs, error: ready.error, refreshPending: false,
    assemblyComplete: ready.snapshot.assemblyComplete };
  // The upstream deadline does not bound filesystem work. A study consumer stops waiting
  // here without canceling/replacing the owned flight or awaiting an unresolved local read.
  const local = studyDate
    ? await Promise.race([flight.local, Promise.resolve<Snapshot | null>(null)]) ?? prior?.snapshot ?? emptySnapshot()
    : await flight.local;
  return { snapshot: local, cacheState: prior ? "stale_cache" : "new_assembly",
    checkedAtMs: prior?.checkedAtMs ?? null, error: prior?.error ?? local.storeError,
    refreshPending: true, assemblyComplete: local.assemblyComplete };
}
