#!/usr/bin/env node
// Loopback-only Supabase auth fixture for the /sectors Shared Shell browser proof.
// Same shape and authority as e2e/tools/qualify_shared_shell_intelligence.cjs: a
// synthetic signed-in member served from this process, reachable only from
// loopback, read-only (GET/OPTIONS). Production never talks to this server; the
// dev server under test points NEXT_PUBLIC_SUPABASE_URL here only in the
// deterministic browser harness.
import http from "node:http";

const port = Number(process.argv[2] || process.env.SECTOR_NATIVE_AUTH_PORT || 54331);
const OWNER = "00000000-0000-4000-8000-0000000000e1";
const user = () => ({ id: OWNER, aud: "authenticated", role: "authenticated", email: "research-fixture@example.test",
  email_confirmed_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { theme: "dark", lang: "en", onboarded_at: "2026-01-01T00:00:00Z" } });

const server = http.createServer((req, res) => {
  // Server-to-server calls (the RSC/SSR supabase client) carry no Origin and
  // need no CORS; browser calls must come from a loopback origin, which is
  // echoed back. Anything else is refused.
  const origin = req.headers.origin || "";
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) { res.writeHead(403).end("{}"); return; }
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "authorization,apikey,content-type,x-client-info,x-supabase-api-version");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  if (req.method !== "GET") { res.writeHead(405).end("{}"); return; }
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  if (path === "/auth/v1/user") {
    // The spec mints its own session token, so authority here is the member
    // identity claim itself (sub === OWNER), not a shared secret only this
    // process knows. Anything else is an invalid fixture session.
    const bearer = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(req.headers.authorization || "");
    const sub = bearer ? JSON.parse(Buffer.from(bearer[1].split(".")[1], "base64url").toString("utf8")).sub : null;
    if (sub !== OWNER) { res.writeHead(401).end('{"message":"invalid fixture session"}'); return; }
    res.end(JSON.stringify(user())); return;
  }
  if (path === "/api/me") { res.end(JSON.stringify({ tier: "pro", features: ["terminal_live_options"], status: "active" })); return; }
  if (path.startsWith("/rest/")) { res.end("[]"); return; }
  res.writeHead(404).end('{"error":"fixture route absent"}');
});

server.once("error", error => {
  // A peer worker already owns the port: that process serves this role.
  if (error.code === "EADDRINUSE") process.exit(0);
  console.error(error); process.exit(1);
});
// The spec spawns this with a stdin pipe; when the owning worker exits, exit with it.
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(0));
server.listen(port, "127.0.0.1", () => console.log(`sector-native auth fixture on 127.0.0.1:${port}`));
