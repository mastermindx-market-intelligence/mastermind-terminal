/** Typed evidence from the existing acquisition owner. Parsing this record is
 * not a fetch, a replay of exhibit bytes, or a source-use permission decision. */
type FilingKey = Readonly<{cik:string;accession:string}>;
type Redirect = Readonly<{url:string;status:301|302|303|307|308;location:string;next_url:string}>;
export type SecAcquisitionBinding = {
  filing_key:FilingKey;source_url:string;source_sha256:string;
};
export type SecAcquisitionReceipt = Readonly<{
  schema:"earnings_release.sec_acquisition.v1";filing_key:FilingKey;
  requested_url:string;final_url:string;redirect_policy:"sec_https_same_filing_max5.v1";
  redirects:readonly Redirect[];http_status:200;
  body_representation:"requests.content_after_content_decoding";
  content_type:string|null;content_encoding:string|null;declared_charset:string|null;
  entity_sha256:string;entity_length:number;decoder:"utf-8"|"latin-1";
  decode_errors:"strict";decode_policy:"utf8_strict"|"utf8_strict_then_latin1_strict";
  source_sha256:string;source_utf8_length:number;acquired_at:string;
}>;
const KEYS = ["schema","filing_key","requested_url","final_url","redirect_policy","redirects",
  "http_status","body_representation","content_type","content_encoding","declared_charset",
  "entity_sha256","entity_length","decoder","decode_errors","decode_policy","source_sha256",
  "source_utf8_length","acquired_at"];
const object = (v:unknown):Record<string,unknown>|null => v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const exact = (v:Record<string,unknown>,keys:readonly string[]) => Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));
const digest = (v:unknown):v is string => typeof v==="string"&&/^[0-9a-f]{64}$/.test(v);
const length = (v:unknown):v is number => typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
function filing(raw:unknown):FilingKey|null {
  const v=object(raw);
  if(!v||!exact(v,["cik","accession"])||typeof v.cik!=="string"||!/^\d{10}$/.test(v.cik)||Number(v.cik)===0
    ||typeof v.accession!=="string"||!/^\d{10}-\d{2}-\d{6}$/.test(v.accession))return null;
  return Object.freeze({cik:v.cik,accession:v.accession});
}
function documentUrl(raw:unknown,key:FilingKey):raw is string {
  if(typeof raw!=="string"||raw.length>8192)return false;
  // Check the raw URL before URL() can erase a default port, escape or dot path.
  const match=/^https:\/\/(?:www\.)?sec\.gov\/Archives\/edgar\/data\/([1-9][0-9]*)\/([0-9]{18})\/([A-Za-z0-9][A-Za-z0-9._-]*\.(?:htm|html|txt))$/.exec(raw);
  return !!match&&match[1]===String(Number(key.cik))&&match[2]===key.accession.replaceAll("-","")
    &&!/(?:^index(?:-headers)?\.|-index(?:-headers)?\.(?:htm|html|txt)$)/i.test(match[3]);
}
function locationTarget(raw:unknown,from:string,key:FilingKey):string|null {
  if(typeof raw!=="string"||!raw||raw.length>8192||/[\u0000-\u0020\u007f\\%?#]/.test(raw)
    ||raw.split("/").some(part=>part==="."||part===".."))return null;
  if(raw.startsWith("//")&&!documentUrl("https:"+raw,key))return null;
  if(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)&&!documentUrl(raw,key))return null;
  try {const target=new URL(raw,from).href;return documentUrl(target,key)?target:null;} catch {return null;}
}
function timestamp(raw:unknown):raw is string {
  if(typeof raw!=="string"||raw.length>64)return false;
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(raw);
  if(!m||Number(m[1])===0||!Number.isFinite(Date.parse(raw)))return false;
  const date=new Date(0);date.setUTCFullYear(Number(m[1]),Number(m[2])-1,Number(m[3]));
  date.setUTCHours(Number(m[4]),Number(m[5]),Number(m[6]),0);
  return date.getUTCFullYear()===Number(m[1])&&date.getUTCMonth()===Number(m[2])-1&&date.getUTCDate()===Number(m[3])
    &&date.getUTCHours()===Number(m[4])&&date.getUTCMinutes()===Number(m[5])&&date.getUTCSeconds()===Number(m[6]);
}
function header(raw:unknown,max:number):string|null|undefined {
  return raw===null?null:typeof raw==="string"&&raw.length<=max?raw:undefined;
}

/** Validate declared provenance and its exact selected-source binding. The
 * acquisition owner must separately qualify how the record was produced. */
export function parseSecAcquisitionReceipt(raw:unknown,binding:SecAcquisitionBinding):SecAcquisitionReceipt|null {
  const v=object(raw),expected=filing(binding.filing_key);
  if(!v||!exact(v,KEYS)||!expected||!digest(binding.source_sha256))return null;
  const key=filing(v.filing_key);
  if(!key||key.cik!==expected.cik||key.accession!==expected.accession
    ||!documentUrl(v.requested_url,key)||v.requested_url!==binding.source_url||!documentUrl(v.final_url,key))return null;
  if(v.schema!=="earnings_release.sec_acquisition.v1"||v.redirect_policy!=="sec_https_same_filing_max5.v1"
    ||v.http_status!==200||v.body_representation!=="requests.content_after_content_decoding"
    ||v.decode_errors!=="strict"||!Array.isArray(v.redirects)||v.redirects.length>5)return null;
  const entityHash=v.entity_sha256,sourceHash=v.source_sha256,entityLength=v.entity_length,sourceLength=v.source_utf8_length;
  if(!digest(entityHash)||!digest(sourceHash)||sourceHash!==binding.source_sha256||!length(entityLength)||!length(sourceLength))return null;
  if(v.decoder!=="utf-8"&&v.decoder!=="latin-1")return null;
  if(v.decode_policy!=="utf8_strict"&&v.decode_policy!=="utf8_strict_then_latin1_strict")return null;
  if(v.decoder==="utf-8"&&(entityHash!==sourceHash||entityLength!==sourceLength))return null;
  if(v.decoder==="latin-1"&&(v.decode_policy!=="utf8_strict_then_latin1_strict"||sourceLength<=entityLength||sourceLength>entityLength*2))return null;
  const contentType=header(v.content_type,1024),contentEncoding=header(v.content_encoding,256),charset=header(v.declared_charset,128);
  if(contentType===undefined||contentEncoding===undefined||charset===undefined||!timestamp(v.acquired_at))return null;
  let next=v.requested_url;
  const redirects:Redirect[]=[];
  for(const rawHop of v.redirects){
    const hop=object(rawHop);
    if(!hop||!exact(hop,["url","status","location","next_url"])||hop.url!==next||!documentUrl(hop.url,key)
      ||!documentUrl(hop.next_url,key)||typeof hop.location!=="string"
      ||![301,302,303,307,308].includes(hop.status as number)||locationTarget(hop.location,hop.url,key)!==hop.next_url)return null;
    redirects.push(Object.freeze({url:hop.url,status:hop.status as Redirect["status"],location:hop.location,next_url:hop.next_url}));
    next=hop.next_url;
  }
  if(next!==v.final_url)return null;
  return Object.freeze({schema:v.schema,filing_key:key,requested_url:v.requested_url,final_url:v.final_url,
    redirect_policy:v.redirect_policy,redirects:Object.freeze(redirects),http_status:v.http_status,body_representation:v.body_representation,
    content_type:contentType,content_encoding:contentEncoding,declared_charset:charset,entity_sha256:entityHash,entity_length:entityLength,
    decoder:v.decoder,decode_errors:v.decode_errors,decode_policy:v.decode_policy,source_sha256:sourceHash,source_utf8_length:sourceLength,acquired_at:v.acquired_at});
}
