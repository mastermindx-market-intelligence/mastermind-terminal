import { proxyReading } from "@/lib/shared-shell/readingProxy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ docId: string }> }) {
  return proxyReading(request, "read", (await context.params).docId);
}
