import { fixtureFlagsEnabled, fixtureJwksDocument } from "@/lib/e2e/investigationAuthFixture";

// The one endpoint the fixture namespace serves, and it is public-only: the synthetic ES256
// JWK that lets the REAL pinned SDK verify a fixture session. It answers only under exact
// development plus both dedicated fixture flags, so production and an ordinary test build get
// a plain 404 with no key. No private material in the response — the matching private key
// lives in the test-only e2e/fixtures/investigation-auth.ts, which no runtime module imports.
// No token/session/refresh/callback service exists. A separately third-opted-in native
// journey GET user fixture verifies the same isolated signer for one distinct test subject.
// These two flags alone still expose only this public key; its response grants no identity.

export const dynamic = "force-dynamic";

export async function GET() {
  if (!fixtureFlagsEnabled()) return new Response("Not Found", { status: 404 });
  return new Response(JSON.stringify(fixtureJwksDocument()), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
