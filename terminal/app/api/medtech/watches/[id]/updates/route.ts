import { runMedTech } from "@/lib/medtechServer";
import { watchUpdates } from "@/lib/medtechWatches";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return runMedTech(request, false, async auth => watchUpdates(auth, (await context.params).id,
    new URL(request.url).searchParams));
}
