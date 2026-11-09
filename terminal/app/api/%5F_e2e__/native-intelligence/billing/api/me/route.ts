import { nativeFixtureRead } from "@/lib/e2e/nativeIntelligenceFixture";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Same normal server billing protocol, fixed test subject, never a product entitlement grant. */
export function GET(request: Request) { return nativeFixtureRead(request, "billing"); }
