"use client";
import React from "react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLang } from "@/lib/i18n";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { isDocId, parseReadingUrl, type ReadingSelection } from "@/lib/shared-shell/readingContracts";
import { researchReadQuery } from "@/lib/shared-shell/readingRequests";
import { catalogItems, readingBody, record, type CatalogItem, type ReadingBody } from "@/lib/shared-shell/readingPayloads";
import { loadBrowserReadingProgress, readingHref, saveBrowserReadingProgress, type ReadingProgress } from "@/lib/shared-shell/readingProgress";
import { readingJson, useReadingScope } from "@/lib/shared-shell/useReadingScope";
import styles from "./ReadingWorkspace.module.css";

const COPY = {
 en: { title:"Research", intro:"Keep the question, the source and the version together.", library:"Research library", search:"Search reports", submit:"Search", all:"Show library", loading:"Loading research…", unavailable:"Research is unavailable. The selected version has not been replaced.", retry:"Try again", empty:"No reports are available in this selection.", noResults:"No matching reports were returned. Search coverage may be incomplete.", preview:"Your library access contains a preview. Full report text requires the existing Pro entitlement.", stale:"The catalog is behind. Each report keeps its own publication date.", generated:"Catalog generated", publication:"Published", dateUnknown:"Publication date unavailable", open:"Open current revision", continue:"Continue reading", local:"Opened in this browser profile", localNote:"Reading position is kept only on this origin and browser profile. Account sync and cross-device continuity are not available.", noLocal:"No reading position has been kept here yet.", choose:"Choose a report to read its source text.", selected:"Selected source revision", changed:"This selected revision is unavailable. Current text has not replaced it.", restricted:"Full report text requires current Pro access.", auth:"Your account changed or your session ended. Private research has been cleared.", signIn:"Sign in", rate:"The report viewing limit has been reached. Try again after the server's waiting period.", invalid:"This reading link is incomplete or invalid. Select a report from the library to open its current revision.", source:"Source and revision evidence", sourceHash:"Source PDF SHA-256", textHash:"Extracted text SHA-256", extractor:"Extractor version", segmenter:"Segmenter version", previous:"Previous text window", next:"Next text window", page:"Source page", window:"Text segments", thin:"This report has a partial text layer. Missing text is not a complete report.", none:"This revision has no readable text layer.", storage:"This browser could not keep the reading position. The selected text remains available for this session.", readback:"Reading the exact selected revision…", same:"Every text window and reopen keeps both source hashes.", catalogUnavailable:"The library is unavailable. Your selected reading remains separate.", evidenceNote:"Catalog generation is a catalog clock; it is not the report's publication or revision time.", saved:"Saved questions", return:"Return to Today" },
 zh: { title:"研究", intro:"将问题、来源与版本放在一起。", library:"研究资料库", search:"搜索报告", submit:"搜索", all:"显示资料库", loading:"正在加载研究…", unavailable:"研究暂不可用。所选版本未被替换。", retry:"重试", empty:"当前选择暂无可用报告。", noResults:"未返回匹配报告。搜索覆盖可能不完整。", preview:"当前资料库为预览。完整报告正文需要现有的 Pro 权限。", stale:"目录更新滞后。各报告保留自己的发布日期。", generated:"目录生成时间", publication:"发布于", dateUnknown:"发布日期不可用", open:"打开当前修订", continue:"继续阅读", local:"在此浏览器配置中打开", localNote:"阅读位置仅保留在当前来源与浏览器配置中。不支持账户同步或跨设备续读。", noLocal:"此处尚无保留的阅读位置。", choose:"选择报告，阅读其原始文本。", selected:"所选来源修订", changed:"所选修订暂不可用。未以当前文本替换。", restricted:"完整报告正文需要当前 Pro 权限。", auth:"账户已更改或会话已结束。私人研究已清除。", signIn:"登录", rate:"已达到报告查看限制。请在服务器等待期结束后重试。", invalid:"阅读链接不完整或无效。请从资料库选择报告以打开当前修订。", source:"来源与修订证据", sourceHash:"来源 PDF SHA-256", textHash:"提取文本 SHA-256", extractor:"提取器版本", segmenter:"分段器版本", previous:"上一文本窗口", next:"下一文本窗口", page:"来源页码", window:"文本片段", thin:"此报告仅有部分文本层。缺失的文本不代表完整报告。", none:"此修订没有可读文本层。", storage:"浏览器无法保留阅读位置。本次会话仍可阅读所选文本。", readback:"正在读取确切的所选修订…", same:"每个文本窗口及重新打开均保留两个来源哈希。", catalogUnavailable:"资料库暂不可用，所选阅读独立保留。", evidenceNote:"目录生成时间仅为目录时钟，并非报告发布或修订时间。", saved:"已保存的问题", return:"返回今日" },
} as const;
type Phase = "idle"|"loading"|"ready"|"changed"|"restricted"|"auth"|"rate"|"invalid"|"unavailable";
type Reader = { owner: string; docId: string; selection: ReadingSelection | null; body: ReadingBody | null; start: number; phase: Phase };
const emptyReader = (owner: string): Reader => ({ owner, docId:"", selection:null, body:null, start:0, phase:"idle" });

export default function ResearchWorkspace({ ownerKey }: { ownerKey: string }) {
 const { lang } = useLang(), c = COPY[lang], onboarding=useOnboarding();
 const { scope, ready, ended, unavailable: identityUnavailable, retryIdentity } = useReadingScope(ownerKey);
 const [library, setLibrary] = useState<{ owner:string; items:CatalogItem[]; preview:boolean; stale:boolean; generated:string|null }|null>(null);
 const [libraryError, setLibraryError] = useState(false), [libraryLoading, setLibraryLoading] = useState(true);
 const [query, setQuery] = useState(""), [appliedQuery, setAppliedQuery] = useState("");
 const [reader, setReader] = useState<Reader>(emptyReader(ownerKey)), [progress, setProgress] = useState<ReadingProgress|null>(null);
 const [storageFailed, setStorageFailed] = useState(false), [visibleCount, setVisibleCount] = useState(8);
 const readSequence = useRef(0), catalogSequence = useRef(0), titleRef = useRef<HTMLHeadingElement>(null);
 const shown = ready && reader.owner === ownerKey ? reader : emptyReader(ownerKey);
 const items = ready && library?.owner === ownerKey ? library.items : [];

 async function inventory(term = "") {
  const ticket=++catalogSequence.current;setLibraryLoading(true);setLibraryError(false);setVisibleCount(8);
  try {
   const path = term ? `/api/shared-shell/research/search?${new URLSearchParams({q:term,limit:"50"})}` : "/api/shared-shell/research/catalog";
   const { response, value } = await readingJson(scope,path);
   const found = catalogItems(value);
   if(ticket!==catalogSequence.current)return;
   if(!response.ok || !found || !record(value))throw Error("unavailable");
   setLibrary({owner:ownerKey,items:found,preview:value.preview===true,stale:value.stale===true,generated:typeof value.generated_at==="string"?value.generated_at:null});
  } catch { if(!scope.current?.signal.aborted && ticket===catalogSequence.current){setLibraryError(true);setLibrary(null);} }
  finally {if(!scope.current?.signal.aborted && ticket===catalogSequence.current)setLibraryLoading(false);}
 }
 async function open(docId:string, selected:ReadingSelection|null, start=0, history:"push"|"replace"|"none"="push") {
  if(!isDocId(docId) || !Number.isSafeInteger(start) || start<0 || (!selected && start>0))return;
  const ticket=++readSequence.current;
  setReader({owner:ownerKey,docId,selection:selected,body:null,start,phase:"loading"});
  try {
   const query = selected ? researchReadQuery(selected,start) : new URLSearchParams({segment_start:"0",max_segments:"2"});
   const { response, value } = await readingJson(scope,`/api/shared-shell/research/read/${docId}?${query}`);
   if(ticket!==readSequence.current)return;
   if(!response.ok){
    const phase:Phase = response.status===409?"changed":response.status===402||response.status===403?"restricted":response.status===401?"auth":response.status===429?"rate":"unavailable";
    setReader({owner:ownerKey,docId,selection:selected,body:null,start,phase});return;
   }
   const body=readingBody(value,docId,selected,start);
   if(!body)throw Error("unavailable");
   setReader({owner:ownerKey,docId,selection:body.selection,body,start,phase:"ready"});
   const nextProgress={selection:body.selection,segmentStart:start};setProgress(nextProgress);
   setStorageFailed(!saveBrowserReadingProgress(ownerKey,nextProgress));
   if(history!=="none")window.history[history==="push"?"pushState":"replaceState"]({},"",readingHref(body.selection,start));
   requestAnimationFrame(()=>titleRef.current?.focus());
  } catch {if(!scope.current?.signal.aborted && ticket===readSequence.current)setReader({owner:ownerKey,docId,selection:selected,body:null,start,phase:"unavailable"});}
 }
 function fromUrl() {
  const params = new URLSearchParams(window.location.search), selection = parseReadingUrl(params);
  if(!selection){++readSequence.current;setReader(emptyReader(ownerKey));return;}
  const raw=params.get("segment_start")??"0",start=/^\d+$/.test(raw)?Number(raw):-1;
  const ambiguous=["doc_id","source_pdf_sha256","extracted_text_sha256","extractor_version","segmenter_version","segment_start"].some(key=>params.getAll(key).length>1);
  if("invalid" in selection || ambiguous || !Number.isSafeInteger(start) || start<0){++readSequence.current;setReader({...emptyReader(ownerKey),docId:selection.docId,phase:"invalid"});return;}
  void open(selection.docId,selection,start,"none");
 }
 useEffect(()=>{
  if(!ready){++readSequence.current;++catalogSequence.current;queueMicrotask(()=>{setReader(emptyReader(ownerKey));setLibrary(null);setProgress(null);});return;}
  const controller=scope.current;
  queueMicrotask(()=>{if(controller?.signal.aborted)return;setProgress(loadBrowserReadingProgress(ownerKey));void inventory();fromUrl();});
  window.addEventListener("popstate",fromUrl);
  return()=>{window.removeEventListener("popstate",fromUrl);};
  // All private requests belong to the verified subject generation; query changes are explicit actions/popstate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[ready,ownerKey]);
 const submit = (event:FormEvent) => {event.preventDefault();const term=query.trim();setAppliedQuery(term);void inventory(term);};
 const title = items.find(item=>item.id===shown.docId)?.title || shown.docId;
 const phaseCopy = shown.phase==="changed"?c.changed:shown.phase==="restricted"?c.restricted:shown.phase==="auth"?c.auth:shown.phase==="rate"?c.rate:shown.phase==="invalid"?c.invalid:c.unavailable;
 return <div className={styles.root}>
  <header className={styles.heading}><div><h1>{c.title}</h1><p>{c.intro}</p></div><div className={styles.actions}><Link href="/analysis?view=investigations">{c.saved}</Link><Link href="/research_screener.html">{lang==="zh"?"研究筛选器":"Research screener"}</Link><Link href="/today">{c.return}</Link></div></header>
  {ended?<div role="status" className={styles.notice}>{c.auth} <button onClick={()=>onboarding.open("signin")}>{c.signIn}</button><button onClick={retryIdentity}>{lang==="zh"?"重新验证所选内容":"Recheck selected context"}</button></div>:identityUnavailable?<div role="status" className={styles.notice}><p>{lang==="zh"?"账户服务暂不可用。私人研究已隐藏。":"The account service is unavailable. Private research is hidden."}</p><button onClick={retryIdentity}>{c.retry}</button></div>:!ready?<div role="status" className={styles.loading}>{c.loading}<div className={styles.skeleton}/></div>:<>
   <div className={styles.toolbar}><form onSubmit={submit}><label>{c.search}<input value={query} maxLength={200} onChange={event=>setQuery(event.target.value)} type="search"/></label><button type="submit">{c.submit}</button>{appliedQuery&&<button type="button" onClick={()=>{setQuery("");setAppliedQuery("");void inventory();}}>{c.all}</button>}</form></div>
   <div className={styles.columns}><section aria-labelledby="research-library"><h2 id="research-library">{c.library}</h2>
    {library?.preview&&<p className={styles.notice}>{c.preview}</p>}{library?.stale&&<p className={styles.warning}>{c.stale}</p>}
    {libraryError?<div role="status" className={styles.notice}>{c.catalogUnavailable}<div className={styles.actions}><button onClick={()=>void inventory(appliedQuery)}>{c.retry}</button></div></div>:libraryLoading?<div role="status" className={styles.loading}>{c.loading}<div className={styles.skeleton}/></div>:items.length===0?<p>{appliedQuery?c.noResults:c.empty}</p>:<ul className={styles.list}>{items.slice(0,visibleCount).map(item=><li className={styles.row} key={item.id}><div className={styles.eyebrow}>{item.institution}</div><h3>{item.title}</h3>{item.summary_points?.slice(0,2).map((point,index)=><p key={index}>{point}</p>)}<footer><small>{item.published_at?`${c.publication} ${item.published_at}`:c.dateUnknown}</small><button onClick={()=>void open(item.id,null)}>{c.open} →</button></footer></li>)}</ul>}
    {items.length>visibleCount&&<button onClick={()=>setVisibleCount(count=>count+8)}>{lang==="zh"?"显示更多报告":"Show more reports"}</button>}
    {library?.generated&&<p className={styles.coverage}>{c.generated}: {library.generated}</p>}
   </section><aside className={styles.side}><div className={styles.eyebrow}>{c.local}</div><h2>{c.continue}</h2><p className={styles.muted}>{c.localNote}</p>{progress?<><p>{progress.selection.docId}</p><p className={styles.source}>{progress.selection.sourcePdfSha256.slice(0,16)}…</p><button onClick={()=>void open(progress.selection.docId,progress.selection,progress.segmentStart)}>{c.continue} →</button></>:<p>{c.noLocal}</p>}</aside></div>
   <section className={styles.reader} aria-live="polite">
    {shown.phase==="idle"?<p>{c.choose}</p>:<><div className={styles.eyebrow}>{c.selected}</div><h2 tabIndex={-1} ref={titleRef}>{title}</h2>
     {shown.phase==="loading"?<div role="status" className={styles.loading}>{c.readback}<div className={styles.skeleton}/></div>:shown.phase!=="ready"?<div role="status" className={styles.notice}><p>{phaseCopy}</p><div className={styles.actions}>{shown.phase==="changed"?<button onClick={()=>void open(shown.docId,null)}>{c.open}</button>:shown.phase==="restricted"?<Link href="/plans.html">{lang==="zh"?"查看方案":"View plans"}</Link>:shown.phase==="auth"?<><button onClick={()=>onboarding.open("signin")}>{c.signIn}</button><button onClick={retryIdentity}>{lang==="zh"?"重新验证所选内容":"Recheck selected context"}</button></>:shown.phase!=="invalid"&&<button onClick={()=>void open(shown.docId,shown.selection,shown.start,"replace")}>{c.retry}</button>}</div></div>:shown.body&&<>
      {shown.body.textLayer==="thin"&&<p className={styles.notice}>{c.thin}</p>}{shown.body.textLayer==="none"&&<p className={styles.notice}>{c.none}</p>}
      {shown.body.segments.map(part=><article key={part.segment_index}><div className={styles.eyebrow}>{c.page} {part.page_start===part.page_end?part.page_start:`${part.page_start}–${part.page_end}`}</div><p className={styles.body}>{part.text}</p><details><summary>{c.source}</summary><p className={styles.source}>SHA-256: {part.segment_text_sha256}</p></details></article>)}
      <p className={styles.coverage}>{c.window}: {shown.body.total?`${shown.start+1}–${shown.start+shown.body.segments.length} / ${shown.body.total}`:"0 / 0"}</p>
      <div className={styles.actions}><button disabled={shown.start===0} onClick={()=>void open(shown.docId,shown.selection,Math.max(0,shown.start-2))}>{c.previous}</button><button disabled={shown.start+shown.body.segments.length>=shown.body.total} onClick={()=>void open(shown.docId,shown.selection,shown.start+shown.body!.segments.length)}>{c.next}</button></div>
      <p className={styles.coverage}>{lang==="zh"?"每个文本窗口均计入现有报告查看额度。":"Each text window counts toward the existing report viewing allowance."}</p>
      {storageFailed&&<p role="status">{c.storage}</p>}
     </>}
     {shown.selection&&<div className={styles.actions}><a href={`/api/shared-shell/research/pdf/${shown.docId}`} target="_blank" rel="noopener noreferrer">{lang==="zh"?"打开当前原始 PDF":"Open current original PDF"} ↗</a><small>{lang==="zh"?"当前原件可能与所选修订不同；重新核验当前权限。":"The current original may differ from this selected revision. Current access is checked again."}</small></div>}
     {shown.selection&&<details open={shown.phase==="changed"}><summary>{c.source}</summary><p>{c.same}</p><dl>{[[c.sourceHash,shown.selection.sourcePdfSha256],[c.textHash,shown.selection.extractedTextSha256],[c.extractor,shown.selection.extractorVersion],[c.segmenter,shown.selection.segmenterVersion]].map(([label,value])=><div key={label}><dt>{label}</dt><dd className={styles.source}>{value}</dd></div>)}</dl>{shown.body?.catalogGeneratedAt&&<p>{c.generated}: {shown.body.catalogGeneratedAt}</p>}<p className={styles.muted}>{c.evidenceNote}</p></details>}
    </>}
   </section>
  </>}
 </div>;
}
