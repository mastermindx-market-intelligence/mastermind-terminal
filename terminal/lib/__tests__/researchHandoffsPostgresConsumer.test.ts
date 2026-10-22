// This suite is run by the isolated PostgreSQL pytest fixture. Ordinary Vitest
// runs skip it honestly when that fixture is absent; it never opens an external DB.
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";

const state = vi.hoisted(() => ({ user: "10000000-0000-4000-8000-000000000001" }));
const OWNER = "10000000-0000-4000-8000-000000000001";
const RECIPIENT = "10000000-0000-4000-8000-000000000002";
const OUTSIDER = "10000000-0000-4000-8000-000000000003";
const INVESTIGATION = "20000000-0000-4000-8000-000000000001";
const available = Boolean(process.env.MMX_HANDOFF_TEST_SOCKET);
const quoted = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;

function sql(statement: string, user = state.user): string {
  const socket = process.env.MMX_HANDOFF_TEST_SOCKET ?? "";
  // The supplying pytest fixture owns this socket-only cluster. No network origin,
  // saved credential, Supabase service key or real account is accepted here.
  if (!socket.startsWith("/tmp/mmx-handoff-pg-")) throw new Error("Missing isolated fixture socket");
  return execFileSync("psql", ["-h", socket, "-p", "55488", "-U", "postgres", "-d", "postgres",
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `set role authenticated; set request.jwt.claim.sub=${quoted(user)};${statement}`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user ? { id: state.user } : null }, error: null }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    try {
      let call: string;
      if (name === "create_investigation_handoff_v1") {
        call = `public.${name}(p_id=>${quoted(args.p_id)}::uuid,p_revision=>${Number(args.p_revision)},p_grantee=>${quoted(args.p_grantee)}::uuid)`;
      } else if (name === "list_investigation_handoffs_v1") {
        call = `public.${name}()`;
      } else if (name === "read_investigation_handoff_v1" || name === "revoke_investigation_handoff_v1") {
        call = `public.${name}(p_grant_id=>${quoted(args.p_grant_id)}::uuid)`;
      } else throw new Error("Unexpected fixture RPC");
      return { data: JSON.parse(sql(`select ${call};`)), error: null };
    } catch { return { data: null, error: { code: "ISOLATED_SQL_FAILURE" } }; }
  },
}) }));

import { GET, POST, DELETE } from "@/app/api/research-handoffs/route";
import { listHandoffs, shareHandoff, readHandoff, revokeHandoff } from "@/lib/researchHandoffs";

let server: Server | undefined;
let originalFetch: typeof fetch;
let origin = "";
const responses: Response[] = [];

beforeAll(async () => {
  if (!available) return;
  originalFetch = globalThis.fetch;
  server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const method = incoming.method ?? "GET";
    const request = new Request(new URL(incoming.url ?? "/", origin), {
      method, headers: incoming.headers as HeadersInit,
      body: method === "GET" ? undefined : Buffer.concat(chunks),
    });
    const response = await (method === "POST" ? POST : method === "DELETE" ? DELETE : GET)(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(await response.text());
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback fixture address");
  origin = `http://127.0.0.1:${address.port}`;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(new URL(String(input), origin), init);
    responses.push(response);
    return response;
  }) as typeof fetch;
});

afterAll(async () => {
  if (!available) return;
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
});

it.skipIf(!available)("uses the exported route and typed client over HTTP against the real role-scoped SQL", async () => {
  state.user = OWNER;
  const created = await shareHandoff(OWNER, { investigationId: INVESTIGATION, revision: 1, granteeUserId: RECIPIENT });
  expect(created.httpStatus).toBe(201);
  if (created.result.status !== "created") throw new Error("Actual named-argument SQL share failed");
  const grant = created.result.handoff.grantId;
  try {
    state.user = RECIPIENT;
    const listed = await listHandoffs(RECIPIENT);
    expect(listed.result).toMatchObject({ status: "listed", received: [{ grantId: grant, revision: 1 }] });
    const read = await readHandoff(RECIPIENT, grant);
    expect(read.httpStatus).toBe(200);
    expect(read.result).toMatchObject({ status: "found", handoff: {
      schema: "mm.research_handoff.v1", revision: 1,
      intent: { title: "Pinned handoff", question: "Why?" },
      continuation: { nextQuestion: "Follow up?", nextObservation: "Watch price" },
    } });
    // The recipient already owns unrelated research in the fixture. Sharing must
    // leave those rows visible while the sharing author's private rows stay closed.
    expect(sql(`select count(*) from public.investigation_revisions where investigation_id=${quoted(INVESTIGATION)}::uuid;`)).toBe("0");
    expect(sql(`select count(*) from public.investigation_mutation_receipts where user_id=${quoted(OWNER)}::uuid;`)).toBe("0");
    state.user = OUTSIDER;
    expect(await readHandoff(OUTSIDER, grant)).toMatchObject({ httpStatus: 404, result: { status: "not_found" } });
    state.user = OWNER;
    expect(await revokeHandoff(OWNER, grant)).toMatchObject({ httpStatus: 200, result: { status: "revoked" } });
    state.user = RECIPIENT;
    expect(await readHandoff(RECIPIENT, grant)).toMatchObject({ httpStatus: 404, result: { status: "not_found" } });
    state.user = "";
    expect(await listHandoffs(RECIPIENT)).toMatchObject({ httpStatus: 401, result: { status: "unauthenticated" } });
    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toBe("Cookie");
    }
  } finally {
    state.user = OWNER;
    await revokeHandoff(OWNER, grant);
  }
});
