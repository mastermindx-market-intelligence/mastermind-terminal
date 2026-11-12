import "server-only";
import { readScenarioSession } from "./scenarioSessionServer";
import { isInvestigationId } from "./investigations";
import { rateLimit } from "./rateLimit";

export type SavedScenarioResolveRequest = {
  mode: "resolve"; investigation_id: string; revision: number; grant_id: string | null;
};
/** Required callable supplied by the actual private native transport at route registration.
 * No global adapter setter, reference-as-authority fallback, or default allow implementation.
 */
export type SavedScenarioTransport = (body: SavedScenarioResolveRequest, token: string) => Promise<unknown>;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization", "X-Content-Type-Options": "nosniff" };
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const unavailable = () => respond({ status: "unavailable" }, 503);

async function readContext(request: Request): Promise<SavedScenarioResolveRequest | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 1024) return null;
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!record(raw) || Object.keys(raw).sort().join(",") !== "grant_id,investigation_id,revision"
      || !isInvestigationId(raw.investigation_id) || !Number.isSafeInteger(raw.revision)
      || Number(raw.revision) < 1 || Number(raw.revision) > 2147483647
      || (raw.grant_id !== null && !isInvestigationId(raw.grant_id))) return null;
    return { mode: "resolve", investigation_id: raw.investigation_id, revision: Number(raw.revision), grant_id: raw.grant_id as string | null };
  } catch { return null; }
  finally { void reader.cancel().catch(() => {}); }
}

/** Authenticated dedicated read path. The native transport still owns current resource,
 * source-use and destination qualification and exact native byte/math verification.
 * Browser fields can name only one canonical UUID/revision/grant, never source overrides.
 */
export async function handleSavedScenarioResolution(request: Request, transport: SavedScenarioTransport): Promise<Response> {
  try {
    const auth = await readScenarioSession();
    if (auth.status === "denied") return respond({ status: "denied" }, 401);
    if (auth.status !== "ok") return unavailable();
    const limited = rateLimit(request, { name: "investigation-scenario-resolve", max: 30 });
    if (!limited.ok) return respond({ status: "unavailable" }, 429);
    const body = await readContext(request);
    if (!body) return respond({ status: "unavailable" }, 400);
    const value = await transport(body, auth.token);
    if (!record(value)) return unavailable();
    if (value.status === "not_found") return respond({ status: "not_found" }, 404);
    if (value.status === "denied") return respond({ status: "denied" }, 403);
    if (value.status !== "resolved" || value.investigation_id !== body.investigation_id
      || value.revision !== body.revision || value.grant_id !== body.grant_id) return unavailable();
    // Whitelist the dedicated readout; raw retained bytes, diagnostics and credentials never
    // become browser response fields even if an internal transport accidentally adds them.
    return respond({ status: "resolved", investigation_id: body.investigation_id, revision: body.revision,
      grant_id: body.grant_id, capture: value.capture, basis: value.basis, result: value.result });
  } catch { return unavailable(); }
}
