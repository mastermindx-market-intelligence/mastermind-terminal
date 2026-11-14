import { proxyReading } from "@/lib/shared-shell/readingProxy";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(request: Request) { return proxyReading(request, "macroDashboard"); }
