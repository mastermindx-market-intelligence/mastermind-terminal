import {NextResponse} from "next/server";
import {billingAuthResult} from "@/app/api/billing/gateway";
import {investigationApiUnavailable} from "@/lib/investigationApiAdmission";
import {isIntlGenerationIdentity} from "@/lib/investigationIntlReference";
import {ISSUE_DESK_API_BASE} from "@/lib/upstreams";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const REQUEST_LIMIT=16*1024,REPLY_LIMIT=256*1024;
const headers={"Cache-Control":"private, no-store","Vary":"Cookie, Authorization","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, noarchive"};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v:unknown,max=256):v is string=>typeof v==="string"&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const hash=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{64}$/.test(v);
const reply=(body:unknown,status=200,extra:Record<string,string>={})=>NextResponse.json(body,{status,headers:{...headers,...extra}});
class BodyLimit extends Error{}
// Same bounded strict-JSON grammar as the existing native Scenario transport.
function jsonBytes(bytes: Uint8Array): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let at = 0;
  const ws = () => { while (/[\x20\x09\x0a\x0d]/.test(text[at] ?? "!")) at++; };
  const str = (): string => {
    const start = at++;
    while (at < text.length) {
      if (text[at++] === '"') return JSON.parse(text.slice(start, at));
      if (text[at-1] === "\\") at++;
    }
    throw Error("invalid_json");
  };
  const value = (depth = 0): void => {
    if (depth > 100) throw Error("invalid_json");
    ws();
    if (text[at] === '"') { str(); return; }
    if (text[at] === "{") {
      at++; ws(); const keys = new Set<string>();
      if (text[at] !== "}") while (true) {
        ws(); if (text[at] !== '"') throw Error("invalid_json");
        const key = str(); if (keys.has(key)) throw Error("duplicate_json_key"); keys.add(key);
        ws(); if (text[at++] !== ":") throw Error("invalid_json");
        value(depth+1); ws(); if (text[at] === "}") break;
        if (text[at++] !== ",") throw Error("invalid_json");
      }
      at++; return;
    }
    if (text[at] === "[") {
      at++; ws(); if (text[at] !== "]") while (true) {
        value(depth+1); ws(); if (text[at] === "]") break;
        if (text[at++] !== ",") throw Error("invalid_json");
      }
      at++; return;
    }
    const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
    if (!match || (!/^(null|true|false)$/.test(match[0]) && !Number.isFinite(Number(match[0])))) throw Error("invalid_json");
    at += match[0].length;
  };
  value(); ws(); if (at !== text.length) throw Error("invalid_json");
  return JSON.parse(text);
}
/** Bound actual streamed bytes, including chunked bodies with no Content-Length. */
async function readJson(message:Request|Response,limit:number):Promise<unknown>{
 const length=message.headers.get("content-length");
 if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>limit)){await message.body?.cancel();throw new BodyLimit();}
 if(!message.body)throw Error("missing_body");
 const reader=message.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new BodyLimit();}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return jsonBytes(bytes);
}
/** Only primitive transport grammar. The existing Macro engine owns method,
 * instrument, period/source qualification and all numerical calculations. */
function settingsShape(s:unknown):boolean{
 if(!exact(s,["economy_a","economy_b","lens","definition","method_version","period","instrument_a_ref","instrument_b_ref","revision_policy"]))return false;
 if(!text(s.economy_a,2)||!/^[A-Z]{2}$/.test(s.economy_a)||!text(s.economy_b,2)||!/^[A-Z]{2}$/.test(s.economy_b)
  ||s.lens!=="nominal_policy_point_gap"||s.definition!=="absolute_gap_change_bp"||!text(s.method_version)
  ||!["latest_vintage","original_known"].includes(String(s.revision_policy))
  ||(s.instrument_a_ref!==null&&!text(s.instrument_a_ref))||(s.instrument_b_ref!==null&&!text(s.instrument_b_ref)))return false;
 const p=s.period;
 return exact(p,["mode","key"])&&p.mode==="owner_horizon"&&text(p.key,32)
  ||exact(p,["mode","start","end"])&&p.mode==="fixed_dates"&&text(p.start,32)&&text(p.end,32);
}
function validReply(raw:unknown,request:Record<string,unknown>):boolean{
 if(!exact(raw,["schema","state","source_generation","artifact_sha256","mapping_identity","qualification_identity","result"])
  ||raw.schema!=="intl.policy_preview.v1"||!["qualified","unavailable","invalid"].includes(String(raw.state))
  ||raw.source_generation!==request.generation||raw.artifact_sha256!==request.fingerprint||!record(raw.result)||raw.result.state!==raw.state)return false;
 for(const key of ["mapping_identity","qualification_identity"])if(raw[key]!==null&&!text(raw[key]))return false;
 return raw.state!=="qualified"||(text(raw.mapping_identity)&&text(raw.qualification_identity));
}
/** Read-only proxy under the incumbent admission/auth owners. It never saves,
 * allocates identities, retries, follows a caller URL or forwards cookie headers. */
export async function POST(request:Request){
 const closed=investigationApiUnavailable();if(closed){for(const [k,v] of Object.entries(headers))closed.headers.set(k,v);return closed;}
 const auth=await billingAuthResult();
 if(auth.status!=="ok")return reply({status:auth.status==="denied"?"unauthenticated":"unavailable"},auth.status==="denied"?401:503);
 const url=new URL(request.url);if(url.search||url.hash)return reply({status:"invalid_payload"},400);
 let upstream:URL;
 try{const base=new URL(ISSUE_DESK_API_BASE);if(base.origin!=="https://www.mastermind-x.com"||base.pathname!=="/"||base.username||base.password||base.search||base.hash)throw Error("invalid_base");upstream=new URL("/api/macro/policy-preview",base);}
 catch{return reply({status:"unavailable"},503);}
 let body:unknown;
 try{body=await readJson(request,REQUEST_LIMIT);}catch(error){return reply({status:"invalid_payload"},error instanceof BodyLimit?413:400);}
 if(!exact(body,["generation","fingerprint","settings"])||!isIntlGenerationIdentity(body.generation)||!hash(body.fingerprint)||!settingsShape(body.settings))return reply({status:"invalid_payload"},400);
 if(request.signal.aborted)return reply({status:"unavailable"},503);
 try{
  const response=await fetch(upstream,{method:"POST",headers:{"Authorization":`Bearer ${auth.token}`,"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(body),cache:"no-store",credentials:"omit",redirect:"error",signal:request.signal});
  if(response.redirected||response.headers.get("content-type")?.split(";")[0].trim()!=="application/json"){await response.body?.cancel();return reply({status:"unavailable"},502);}
  let raw:unknown;try{raw=await readJson(response,REPLY_LIMIT);}catch{return reply({status:"unavailable"},502);}
  if(response.status===200)return validReply(raw,body)?reply(raw):reply({status:"unavailable"},502);
  if(!record(raw)||![400,401,403,413,422,429,502,503].includes(response.status))return reply({status:"unavailable"},502);
  // Keep denial/outage status; do not relay provider details, cookies or tokens.
  const challenge=response.status===401?response.headers.get("www-authenticate"):null;
  return reply({status:response.status===401?"unauthenticated":"unavailable"},response.status,challenge?{"WWW-Authenticate":challenge}:{});
 }catch{return reply({status:"unavailable"},503);}
}
