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

// Synthetic overflow rows only: the same socket-only fixture cluster, but as its bootstrap
// role (the way the pytest fixture's own bounds test seeds rows). Never an external origin,
// never a production surface — this path exists purely to build a >200-row scratch fixture.
function sqlSuper(statement: string): string {
  const socket = process.env.MMX_HANDOFF_TEST_SOCKET ?? "";
  if (!socket.startsWith("/tmp/mmx-handoff-pg-")) throw new Error("Missing isolated fixture socket");
  return execFileSync("psql", ["-h", socket, "-p", "55488", "-U", "postgres", "-d", "postgres",
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: statement,
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
        // New named-args contract: both cursors always bound, explicitly NULL on a first page.
        call = `public.${name}(p_sent_after=>${args.p_sent_after == null ? "NULL" : quoted(args.p_sent_after)}::uuid,`
          + `p_received_after=>${args.p_received_after == null ? "NULL" : quoted(args.p_received_after)}::uuid)`;
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

// The fixture base owns two investigations for the sharing author (I1 = INVESTIGATION, plus
// I2) and one for the recipient (J1). Everything beyond that is synthetic overflow created
// HERE, on the isolated socket, as the fixture's bootstrap role — never external.
const I2 = "20000000-0000-4000-8000-000000000002";
const I3 = "20000000-0000-4000-8000-000000000003";
const BASE_INVESTIGATIONS = [INVESTIGATION, I2, I3];
const OVERFLOW_COUNT = 205;
const OVERFLOW_MANIFEST =
  '{"schema":"investigation_manifest.v2","intent":{"title":"Overflow handoff","question":"Why later?",'
  + '"subjects":[]},"layout_refs":[],"thesis_refs":[],"evidence_refs":[],'
  + '"continuation":{"next_question":"Later page?","next_observation":"Watch"}}';
const baseList = `array[${BASE_INVESTIGATIONS.map(quoted).join(",")}]::uuid[]`;

/** Every sent/received row, exactly once, by following the route's own keyset cursors. */
async function traverse(kind: "sent" | "received", who: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined = undefined;
  for (let page = 0; ; page += 1) {
    state.user = who;
    const response = await listHandoffs(
      who,
      page === 0 ? undefined : kind === "sent" ? { sentAfter: cursor } : { receivedAfter: cursor },
    );
    expect(response.httpStatus).toBe(200);
    if (response.result.status !== "listed") throw new Error(`${kind} page failed`);
    const rows = kind === "sent" ? response.result.sent : response.result.received;
    const next = kind === "sent" ? response.result.sentNextCursor : response.result.receivedNextCursor;
    for (const row of rows) ids.push(row.grantId.toLowerCase());
    if (next === null) return ids;
    // Full pages carry the cursor equal to their last grant ID; the final page does not.
    expect(rows).toHaveLength(200);
    expect(next).toBe(rows[199].grantId.toLowerCase());
    cursor = next;
    expect(page).toBeLessThan(10);
  }
}

it.skipIf(!available)("uses the exported route and typed client over HTTP against the real role-scoped SQL", async () => {
  state.user = OWNER;
  const created = await shareHandoff(OWNER, { investigationId: INVESTIGATION, revision: 1, granteeUserId: RECIPIENT });
  expect(created.httpStatus).toBe(201);
  if (created.result.status !== "created") throw new Error("Actual named-argument SQL share failed");
  const grant = created.result.handoff.grantId;
  let pinnedGrant = "";
  let overflowInvs: string[] = [];
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

    // ── >201 direct-INSERT overflow, navigable end to end through the exported route and
    // typed client: seeded exactly the way the supplying pytest fixture seeds its bounds
    // rows — bootstrap-role INSERTs on this isolated socket, nothing external. ──────────
    state.user = OWNER;
    sqlSuper(`insert into public.investigations(id,user_id,current_revision,lifecycle,created_at,updated_at)
      select gen_random_uuid(),${quoted(OWNER)}::uuid,1,'active',now(),now()
        from generate_series(1,${OVERFLOW_COUNT + 1});`);
    sqlSuper(`insert into public.investigation_revisions(investigation_id,user_id,revision,action,lifecycle,manifest,committed_at)
      select id,user_id,1,'create','active',${quoted(OVERFLOW_MANIFEST)}::jsonb,now()
        from public.investigations
        where user_id=${quoted(OWNER)}::uuid and id <> all(${baseList});`);
    sqlSuper(`insert into public.resource_grants(resource_kind,resource_id,resource_revision,grantee_user_id,granted_by)
      select 'investigation',id,1,${quoted(RECIPIENT)}::uuid,${quoted(OWNER)}::uuid
        from public.investigations
        where user_id=${quoted(OWNER)}::uuid and id <> all(${baseList})
        order by id limit ${OVERFLOW_COUNT};`);
    overflowInvs = JSON.parse(sqlSuper(
      `select coalesce(json_agg(id order by id),'[]'::json) from public.investigations
        where user_id=${quoted(OWNER)}::uuid and id <> all(${baseList});`,
    )) as string[];
    const overflowGrants = JSON.parse(sqlSuper(
      `select coalesce(json_agg(g.id order by g.id),'[]'::json) from public.resource_grants g
        where g.granted_by=${quoted(OWNER)}::uuid and g.resource_kind='investigation'
          and g.resource_id = any(array(select jsonb_array_elements_text(${quoted(JSON.stringify(overflowInvs))}::jsonb)::uuid));`,
    )) as string[];
    expect(overflowInvs).toHaveLength(OVERFLOW_COUNT + 1);
    expect(overflowGrants).toHaveLength(OVERFLOW_COUNT);

    // The RPC-created pin navigates among the pre-existing overflow rows on equal terms.
    const pinnedAgain = await shareHandoff(OWNER, { investigationId: INVESTIGATION, revision: 1, granteeUserId: RECIPIENT });
    expect(pinnedAgain.httpStatus).toBe(201);
    if (pinnedAgain.result.status !== "created") throw new Error("overflow-era share failed");
    pinnedGrant = pinnedAgain.result.handoff.grantId;

    const synthetic = new Set(overflowGrants.map((id) => id.toLowerCase()));
    const sentAll = await traverse("sent", OWNER);
    expect(sentAll).toHaveLength(OVERFLOW_COUNT + 1);
    expect(new Set(sentAll).size).toBe(sentAll.length);
    expect(sentAll).toEqual([...sentAll].sort());
    for (const id of overflowGrants) expect(sentAll).toContain(id.toLowerCase());
    expect(sentAll).toContain(pinnedGrant.toLowerCase());
    const sentLaterPage = sentAll.slice(200);
    expect(sentLaterPage.length).toBeGreaterThan(0);

    // The recipient pages the same rows independently and reads one from the LATER page.
    const receivedAll = await traverse("received", RECIPIENT);
    expect(receivedAll).toEqual(sentAll);
    const laterReadId = sentLaterPage.find((id) => synthetic.has(id));
    if (!laterReadId) throw new Error("no synthetic grant on the later page");
    const laterRead = await readHandoff(RECIPIENT, laterReadId);
    expect(laterRead.httpStatus).toBe(200);
    expect(laterRead.result).toMatchObject({ status: "found", handoff: {
      schema: "mm.research_handoff.v1", revision: 1,
      intent: { title: "Overflow handoff", question: "Why later?" },
      continuation: { nextQuestion: "Later page?", nextObservation: "Watch" },
    } });

    // The owner revokes a LATER-page share; the recipient's next read confirms not_found.
    const laterRevokeId = sentLaterPage.find((id) => synthetic.has(id) && id !== laterReadId);
    if (!laterRevokeId) throw new Error("no second synthetic grant on the later page");
    state.user = OWNER;
    expect(await revokeHandoff(OWNER, laterRevokeId)).toMatchObject({ httpStatus: 200, result: { status: "revoked" } });
    state.user = RECIPIENT;
    expect(await readHandoff(RECIPIENT, laterRevokeId)).toMatchObject({ httpStatus: 404, result: { status: "not_found" } });

    // A grant inserted after the first traversal is picked up on explicit refresh — the pages
    // are a keyset, not a frozen snapshot — and the revoked row's absence skips nothing: every
    // remaining ID is still visited exactly once, in ascending order.
    const heldInvestigation = overflowInvs[overflowInvs.length - 1];
    sqlSuper(`insert into public.resource_grants(resource_kind,resource_id,resource_revision,grantee_user_id,granted_by)
      values ('investigation',${quoted(heldInvestigation)}::uuid,1,${quoted(RECIPIENT)}::uuid,${quoted(OWNER)}::uuid);`);
    const refreshed = await traverse("sent", OWNER);
    expect(refreshed).toHaveLength(OVERFLOW_COUNT + 1);
    expect(new Set(refreshed).size).toBe(refreshed.length);
    expect(refreshed).toEqual([...refreshed].sort());
    expect(refreshed).not.toContain(laterRevokeId);
    const fresh = refreshed.filter((id) => !sentAll.includes(id));
    expect(fresh).toHaveLength(1);

    // A malformed or mixed seek is a 400 before any effect — never a page, never a silent
    // fall back to the first page.
    state.user = OWNER;
    const malformed = await fetch(`${origin}/api/research-handoffs?sent_after=zzz`, { headers: { "x-mm-handoff-owner": OWNER } });
    expect(malformed.status).toBe(400);
    const mixed = await fetch(`${origin}/api/research-handoffs?sent_after=${laterReadId}&grant_id=${laterReadId}`, { headers: { "x-mm-handoff-owner": OWNER } });
    expect(mixed.status).toBe(400);

    // Every response of the whole run — first pages, later pages, reads, writes, refusals —
    // stayed private.
    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toBe("Cookie");
    }
  } finally {
    state.user = OWNER;
    await revokeHandoff(OWNER, grant);
    if (pinnedGrant) await revokeHandoff(OWNER, pinnedGrant);
    // Drop every synthetic row so the shared fixture returns to its base state. The fixture
    // cluster is disposable, but the pytest suite after this run expects the base back.
    try {
      if (overflowInvs.length > 0) {
        const invList = `array(select jsonb_array_elements_text(${quoted(JSON.stringify(overflowInvs))}::jsonb)::uuid)`;
        sqlSuper(`delete from public.resource_grants where granted_by=${quoted(OWNER)}::uuid and resource_id = any(${invList});`);
        sqlSuper(`delete from public.investigation_revisions where user_id=${quoted(OWNER)}::uuid and investigation_id = any(${invList});`);
        sqlSuper(`delete from public.investigations where id = any(${invList});`);
      }
    } catch { /* the fixture is disposable; never mask the test's own failure */ }
  }
}, 120000);
