/** Synthetic specimens shared by the incumbent reader unit and browser journeys.
 * No live research, entitlement, market observation or production receipt. */
import type { ReadingSelection } from "../../shared-shell/readingContracts";

export const researchSelection:ReadingSelection={docId:"report-one",sourcePdfSha256:"a".repeat(64),extractedTextSha256:"b".repeat(64),extractorVersion:"research_vault.ingest.extract_pdf_text.v1",segmenterVersion:"page-byte-v1"};
export function researchBody(text="PRIVATE SELECTED SOURCE",start=0,total=3,docId=researchSelection.docId){return{
 schema:"research_vault.browser_read.v1",report_id:docId,selection:{source_pdf_sha256:researchSelection.sourcePdfSha256,extracted_text_sha256:researchSelection.extractedTextSha256,extractor_version:researchSelection.extractorVersion,segmenter_version:researchSelection.segmenterVersion,segment_max_bytes:4000},
 source:{catalog_generated_at:"2026-10-20T10:00:00Z",catalog_health:{}},text_layer_state:"full",segment_count_total:total,
 segments:[{schema:"research_vault.segment.v1",report_id:docId,source_pdf_sha256:researchSelection.sourcePdfSha256,extracted_text_sha256:researchSelection.extractedTextSha256,extractor_version:researchSelection.extractorVersion,segmenter_version:researchSelection.segmenterVersion,segment_max_bytes:4000,segment_index:start,page_start:1,page_end:1,start_byte:0,end_byte:new TextEncoder().encode(text).length,segment_text_sha256:"c".repeat(64),replay_state:"EXACT",text}],
};}

export function researchCatalogFixture(){return {items:[{id:"report-one",title:"First source report",institution:"Source desk",published_at:"2026-10-19"},{id:"report-two",title:"Second source report"}],preview:false};}
export function researchFilterFixture(){return Array.from({length:10},(_,index)=>({id:`report-${index}`,title:`Report ${index}`,institution:"Source desk",tags:["Macro"],published_at:"2026-10-19"}));}
export const researchOutlineFixture=[{segment_index:0,page_start:1,page_end:1},{segment_index:1,page_start:2,page_end:2},{segment_index:2,page_start:3,page_end:3}];
