/** Real SQL -> actual Request/Response route handlers. Authentication is an
 * explicit synthetic Supabase principal fixture, never live-provider proof.
 * The Python test owns one disposable socket-only database and its lifetime.
 */
import { createServer, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { D, T, U } from "./briefDeliverySharing.fixture";
const state = vi.hoisted(() => ({ user: "10000000-0000-4000-8000-000000000001", flipOnShare: false,
  mutations: 0 }));
function localPsql(sql: string) {
  const argv: string[] = JSON.parse(process.env.MM_BRIEF_TEST_PSQL_ARGV || "[]");
  const host = argv[argv.indexOf("-h") + 1];
  if (argv[0] !== "psql" || !host?.startsWith("/tmp/brief-share-") || argv.includes("--password"))
    throw new Error("disposable local PostgreSQL fixture required");
  return spawnSync(argv[0], argv.slice(1), { input: sql, encoding: "utf8" });
}
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: state.user } }, error: null }) },
  rpc: async (name: string, args: Record<string, string>) => {
    const fields: Record<string, string[]> = {
      read_brief_delivery_sharing: ["p_delivery_id", "p_team_id"],
      share_brief_delivery: ["p_delivery_id", "p_team_id", "p_expected_content_sha256", "p_expected_effect_sha256"],
      reconcile_brief_delivery_sharing: ["p_delivery_id", "p_expected_effect_sha256"],
      read_shared_brief_delivery: ["p_delivery_id"],
    };
    if (!Object.hasOwn(fields, name)) throw new Error("fixed fixture RPC required");
    const sql = "set role authenticated;set request.jwt.claim.sub=" + quote(state.user) +
      ";select public." + name + "(" + fields[name].map(key => quote(args[key])).join(",") + ");";
    const result = localPsql(sql);
    if (result.status !== 0) return { data: null, error: { code: /ERROR:\s+([A-Z0-9]{5}):/.exec(result.stderr)?.[1] } };
    if (name === "share_brief_delivery") {
      state.mutations++;
      if (state.flipOnShare) state.user = "10000000-0000-4000-8000-000000000004";
    }
    return { data: JSON.parse(result.stdout.trim()), error: null };
  },
}) }));
import { GET, POST } from "../../app/api/briefs/deliveries/[deliveryId]/sharing/route";
import { GET as sharedGET } from "../../app/api/briefs/shared/[deliveryId]/route";
let origin = "https://app.mastermind-x.com";
const context = (deliveryId = D) => ({ params: Promise.resolve({ deliveryId }) });
// Socket bound to loopback for this inert fixture only. Actual HTTP transports
// the unchanged route handlers into the disposable PostgreSQL owner; Supabase
// identity remains the explicitly synthetic fixture above.
async function withHttp(run: (base: string) => Promise<void>) {
  const server = createServer(async (incoming: IncomingMessage, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const part of incoming) chunks.push(Buffer.from(part));
      const url = new URL(incoming.url!, origin);
      const match = /^\/api\/briefs\/(?:deliveries\/([^/]+)\/sharing|shared\/([^/]+))$/.exec(url.pathname);
      if (!match) { outgoing.writeHead(404).end(); return; }
      const headers = new Headers();
      for (const [key,value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(key,value);
      const request = new Request(url, { method: incoming.method, headers,
        ...(incoming.method === "POST" ? { body: Buffer.concat(chunks).toString("utf8") } : {}) });
      const response = match[2] ? await sharedGET(request, context(match[2])) :
        incoming.method === "POST" ? await POST(request, context(match[1])) : await GET(request, context(match[1]));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch { outgoing.writeHead(500).end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw Error("fixture address");
  origin = `http://127.0.0.1:${address.port}`;
  try { await run(origin); } finally { await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
}
beforeEach(() => { state.user = U; state.flipOnShare = false; state.mutations = 0; });

describe.skipIf(!process.env.MM_BRIEF_TEST_PSQL_ARGV)("route handlers joined to the actual delivery/team database owner", () => {
  it("recovers a lost authorized response and then enforces actual recipient revocation", async () => {
    const path = `${origin}/api/briefs/deliveries/${D}/sharing`;
    const reviewResponse = await GET(new Request(`${path}?team_id=${T}`), context());
    expect(reviewResponse.status).toBe(200);
    const review = await reviewResponse.json();
    state.flipOnShare = true;
    const submitted = await POST(new Request(path, { method: "POST", headers: {
      Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ team_id: T,
      expected_content_sha256: review.delivery.content_sha256,
      expected_effect_sha256: review.expected_effect_sha256 }) }), context());
    // The actual SQL grant committed, but the changed fixture principal must
    // not receive its body. Recovery is one original read, never a second POST.
    expect(submitted.status).toBe(503);
    expect(await submitted.json()).toEqual({ ok: false, code: "effect_unknown", reference: {
      delivery_id: D, expected_effect_sha256: review.expected_effect_sha256 } });
    state.user = U;
    const recovered = await GET(new Request(`${path}?expected_effect_sha256=${review.expected_effect_sha256}`), context());
    const receipt = await recovered.json();
    expect(recovered.status).toBe(200);
    expect(receipt.observation).toBe("MATCHED");
    expect(receipt.current_access).toBe(true);
    expect(state.mutations).toBe(1);
    state.user = "10000000-0000-4000-8000-000000000003";
    const shared = await sharedGET(new Request(`${origin}/api/briefs/shared/${D}`), context());
    const value = await shared.json();
    expect(shared.status).toBe(200);
    expect(Object.keys(value.delivery.body).sort()).toEqual(["artifact", "market_read", "monitors"]);
    expect(JSON.stringify(value)).not.toContain("subscription");
    expect(JSON.stringify(value)).not.toContain("30000000-");
    expect(localPsql(`delete from public.team_members where team_id=${quote(T)} and user_id=${quote(state.user)};`).status).toBe(0);
    expect((await sharedGET(new Request(`${origin}/api/briefs/shared/${D}`), context())).status).toBe(403);
  });
  it("rejects a changed preview operation before SQL writes any grant", async () => {
    state.user = "10000000-0000-4000-8000-000000000002";
    const d = "40000000-0000-4000-8000-000000000002", route = `${origin}/api/briefs/deliveries/${d}/sharing`;
    const review = await (await GET(new Request(`${route}?team_id=${T}`), context(d))).json();
    const response = await POST(new Request(route, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ team_id: T, expected_content_sha256: review.delivery.content_sha256,
        expected_effect_sha256: "0".repeat(64) }) }), context(d));
    expect(response.status).toBe(409);
    const after = await (await GET(new Request(`${route}?team_id=${T}`), context(d))).json();
    expect(after.grant).toBeNull();
    expect(state.mutations).toBe(0);
  });
  it("carries the exact preview, commit and original receipt over actual loopback HTTP", async () => {
    await withHttp(async base => {
      state.user = "10000000-0000-4000-8000-000000000002";
      const deliveryId = "40000000-0000-4000-8000-000000000002";
      const path = `${base}/api/briefs/deliveries/${deliveryId}/sharing`;
      const reviewResponse = await fetch(`${path}?team_id=${T}`);
      expect(reviewResponse.status).toBe(200);
      expect(reviewResponse.headers.get("cache-control")).toContain("no-store");
      const review = await reviewResponse.json();
      const response = await fetch(path, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ team_id: T, expected_content_sha256: review.delivery.content_sha256,
          expected_effect_sha256: review.expected_effect_sha256 }) });
      expect(response.status).toBe(200);
      const recorded = await response.json();
      const receipt = await (await fetch(`${path}?expected_effect_sha256=${review.expected_effect_sha256}`)).json();
      expect(receipt.observation).toBe("MATCHED");
      expect(receipt.grant).toEqual(recorded.grant);
      expect(state.mutations).toBe(1);
      const denied = await fetch(path, { method: "POST", headers: { Origin: "https://unrelated.invalid", "Content-Type": "application/json" }, body: "{}" });
      expect(denied.status).toBe(403); expect(state.mutations).toBe(1);
    });
  });

});
