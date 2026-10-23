import { proxyReading } from "@/lib/shared-shell/readingProxy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return proxyReading(request, "search"); }
