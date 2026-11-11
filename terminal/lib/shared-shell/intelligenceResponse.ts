import "server-only";
import { projectCycleIntelligence, projectProphetIntelligence } from "./intelligencePayloads";
/** Only called after the incumbent reader has enforced authentication and acquisition.
 * This does not own a cache, upstream, entitlement or source selection. */
export async function intelligenceResponse(response: Response, kind: "cycles" | "prophet"): Promise<Response> {
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  for (const key of ["content-length", "content-encoding", "etag"]) headers.delete(key);
  headers.set("Content-Type", "application/json"); headers.set("Cache-Control", "private, no-store");
  const vary = new Set((headers.get("Vary") ?? "").split(",").map(x => x.trim()).filter(Boolean));
  vary.add("Cookie"); headers.set("Vary", [...vary].join(", "));
  try {
    const input: unknown = await response.json();
    const data = kind === "cycles" ? projectCycleIntelligence(input) : projectProphetIntelligence(input);
    if (data === null) throw Error("shape");
    return Response.json(data, { headers });
  } catch { return Response.json({ error: "intelligence_summary_unavailable" }, { status: 503, headers }); }
}
