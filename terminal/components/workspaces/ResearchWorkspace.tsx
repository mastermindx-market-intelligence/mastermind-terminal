"use client";
import { pick } from "@/lib/finFormat";
import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLang } from "@/lib/i18n";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { isDocId, parseReadingUrl, type ReadingSelection } from "@/lib/shared-shell/readingContracts";
import { researchReadQuery } from "@/lib/shared-shell/readingRequests";
import { catalogItems, readingBody, record, type CatalogItem, type ReadingBody } from "@/lib/shared-shell/readingPayloads";
import { loadBrowserReadingProgress, readingHref, saveBrowserReadingProgress, type ReadingProgress } from "@/lib/shared-shell/readingProgress";
import { readingJson, useReadingScope } from "@/lib/shared-shell/useReadingScope";
import { sourcePageDestinations, type ResearchOutlineEntry } from "@/lib/shared-shell/researchOutline";
import { isResearchPublicationDate, researchLibrary, type ResearchLibrarySort } from "@/lib/shared-shell/researchLibrary";
import MobileSheet from "@/components/ui/MobileSheet";
import styles from "./ResearchWorkspace.module.css";

const COPY = {
 en: { title:"Research", intro:"Keep the question, the source and the version together.", library:"Research library", search:"Search reports", submit:"Search", all:"Show library", loading:"Loading research…", unavailable:"Research is unavailable. The selected version has not been replaced.", retry:"Try again", empty:"No reports are available in this selection.", noResults:"No matching reports were returned. Search coverage may be incomplete.", preview:"Your library access contains a preview. Full report text requires the existing Pro entitlement.", stale:"The catalog is behind. Each report keeps its own publication date.", generated:"Catalog generated", publication:"Published", dateUnknown:"Publication date unavailable", open:"Open current revision", continue:"Continue reading", local:"Opened in this browser profile", localNote:"Reading position is kept only on this origin and browser profile. Account sync and cross-device continuity are not available.", noLocal:"No reading position has been kept here yet.", choose:"Choose a report to read its source text.", selected:"Selected source revision", changed:"This selected revision is unavailable. Current text has not replaced it.", restricted:"Full report text requires current Pro access.", auth:"Your account changed or your session ended. Private research has been cleared.", signIn:"Sign in", rate:"The report viewing limit has been reached. Try again after the server's waiting period.", invalid:"This reading link is incomplete or invalid. Select a report from the library to open its current revision.", source:"Source and revision evidence", sourceHash:"Source PDF SHA-256", textHash:"Extracted text SHA-256", extractor:"Extractor version", segmenter:"Segmenter version", previous:"Previous text window", next:"Next text window", page:"Source page", window:"Text segments", thin:"This report has a partial text layer. Missing text is not a complete report.", none:"This revision has no readable text layer.", storage:"This browser could not keep the reading position. The selected text remains available for this session.", readback:"Reading the exact selected revision…", same:"Every text window and reopen keeps both source hashes.", catalogUnavailable:"The library is unavailable. Your selected reading remains separate.", evidenceNote:"Catalog generation is a catalog clock; it is not the report's publication or revision time.", saved:"Saved questions", return:"Return to Today" },
 zh: { title:"研究", intro:"将问题、来源与版本放在一起。", library:"研究资料库", search:"搜索报告", submit:"搜索", all:"显示资料库", loading:"正在加载研究…", unavailable:"研究暂不可用。所选版本未被替换。", retry:"重试", empty:"当前选择暂无可用报告。", noResults:"未返回匹配报告。搜索覆盖可能不完整。", preview:"当前资料库为预览。完整报告正文需要现有的 Pro 权限。", stale:"目录更新滞后。各报告保留自己的发布日期。", generated:"目录生成时间", publication:"发布于", dateUnknown:"发布日期不可用", open:"打开当前修订", continue:"继续阅读", local:"在此浏览器配置中打开", localNote:"阅读位置仅保留在当前来源与浏览器配置中。不支持账户同步或跨设备续读。", noLocal:"此处尚无保留的阅读位置。", choose:"选择报告，阅读其原始文本。", selected:"所选来源修订", changed:"所选修订暂不可用。未以当前文本替换。", restricted:"完整报告正文需要当前 Pro 权限。", auth:"账户已更改或会话已结束。私人研究已清除。", signIn:"登录", rate:"已达到报告查看限制。请在服务器等待期结束后重试。", invalid:"阅读链接不完整或无效。请从资料库选择报告以打开当前修订。", source:"来源与修订证据", sourceHash:"来源 PDF SHA-256", textHash:"提取文本 SHA-256", extractor:"提取器版本", segmenter:"分段器版本", previous:"上一文本窗口", next:"下一文本窗口", page:"来源页码", window:"文本片段", thin:"此报告仅有部分文本层。缺失的文本不代表完整报告。", none:"此修订没有可读文本层。", storage:"浏览器无法保留阅读位置。本次会话仍可阅读所选文本。", readback:"正在读取确切的所选修订…", same:"每个文本窗口及重新打开均保留两个来源哈希。", catalogUnavailable:"资料库暂不可用，所选阅读独立保留。", evidenceNote:"目录生成时间仅为目录时钟，并非报告发布或修订时间。", saved:"已保存的问题", return:"返回今日" },
} as const;
const EMPTY_ITEMS: CatalogItem[] = [];
const EDITORIAL_COPY = {
 en: { topic:"Topic", institution:"Institution", sort:"Order", allTopics:"All supplied topics", noTopics:"Topics not supplied", allInstitutions:"All supplied institutions", noInstitutions:"Institutions not supplied", newest:"Newest publication", oldest:"Oldest publication", titleOrder:"Report title", noMatches:"No reports in the loaded selection match these filters.", selectedReport:"Selected report", librarySummary:"Library summary", browseLibrary:"Browse the research library", readingContext:"Reading context", sourcePages:"Source pages", closePages:"Close source pages", currentPage:"Current source page", outlineMissing:"A source-page outline is not supplied for this revision. Use the text-window controls to continue.", inspectPassage:"Inspect source passage", passageEvidence:"Selected passage evidence", returnPassage:"Return to passage", returnReading:"Return to selected reading", sourceRange:"Source byte range", segmentReceipt:"Passage text SHA-256", identifier:"Report identifier", textWindows:"Source text windows", searchLimit:"Search returns at most 50 reports. These counts describe only the loaded selection.", loaded:(shown:number,total:number,loaded:number)=>`${shown} shown · ${total} matching in ${loaded} loaded reports`, windowNumber:(number:number)=>`Window ${number}` },
 zh: { topic:"主题", institution:"机构", sort:"排序", allTopics:"全部已提供主题", noTopics:"未提供主题", allInstitutions:"全部已提供机构", noInstitutions:"未提供机构", newest:"发布日期从新到旧", oldest:"发布日期从旧到新", titleOrder:"报告标题", noMatches:"已加载的选择中没有符合这些筛选条件的报告。", selectedReport:"所选报告", librarySummary:"资料库摘要", browseLibrary:"浏览研究资料库", readingContext:"阅读上下文", sourcePages:"来源页码", closePages:"关闭来源页码", currentPage:"当前来源页码", outlineMissing:"此修订未提供来源页码目录。请使用文本窗口控件继续阅读。", inspectPassage:"查看来源片段", passageEvidence:"所选片段证据", returnPassage:"返回片段", returnReading:"返回所选阅读", sourceRange:"来源字节范围", segmentReceipt:"片段文本 SHA-256", identifier:"报告标识", textWindows:"来源文本窗口", searchLimit:"搜索最多返回 50 份报告。此处计数仅描述已加载的选择。", loaded:(shown:number,total:number,loaded:number)=>`已显示 ${shown} 份 · ${loaded} 份已加载报告中有 ${total} 份符合条件`, windowNumber:(number:number)=>`窗口 ${number}` },
} as const;
type Phase = "idle"|"loading"|"ready"|"changed"|"restricted"|"auth"|"rate"|"invalid"|"unavailable";
type Reader = { owner: string; docId: string; selection: ReadingSelection | null; body: ReadingBody | null; start: number; phase: Phase };
const emptyReader = (owner: string): Reader => ({ owner, docId:"", selection:null, body:null, start:0, phase:"idle" });

function ResearchWorkspaceSession({ ownerKey }: { ownerKey: string }) {
 const { lang } = useLang(), c = COPY[lang], e = EDITORIAL_COPY[lang], onboarding=useOnboarding();
 const routeQuery = useSearchParams()?.toString() ?? "";
 const observedQuery = useRef<string | null>(null);
 const { scope, ready, ended, unavailable: identityUnavailable, retryIdentity, invalidateIdentity } = useReadingScope(ownerKey);
 const [library, setLibrary] = useState<{ owner:string; items:CatalogItem[]; preview:boolean; stale:boolean; generated:string|null }|null>(null);
 const [libraryError, setLibraryError] = useState(false), [libraryLoading, setLibraryLoading] = useState(true);
 const [libraryRestricted, setLibraryRestricted] = useState(false);
 const [topic, setTopic] = useState(""), [institution, setInstitution] = useState("");
 const [sort, setSort] = useState<ResearchLibrarySort>("date-newest");
 const [query, setQuery] = useState(""), [appliedQuery, setAppliedQuery] = useState("");
 const [reader, setReader] = useState<Reader>(emptyReader(ownerKey)), [progress, setProgress] = useState<ReadingProgress|null>(null);
 const [storageFailed, setStorageFailed] = useState(false), [visibleCount, setVisibleCount] = useState(8);
 const [libraryOpen, setLibraryOpen] = useState(false), [evidenceIndex, setEvidenceIndex] = useState<number|null>(null);
 const [pageSheetOpen, setPageSheetOpen] = useState(false);
 const destinationFocus = useRef<number|null>(null);
 const evidenceRef = useRef<HTMLElement>(null);
 const readSequence = useRef(0), catalogSequence = useRef(0), titleRef = useRef<HTMLHeadingElement>(null);
 const shown = ready && reader.owner === ownerKey ? reader : emptyReader(ownerKey);
 const items = ready && library?.owner === ownerKey ? library.items : EMPTY_ITEMS;
 const libraryView = useMemo(() => researchLibrary(items, { topic, institution, sort }), [items, topic, institution, sort]);
 const filteredItems = libraryView.items;
 useEffect(() => {
  if (evidenceIndex !== null) evidenceRef.current?.focus();
 }, [evidenceIndex, shown.body]);

 useEffect(() => {
  if (pageSheetOpen || shown.phase === "loading" || destinationFocus.current === null) return;
  // Native history writes are observed by Next. Wait for that exact query commit so
  // its route-focus lifecycle cannot reclaim the source-page destination.
  if (shown.selection && routeQuery !== new URL(readingHref(shown.selection, shown.start), window.location.href).searchParams.toString()) return;
  const destination = destinationFocus.current;
  const frame = requestAnimationFrame(() => {
   destinationFocus.current = null;
   (document.getElementById(`research-segment-${destination}`) ?? titleRef.current)?.focus();
  });
  return () => cancelAnimationFrame(frame);
 }, [pageSheetOpen, shown.phase, shown.body, shown.selection, shown.start, routeQuery]);
 useEffect(() => {
  const media = window.matchMedia?.("(min-width: 1100px)");
  const closeOnDesktop = () => { if (media?.matches) setPageSheetOpen(false); };
  media?.addEventListener("change", closeOnDesktop);
  return () => media?.removeEventListener("change", closeOnDesktop);
 }, []);

 async function inventory(term = "") {
  const ticket=++catalogSequence.current;setLibraryLoading(true);setLibraryError(false);setLibraryRestricted(false);setVisibleCount(8);
  try {
   const path = term ? `/api/shared-shell/research/search?${new URLSearchParams({q:term,limit:"50"})}` : "/api/shared-shell/research/catalog";
   const { response, value } = await readingJson(scope,path);
   const found = catalogItems(value);
   if(ticket!==catalogSequence.current)return;
   if(response.status===401){setLibrary(null);invalidateIdentity();return;}
   if(response.status===402||response.status===403){setLibrary(null);setLibraryRestricted(true);return;}
   if(!response.ok || !found || !record(value))throw Error("unavailable");
   setLibrary({owner:ownerKey,items:found,preview:value.preview===true,stale:value.stale===true,generated:typeof value.generated_at==="string"?value.generated_at:null});
  } catch { if(!scope.current?.signal.aborted && ticket===catalogSequence.current){setLibraryError(true);setLibrary(null);} }
  finally {if(!scope.current?.signal.aborted && ticket===catalogSequence.current)setLibraryLoading(false);}
 }
 async function open(docId:string, selected:ReadingSelection|null, start=0, history:"push"|"replace"|"none"="push") {
  if(!isDocId(docId) || !Number.isSafeInteger(start) || start<0 || (!selected && start>0))return;
  setLibraryOpen(false);
  setPageSheetOpen(false);
  setEvidenceIndex(null);
  const focusDestination = destinationFocus.current;
  const ticket=++readSequence.current;
  setReader({owner:ownerKey,docId,selection:selected,body:null,start,phase:"loading"});
  try {
   const query = selected ? researchReadQuery(selected,start) : new URLSearchParams({segment_start:"0",max_segments:"2"});
   const { response, value } = await readingJson(scope,`/api/shared-shell/research/read/${docId}?${query}`);
   if(ticket!==readSequence.current)return;
   if(!response.ok){
    if(response.status===401){invalidateIdentity();return;}
    const phase:Phase = response.status===409?"changed":response.status===402||response.status===403?"restricted":response.status===401?"auth":response.status===429?"rate":"unavailable";
    setReader({owner:ownerKey,docId,selection:selected,body:null,start,phase});return;
   }
   const body=readingBody(value,docId,selected,start);
   if(!body)throw Error("unavailable");
   setReader({owner:ownerKey,docId,selection:body.selection,body,start,phase:"ready"});
   const nextProgress={selection:body.selection,segmentStart:start};setProgress(nextProgress);
   setStorageFailed(!saveBrowserReadingProgress(ownerKey,nextProgress));
   if(history!=="none") {
    const href=readingHref(body.selection,start);
    // Next observes native history writes. Mark our accepted tuple before publishing
    // it so that the URL observer does not charge a second identical text-window read.
    observedQuery.current=new URL(href,window.location.href).search;
    window.history[history==="push"?"pushState":"replaceState"]({},"",href);
   }
   if (focusDestination === null) requestAnimationFrame(()=>titleRef.current?.focus());
  } catch {if(!scope.current?.signal.aborted && ticket===readSequence.current)setReader({owner:ownerKey,docId,selection:selected,body:null,start,phase:"unavailable"});}
 }
 function fromUrl() {
  const queryString=window.location.search;
  if(observedQuery.current===queryString)return;
  observedQuery.current=queryString;
  const params = new URLSearchParams(queryString), selection = parseReadingUrl(params);
  if(!selection){++readSequence.current;setReader(emptyReader(ownerKey));return;}
  const raw=params.get("segment_start")??"0",start=/^\d+$/.test(raw)?Number(raw):-1;
  const ambiguous=["doc_id","source_pdf_sha256","extracted_text_sha256","extractor_version","segmenter_version","segment_start"].some(key=>params.getAll(key).length>1);
  if("invalid" in selection || ambiguous || !Number.isSafeInteger(start) || start<0){++readSequence.current;setReader({...emptyReader(ownerKey),docId:selection.docId,phase:"invalid"});return;}
  void open(selection.docId,selection,start,"none");
 }
 useEffect(()=>{
  if(!ready){observedQuery.current=null;++readSequence.current;++catalogSequence.current;queueMicrotask(()=>{setReader(emptyReader(ownerKey));setLibrary(null);setProgress(null);});return;}
  const controller=scope.current;
  queueMicrotask(()=>{if(controller?.signal.aborted)return;setProgress(loadBrowserReadingProgress(ownerKey));void inventory(appliedQuery);fromUrl();});
  window.addEventListener("popstate",fromUrl);
  return()=>{window.removeEventListener("popstate",fromUrl);};
  // All private requests belong to the verified subject generation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[ready,ownerKey]);
 useEffect(()=>{
  if(!ready)return;
  const controller=scope.current;
  queueMicrotask(()=>{if(!controller?.signal.aborted)fromUrl();});
  // App Router links can change a same-route query without a popstate event.
  // fromUrl shares a synchronous cursor with history writes and the popstate listener.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[ready,ownerKey,routeQuery]);
 const submit = (event:FormEvent) => {event.preventDefault();const term=query.trim();setAppliedQuery(term);void inventory(term);};
 const metadata = items.find(item => item.id === shown.docId);
 const title = metadata?.title.trim() || e.selectedReport;
 const published = isResearchPublicationDate(metadata?.published_at) ? metadata?.published_at : null;
 const hasSelection = shown.phase !== "idle";
 const pageDestinations = sourcePageDestinations(shown.body?.outline ?? []);
 const currentSourceRange = shown.body?.segments[0];
 const evidenceSegment = shown.body?.segments.find(part => part.segment_index === evidenceIndex) ?? null;
 const phaseCopy = shown.phase === "changed" ? c.changed : shown.phase === "restricted" ? c.restricted : shown.phase === "auth" ? c.auth : shown.phase === "rate" ? c.rate : shown.phase === "invalid" ? c.invalid : c.unavailable;
 function inspectPassage(index: number) {
  if (index === evidenceIndex) evidenceRef.current?.focus();
  else setEvidenceIndex(index);
 }
 function sourcePage(entry: ResearchOutlineEntry, fromSheet = false) {
  if (!shown.selection || shown.phase !== "ready") return;
  if (fromSheet) {
   destinationFocus.current = entry.segment_index;
   setPageSheetOpen(false);
  }
  if (shown.body?.segments.some(part => part.segment_index === entry.segment_index)) {
   if (!fromSheet) document.getElementById(`research-segment-${entry.segment_index}`)?.focus();
   return;
  }
  void open(shown.docId, shown.selection, entry.segment_index);
 }
 const sourcePageList = (inSheet = false) => <nav aria-label={e.sourcePages}><ol className={styles.outlineList}>{pageDestinations.map(entry => <li key={entry.segment_index}>
  <button aria-current={currentSourceRange && entry.page_start === currentSourceRange.page_start && entry.page_end === currentSourceRange.page_end ? "page" : undefined} onClick={() => sourcePage(entry, inSheet)}>
   <span>{c.page} {entry.page_start === entry.page_end ? entry.page_start : `${entry.page_start}–${entry.page_end}`}</span><small>{e.windowNumber(entry.segment_index + 1)}</small>
  </button>
 </li>)}</ol></nav>;
 const libraryContents = <>
  <div className={styles.toolbar}>
   {hasSelection && <a href="#research-reader-title">{e.returnReading}</a>}
   <form onSubmit={submit}>
    <label>{c.search}<input value={query} maxLength={200} onChange={event => setQuery(event.target.value)} type="search"/></label>
    <button type="submit">{c.submit}</button>
    {appliedQuery && <button type="button" onClick={() => { setQuery(""); setAppliedQuery(""); void inventory(); }}>{c.all}</button>}
   </form>
   <div className={styles.filters}>
    <label>{e.topic}<select aria-label={e.topic} value={topic} disabled={!libraryView.topics.length && !topic} onChange={event => { setTopic(event.target.value); setVisibleCount(8); }}>
     <option value="">{libraryView.topics.length ? e.allTopics : e.noTopics}</option>{topic && !libraryView.topics.includes(topic) && <option value={topic}>{topic}</option>}
     {libraryView.topics.map(label => <option key={label} value={label}>{label}</option>)}
    </select></label>
    <label>{e.institution}<select aria-label={e.institution} value={institution} disabled={!libraryView.institutions.length && !institution} onChange={event => { setInstitution(event.target.value); setVisibleCount(8); }}>
     <option value="">{libraryView.institutions.length ? e.allInstitutions : e.noInstitutions}</option>{institution && !libraryView.institutions.includes(institution) && <option value={institution}>{institution}</option>}
     {libraryView.institutions.map(label => <option key={label} value={label}>{label}</option>)}
    </select></label>
    <label>{e.sort}<select aria-label={e.sort} value={sort} onChange={event => { setSort(event.target.value as ResearchLibrarySort); setVisibleCount(8); }}>
     <option value="date-newest">{e.newest}</option><option value="date-oldest">{e.oldest}</option><option value="title">{e.titleOrder}</option>
    </select></label>
   </div>
  </div>
  {library?.preview && <p className={styles.notice}>{c.preview}</p>}
  {library?.stale && <p className={styles.warning}>{c.stale}</p>}
  {libraryRestricted ? <div role="status" className={styles.notice}><p>{pick(lang === "zh", "Current access does not permit this research selection.", "当前访问权限不允许查看此研究选择。")}</p><Link href="/plans.html">{pick(lang === "zh", "View plans", "查看方案")}</Link></div>
   : libraryError ? <div role="status" className={styles.notice}>{c.catalogUnavailable}<div className={styles.actions}><button onClick={() => void inventory(appliedQuery)}>{c.retry}</button></div></div>
   : libraryLoading ? <div role="status" className={styles.loading}>{c.loading}<div className={styles.skeleton}/></div>
   : <>
    <p className={styles.loaded}>{e.loaded(Math.min(visibleCount, filteredItems.length), filteredItems.length, libraryView.loadedCount)}</p>
    {appliedQuery && <p className={styles.coverage}>{e.searchLimit}</p>}
    {filteredItems.length === 0 ? <p>{topic || institution ? e.noMatches : appliedQuery ? c.noResults : c.empty}</p>
     : <ul className={styles.list}>{filteredItems.slice(0, visibleCount).map(item => <li className={styles.row} key={item.id}>
      {item.institution && <div className={styles.eyebrow}>{item.institution}</div>}
      <h3>{item.title}</h3>
      {!!item.tags?.length && <div className={styles.tags}>{item.tags.map((tag, index) => <span className={styles.tag} key={`${tag}:${index}`}>{tag}</span>)}</div>}
      {item.summary_points?.slice(0, 2).map((point, index) => <p key={index}>{point}</p>)}
      <footer><small>{isResearchPublicationDate(item.published_at) ? `${c.publication} ${item.published_at}` : c.dateUnknown}</small><button onClick={() => void open(item.id, null)}>{c.open} →</button></footer>
     </li>)}</ul>}
    {filteredItems.length > visibleCount && <button className={styles.more} onClick={() => setVisibleCount(count => count + 8)}>{pick(lang === "zh", "Show more reports", "显示更多报告")}</button>}
   </>}
  {library?.generated && <p className={styles.coverage}>{c.generated}: {library.generated}</p>}
 </>;
 const reading = hasSelection && <section className={styles.editorial} aria-label={c.selected}>
  <article className={styles.reading}>
   <header className={styles.readingHeader}>
    <div className={styles.eyebrow}>{c.selected}</div>
    <h2 id="research-reader-title" tabIndex={-1} ref={titleRef}>{title}</h2>
    {(metadata?.institution || published) && <div className={styles.metadata}>
     {metadata?.institution && <span>{metadata.institution}</span>}
     {published && <span>{c.publication} {published}</span>}
    </div>}
    {shown.phase === "ready" && !!metadata?.summary_points?.length && <div>
     <p className={styles.summaryLabel}>{e.librarySummary}</p>
     <ul className={styles.deck}>{metadata.summary_points.slice(0, 3).map((point, index) => <li key={index}>{point}</li>)}</ul>
    </div>}
   {shown.selection && <div className={styles.original}>
    <a href={`/api/shared-shell/research/pdf/${shown.docId}`} target="_blank" rel="noopener noreferrer">{pick(lang === "zh", "Open current original PDF", "打开当前原始 PDF")} ↗</a>
    <small>{pick(lang === "zh", "The current original may differ from this selected revision. Current access is checked again.", "当前原件可能与所选修订不同；重新核验当前权限。")}</small>
   </div>}
   {shown.body?.outline && <button className={styles.mobilePagesTrigger} aria-haspopup="dialog" aria-expanded={pageSheetOpen} onClick={() => setPageSheetOpen(true)}>{e.sourcePages}<span aria-hidden="true">↗</span></button>}
   </header>
   {shown.phase === "loading" ? <div role="status" className={styles.loading}>{c.readback}<div className={styles.skeleton}/></div>
    : shown.phase !== "ready" ? <div role="status" className={styles.notice}><p>{phaseCopy}</p><div className={styles.actions}>
     {shown.phase === "changed" ? <button onClick={() => void open(shown.docId, null)}>{c.open}</button>
      : shown.phase === "restricted" ? <Link href="/plans.html">{pick(lang === "zh", "View plans", "查看方案")}</Link>
      : shown.phase === "auth" ? <><button onClick={() => onboarding.open("signin")}>{c.signIn}</button><button onClick={retryIdentity}>{pick(lang === "zh", "Recheck selected context", "重新验证所选内容")}</button></>
      : shown.phase !== "invalid" && <button onClick={() => void open(shown.docId, shown.selection, shown.start, "replace")}>{c.retry}</button>}
    </div></div>
    : shown.body && <>
     {shown.body.textLayer === "thin" && <p className={styles.notice}>{c.thin}</p>}
     {shown.body.textLayer === "none" && <p className={styles.notice}>{c.none}</p>}
     <nav className={styles.windowNav} aria-label={e.textWindows}>
      <p className={styles.coverage}>{c.window}: {shown.body.total ? `${shown.start + 1}–${shown.start + shown.body.segments.length} / ${shown.body.total}` : "0 / 0"}</p>
      <div className={styles.actions}>
       <button disabled={shown.start === 0} onClick={() => void open(shown.docId, shown.selection, Math.max(0, shown.start - 2))}>{c.previous}</button>
       <button disabled={shown.start + shown.body.segments.length >= shown.body.total} onClick={() => void open(shown.docId, shown.selection, shown.start + shown.body!.segments.length)}>{c.next}</button>
      </div>
     </nav>
     {shown.body.segments.map(part => <section className={styles.passage} key={part.segment_index} id={`research-segment-${part.segment_index}`} tabIndex={-1}>
      <header className={styles.passageHeader}>
       <h3>{c.page} {part.page_start === part.page_end ? part.page_start : `${part.page_start}–${part.page_end}`}</h3>
       <button onClick={() => inspectPassage(part.segment_index)}>{e.inspectPassage}</button>
      </header>
      <p className={styles.body}>{part.text}</p>
     </section>)}
     <p className={styles.coverage}>{pick(lang === "zh", "Each text window counts toward the existing report viewing allowance.", "每个文本窗口均计入现有报告查看额度。")}</p>
     {storageFailed && <p role="status">{c.storage}</p>}
    </>}

  </article>
  {shown.body?.outline && <MobileSheet open={pageSheetOpen} onClose={() => setPageSheetOpen(false)} title={e.sourcePages} className={styles.pageSheet}>
   <div className={styles.sheetContents}>
    <button className={styles.sheetClose} data-autofocus onClick={() => setPageSheetOpen(false)} aria-label={e.closePages}>×</button>
    {currentSourceRange && <p>{e.currentPage}: {currentSourceRange.page_start === currentSourceRange.page_end ? currentSourceRange.page_start : `${currentSourceRange.page_start}–${currentSourceRange.page_end}`}</p>}
    {sourcePageList(true)}
    <button className={styles.returnReading} onClick={() => setPageSheetOpen(false)}>{e.returnReading}</button>
   </div>
  </MobileSheet>}
  <aside className={styles.context} aria-label={e.readingContext}>
   {shown.body && <details className={`${styles.contextPanel} ${styles.desktopPages}`} open>
    <summary>{e.sourcePages}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
    {shown.body.outline ? sourcePageList() : <p className={styles.coverage}>{e.outlineMissing}</p>}
   </details>}
   {evidenceSegment && <section ref={evidenceRef} tabIndex={-1} className={`${styles.contextPanel} ${styles.evidence}`} aria-label={e.passageEvidence}>
    <div className={styles.eyebrow}>{e.passageEvidence}</div>
    <h3>{c.page} {evidenceSegment.page_start === evidenceSegment.page_end ? evidenceSegment.page_start : `${evidenceSegment.page_start}–${evidenceSegment.page_end}`}</h3>
    <p className={styles.evidenceExcerpt}>{evidenceSegment.text}</p>
    <dl><div><dt>{e.segmentReceipt}</dt><dd className={styles.source}>{evidenceSegment.segment_text_sha256}</dd></div>
     <div><dt>{e.sourceRange}</dt><dd className={styles.source}>{evidenceSegment.start_byte}–{evidenceSegment.end_byte}</dd></div>
    </dl>
    <button onClick={() => document.getElementById(`research-segment-${evidenceSegment.segment_index}`)?.focus()}>{e.returnPassage}</button>
   </section>}
   {shown.selection && <details className={styles.contextPanel} open={shown.phase === "changed"}>
    <summary>{c.source}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary><p className={styles.coverage}>{c.same}</p>
    <dl>{[[e.identifier, shown.docId], [c.sourceHash, shown.selection.sourcePdfSha256], [c.textHash, shown.selection.extractedTextSha256], [c.extractor, shown.selection.extractorVersion], [c.segmenter, shown.selection.segmenterVersion]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={styles.source}>{value}</dd></div>)}</dl>
    {shown.body?.catalogGeneratedAt && <p className={styles.coverage}>{c.generated}: {shown.body.catalogGeneratedAt}</p>}
    <p className={styles.coverage}>{c.evidenceNote}</p>
   </details>}
   <p className={styles.coverage}>{c.localNote}</p>
  </aside>
 </section>;
 return <main id="shared-shell-content" tabIndex={-1} className={styles.root}>
  <header className={styles.heading}><div><h1>{c.title}</h1>{!hasSelection && <p>{c.intro}</p>}</div>
   <div className={styles.actions}>{hasSelection && <a href="#research-library" onClick={() => setLibraryOpen(true)}>{e.browseLibrary}</a>}<Link href="/analysis?view=investigations">{c.saved}</Link><Link href="/research_screener.html">{pick(lang === "zh", "Research screener", "研究筛选器")}</Link><Link href="/today">{c.return}</Link></div>
  </header>
  {ended ? <div role="status" className={styles.notice}>{c.auth} <button onClick={() => onboarding.open("signin")}>{c.signIn}</button><button onClick={retryIdentity}>{pick(lang === "zh", "Recheck selected context", "重新验证所选内容")}</button></div>
   : identityUnavailable ? <div role="status" className={styles.notice}><p>{pick(lang === "zh", "The account service is unavailable. Private research is hidden.", "账户服务暂不可用。私人研究已隐藏。")}</p><button onClick={retryIdentity}>{c.retry}</button></div>
   : !ready ? <div role="status" className={styles.loading}>{c.loading}<div className={styles.skeleton}/></div>
   : <>
    {reading}
    <section key="library" className={`${styles.library} ${!hasSelection ? styles.libraryFirst : ""}`} aria-labelledby="research-library">
     <details className={styles.libraryDisclosure} open={!hasSelection || libraryOpen} onToggle={event => setLibraryOpen(event.currentTarget.open)}>
      <summary><h2 id="research-library">{hasSelection ? e.browseLibrary : c.library}</h2></summary>
      {!hasSelection && <p className={styles.coverage}>{c.choose}</p>}
      {!hasSelection && progress && <section className={styles.contextPanel} aria-label={c.continue}>
       <div className={styles.eyebrow}>{c.local}</div><h3>{items.find(item => item.id === progress.selection.docId)?.title || e.selectedReport}</h3>
       <p className={styles.coverage}>{c.localNote}</p><button onClick={() => void open(progress.selection.docId, progress.selection, progress.segmentStart)}>{c.continue} →</button>
      </section>}
      <div key="selection-contents">{libraryContents}</div>
     </details>
    </section>
   </>}
 </main>;
}

/** Subject switches destroy the entire reader lifetime, including A→B→A re-entry. */
export default function ResearchWorkspace({ownerKey}:{ownerKey:string}) {
 return <ResearchWorkspaceSession key={ownerKey} ownerKey={ownerKey}/>;
}
