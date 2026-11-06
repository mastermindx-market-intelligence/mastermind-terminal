import { EVENT_ID, MedTechError, macroRead, runMedTech } from "@/lib/medtechServer";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return runMedTech(request, false, async auth => {
    const { path } = await context.params;
    const detail = path.length >= 2 && path[0] === "events" && EVENT_ID.test(path[1]);
    if (!(path.length === 1 && ["events", "health"].includes(path[0])) &&
        !(detail && (path.length === 2 || (path.length === 3 && path[2] === "changes")))) {
      throw new MedTechError(404, "not_found");
    }
    const query = new URL(request.url).searchParams;
    const keys = path[0] === "health" ? [] : detail
      ? (path.length === 2 ? ["snapshot_id"] : ["limit", "offset", "snapshot_id"])
      : ["q", "pathway", "decision", "dataset", "limit", "offset", "snapshot_id"];
    for (const [key, value] of query) {
      if (!keys.includes(key) || query.getAll(key).length !== 1 || value.length > 120) {
        throw new MedTechError(400, "invalid_request");
      }
    }
    return macroRead(auth, "/" + path.join("/"), query);
  });
}
