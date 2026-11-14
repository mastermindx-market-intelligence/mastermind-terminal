import "server-only";
import { billingAuthResult } from "@/app/api/billing/gateway";
import { rateLimit } from "@/lib/rateLimit";
import { decodeProphetCandidates, PROPHET_CANDIDATES_MAX_BYTES } from "./prophetCandidates";
import { PROPHET_PRIVATE_HEADERS, PROPHET_READ_DEADLINE_MS, prophetReadError as error, prophetReadOrigin, readProphetJSON, withinProphetRead as within } from "./prophetReadServer";

/** One fixed upstream read. Macro verifies site-full entitlement and owns the
 * complete pool; this route cannot query arbitrary files or create a universe. */
export async function handleProphetCandidateRequest(request: Request): Promise<Response> {
  const origin = prophetReadOrigin();
  if (!origin) return error("source_unavailable", 503);
  const controller = new AbortController(), cancel = () => controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) cancel();
  const timer = setTimeout(cancel, PROPHET_READ_DEADLINE_MS);
  let phase: "authentication" | "source" = "authentication";
  try {
    const auth = await within(controller.signal, billingAuthResult);
    if (auth.status === "denied") return error("authentication_required", 401);
    if (auth.status !== "ok" || !auth.token) return error("authentication_unavailable", 502);
    if ([...new URL(request.url).searchParams.keys()].length) return error("invalid_query", 400);
    if (!rateLimit(request, { name: "prophet-candidates", max: 30 }).ok) return error("rate_limited", 429);
    phase = "source";
    const response = await within(controller.signal, () => fetch(`${origin}/api/prophet/candidates/v1`, {
      method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${auth.token}` },
      cache: "no-store", redirect: "error", signal: controller.signal,
    }));
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 401) return error("authentication_required", 401);
      if (response.status === 403) return error("entitlement_required", 403);
      return error("source_unavailable", response.status === 429 ? 429 : response.status === 503 ? 503 : 502);
    }
    const pool = decodeProphetCandidates(await readProphetJSON(response, controller.signal, PROPHET_CANDIDATES_MAX_BYTES));
    if (!pool) return error("invalid_source", 502);
    return Response.json(pool, { status: 200, headers: PROPHET_PRIVATE_HEADERS });
  } catch {
    return error(phase === "authentication" ? "authentication_unavailable" : "source_unavailable", controller.signal.aborted ? 503 : 502);
  } finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", cancel); controller.abort();
  }
}
