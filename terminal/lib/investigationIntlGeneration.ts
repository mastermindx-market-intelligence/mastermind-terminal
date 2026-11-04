import "server-only";
import {createHash} from "node:crypto";
import {R2_BASE} from "./upstreams";
import {isIntlGenerationIdentity} from "./investigationIntlReference";

export const INTL_GENERATION_BYTE_LIMIT=8*1024*1024;
const DESCRIPTOR_LIMIT=256*1024;
type Options={signal?:AbortSignal;fetcher?:typeof fetch;base?:string};
export type IntlGenerationArtifact={generation:string;fingerprint:string;bytes:number;document:Record<string,unknown>};
export type IntlGenerationDescriptor={schema:"intl.workspace_generation_current.v1";asof:null;state:"ready";generation:string;artifact_name:string;artifact_sha256:string;artifact_bytes:number;current_policies:unknown};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const artifactName=(generation:string,fingerprint:string)=>`intl_generation_${generation.slice("im-workspace-generation:".length)}_${fingerprint}.json`;
async function feed(name:string,limit:number,options:Options):Promise<{bytes:Buffer;document:Record<string,unknown>;sha256:string}|null>{
 if(options.signal?.aborted)return null;
 try{
  const base=new URL(options.base??R2_BASE);
  if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash)return null;
  const response=await (options.fetcher??fetch)(new URL(`/feeds/${name}`,base),{cache:"no-store",redirect:"error",credentials:"omit",headers:{Accept:"application/json"},signal:options.signal});
  if(!response.body)return null;
  if(response.status!==200||response.redirected||response.headers.get("content-type")?.split(";")[0].trim()!=="application/json"){await response.body.cancel();return null;}
  const declared=response.headers.get("content-length");
  if(declared!==null&&(!/^[0-9]+$/.test(declared)||Number(declared)>limit)){await response.body.cancel();return null;}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>limit||options.signal?.aborted){await reader.cancel();return null;}chunks.push(value);
  }}finally{reader.releaseLock();}
  if(options.signal?.aborted)return null;
  const bytes=Buffer.concat(chunks.map(chunk=>Buffer.from(chunk)));
  const document:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  return record(document)?{bytes,document,sha256:digest(bytes)}:null;
 }catch{return null;}
}
/** Sealed bytes only. Native context, field/domain and current permission still
 * require the producer codec and the authenticated Investigation owner. */
export async function readIntlGenerationArtifact(pin:{generation:string;fingerprint:string},options:Options={}):Promise<IntlGenerationArtifact|null>{
 if(!isIntlGenerationIdentity(pin.generation)||!/^[0-9a-f]{64}$/.test(pin.fingerprint))return null;
 const read=await feed(artifactName(pin.generation,pin.fingerprint),INTL_GENERATION_BYTE_LIMIT,options);
 if(!read||read.sha256!==pin.fingerprint||read.document.schema!=="intl.workspace_generation.v1")return null;
 return {generation:pin.generation,fingerprint:pin.fingerprint,bytes:read.bytes.byteLength,document:read.document};
}
/** Mutable current must byte-match its immutable content-addressed descriptor.
 * Every name is constructed locally. No supplied URL, latest-as-pin fallback,
 * credential forwarding or cross-request private cache is involved. */
export async function readCurrentIntlGeneration(options:Options={}):Promise<{descriptor:IntlGenerationDescriptor;descriptorDigest:string;artifact:IntlGenerationArtifact}|null>{
 const current=await feed("intl_generation_current.json",DESCRIPTOR_LIMIT,options);
 if(!current)return null;
 const d=current.document;
 if(Object.keys(d).length!==8||Object.keys(d).some(k=>!["schema","asof","state","generation","artifact_name","artifact_sha256","artifact_bytes","current_policies"].includes(k))
  ||d.schema!=="intl.workspace_generation_current.v1"||d.asof!==null||d.state!=="ready"||!isIntlGenerationIdentity(d.generation)
  ||typeof d.artifact_sha256!=="string"||!/^[0-9a-f]{64}$/.test(d.artifact_sha256)||d.artifact_name!==artifactName(d.generation,d.artifact_sha256)
  ||!Number.isSafeInteger(d.artifact_bytes)||Number(d.artifact_bytes)<1||Number(d.artifact_bytes)>INTL_GENERATION_BYTE_LIMIT||!record(d.current_policies))return null;
 const sidecar=await feed(`intl_generation_descriptor_${current.sha256}.json`,DESCRIPTOR_LIMIT,options);
 if(!sidecar||!sidecar.bytes.equals(current.bytes))return null;
 const artifact=await readIntlGenerationArtifact({generation:d.generation,fingerprint:d.artifact_sha256},options);
 if(!artifact||artifact.bytes!==d.artifact_bytes)return null;
 return {descriptor:d as IntlGenerationDescriptor,descriptorDigest:current.sha256,artifact};
}
