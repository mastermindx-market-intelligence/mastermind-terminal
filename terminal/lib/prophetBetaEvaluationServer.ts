import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BILLING_BASE, billingAuthResult } from "@/app/api/billing/gateway";
import { rateLimit } from "@/lib/rateLimit";
import { decodeBetaEvaluation } from "./prophetBetaEvaluation";

export const PROPHET_BETA_EVALUATION_MAX_BYTES = 160 * 1024;
export const PROPHET_BETA_EVALUATION_DEADLINE_MS = 10_000;
/** Committed real-artifact copy served in dev/Playwright fixture mode. */
export const PROPHET_BETA_EVALUATION_FIXTURE_FILE = "public/data/prophet_beta_evaluation_fixture.json";
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
      if (length > PROPHET_BETA_EVALUATION_MAX_BYTES) throw new Error("Source exceeds read bound");
      chunks.push(next.value);
    }
    const joined = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as unknown;
  } finally {
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* Pending read is cancelled by the owner signal. */ }
  }
}

function fixtureMode(): boolean {
  return process.env.FLOW_FIXTURE === "1" || process.env.TERMINAL_E2E_FIXTURE === "1";
}

/** Fixture branch: the committed REAL artifact (byte-identical to the engine's
 * publication for this window) answers without any upstream or billing
 * dependency, through the SAME closed decoder gate as the live path. */
async function handleFixture(): Promise<Response> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(
      path.join(process.cwd(), PROPHET_BETA_EVALUATION_FIXTURE_FILE), "utf8")) as unknown;
    if (!decodeBetaEvaluation(raw)) return error("invalid_source", 502);
    return Response.json(raw, { status: 200, headers: { ...HEADERS, "X-Flow-Source": "fixture" } });
  } catch {
    return error("evaluation_unavailable", 503);
  }
}

/**
 * Transport only. Supabase verifies the session; Macro's evaluation engine
 * remains the sole owner of the artifact. The BFF forwards nothing (a frozen
 * singleton GET), bounds the read, passes 401/403 through, and folds every
 * "upstream has nothing yet" condition (404/5xx/timeout) into a single
 * designed-unavailable 503 the client renders as "Evaluation not available
 * yet" — never a partial or inferred evaluation.
 */
export async function handleProphetBetaEvaluationRequest(request: Request): Promise<Response> {
  if (new URL(request.url).search.length > 0) return error("invalid_query", 422);

  if (fixtureMode()) {
    const limited = rateLimit(request, { name: "prophet-beta-evaluation", max: 60 });
    if (!limited.ok) return error("rate_limited", 429);
    return handleFixture();
  }

  const upstreamOrigin = origin();
  if (!upstreamOrigin) return error("evaluation_unavailable", 503);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  const timer = setTimeout(cancel, PROPHET_BETA_EVALUATION_DEADLINE_MS);
  let phase: "authentication" | "source" = "authentication";
  try {
    if (controller.signal.aborted) return error("evaluation_unavailable", 503);
    const auth = await within(controller.signal, billingAuthResult);
    if (auth.status === "denied") return error("authentication_required", 401);
    if (auth.status !== "ok" || !auth.token) return error("authentication_unavailable", 502);
    const limited = rateLimit(request, { name: "prophet-beta-evaluation", max: 60 });
    if (!limited.ok) return error("rate_limited", 429);

    phase = "source";
    const response = await within(controller.signal, () => fetch(
      `${upstreamOrigin}/api/prophet/beta-evaluation/v1`, {
        method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${auth.token}` },
        cache: "no-store", redirect: "error", signal: controller.signal,
      }));
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 401) return error("authentication_required", 401);
      if (response.status === 403) return error("entitlement_required", 403);
      if (response.status === 422) return error("invalid_query", 422);
      // No artifact yet (404), upstream fault (5xx) or throttle — all are
      // "nothing to show" for the reader; the UI owns one designed state for it.
      return error("evaluation_unavailable", response.status === 429 ? 429 : 503);
    }
    const raw = await readJSON(response, controller.signal);
    // Closed-contract gate: a body outside `prophet.beta_evaluation/v1` is never
    // rehosted for the client to half-render.
    if (!decodeBetaEvaluation(raw)) return error("invalid_source", 502);
    return Response.json(raw, { status: 200, headers: HEADERS });
  } catch {
    if (controller.signal.aborted) return error("evaluation_unavailable", 503);
    if (phase === "authentication") return error("authentication_unavailable", 502);
    // A read/transport fault on an ANSWERING upstream is a source error (502),
    // distinct from "nothing published yet" (503 above): the client shows the
    // same designed unavailable state either way, but the operator evidence
    // keeps the two causes apart.
    return error("source_unavailable", 502);
  } finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", cancel);
    controller.abort();
  }
}
