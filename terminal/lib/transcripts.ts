export interface TranscriptIndexCall {
  id: string;
  period: string;
  date: string | null;
  title: string;
  url: string;
  bytes: number;
  segment_count: number;
  speaker_count: number;
  speakers: string[];
  word_count: number;
  qa_start: number | null;
  has_qa: boolean;
  source: string;
}

export interface TickerTranscriptIndex {
  schema: "mastermind.tx-symbol-index/v1";
  generated_at: string;
  ticker: string;
  n: number;
  calls: TranscriptIndexCall[];
}

/** Why the committed global fallback is shown instead of the ticker's own metadata. */
export type TranscriptIndexWarning = "rebuilding" | "invalid" | "timeout";

export type TranscriptIndexResult =
  | {
    status: "ok";
    index: TickerTranscriptIndex;
    source: "symbol" | "global";
    warning?: string;
    warningCode?: TranscriptIndexWarning;
  }
  | { status: "not_found" }
  | { status: "error"; message: string; timedOut?: true };

/**
 * Each archive request, headers and JSON body together, settles within this
 * budget. A stalled optional request must not hold back the committed fallback.
 */
export const ARCHIVE_REQUEST_TIMEOUT_MS = 15_000;

const TX_ID = /^\d{4}Q[1-4]$/;
const SAFE_TICKER = /^[A-Z0-9.^-]+$/;

export function isTranscriptId(value: string): boolean {
  return TX_ID.test(value);
}

function asCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

export function normalizeTickerTranscriptIndex(raw: unknown, sym: string): TickerTranscriptIndex | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const requested = sym.trim().toUpperCase();
  if (!SAFE_TICKER.test(requested)) return null;
  if (obj.schema !== "mastermind.tx-symbol-index/v1" || !Array.isArray(obj.calls)) return null;
  if (typeof obj.ticker !== "string" || obj.ticker.trim().toUpperCase() !== requested) return null;
  const prefix = `/data/tx/${requested}/`;
  const calls = obj.calls
    .filter((call): call is Record<string, unknown> => !!call && typeof call === "object")
    .map((call): TranscriptIndexCall => {
      const id = typeof call.id === "string" ? call.id : "";
      const qaStart = Number.isInteger(call.qa_start) && Number(call.qa_start) >= 0
        ? Number(call.qa_start)
        : null;
      return {
        id,
        period: typeof call.period === "string" && call.period.trim()
          ? call.period.trim()
          : `Q${id.slice(5)} FY${id.slice(0, 4)}`,
        date: typeof call.date === "string" && call.date.trim() ? call.date : null,
        title: typeof call.title === "string" && call.title.trim()
          ? call.title.trim()
          : `${requested} Earnings Call`,
        url: typeof call.url === "string" ? call.url : "",
        bytes: asCount(call.bytes),
        segment_count: asCount(call.segment_count),
        speaker_count: asCount(call.speaker_count),
        speakers: asStringArray(call.speakers),
        word_count: asCount(call.word_count),
        qa_start: qaStart,
        has_qa: call.has_qa === true || qaStart !== null,
        source: typeof call.source === "string" && call.source.trim() ? call.source.trim() : "DefeatBeta",
      };
    })
    .filter((call) => TX_ID.test(call.id) && call.url === `${prefix}${call.id}.json.gz`)
    .sort((a, b) => b.id.localeCompare(a.id));
  return {
    schema: "mastermind.tx-symbol-index/v1",
    generated_at: typeof obj.generated_at === "string" ? obj.generated_at : "",
    ticker: requested,
    n: calls.length,
    calls,
  };
}

type FetchJSONResult =
  | { kind: "ok"; value: unknown }
  | { kind: "missing" }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

async function fetchJSON(url: string, retryNonce = 0, signal?: AbortSignal): Promise<FetchJSONResult> {
  const target = retryNonce ? `${url}?retry=${retryNonce}` : url;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  // The deadline and the caller's cancel settle the result before the abort
  // rejects the read, so a stall is classified as a timeout, not a failure.
  const stopped = new Promise<FetchJSONResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: "timeout" });
      controller.abort();
    }, ARCHIVE_REQUEST_TIMEOUT_MS);
    cancel = () => {
      resolve({ kind: "error", message: "Archive request was cancelled" });
      controller.abort();
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
  });
  const read = async (): Promise<FetchJSONResult> => {
    try {
      const response = await fetch(target, { cache: "no-store", signal: controller.signal });
      if (response.status === 404) return { kind: "missing" };
      if (!response.ok) return { kind: "error", message: `Archive request failed (${response.status})` };
      try {
        return { kind: "ok", value: await response.json() };
      } catch {
        return { kind: "error", message: "Archive index returned malformed JSON" };
      }
    } catch {
      return { kind: "error", message: "Archive index could not be reached" };
    }
  };
  try {
    return await Promise.race([read(), stopped]);
  } finally {
    clearTimeout(timer);
    if (cancel) signal?.removeEventListener("abort", cancel);
  }
}

function normalizeGlobalIndex(raw: unknown): { generatedAt: string; symbols: Record<string, string[]> } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (
    obj.schema !== "mastermind.tx-index/v1"
    || typeof obj.generated_at !== "string"
    || !obj.symbols
    || typeof obj.symbols !== "object"
  ) return null;
  const symbols: Record<string, string[]> = {};
  for (const [rawSym, rawIds] of Object.entries(obj.symbols as Record<string, unknown>)) {
    const sym = rawSym.trim().toUpperCase();
    if (!SAFE_TICKER.test(sym) || !Array.isArray(rawIds)) return null;
    const ids = rawIds.filter((id): id is string => typeof id === "string" && TX_ID.test(id));
    if (ids.length !== rawIds.length) return null;
    if (ids.length) symbols[sym] = [...new Set(ids)].sort();
  }
  return { generatedAt: obj.generated_at, symbols };
}

function synthesizeGlobalIndex(sym: string, ids: string[], generatedAt: string): TickerTranscriptIndex {
  const calls = [...ids].sort((a, b) => b.localeCompare(a)).map((id): TranscriptIndexCall => ({
    id,
    period: `Q${id.slice(5)} FY${id.slice(0, 4)}`,
    date: null,
    title: `${sym} Earnings Call`,
    url: `/data/tx/${sym}/${id}.json.gz`,
    bytes: 0,
    segment_count: 0,
    speaker_count: 0,
    speakers: [],
    word_count: 0,
    qa_start: null,
    has_qa: false,
    source: "DefeatBeta",
  }));
  return {
    schema: "mastermind.tx-symbol-index/v1",
    generated_at: generatedAt,
    ticker: sym,
    n: calls.length,
    calls,
  };
}

/** Load ticker discovery without sticky session caching of a 404 or failure. */
export async function getTickerTranscriptIndex(
  sym: string,
  options: { retryNonce?: number; signal?: AbortSignal } = {},
): Promise<TranscriptIndexResult> {
  const ticker = sym.trim().toUpperCase();
  if (!SAFE_TICKER.test(ticker)) return { status: "error", message: "Invalid ticker" };
  const nonce = options.retryNonce ?? 0;
  // One scope for both requests: the caller's cancel reaches each of them, and a
  // failed commit marker drops the optional ticker request instead of waiting on it.
  const scope = new AbortController();
  const cancel = () => scope.abort();
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    // Readers require the archive-wide commit marker even when the ticker index
    // exists.  Matching generation IDs prevent a half-published per-symbol file
    // from becoming visible if a publication dies before its final commit write.
    const symbolRead = fetchJSON(`/data/tx/${ticker}/index.json`, nonce, scope.signal);
    const globalResult = await fetchJSON("/data/tx/index.json", nonce, scope.signal);
    if (globalResult.kind !== "ok") {
      scope.abort();
      if (globalResult.kind === "timeout") {
        return { status: "error", message: "Archive commit marker request timed out", timedOut: true };
      }
      const detail = globalResult.kind === "error" ? globalResult.message : "Archive commit marker is missing";
      return { status: "error", message: detail };
    }
    const globalIndex = normalizeGlobalIndex(globalResult.value);
    if (!globalIndex) {
      scope.abort();
      return { status: "error", message: "Archive commit marker is malformed" };
    }
    const ids = globalIndex.symbols[ticker];
    if (!ids?.length) {
      scope.abort();
      return { status: "not_found" };
    }
    const symbolResult = await symbolRead;
    if (symbolResult.kind === "ok") {
      const index = normalizeTickerTranscriptIndex(symbolResult.value, ticker);
      const indexedIds = index?.calls.map((call) => call.id).sort();
      if (
        index
        && index.generated_at === globalIndex.generatedAt
        && JSON.stringify(indexedIds) === JSON.stringify([...ids].sort())
      ) return { status: "ok", index, source: "symbol" };
    }
    const warningCode: TranscriptIndexWarning = symbolResult.kind === "missing"
      ? "rebuilding"
      : symbolResult.kind === "timeout" ? "timeout" : "invalid";
    const warning = {
      rebuilding: "Ticker metadata is rebuilding; showing the committed archive fallback.",
      timeout: "Ticker metadata timed out; showing the committed archive fallback.",
      invalid: "Ticker metadata is uncommitted or invalid; showing the committed archive fallback.",
    }[warningCode];
    return {
      status: "ok",
      index: synthesizeGlobalIndex(ticker, ids, globalIndex.generatedAt),
      source: "global",
      warning,
      warningCode,
    };
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }
}
