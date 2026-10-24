import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import fixture from "./fixtures/sec_acquisition.synthetic.json";
import schema from "./fixtures/sec_acquisition.v1.schema.json";
import {parseSecAcquisitionReceipt,type SecAcquisitionBinding} from "../issuerReleaseSecAcquisition";
import golden from "./fixtures/aapl-event-workspace.json";
import {normalizeEventWorkspace} from "../eventWorkspace";

type Raw = Omit<typeof fixture.acquisition_receipt,"redirects"> & {
  redirects:{url:string;status:number;location:string;next_url:string}[];
};
const fresh=():Raw=>structuredClone(fixture.acquisition_receipt);
const binding=(raw:Raw=fresh()):SecAcquisitionBinding=>({filing_key:{...raw.filing_key},source_url:raw.requested_url,source_sha256:raw.source_sha256});
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function utf8():Raw {
  const r=fresh(),bytes=Buffer.from(fixture.decoded_text,"utf8");
  return {...r,decoder:"utf-8",decode_policy:"utf8_strict",entity_sha256:hash(bytes),entity_length:bytes.length,
    content_type:"text/html; charset=utf-8",declared_charset:"utf-8"};
}
function redirected(count=1):Raw {
  const r=fresh();let from=r.requested_url;
  for(let i=0;i<count;i++){
    const location=`release${i}.htm`,next_url=new URL(location,from).href;
    r.redirects.push({url:from,status:302,location,next_url});from=next_url;
  }
  r.final_url=from;return r;
}

describe("selected SEC acquisition receipt — synthetic source contract",()=>{
  it("matches the exact producer schema and decodes its explicitly synthetic Latin-1 vector",()=>{
    expect(fixture.fixture_kind).toBe("SYNTHETIC_NOT_LIVE_ACQUISITION_NOT_A_RIGHTS_GRANT");
    const bytes=Buffer.from(fixture.entity_bytes_hex,"hex"),r=fresh();
    expect(hash(bytes)).toBe(r.entity_sha256);expect(bytes.length).toBe(r.entity_length);
    expect(bytes.toString("latin1")).toBe(fixture.decoded_text);
    expect(hash(Buffer.from(fixture.decoded_text,"utf8"))).toBe(r.source_sha256);
    const parsed=parseSecAcquisitionReceipt(r,binding(r));expect(parsed).toEqual(r);
    expect(Object.keys(parsed!).sort()).toEqual(Object.keys(schema.properties).sort());
  });
  it("accepts a separately encoded UTF-8 vector and preserves its actual recorded clock",()=>{
    const r=utf8();r.acquired_at="2026-02-28T23:59:59.123456Z";
    const parsed=parseSecAcquisitionReceipt(r,binding(r));expect(parsed).toEqual(r);
    expect(parsed).not.toHaveProperty("checked_at");expect(parsed).not.toHaveProperty("allowed");
  });
  it.each([null,undefined,[],"receipt",false])("does not upgrade an absent or untyped record: %s",raw=>{
    expect(parseSecAcquisitionReceipt(raw,binding())).toBeNull();
  });
  it.each(schema.required)("refuses a missing external-contract field: %s",key=>{
    const raw:Record<string,unknown>={...fresh()};delete raw[key];
    expect(parseSecAcquisitionReceipt(raw,binding())).toBeNull();
  });
  it("refuses unknown receipt or filing-key fields",()=>{
    expect(parseSecAcquisitionReceipt({...fresh(),allowed:true},binding())).toBeNull();
    const r=fresh();expect(parseSecAcquisitionReceipt({...r,filing_key:{...r.filing_key,grant:true}},binding())).toBeNull();
  });
  it.each([
    {schema:"earnings_release.sec_acquisition.v2"},{http_status:201},{http_status:"200"},
    {body_representation:"raw_wire"},{redirect_policy:"any_https"},{entity_length:0},
    {entity_length:1.5},{entity_length:Number.MAX_SAFE_INTEGER+1},{source_utf8_length:0},
    {entity_sha256:"A".repeat(64)},{source_sha256:"x".repeat(64)},
    {decode_errors:"replace"},{decoder:"utf-8-sig"},{decode_policy:"header_guess"},
    {content_type:1},{content_type:"x".repeat(1025)},{content_encoding:"x".repeat(257)},
    {declared_charset:"x".repeat(129)},
  ])("refuses malformed declared acquisition metadata %j",change=>{
    expect(parseSecAcquisitionReceipt({...fresh(),...change},binding())).toBeNull();
  });
  it("binds the exact selected filing, requested URL and source digest",()=>{
    const r=fresh(),b=binding(r);
    expect(parseSecAcquisitionReceipt(r,{...b,filing_key:{...b.filing_key,cik:"0000000001"}})).toBeNull();
    expect(parseSecAcquisitionReceipt(r,{...b,filing_key:{...b.filing_key,accession:"0000320193-26-000002"}})).toBeNull();
    expect(parseSecAcquisitionReceipt(r,{...b,source_url:r.requested_url.replace("ex991","other")})).toBeNull();
    expect(parseSecAcquisitionReceipt(r,{...b,source_sha256:"a".repeat(64)})).toBeNull();
  });
  it.each([
    "https://www.sec.gov.evil.example/Archives/edgar/data/320193/000032019326000001/ex991.htm",
    "https://user@www.sec.gov/Archives/edgar/data/320193/000032019326000001/ex991.htm",
    "https://www.sec.gov:443/Archives/edgar/data/320193/000032019326000001/ex991.htm",
    "https://www.sec.gov/Archives/edgar/data/320194/000032019326000001/ex991.htm",
    "https://www.sec.gov/Archives/edgar/data/320193/000032019326000002/ex991.htm",
    "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/%65x991.htm",
    "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/../000032019326000001/ex991.htm",
    "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/index.html",
    "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/ex991.htm?raw=1",
    "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/ex991.htm#body",
    "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/ex991.htm\\evil",
  ])("checks the raw URL even when the binding repeats it: %s",url=>{
    const r=fresh();r.requested_url=url;r.final_url=url;
    expect(parseSecAcquisitionReceipt(r,binding(r))).toBeNull();
  });
  it.each(["index-headers.html","0000320193-26-000001-index-headers.html"])("refuses filing index headers at every URL boundary: %s",filename=>{
    const r=fresh(),url=new URL(filename,r.requested_url).href;
    const requested={...r,requested_url:url,final_url:url};
    expect(parseSecAcquisitionReceipt(requested,binding(requested))).toBeNull();
    expect(parseSecAcquisitionReceipt({...r,final_url:url},binding(r))).toBeNull();
    const target={...r,final_url:url,redirects:[{url:r.requested_url,status:302,location:filename,next_url:url}]};
    expect(parseSecAcquisitionReceipt(target,binding(r))).toBeNull();
  });
  it("does not mistake an accession's submitting agent for the issuer CIK",()=>{
    const r=fresh();r.filing_key.accession="0000950170-26-000001";
    r.requested_url=r.requested_url.replace("000032019326000001","000095017026000001");r.final_url=r.requested_url;
    expect(parseSecAcquisitionReceipt(r,binding(r))).toEqual(r);
  });
  it("validates a full redirect chain, including the allowed five-hop boundary",()=>{
    for(const count of [1,5]){const r=redirected(count);expect(parseSecAcquisitionReceipt(r,binding(r))).toEqual(r);}
    const r=redirected(6);expect(parseSecAcquisitionReceipt(r,binding(r))).toBeNull();
  });
  it.each(["../000032019326000001/release0.htm","%72elease0.htm","release0.htm?x=1","release0.htm#x","release0.htm\r\nX: y","\\release0.htm","https://www.sec.gov:443/Archives/edgar/data/320193/000032019326000001/release0.htm"])("checks raw Location before URL normalization: %s",location=>{
    const r=redirected();r.redirects[0].location=location;
    expect(parseSecAcquisitionReceipt(r,binding(r))).toBeNull();
  });
  it("rejects a discontinuity, incorrect resolved target, or non-redirect response",()=>{
    const r=redirected(2);r.redirects[1].url=r.requested_url;
    expect(parseSecAcquisitionReceipt(r,binding(r))).toBeNull();
    const target=redirected();target.redirects[0].location="different.htm";
    expect(parseSecAcquisitionReceipt(target,binding(target))).toBeNull();
    const status=redirected();status.redirects[0].status=200;
    expect(parseSecAcquisitionReceipt(status,binding(status))).toBeNull();
    const extra=redirected();expect(parseSecAcquisitionReceipt({...extra,redirects:[{...extra.redirects[0],extra:true}]},binding(extra))).toBeNull();
  });
  it("enforces the byte-to-text declaration without claiming to fetch or replay the bytes",()=>{
    const u=utf8();u.entity_sha256="a".repeat(64);expect(parseSecAcquisitionReceipt(u,binding(u))).toBeNull();
    const size=utf8();size.entity_length++;expect(parseSecAcquisitionReceipt(size,binding(size))).toBeNull();
    const latin=fresh();latin.decode_policy="utf8_strict";expect(parseSecAcquisitionReceipt(latin,binding(latin))).toBeNull();
    const same=fresh();same.source_utf8_length=same.entity_length;expect(parseSecAcquisitionReceipt(same,binding(same))).toBeNull();
  });
  it.each(["2026-02-30T00:00:00Z","2025-02-29T00:00:00Z","2026-01-01","2026-01-01T00:00:00+00:00","2026-01-01T24:00:00Z","2026-01-01T00:60:00Z"])("rejects a normalized or non-UTC acquisition clock: %s",clock=>{
    const r=fresh();r.acquired_at=clock;expect(parseSecAcquisitionReceipt(r,binding(r))).toBeNull();
  });
  it("copies and deeply freezes metadata while leaving the original input independent",()=>{
    const r=redirected(),parsed=parseSecAcquisitionReceipt(r,binding(r))!;
    expect(Object.isFrozen(parsed)).toBe(true);expect(Object.isFrozen(parsed.filing_key)).toBe(true);
    expect(Object.isFrozen(parsed.redirects)).toBe(true);expect(Object.isFrozen(parsed.redirects[0])).toBe(true);
    const original=parsed.redirects[0].next_url;r.redirects[0].next_url="https://unqualified.example";r.filing_key.cik="0000000001";
    expect(parsed.redirects[0].next_url).toBe(original);expect(parsed.filing_key.cik).toBe("0000320193");
    expect(Object.isFrozen(r)).toBe(false);expect(Reflect.set(parsed,"allowed",true)).toBe(false);
  });
});

describe("existing retained source normalization",()=>{
  // These are declared-metadata fixtures, not a claim to have acquired Apple's
  // exhibit. The separate producer vector above tests actual byte transforms.
  function declared():Omit<typeof golden,"sources">&{sources:(typeof golden.sources[number]&{acquisition_receipt?:Raw})[]}{
    const r=utf8(),source=golden.sources[0];
    r.filing_key={...source.filing_key!};r.requested_url=source.url!;r.final_url=source.url!;
    r.source_sha256=source.source_sha256!;r.entity_sha256=source.source_sha256!;
    return {...structuredClone(golden),sources:golden.sources.map((s,i)=>i===0?{...s,acquisition_receipt:r}:structuredClone(s))};
  }
  it("preserves legacy absence rather than inventing a receipt",()=>{
    const parsed=normalizeEventWorkspace(golden);expect(parsed).not.toBeNull();
    expect(parsed!.sources[0]).not.toHaveProperty("acquisition_receipt");
  });
  it("retains a valid matching typed receipt as immutable metadata",()=>{
    const input=declared(),parsed=normalizeEventWorkspace(input);expect(parsed).not.toBeNull();
    expect(parsed!.sources[0].acquisition_receipt).toEqual(input.sources[0].acquisition_receipt);
    expect(Object.isFrozen(parsed!.sources[0].acquisition_receipt)).toBe(true);
  });
  it("rejects acquisition after immutable generation emission while allowing older first-observation clocks",()=>{
    const input=declared();
    input.sources[0].acquisition_receipt!.acquired_at="2026-07-31T00:00:00Z";
    expect(normalizeEventWorkspace(input)).toBeNull();
    // A new immutable generation may contain a later real acquisition without
    // changing the existing first-observation/source lifecycle clocks.
    input.generated_at="2026-08-01T00:00:00Z";
    expect(normalizeEventWorkspace(input)).not.toBeNull();
  });
  it("refuses a present invalid record or a receipt attached to the wrong source kind",()=>{
    const input=declared();input.sources[0].acquisition_receipt!.source_sha256="a".repeat(64);
    expect(normalizeEventWorkspace(input)).toBeNull();
    const wrong=declared();wrong.sources[0].kind="transcript";
    expect(normalizeEventWorkspace(wrong)).toBeNull();
    const nullable={...golden,sources:golden.sources.map((s,i)=>i===0?{...s,acquisition_receipt:null}:s)};
    expect(normalizeEventWorkspace(nullable)).toBeNull();
  });
});
