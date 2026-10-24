import { boundedJson, runMedTech } from "@/lib/medtechServer";
import { reviewChange } from "@/lib/medtechWatches";

export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return runMedTech(request, true, async auth => reviewChange(auth, (await context.params).id,
    await boundedJson(request.body, 8192)));
}
