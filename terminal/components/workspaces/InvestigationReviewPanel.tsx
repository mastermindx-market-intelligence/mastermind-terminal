"use client";

import { useState } from "react";
import { type Assessment, type FireReceipt, type ReviewRow } from "@/lib/investigationReview";
import styles from "./InvestigationWorkspace.module.css";

type Revisions = { revision: number; committed_at: string | null; assessment: Assessment | null }[];
type Props = {
 review: { rows: ReviewRow[]; fired: FireReceipt | null; revisions: Revisions };
 receipts: readonly FireReceipt[] | null;
 current: { revision: number; current_revision: number };
 history?: Revisions;
 lang: "en" | "zh"; disabled: boolean;
 onAssess(assessment: Assessment, fire_event_id: string | null, note: string): Promise<void>;
 onOpenRevision(revision: number): void;
};
const C={
 en:{panel:"REVIEW",receipt:"Receipt",fired:"FIRED",condition:"CONDITION",observed:"OBSERVED",source:"SOURCE · VINTAGE",delivery:"DELIVERY",receiptId:"RECEIPT ID",notDelivered:"not yet delivered",queueUnavailable:"delivery queue not readable now",queueAbsent:"no delivery record found",noFiring:"No firing recorded yet.",deliveryUnavailable:"Delivery state not available here.",corrects:"corrects",evidence:"Evidence in revision",changed:"CHANGED",still:"STILL SUPPORTED",unavailable:"UNAVAILABLE",
  assessment:"Assessment",confirmed:"Confirmed",contradicted:"Contradicted",inconclusive:"Inconclusive",note:"Note (optional)",save:"Save as revision",discard:"Discard",assessRequired:"Choose confirmed, contradicted or inconclusive before saving.",saveFailed:"The assessment was not saved. Your words are retained; try again.",superseded:"This is not the latest revision. Open the latest revision to record an assessment.",revisions:"Revisions",none:"—",noRows:"No Options evidence is referenced by this revision.",exposureType:"Exposure chart read",originType:"Sector origin",rotationType:"Rotation measurement",otherType:"Saved reference"},
 zh:{panel:"复盘",receipt:"回执",fired:"触发时间",condition:"条件",observed:"观测值",source:"来源 · 数据版次",delivery:"送达",receiptId:"回执编号",notDelivered:"尚未送达",queueUnavailable:"送达队列当前无法读取",queueAbsent:"未找到送达记录",noFiring:"尚无触发记录。",deliveryUnavailable:"此处无法获得送达状态。",corrects:"修正",evidence:"证据（修订",changed:"已变化",still:"仍然成立",unavailable:"不可用",
  assessment:"结论",confirmed:"已证实",contradicted:"已证伪",inconclusive:"尚无定论",note:"备注（可选）",save:"保存为修订",discard:"放弃",assessRequired:"请先选择已证实、已证伪或尚无定论，再保存。",saveFailed:"结论未能保存。你的备注仍保留，请重试。",superseded:"这不是最新修订。请打开最新修订后再记录结论。",revisions:"修订记录",none:"—",noRows:"此修订未引用任何期权证据。",exposureType:"敞口图读数",originType:"板块来源",rotationType:"轮动测量",otherType:"已保存引用"},
} as const;
const ASSESSMENTS: readonly Assessment[] = ["confirmed", "contradicted", "inconclusive"];
const typeLabel=(c:(typeof C)["en"|"zh"],type:string)=>type==="exposure_chart_request"?c.exposureType:type==="sector_origin"?c.originType:type==="rotation_measurement"?c.rotationType:c.otherType;
const stamp=(v:string|null)=>v?`${v.slice(11,19)}Z`:"—";
const kindWord=(c:(typeof C)["en"|"zh"],kind:ReviewRow["kind"])=>kind==="changed"?c.changed:kind==="still_supported"?c.still:c.unavailable;

export default function InvestigationReviewPanel({review,receipts,current,history,lang,disabled,onAssess,onOpenRevision}:Props) {
 const c=C[lang];
 const [assessment,setAssessment]=useState<Assessment|null>(null);
 const [note,setNote]=useState("");
 const [error,setError]=useState<string|null>(null);
 const superseded=current.revision!==current.current_revision;
 const revisions=history??review.revisions;
 async function save() {
  if(!assessment){setError(c.assessRequired);return;}
  setError(null);
  try{await onAssess(assessment,review.fired?.fire_event_id??null,note);}catch{setError(c.saveFailed);}
 }
 return <section className={styles.reviewPanel} data-testid="investigation-review">
  <p className={styles.eyebrow}>{c.panel}</p>
  <details open className={styles.landing}>
   <summary>{c.receipt}</summary>
   {receipts===null?<p role="status">{c.deliveryUnavailable}</p>
    :receipts.length===0?<p role="status">{c.noFiring}</p>
    :<div className={styles.tableWrap} data-testid="investigation-review-receipts"><table><thead><tr><th>{c.fired}</th><th>{c.condition}</th><th>{c.observed}</th><th>{c.source}</th><th>{c.delivery}</th><th>{c.receiptId}</th></tr></thead>
    <tbody>{receipts.map(receipt=><tr key={`${receipt.alert_id}:${receipt.fire_event_id??""}`}>
     <td>{stamp(receipt.fired_at)}</td>
     <td>{receipt.condition_plain??c.none}{receipt.corrects&&<small> · {c.corrects} {receipt.corrects.id.slice(0,8)}</small>}</td>
     <td>{receipt.observed!==null?receipt.observed.toFixed(2):c.none}</td>
     <td>{receipt.source_note??c.none}{receipt.vintage?` · ${stamp(receipt.vintage)}`:""}</td>
     <td>{receipt.queue==="read"?receipt.delivery??c.notDelivered:receipt.queue==="unavailable"?c.queueUnavailable:c.queueAbsent}</td>
     <td><span className={styles.identifier}>{receipt.queue==="read"?receipt.fire_event_id??c.notDelivered:c.none}</span></td>
    </tr>)}</tbody></table></div>}
  </details>
  <details open className={styles.landing}>
   <summary>{c.evidence} {current.revision}</summary>
   {review.rows.length===0?<p role="status">{c.noRows}</p>
    :<ul className={styles.refs} data-testid="investigation-review-evidence">{review.rows.map(row=><li key={`${row.object_type}:${row.object_id}`}><strong>{kindWord(c,row.kind)}</strong> · {typeLabel(c,row.object_type)} <span className={styles.identifier}>{row.object_id}</span>{row.detail&&<small className={styles.identifier}>{row.detail}</small>}</li>)}</ul>}
  </details>
  <details open className={styles.landing}>
   <summary>{c.assessment}</summary>
   <div className={styles.assess} data-testid="investigation-review-assessment">
    {ASSESSMENTS.map(value=><button key={value} aria-pressed={assessment===value} disabled={disabled} onClick={()=>{setAssessment(value);setError(null);}}>{C[lang][value]}</button>)}
   </div>
   <label>{c.note}<textarea data-testid="investigation-review-note" rows={3} maxLength={2000} disabled={disabled} value={note} onChange={e=>setNote(e.target.value)}/><small>{Array.from(note).length} / 2000</small></label>
   {error&&<p role="alert">{error}</p>}
   <div className={styles.actions}>
    <button data-testid="investigation-review-save" disabled={disabled||superseded||!assessment} onClick={()=>void save()}>{c.save} {current.revision+1}</button>
    <button disabled={disabled} onClick={()=>{setAssessment(null);setNote("");setError(null);}}>{c.discard}</button>
   </div>
   {superseded&&<p role="status">{c.superseded}</p>}
  </details>
  <details open className={styles.landing}>
   <summary>{c.revisions}</summary>
   <ul className={styles.kinds} data-testid="investigation-review-revisions">
    {revisions.map(entry=><li key={entry.revision}><button disabled={disabled} onClick={()=>onOpenRevision(entry.revision)}>r{entry.revision} · {stamp(entry.committed_at)}{entry.assessment?` · ${C[lang][entry.assessment]}`:""}</button></li>)}
   </ul>
  </details>
 </section>;
}
