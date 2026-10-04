import {beforeEach,describe,expect,it,vi} from "vitest";
const {getUser,read,version}=vi.hoisted(()=>({getUser:vi.fn(),read:vi.fn(),version:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser}})}));
vi.mock("@/lib/investigations",async()=>({...await vi.importActual<typeof import("@/lib/investigations")>("@/lib/investigations"),readInvestigation:read}));
vi.mock("@/lib/theses",()=>({readThesisVersion:version}));
import {GET} from "@/app/api/investigations/theses/route";
const id="10000000-0000-4000-8000-000000000001",tid="20000000-0000-4000-8000-000000000001",vid="30000000-0000-4000-8000-000000000001";
const ref={thesis_id:tid,version_id:vid,role:"alternative"};
const manifest={schema:"investigation_manifest.v2",intent:{title:"Research",question:"Why?",subjects:[]},layout_refs:[],thesis_refs:[ref],evidence_refs:[],continuation:{}};
const request=(suffix="")=>new Request(`https://terminal.test/api/investigations/theses?id=${id}&revision=1${suffix}`);
beforeEach(()=>{vi.clearAllMocks();getUser.mockResolvedValue({data:{user:{id:"owner"}},error:null});read.mockResolvedValue({status:"found",id,revision:1,manifest});version.mockResolvedValue({ok:true,version:{id:vid,thesisId:tid,version:1}});});
describe("exact saved canonical Thesis references",()=>{
 it("reads only server-owned reference tuples at the requested revision",async()=>{
  const response=await GET(request());expect(response.status).toBe(200);expect(await response.json()).toEqual({status:"resolved",id,revision:1,items:[{ref,status:"available",version:{id:vid,thesisId:tid,version:1}}]});
  expect(read.mock.calls[0].slice(1)).toEqual([id,1]);expect(version.mock.calls[0].slice(1)).toEqual(["owner",tid,vid]);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("vary")).toBe("Cookie");
 });
 it("does not resolve any tuple for anonymous or foreign records",async()=>{
  getUser.mockResolvedValue({data:{user:null},error:null});expect((await GET(request())).status).toBe(401);expect(read).not.toHaveBeenCalled();getUser.mockResolvedValue({data:{user:{id:"other"}},error:null});read.mockResolvedValue({status:"not_found"});expect((await GET(request())).status).toBe(404);expect(version).not.toHaveBeenCalled();
 });
 it("preserves inaccessible versions explicitly without current-head substitution",async()=>{
  for(const status of ["not_found","unavailable"]){version.mockResolvedValue({ok:false,status});expect(await (await GET(request())).json()).toMatchObject({items:[{ref,status:"unavailable"}]});}
 });
 it("rejects duplicate selectors and reference overrides before any read",async()=>{
  for(const suffix of ["&revision=1","&thesis_id="+tid,"&version_id="+vid,"&user_id=other"]){expect((await GET(request(suffix))).status).toBe(400);}expect(read).not.toHaveBeenCalled();
 });
 it("allows a valid empty reference list without inventing any Thesis",async()=>{
  read.mockResolvedValue({status:"found",id,revision:1,manifest:{...manifest,thesis_refs:[]}});expect(await (await GET(request())).json()).toMatchObject({status:"resolved",items:[]});expect(version).not.toHaveBeenCalled();
 });
});
