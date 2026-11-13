import { boundedJson, runMedTech } from "@/lib/medtechServer";
import { createWatch, listWatches } from "@/lib/medtechWatches";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return runMedTech(request, false, listWatches);
}
export async function POST(request: Request) {
  return runMedTech(request, true, async auth => createWatch(auth, await boundedJson(request.body, 8192)));
}
