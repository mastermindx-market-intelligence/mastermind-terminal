import { proxyCurrentResearchPdf } from "@/lib/shared-shell/readingPdfProxy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ docId: string }> }) {
  return proxyCurrentResearchPdf(request, (await context.params).docId);
}
