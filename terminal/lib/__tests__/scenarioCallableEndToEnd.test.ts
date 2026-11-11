import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST as resolvePOST } from "@/app/api/investigation-scenarios/route";
import { POST as savePOST } from "@/app/api/investigations/route";
import { SCENARIO_NATIVE_URL } from "@/lib/scenarioNative";
import { scenarioNativePacket } from "./fixtures/scenarioNativePacket";
const state=vi.hoisted(()=>({token:"",user:"",rpc:vi.fn(),getUser:vi.fn(),getSession:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:state.rpc,auth:{getUser:state.getUser,getSession:state.getSession}})}));
vi.mock("@/lib/rateLimit",()=>({rateLimit:()=>({ok:true})}));
let nativeProcess:ChildProcessWithoutNullStreams, directory:string, port:number, id:string, grant:string;
let mode="allow";let loseCaptureResponse=false;const nativeModes:string[]=[];const nativePuts:number[]=[];const originalFetch=globalThis.fetch;
const packet=scenarioNativePacket();
// Explicit cross-repo qualification only; hosted Terminal checks do not assume a Mac checkout.
const nativeCwd=process.env.SCENARIO_NATIVE_TEST_CWD ?? "";
const script=String.raw`
import sys,json,base64,socket,urllib.request
from pathlib import Path
from fastapi import FastAPI
import uvicorn,pytest
from tests.test_options_scenarios import World,token,INV,GRANT,UID,FakeRpcResponse,S
from engine import options_hub_retention as R
packet=json.loads(Path(sys.argv[1]).read_text()); h=World(); patch=pytest.MonkeyPatch(); h.patch(patch)
h.gex_bytes=base64.b64decode(packet['gex_base64']); h.gex_ref=R.reference_for_bytes('SPY','gex',h.gex_bytes)
h.moves_ref=None; h.s3.objects={h.gex_ref.key:h.gex_bytes}; h.capture=lambda **kwargs:packet['capture']
producer=Path(sys.argv[1]).parent/'producer';(producer/'gex').mkdir(parents=True);(producer/'gex'/'SPY.json').write_bytes(h.gex_bytes)
puts=[]
def put_object(Bucket,Key,Body,**kwargs):
    puts.append(Key);h.s3.objects[Key]=bytes(Body)
h.s3.put_object=put_object
from tests.test_options_hub_retention import controlled_decision
case={'value':'allow'}
def rpc(req,timeout):
    body=json.loads(req.data)
    if case['value']=='revoked':return FakeRpcResponse({'status':'not_found'})
    if req.full_url.endswith('read_investigation_handoff_v1'):
        value=h.handoff() if body.get('p_grant_id')==GRANT else {'status':'not_found'}
    else:
        value=h.row() if body.get('p_id')==INV and body.get('p_revision')==4 else {'status':'not_found'}
    return FakeRpcResponse(value)
patch.setattr(S,'_open_rpc',rpc)
app=FastAPI();app.include_router(S.router)
app.state.options_scenario_source_bindings=S.SourceScenarioBindings(s3=h.s3,bucket='b',destination=h.destination_qualifier,resource_access=h.resource_access,source_use_decision=h.source_use_decision,clock=h.clock,producer_out_dir=producer,source_save_decision=h.source_use_decision,retention_decision=controlled_decision())
@app.middleware('http')
async def control(request,call_next):
    case['value']=request.headers.get('x-controlled-native','allow');h.resource_calls=0
    h.source_status='denied' if case['value']=='denied' else 'allowed'
    if case['value']=='initial':h.s3.objects={}
    response=await call_next(request)
    response.headers['x-controlled-put-count']=str(len(puts))
    return response
sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen(32)
print(json.dumps({'port':sock.getsockname()[1],'token':token(),'id':INV,'grant':GRANT,'user':UID}),flush=True)
uvicorn.Server(uvicorn.Config(app,log_level='critical',lifespan='off')).run(sockets=[sock])
`;
describe.skipIf(!nativeCwd)("controlled cross-repo native interface",()=>{
beforeAll(async()=>{
 directory=mkdtempSync(join(tmpdir(),"p052-native-controlled-"));const file=join(directory,"packet.json");writeFileSync(file,JSON.stringify(packet));
 nativeProcess=spawn("python3",["-u","-c",script,file],{cwd:nativeCwd});
 const ready=await new Promise<{port:number;token:string;id:string;grant:string;user:string}>((resolve,reject)=>{
  let data="",errors="";const timer=setTimeout(()=>reject(Error(`controlled native startup deadline: ${errors}`)),10_000);
  nativeProcess.stderr.on("data",chunk=>{errors+=String(chunk);});
  nativeProcess.stdout.on("data",chunk=>{data+=String(chunk);const line=data.split("\n").find(v=>v.startsWith("{"));if(line){clearTimeout(timer);try{resolve(JSON.parse(line));}catch{reject(Error("invalid controlled native startup"));}}});
  nativeProcess.on("exit",code=>{clearTimeout(timer);reject(Error(`controlled native exited ${code}: ${errors}`));});
 });
 ({port,id,grant}=ready);state.token=ready.token;state.user=ready.user;
 state.getSession.mockImplementation(async()=>({data:{session:{access_token:state.token}},error:null}));
 state.getUser.mockImplementation(async(token?:string)=>({data:{user:token===undefined||token===state.token?{id:state.user}:null},error:null}));
 vi.stubGlobal("fetch",async(url:RequestInfo|URL,options?:RequestInit)=>{
  if(String(url)!==SCENARIO_NATIVE_URL)throw Error("unexpected production network target");
  const intent=JSON.parse(String(options?.body));nativeModes.push(intent.mode);
  const response=await originalFetch(`http://127.0.0.1:${port}/api/options/scenario-source/resolve`,{...options,headers:{...options?.headers,"x-controlled-native":mode}});
  nativePuts.push(Number(response.headers.get("x-controlled-put-count")));
  if(loseCaptureResponse&&intent.mode==="capture"){await response.text();loseCaptureResponse=false;throw Error("controlled response lost after retention");}
  return response;
 });
},15_000);
afterAll(async()=>{vi.unstubAllGlobals();if(nativeProcess?.exitCode===null){await new Promise<void>(resolve=>{nativeProcess.once("exit",()=>resolve());nativeProcess.kill("SIGTERM");});}if(directory)rmSync(directory,{recursive:true,force:true});});

it("real private Next route → real HTTP → native auth/canonical/retained-source resolver → exact TS native result",async()=>{
 mode="allow";const request=()=>new Request("https://terminal.test/api/investigation-scenarios",{method:"POST",body:JSON.stringify({investigation_id:id,revision:4,grant_id:grant})});
 const response=await resolvePOST(request());expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("private, no-store");
 const value=await response.json();expect(value.status).toBe("resolved");expect(value.grant_id).toBe(grant);expect(value.capture).toEqual(packet.capture);expect(value.result.version).toBe("exposure-scenario/v1");expect(value.result.inputs).toEqual(packet.capture.inputs);expect(value.gex).toBeUndefined();
 mode="denied";expect((await resolvePOST(request())).status).toBe(403);
 mode="revoked";expect((await resolvePOST(request())).status).toBe(404);
});
it("real prospective save preflight binds full UUID/revision/operation context before the existing CAS RPC and refuses native denial",async()=>{
 const newId="40000000-0000-4000-8000-000000000004",operation="50000000-0000-4000-8000-000000000005";
 const manifest={schema:"investigation_manifest.v2",intent:{title:"Saved exact scenario",question:"What if spot changes?",subjects:[{owner:"terminal.analysis_symbol",kind:"security",object_id:"SPY"}]},layout_refs:[],thesis_refs:[],evidence_refs:[],continuation:{},scenario_capture:packet.capture};
 const command={id:newId,operation_id:operation,expected_revision:0,action:"create",manifest};
 const request=()=>new Request("https://terminal.test/api/investigations",{method:"POST",headers:{"x-mm-scenario-owner":state.user},body:JSON.stringify(command)});
 state.rpc.mockReset().mockImplementation(async(name,args)=>{expect(name).toBe("apply_investigation_revision_v2");expect(args.p_id).toBe(newId);expect(args.p_operation_id).toBe(operation);expect(args.p_expected_revision).toBe(0);expect(args.p_manifest).toEqual(manifest);expect(JSON.stringify(args)).not.toContain("referenceSpot");return {data:{status:"committed",id:newId,revision:1,lifecycle:"active",manifest,committed_at:"2026-10-23T13:00:00Z"},error:null};});
 mode="denied";expect((await savePOST(request())).status).toBe(503);expect(state.rpc).not.toHaveBeenCalled();
 mode="allow";const response=await savePOST(request());expect(response.status).toBe(200);expect((await response.json()).status).toBe("committed");expect(state.rpc).toHaveBeenCalledTimes(1);
});

it("initial capture → original producer → private retain → lost response → read-only same-operation recovery → CAS",async()=>{
 mode="initial";loseCaptureResponse=true;nativeModes.length=0;nativePuts.length=0;
 const newId="60000000-0000-4000-8000-000000000006",operation="70000000-0000-4000-8000-000000000007";
 const manifest={schema:"investigation_manifest.v2",intent:{title:"Capture A",question:"Retain exactly A?",subjects:[{owner:"terminal.analysis_symbol",kind:"security",object_id:"SPY"}]},layout_refs:[],thesis_refs:[],evidence_refs:[],continuation:{},scenario_capture:packet.capture};
 const command={id:newId,operation_id:operation,expected_revision:0,action:"create",manifest};
 const request=(stage:string)=>new Request("https://terminal.test/api/investigations",{method:"POST",headers:{"x-mm-scenario-owner":state.user,"x-mm-scenario-capture":stage},body:JSON.stringify(command)});
 state.rpc.mockReset().mockResolvedValue({data:{status:"committed",id:newId,revision:1,lifecycle:"active",manifest,committed_at:"2026-10-23T14:00:00Z"},error:null});
 const lost=await savePOST(request("initial"));expect(lost.status).toBe(503);expect((await lost.json()).status).toBe("unavailable");expect(state.rpc).not.toHaveBeenCalled();
 expect(nativeModes).toEqual(["capture"]);expect(nativePuts).toEqual([1]);
 mode="allow";const recovered=await savePOST(request("recover"));expect(recovered.status).toBe(200);expect((await recovered.json()).status).toBe("committed");
 expect(nativeModes).toEqual(["capture","qualify"]);expect(nativePuts).toEqual([1,1]);expect(state.rpc).toHaveBeenCalledTimes(1);
 expect(JSON.stringify(state.rpc.mock.calls)).not.toContain("referenceSpot");
});

});
