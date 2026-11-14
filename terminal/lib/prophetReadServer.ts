import "server-only";
import { BILLING_BASE } from "@/app/api/billing/gateway";

/** Shared transport bounds for authenticated, read-only Prophet projections.
 * Authentication and source interpretation remain with each existing owner. */
export const PROPHET_PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, noarchive" };
export const PROPHET_READ_DEADLINE_MS = 10_000;
export function prophetReadError(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: PROPHET_PRIVATE_HEADERS });
}
export function prophetReadOrigin(): string | null {
  try {
    const url = new URL(BILLING_BASE);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || (url.protocol === "http:" && local) ? url.origin : null;
  } catch { return null; }
}
function aborted(): DOMException { return new DOMException("Read cancelled", "AbortError"); }
export async function withinProphetRead<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw aborted();
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(aborted());
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw aborted(); return action(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
  });
}
export async function readProphetJSON(response: Response, signal: AbortSignal, maxBytes: number): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !response.body) throw new Error("Invalid source");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await withinProphetRead(signal, () => reader.read());
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) throw new Error("Source exceeds read bound");
      chunks.push(next.value);
    }
    const joined = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as unknown;
  } finally {
    // Cleanup cannot extend the deadline when a broken producer ignores abort.
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* The owner signal cancels a pending read. */ }
  }
}
