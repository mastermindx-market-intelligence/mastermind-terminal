import "server-only";
import { billingAuth } from "@/app/api/billing/gateway";
import { ISSUE_DESK_API_BASE } from "@/lib/upstreams";
import {
  NewsContractError,
  parseChanges,
  parseSnapshot,
  parseStory,
  type ChangePage,
  type NewsSnapshot,
  type StoryDetail,
} from "@/lib/newsContract";

const base = ISSUE_DESK_API_BASE;
const TIMEOUT_MS = 8000;
const MAX_JSON_BYTES = 1024 * 1024;

export const TICKER_NEWS_PRIVATE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
};

export class UpstreamError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable?: boolean;
  readonly detail?: string;
  readonly retryAfter?: string;

  constructor(
    code: string,
    status: number,
    opts?: { retryable?: boolean; detail?: string; retryAfter?: string },
  ) {
    super(code);
    this.name = "UpstreamError";
    this.code = code;
    this.status = status;
    this.retryable = opts?.retryable;
    this.detail = opts?.detail;
    this.retryAfter = opts?.retryAfter;
  }
}

export async function authToken(): Promise<string | null> {
  const auth = await billingAuth();
  if (!auth) return null;
  return auth.token;
}

function linkAbort(callerSignal?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);
    },
  };
}

function classifyAbort(callerSignal?: AbortSignal): UpstreamError {
  if (callerSignal?.aborted) {
    return new UpstreamError("client_aborted", 499);
  }
  return new UpstreamError("ticker_news_unavailable", 502, { retryable: true });
}

function jsonContentType(res: Response): boolean {
  return res.headers.get("content-type")?.toLowerCase().startsWith("application/json") ?? false;
}

async function readJsonText(res: Response): Promise<string> {
  const text = await res.text();
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) {
    throw new UpstreamError("oversize_upstream_response", 502);
  }
  return text;
}

function parseDetail(text: string): string {
  try {
    const body = JSON.parse(text) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : "Upstream request failed";
  } catch {
    return "Upstream request failed";
  }
}

async function upstreamFetch(
  path: string,
  token: string,
  accept: string,
  callerSignal?: AbortSignal,
): Promise<Response> {
  const { signal, dispose } = linkAbort(callerSignal);
  try {
    return await fetch(`${base}${path}`, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
      },
      signal,
    });
  } catch {
    throw classifyAbort(callerSignal);
  } finally {
    dispose();
  }
}

async function handleJsonResponse<T>(
  res: Response,
  validate: (parsed: unknown) => T,
  callerSignal?: AbortSignal,
): Promise<T> {
  if (!jsonContentType(res)) {
    throw new UpstreamError("invalid_upstream_response", 502);
  }
  let text: string;
  try {
    text = await readJsonText(res);
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw classifyAbort(callerSignal);
  }
  if (!res.ok) {
    const detail = parseDetail(text);
    const retryAfter = res.status === 429 ? res.headers.get("Retry-After") ?? undefined : undefined;
    throw new UpstreamError("upstream_http_error", res.status, { detail, retryAfter });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UpstreamError("invalid_upstream_response", 502);
  }
  try {
    return validate(parsed);
  } catch (err) {
    if (err instanceof NewsContractError) {
      throw new UpstreamError("invalid_upstream_response", 502);
    }
    throw err;
  }
}

export async function fetchSnapshot(
  ticker: string,
  opts: { limit: number; cursor?: number },
  token: string,
  signal?: AbortSignal,
): Promise<NewsSnapshot> {
  const params = new URLSearchParams({ limit: String(opts.limit) });
  if (opts.cursor !== undefined) params.set("cursor", String(opts.cursor));
  const res = await upstreamFetch(
    `/api/ticker-news/${encodeURIComponent(ticker)}?${params}`,
    token,
    "application/json",
    signal,
  );
  return handleJsonResponse(res, (x) => parseSnapshot(x, ticker), signal);
}

export async function fetchChanges(
  ticker: string,
  opts: { afterSequence: number; limit: number },
  token: string,
  signal?: AbortSignal,
): Promise<ChangePage> {
  const params = new URLSearchParams({
    after_sequence: String(opts.afterSequence),
    limit: String(opts.limit),
  });
  const res = await upstreamFetch(
    `/api/ticker-news/${encodeURIComponent(ticker)}/changes?${params}`,
    token,
    "application/json",
    signal,
  );
  return handleJsonResponse(res, (x) => parseChanges(x, ticker), signal);
}

export async function fetchStory(
  storyId: string,
  token: string,
  signal?: AbortSignal,
): Promise<StoryDetail> {
  const res = await upstreamFetch(
    `/api/ticker-news/stories/${encodeURIComponent(storyId)}`,
    token,
    "application/json",
    signal,
  );
  return handleJsonResponse(res, (x) => parseStory(x), signal);
}

export async function openStream(
  ticker: string,
  afterSequence: number,
  token: string,
  signal?: AbortSignal,
): Promise<Response> {
  const params = new URLSearchParams({ after_sequence: String(afterSequence) });
  const res = await upstreamFetch(
    `/api/ticker-news/${encodeURIComponent(ticker)}/stream?${params}`,
    token,
    "text/event-stream",
    signal,
  );
  if (!res.ok) {
    if (!jsonContentType(res)) {
      throw new UpstreamError("invalid_upstream_response", 502);
    }
    const text = await readJsonText(res);
    const detail = parseDetail(text);
    const retryAfter = res.status === 429 ? res.headers.get("Retry-After") ?? undefined : undefined;
    throw new UpstreamError("upstream_http_error", res.status, { detail, retryAfter });
  }
  return res;
}

export type TickerNewsCteErrorCode =
  | "invalid_symbol"
  | "unauthorized"
  | "payment_required"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "cursor_expired"
  | "unavailable"
  | "upstream_error"
  | "invalid_upstream_response"
  | "oversize_upstream_response"
  | "invalid_request";

export function tickerNewsErrorResponse(
  status: number,
  code: TickerNewsCteErrorCode,
  message: string,
  retryable: boolean,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({ ok: false, state: "error", error: { code, message, retryable } }),
    {
      status,
      headers: {
        "content-type": "application/json",
        ...TICKER_NEWS_PRIVATE_HEADERS,
        ...extraHeaders,
      },
    },
  );
}

export function mapUpstreamHttpError(
  status: number,
  detail: string,
  opts: { hadCursorOrSequence?: boolean; retryAfter?: string },
): { status: number; code: TickerNewsCteErrorCode; retryable: boolean; retryAfter?: string } {
  if (status === 401) return { status: 401, code: "unauthorized", retryable: false };
  if (status === 402) return { status: 402, code: "payment_required", retryable: false };
  if (status === 403) return { status: 403, code: "forbidden", retryable: false };
  if (status === 404) return { status: 404, code: "not_found", retryable: false };
  if (status === 429) {
    return {
      status: 429,
      code: "rate_limited",
      retryable: true,
      retryAfter: opts.retryAfter ?? "60",
    };
  }
  if (opts.hadCursorOrSequence && (status === 400 || status === 409 || status === 410)) {
    return { status, code: "cursor_expired", retryable: false };
  }
  if (status === 503) return { status: 503, code: "unavailable", retryable: true };
  return { status, code: "upstream_error", retryable: status >= 500 };
}

export function mapClientUpstreamError(
  err: UpstreamError,
  hadCursorOrSequence: boolean,
): Response {
  if (err.code === "client_aborted") {
    return tickerNewsErrorResponse(499, "upstream_error", "Client aborted", false);
  }
  if (err.code === "oversize_upstream_response") {
    return tickerNewsErrorResponse(502, "oversize_upstream_response", "Upstream response too large", false);
  }
  if (err.code === "invalid_upstream_response") {
    return tickerNewsErrorResponse(502, "invalid_upstream_response", "Invalid upstream response", false);
  }
  if (err.code === "ticker_news_unavailable") {
    return tickerNewsErrorResponse(502, "unavailable", "Ticker news is temporarily unavailable", true);
  }
  if (err.code === "upstream_http_error") {
    const mapped = mapUpstreamHttpError(err.status, err.detail ?? "Upstream request failed", {
      hadCursorOrSequence,
      retryAfter: err.retryAfter,
    });
    const headers: Record<string, string> = {};
    if (mapped.retryAfter) headers["Retry-After"] = mapped.retryAfter;
    return tickerNewsErrorResponse(
      mapped.status,
      mapped.code,
      err.detail ?? "Upstream request failed",
      mapped.retryable,
      headers,
    );
  }
  return tickerNewsErrorResponse(502, "upstream_error", err.message, true);
}

export function jsonOk(body: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...TICKER_NEWS_PRIVATE_HEADERS,
      ...extraHeaders,
    },
  });
}
