/** Native Vitest integration tests. The transport is the repository's existing fixture DB. */
import { beforeEach, describe, expect, it, vi } from "vitest";
const H = vi.hoisted(() => ({ key: "saved-view-v2", user: null as {id:string} | null }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("@/lib/supabase/server", async () => {
  const { createFixtureDb } = await import("@/lib/watchlistsFixtureDb");
  return { createClient: vi.fn(async () => ({ ...createFixtureDb(H.key), auth: { getUser: async () => ({ data: { user: H.user } }) } })) };
});
import { GET, PUT } from "@/app/api/thesis-saved-views/route";
import { resetFixtureStores, fixtureUserId } from "@/lib/watchlistsFixtureDb";
import { SAVED_VIEW_CONTRACT } from "@/lib/savedViewContract";
import { SavedViewClient } from "@/lib/savedViewClient";

const ID = "22222222-2222-4222-8222-222222222222";
const definition = { version: 1, kind: "heatmap_fixed", securityOwner: "data_os.security_master",
  securityKeys: ["issuer:MU", "issuer:WDC"], universe: { owner: "theme_graph", key: "illustrative.memory" }, membershipVersion: "fixture-v1" };
const body = () => ({ action: "create", contract: SAVED_VIEW_CONTRACT, id: ID, name: "Memory focus", definition });
const put = (value: unknown) => PUT(new Request("https://fixture.invalid/api/thesis-saved-views", { method: "PUT", body: JSON.stringify(value), headers: { "Content-Type": "application/json" } }));
const get = (query = "") => GET(new Request("https://fixture.invalid/api/thesis-saved-views" + query));
const transport: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const request = new Request(new URL(url, "https://fixture.invalid"), init);
  return request.method === "PUT" ? PUT(request) : GET(request);
};
function handles() { const store = new Map<string, string>(); return {
  getItem: (key:string) => store.get(key) ?? null,
  setItem: (key:string, value:string) => { store.set(key,value); },
  removeItem: (key:string) => { store.delete(key); },
}; }
beforeEach(() => { resetFixtureStores(); H.user = { id: fixtureUserId(H.key) }; delete process.env.TERMINAL_E2E_FIXTURE; vi.clearAllMocks(); });

describe("existing saved-view owner v2", () => {
  it("round-trips the fixed group without leaking it into the thesis listing", async () => {
    const created = await put(body()); expect(created.status).toBe(201);
    const payload = await created.json(); expect(payload.view.definition).toEqual(definition);
    expect(payload.receipt.requestId).toBe(ID);
    expect((await (await get()).json()).views).toEqual([]);
    const exact = await (await get("?id=" + ID)).json(); expect(exact.view.definition).toEqual(definition);
  });
  it("preserves a live condition and explicit on-open policies", async () => {
    const live = { version:1,kind:"heatmap_live",universe:definition.universe,membershipPolicy:"current_on_open",sessionPolicy:"latest_eligible_close",metric:{id:"price_return_pct",window:"1D"},condition:{operator:"gt",value:2} };
    const response = await put({...body(),definition:live});expect(response.status).toBe(201);expect((await response.json()).view.definition).toEqual(live);
  });
  it("rejects the old mixed-envelope field-loss case", async () => {
    const response = await put({action:"create",name:"Lossy",filter:{lifecycle:"active",securityKeys:["MU"]}});
    expect(response.status).toBe(400);expect((await (await get()).json()).views).toEqual([]);
  });
  it.each([null,42,false,{},[]])("rejects malformed supplied id %j", async id => {
    const response = await put({...body(),id});expect(response.status).toBe(400);expect((await response.json()).error).toBe("invalid_id");
  });
  it("replays the exact operation but refuses changed meaning", async () => {
    expect((await put(body())).status).toBe(201);
    const replay = await put(body());expect(replay.status).toBe(200);expect((await replay.json()).replayed).toBe(true);
    const conflict = await put({...body(),name:"Different"});expect(conflict.status).toBe(409);expect((await conflict.json()).error).toBe("request_conflict");
  });
  it("keeps the immutable original receipt through rename and deletion", async () => {
    const created = await (await put(body())).json();
    expect((await put({action:"rename",contract:SAVED_VIEW_CONTRACT,id:ID,name:"Renamed"})).status).toBe(200);
    const renamed = await (await get("?id="+ID)).json();expect(renamed.view.name).toBe("Renamed");expect(renamed.receipt.fingerprint).toBe(created.receipt.fingerprint);
    expect((await put({action:"delete",contract:SAVED_VIEW_CONTRACT,id:ID})).status).toBe(200);
    const deleted = await (await get("?id="+ID)).json();expect(deleted.state).toBe("deleted");expect(deleted.view).toBeNull();expect((await put(body())).status).toBe(410);
  });
  it("retains legacy thesis create/list/rename/delete", async () => {
    const legacy = await put({action:"create",id:ID,name:"Old",filter:{lifecycle:"active"}});expect(legacy.status).toBe(201);
    expect((await put({action:"rename",id:ID,name:"New"})).status).toBe(200);
    const listed = await (await get()).json();expect(listed.views[0].filter).toEqual({lifecycle:"active"});
    expect((await put({action:"delete",id:ID})).status).toBe(200);expect((await (await get()).json()).views).toEqual([]);
  });
  it("isolates user reads and refuses unauthenticated mutations", async () => {
    await put(body());H.user={id:"other-account"};expect((await get("?id="+ID)).status).toBe(404);
    H.user=null;expect((await get()).status).toBe(401);expect((await put(body())).status).toBe(401);
  });
  it("returns no-store responses for success and failure", async () => {
    expect((await put(body())).headers.get("cache-control")).toContain("no-store");
    expect((await get("?id=bad")).headers.get("cache-control")).toContain("no-store");
  });
});

describe("save client and existing route together", () => {
  it("invokes transport without binding the controller as native fetch's receiver", async () => {
    const network: typeof fetch = function(this: unknown, input, init) {
      expect(this).toBeUndefined();
      return transport(input, init);
    };
    const client = new SavedViewClient(H.user!.id, handles(), network, () => ID);
    expect((await client.load()).listStatus).toBe("ready");
    expect((await client.save("Memory focus", definition)).phase).toBe("confirmed");
  });
  it("confirms only the exact typed payload", async () => {
    const client = new SavedViewClient(H.user!.id,handles(),transport,()=>ID);
    const result = await client.save("Memory focus",definition);expect(result.phase).toBe("confirmed");expect(result.view?.definition).toEqual(definition);
  });
  it("recovers a committed save whose response was lost without another PUT", async () => {
    const store=handles();const methods:string[]=[];let lose=true;
    const network:typeof fetch=async(input,init)=>{methods.push(init?.method??"GET");const response=await transport(input,init);if(lose){lose=false;throw new Error("fixture reply lost after commit");}return response;};
    const first=new SavedViewClient(H.user!.id,store,network,()=>ID);expect((await first.save("Memory focus",definition)).phase).toBe("unknown");first.dispose();
    const reopened=new SavedViewClient(H.user!.id,store,network,()=>ID);expect((await reopened.check()).phase).toBe("confirmed");expect(methods).toEqual(["PUT","GET"]);
  });
  it("does not clear an uncertain operation on a successful response without a receipt", async () => {
    const client=new SavedViewClient(H.user!.id,handles(),async()=>Response.json({}),()=>ID);
    const result=await client.save("Memory focus",definition);expect(result.phase).toBe("unknown");expect(result.pending?.requestId).toBe(ID);expect(client.clearResolved()).toBe(false);
  });
});
