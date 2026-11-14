import "server-only";
import { billingAuthResult } from "@/app/api/billing/gateway";
import { rateLimit } from "@/lib/rateLimit";
import { decodeProphetObservations, isProphetTicker } from "./prophetObservations";

export const PROPHET_READ_MAX_BYTES = 128 * 1024;
export { PROPHET_READ_DEADLINE_MS } from "./prophetReadServer";
import { PROPHET_PRIVATE_HEADERS as HEADERS, PROPHET_READ_DEADLINE_MS, prophetReadError as error,
  prophetReadOrigin as origin, withinProphetRead as within, readProphetJSON } from "./prophetReadServer";

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
    const raw = await readProphetJSON(response, controller.signal, PROPHET_READ_MAX_BYTES);
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
