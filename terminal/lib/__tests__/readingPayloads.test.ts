import { describe, expect, it } from "vitest";
import { catalogItems, readingBody, todayPayload } from "@/lib/shared-shell/readingPayloads";
import { loadReadingProgress, saveReadingProgress } from "@/lib/shared-shell/readingProgress";
import { researchReadQuery } from "@/lib/shared-shell/readingRequests";
const selection={docId:"report-one",sourcePdfSha256:"a".repeat(64),extractedTextSha256:"b".repeat(64),extractorVersion:"research_vault.ingest.extract_pdf_text.v1",segmenterVersion:"page-byte-v1"};
const subject="11111111-1111-4111-8111-111111111111";
function reading(){return{schema:"research_vault.browser_read.v1",report_id:selection.docId,selection:{source_pdf_sha256:selection.sourcePdfSha256,extracted_text_sha256:selection.extractedTextSha256,extractor_version:selection.extractorVersion,segmenter_version:selection.segmenterVersion,segment_max_bytes:4000},text_layer_state:"full",segment_count_total:1,segments:[{schema:"research_vault.segment.v1",report_id:selection.docId,source_pdf_sha256:selection.sourcePdfSha256,extracted_text_sha256:selection.extractedTextSha256,extractor_version:selection.extractorVersion,segmenter_version:selection.segmenterVersion,segment_max_bytes:4000,segment_index:0,page_start:1,page_end:1,start_byte:0,end_byte:4,replay_state:"EXACT",segment_text_sha256:"c".repeat(64),text:"body"}]};}
describe("selected source payload integrity",()=>{
 it("projects the complete URL identity onto only the four admitted HTTP query fields",()=>{
  const query=researchReadQuery(selection,0);
  expect(Array.from(query.keys())).toEqual(["source_pdf_sha256","extracted_text_sha256","segment_start","max_segments"]);
  expect(query.get("source_pdf_sha256")).toBe(selection.sourcePdfSha256);expect(query.get("extracted_text_sha256")).toBe(selection.extractedTextSha256);
 });
 it("admits the selected tuple and preserves thin/no-text distinctions",()=>{
  const value=reading();expect(readingBody(value,selection.docId,selection,0)?.segments[0].text).toBe("body");
  expect(readingBody({...value,text_layer_state:"thin"},selection.docId,selection,0)?.textLayer).toBe("thin");
  expect(readingBody({...value,text_layer_state:"none",segment_count_total:0,segments:[]},selection.docId,selection,0)?.textLayer).toBe("none");
 });
 it.each(["report_id","source_pdf_sha256","extracted_text_sha256","extractor_version","segmenter_version","replay_state","segment_index","start_byte","end_byte"])("rejects a segment with wrong %s despite a correct outer selection",field=>{
  const value=reading();(value.segments[0] as Record<string,unknown>)[field]=typeof (value.segments[0] as Record<string,unknown>)[field]==="number"?999:"WRONG";
  expect(readingBody(value,selection.docId,selection,0)).toBeNull();
 });
 it("rejects a changed selected source and wrong-window body",()=>{
  expect(readingBody(reading(),selection.docId,{...selection,sourcePdfSha256:"d".repeat(64)},0)).toBeNull();
  expect(readingBody(reading(),selection.docId,selection,1)).toBeNull();
 });
 it("never converts search unavailability/malformed metadata into an empty catalog",()=>{
  expect(catalogItems({available:false,items:[]})).toBeNull();expect(catalogItems({items:[]})).toEqual([]);
  expect(catalogItems({items:[{id:"../escape",title:"x"}]})).toBeNull();
  expect(catalogItems({items:[{id:"report-one",title:"x",summary_points:[{}]}]})).toBeNull();
 });
});
describe("local reading position",()=>{
 it("stores only the exact tuple and segment start; subject and source revision do not alias",()=>{
  const map=new Map<string,string>(),storage={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);}};
  expect(saveReadingProgress(subject,{selection,segmentStart:2},storage)).toBe(true);
  expect(loadReadingProgress(subject,storage)).toEqual({selection,segmentStart:2});
  expect(loadReadingProgress("22222222-2222-4222-8222-222222222222",storage)).toBeNull();
  expect(Array.from(map.values()).join()).not.toContain('"body"');
  expect(saveReadingProgress(subject,{selection:{...selection,sourcePdfSha256:"c".repeat(64)},segmentStart:0},storage)).toBe(true);
  expect(map.size).toBe(3);expect(loadReadingProgress(subject,storage)?.segmentStart).toBe(0);
 });
 it("a storage failure or malformed retained pointer makes no continuity claim",()=>{
  const storage={getItem:()=>'{"selection":{"docId":"report-one"}}',setItem:()=>{throw Error("quota");}};
  expect(loadReadingProgress(subject,storage)).toBeNull();expect(saveReadingProgress(subject,{selection,segmentStart:0},storage)).toBe(false);
 });
});
it("refuses malformed Today source bodies rather than inventing coverage",()=>{
 expect(todayPayload({schema:"mastermind.macro_command_read.v1",state:"ready",coverage:{available:0,total:0}})).toBeNull();
});
