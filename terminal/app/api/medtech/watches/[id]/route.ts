import { boundedJson, runMedTech } from "@/lib/medtechServer";
import { deleteWatch, getWatch, updateWatch } from "@/lib/medtechWatches";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return runMedTech(request, false, async auth => ({
    schema: "medtech.watch/v1", watch: await getWatch(auth, (await context.params).id),
  }));
}
export async function PATCH(request: Request, context: Context) {
  return runMedTech(request, true, async auth => updateWatch(auth, (await context.params).id,
    await boundedJson(request.body, 8192)));
}
export async function DELETE(request: Request, context: Context) {
  return runMedTech(request, true, async auth => deleteWatch(auth, (await context.params).id,
    await boundedJson(request.body, 8192)));
}
