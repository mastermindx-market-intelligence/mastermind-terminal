import {beforeEach,describe,expect,it,vi} from "vitest";
import produced from "./fixtures/brief-sharing-request-record.json";
const state=vi.hoisted(()=>({users:[] as Array<string|null>,data:null as unknown,calls:[] as Array<{name:string;args:Record<string,string>}>,throws:false}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>{const id=state.users.shift();return {data:{user:id?{id}:null},error:null};}},rpc:async(name:string,args:Record<string,string>)=>{state.calls.push({name,args});if(state.throws)throw Error("inert-private-error");return {data:state.data,error:null};}})}));
import {GET,POST} from "../../app/api/briefs/deliveries/[deliveryId]/sharing-request/route";
import {sharingOriginAllowed} from "../briefDeliverySharingServer";
import {parseSharingRequestCommand,decodeSharingRequestFeed} from "../briefSharingRequests";
import {terminalTokenSelection} from "../briefSharingRequestsServer";
import feed from "./fixtures/brief-sharing-request-feed.json";
const owner="10000000-0000-4000-8000-000000000001",delivery=produced.review.delivery.delivery_id,ref=produced.request_ref;
const origin="https://app.mastermind-x.com",path=origin+`/api/briefs/deliveries/${delivery}/sharing-request`;
const context=()=>({params:Promise.resolve({deliveryId:delivery})});
const issue=()=>({action:"ISSUE",request_ref:ref,team_id:produced.review.audience.team_id,expected_content_sha256:produced.review.delivery.content_sha256});
const post=(body=JSON.stringify(issue()),url=path,originHeader=origin)=>new Request(url,{method:"POST",headers:{Origin:originHeader,"Content-Type":"application/json"},body});
beforeEach(()=>{state.users=[owner,owner];state.data=produced;state.calls=[];state.throws=false;});
describe("same Terminal explicit request owner",()=>{
 it("POST explicitly issues only the supplied original request, not share/grant",async()=>{
  const response=await POST(post(),context());expect(response.status).toBe(200);
  expect(state.calls).toEqual([{name:"issue_brief_sharing_request",args:{p_delivery_id:delivery,p_request_ref:ref,p_team_id:produced.review.audience.team_id,p_expected_content_sha256:produced.review.delivery.content_sha256}}]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
 });
 it("GET reads the addressed persisted request and never mutates",async()=>{
  const response=await GET(new Request(path+`?request_ref=${ref}&revision=1`),context());expect(response.status).toBe(200);
  expect(state.calls).toEqual([{name:"read_brief_sharing_request",args:{p_delivery_id:delivery,p_request_ref:ref,p_revision:"1"}}]);
 });
 it("preserves exact original request on possible-effect/identity change",async()=>{
  state.users=[owner,null];const response=await POST(post(),context());expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ok:false,code:"effect_unknown",request:{delivery_id:delivery,request_ref:ref,revision:1}});expect(state.calls).toHaveLength(1);
 });
 it("signout and mixed bearer cannot originate a cookie request",async()=>{
  state.users=[null];expect((await POST(post(),context())).status).toBe(401);expect(state.calls).toHaveLength(0);
  expect((await GET(new Request(path+`?request_ref=${ref}&revision=1`,{headers:{authorization:"Bearer inert"}}),context())).status).toBe(400);
 });
 it("rejects duplicate or injected identity/recipient/revision before RPC",async()=>{
  const value=JSON.stringify(issue());expect(parseSharingRequestCommand(value.replace('"action":"ISSUE"','"action":"ISSUE","action":"ISSUE"'))).toBeNull();
  expect((await POST(post(JSON.stringify({...issue(),principal_scope:"x"})),context())).status).toBe(400);
  expect((await GET(new Request(path+`?request_ref=${ref}&revision=1&team_id=${produced.review.audience.team_id}`),context())).status).toBe(400);expect(state.calls).toHaveLength(0);
 });
 it("uses the fixed public origin through reverse-proxy internal URLs, with foreign-origin refusal",async()=>{
  vi.stubEnv("NODE_ENV","production");
  try{
   const internal=`http://localhost:3000/api/briefs/deliveries/${delivery}/sharing-request`;
   expect(sharingOriginAllowed(post(undefined,internal))).toBe(true);
   expect((await POST(post(undefined,internal),context())).status).toBe(200);
   expect(sharingOriginAllowed(post(undefined,internal,"https://evil.example"))).toBe(false);
   expect(sharingOriginAllowed(post(undefined,internal,"http://localhost:3000"))).toBe(false);
  }finally{vi.unstubAllEnvs();}
 });
 it("decodes the actual SQL-generated feed against matching actual Terminal session selection",()=>{
  const token=['e30',Buffer.from(JSON.stringify({sub:owner,session_id:"70000000-0000-4000-8000-000000000001",iss:"https://fsldfzlxyavsuwqbceod.supabase.co/auth/v1",aud:"authenticated",exp:2000000000})).toString('base64url'),'inert'].join('.');
  const selected=terminalTokenSelection(token,1)!;expect(selected).not.toBeNull();expect(decodeSharingRequestFeed(feed,selected)).toEqual(feed);
 });
});
