import "server-only";
import { BILLING_BASE, billingAuthResult } from "@/app/api/billing/gateway";
import { rateLimit } from "@/lib/rateLimit";
import { decodeProphetObservations, isProphetTicker } from "./prophetObservations";

export const PROPHET_READ_MAX_BYTES = 128 * 1024;
export const PROPHET_READ_DEADLINE_MS = 10_000;
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, noarchive" };
function error(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: HEADERS });
}
function origin(): string | null {
  try {
    const url = new URL(BILLING_BASE);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || (url.protocol === "http:" && local) ? url.origin : null;
  } catch { return null; }
}
function aborted(): DOMException { return new DOMException("Read cancelled", "AbortError"); }
async function within<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw aborted();
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(aborted());
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw aborted(); return action(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
  });
}
async function readJSON(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !response.body) throw new Error("Invalid source");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await within(signal, () => reader.read());
      if (next.done) break;
      length += next.value.byteLength;
      if (length > PROPHET_READ_MAX_BYTES) throw new Error("Source exceeds read bound");
      chunks.push(next.value);
    }
    const joined = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as unknown;
  } finally {
    // A hostile or broken stream must not extend the request deadline during cleanup.
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* Pending read is cancelled by the owner signal. */ }
  }
}

/** Transport only. Supabase verifies the session; Macro remains the sole entitlement/observation owner. */
export async function handleProphetObservationRequest(request: Request): Promise<Response> {
  const upstreamOrigin = origin();
  if (!upstreamOrigin) return error("source_unavailable", 503);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  const timer = setTimeout(cancel, PROPHET_READ_DEADLINE_MS);
  let phase: "authentication" | "source" = "authentication";
  try {
    if (controller.signal.aborted) return error("source_unavailable", 503);
    const auth = await within(controller.signal, billingAuthResult);
    if (auth.status === "denied") return error("authentication_required", 401);
    if (auth.status !== "ok" || !auth.token) return error("authentication_unavailable", 502);
    const query = new URL(request.url).searchParams;
    const ticker = query.get("ticker") ?? "";
    if (query.getAll("ticker").length !== 1 || [...query.keys()].some(key => key !== "ticker") || !isProphetTicker(ticker)) return error("invalid_ticker", 400);
    const limited = rateLimit(request, { name: "prophet-observations", max: 60 });
    if (!limited.ok) return error("rate_limited", 429);
    phase = "source";
    const response = await within(controller.signal, () => fetch(`${upstreamOrigin}/api/prophet/observations/v1?ticker=${encodeURIComponent(ticker)}&limit=50`, {
      method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${auth.token}` },
      cache: "no-store", redirect: "error", signal: controller.signal,
    }));
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 401) return error("authentication_required", 401);
      if (response.status === 403) return error("entitlement_required", 403);
      return error("source_unavailable", response.status === 429 ? 429 : response.status === 503 ? 503 : 502);
    }
    const raw = await readJSON(response, controller.signal);
    if (raw && typeof raw === "object" && !Array.isArray(raw) && (raw as { status?: unknown }).status === "UNAVAILABLE") return error("source_unavailable", 503);
    const projection = decodeProphetObservations(raw, ticker);
    if (!projection) return error("invalid_source", 502);
    return Response.json(projection, { status: 200, headers: HEADERS });
  } catch {
    if (controller.signal.aborted) return error("source_unavailable", 503);
    return error(phase === "authentication" ? "authentication_unavailable" : "source_unavailable", 502);
  } finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", cancel);
    controller.abort();
  }
}
