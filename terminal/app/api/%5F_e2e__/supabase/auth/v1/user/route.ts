import { nativeFixtureRead } from "@/lib/e2e/nativeIntelligenceFixture";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Separate third opt-in, exact signed synthetic subject only. Existing JWKS stays public-only. */
export function GET(request: Request) { return nativeFixtureRead(request, "user"); }
