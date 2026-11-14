import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BILLING_BASE, billingAuthResult } from "@/app/api/billing/gateway";
import { rateLimit } from "./rateLimit";
import { fixtureSeamReachable } from "./fixtureSeam";
import { parseProphetTroughRead } from "./prophetTroughRead";

/** Same Macro origin/auth and closed-source gate as beta evaluation. Intended
 * singleton for Macro's site/prophet/trough_read.json; producer integration is
 * not yet verified. Missing publication stays unavailable. */
export const TROUGH_MACRO_PATH = "/api/prophet/trough-read/v1";
export const TROUGH_FIXTURE_FILE = "lib/__tests__/fixtures/prophet_trough_read.json";
export const TROUGH_MAX_BYTES = 160 * 1024;
export const TROUGH_DEADLINE_MS = 10_000;
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, noarchive" };
const error = (code: string, status: number) => Response.json({ error: code }, { status, headers: HEADERS });
function origin(): string | null {
  try {
    const url = new URL(BILLING_BASE);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? url.origin : null;
  } catch { return null; }
}
async function within<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw new DOMException("Read cancelled", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new DOMException("Read cancelled", "AbortError"));
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw new DOMException("Read cancelled", "AbortError"); return action(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
  });
}
async function readJSON(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !response.body) throw new Error("Invalid source");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await within(signal, () => reader.read()); if (next.done) break;
      length += next.value.byteLength; if (length > TROUGH_MAX_BYTES) throw new Error("Source exceeds read bound"); chunks.push(next.value);
    }
    const joined = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as unknown;
  } finally { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* Pending read is cancelled by the owner signal. */ } }
}
function closedResponse(raw: unknown): Response {
  const decoded = parseProphetTroughRead(raw);
  return decoded.status === "ready" ? Response.json(decoded.data, { headers: HEADERS }) : error("trough_unavailable", 503);
}
export async function handleProphetTroughReadRequest(request: Request): Promise<Response> {
  if (new URL(request.url).search.length) return error("invalid_query", 422);
  // Same production-proof fixture gate as evaluation. Synthetic data is test-only
  // and cannot be selected by a production deployment or a request parameter.
  if (fixtureSeamReachable()) {
    const limited = rateLimit(request, { name: "prophet-trough-read" });
    if (!limited.ok) return error("rate_limited", 429);
    try {
      const bytes = await fs.readFile(path.join(process.cwd(), TROUGH_FIXTURE_FILE));
      if (bytes.byteLength > TROUGH_MAX_BYTES) return error("trough_unavailable", 503);
      return closedResponse(JSON.parse(bytes.toString("utf8")) as unknown);
    } catch { return error("trough_unavailable", 503); }
  }
  const base = origin(); if (!base) return error("trough_unavailable", 503);
  const controller = new AbortController(); const cancel = () => controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true }); if (request.signal.aborted) cancel();
  const timer = setTimeout(cancel, TROUGH_DEADLINE_MS);
  try {
    const auth = await within(controller.signal, billingAuthResult);
    if (auth.status === "denied") return error("authentication_required", 401);
    if (auth.status !== "ok" || !auth.token) return error("authentication_unavailable", 502);
    const limited = rateLimit(request, { name: "prophet-trough-read", max: 60 });
    if (!limited.ok) return error("rate_limited", 429);
    const response = await within(controller.signal, () => fetch(`${base}${TROUGH_MACRO_PATH}`, {
      method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${auth.token}` }, cache: "no-store", redirect: "error", signal: controller.signal,
    }));
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      return error("trough_unavailable", [401, 403, 429].includes(response.status) ? response.status : 503);
    }
    return closedResponse(await readJSON(response, controller.signal));
  } catch { return error("trough_unavailable", 503); }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", cancel); controller.abort(); }
}
