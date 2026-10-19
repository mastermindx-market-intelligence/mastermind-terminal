"use client";

import { sectorPaperText } from "@/lib/sectorPaperCopy";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { identityUserId, type AccountIdentity } from "@/lib/accountIdentity";
import { companyHref, object, text, type Row } from "@/lib/sectorIntelligence";
import { paperOwnedWatchlists } from "@/lib/sectorPaperWatches";
import type { ServerWatchlist } from "@/lib/watchlists";
import styles from "./PaperSectorWorkspace.module.css";

type Inventory = { owner:string; requestKey:string; status:"ready"|"access"|"error"|"invalid"; lists:ServerWatchlist[] };
type SaveState = { owner:string; listId:string; status:"saving"|"saved"|"unconfirmed" };
type Props = {
  identity:AccountIdentity; lang:"en"|"zh"; sector:Row; sectors:Row[]; refreshEpoch:number;
  onInspect:(id:string)=>void;
};

/** A consumer of /api/watchlist. The existing service owns auth, grants and persistence.
 * This page neither restores local lists nor runs TerminalShell's migration/outbox.
 */
export default function PaperSectorWatches({identity,lang,sector,sectors,refreshEpoch,onInspect}:Props){
  const zh=lang==="zh", owner=identityUserId(identity);
  const [inventory,setInventory]=useState<Inventory|null>(null);
  const [reload,setReload]=useState(0);
  const [save,setSave]=useState<SaveState|null>(null);
  const pending=useRef<AbortController|null>(null);
  const requestKey=refreshEpoch+":"+reload;
  const current=owner && inventory?.owner===owner && inventory.requestKey===requestKey ? inventory : null;
  const activeSave=save?.owner===owner ? save : null;
  const ticker=text(sector.ticker), validTicker=companyHref(ticker) ? ticker : "";
  const sectorName=text(zh?sector.name_zh:sector.name)||text(sector.name)||ticker;

  useEffect(()=>{
    if(!owner)return;
    const controller=new AbortController();let alive=true;
    void (async()=>{
      let result:Inventory;
      try{
        const response=await fetch("/api/watchlist",{credentials:"same-origin",cache:"no-store",
          headers:{Accept:"application/json"},signal:controller.signal});
        if(response.status===401 || response.status===403)result={owner,requestKey,status:"access",lists:[]};
        else if(!response.ok)result={owner,requestKey,status:"error",lists:[]};
        else{
          const lists=paperOwnedWatchlists(await response.json());
          result={owner,requestKey,status:lists?"ready":"invalid",lists:lists || []};
        }
      }catch{
        if(controller.signal.aborted)return;
        result={owner,requestKey,status:"error",lists:[]};
      }
      if(alive)setInventory(result);
    })();
    return()=>{alive=false;controller.abort();};
  },[owner,requestKey]);

  useEffect(()=>()=>{pending.current?.abort();pending.current=null;},[owner]);

  async function addToList(list:ServerWatchlist){
    if(!owner || !validTicker || current?.status!=="ready" || pending.current
      || !current.lists.some(row=>row.id===list.id) || list.symbols.some(row=>row.symbol===validTicker))return;
    const controller=new AbortController();pending.current=controller;
    setSave({owner,listId:list.id,status:"saving"});
    try{
      const response=await fetch("/api/watchlist",{method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json",Accept:"application/json"},signal:controller.signal,
        body:JSON.stringify({action:"add",listId:list.id,symbols:[validTicker]})});
      const body=object(await response.json());
      if(controller.signal.aborted)return;
      if(response.status===401 || response.status===403){
        setInventory({owner,requestKey,status:"access",lists:[]});
        setSave(null);
      }else{
        setSave({owner,listId:list.id,status:response.ok && body.ok===true?"saved":"unconfirmed"});
        // Reconcile the canonical inventory even when the write was not confirmed.
        setReload(value=>value+1);
      }
    }catch{
      if(!controller.signal.aborted){
        setSave({owner,listId:list.id,status:"unconfirmed"});
        setReload(value=>value+1);
      }
    }finally{if(pending.current===controller)pending.current=null;}
  }

  const status=!owner ? "access" : current?.status || "loading";
  return <section className={styles.watchWorkspace} data-testid="paper-sector-watches">
    <div className={styles.exploreHeading}><div><h2>{sectorPaperText(lang, "siPaperKeepTheNextInvestigationInView")}</h2>
      <p>{sectorPaperText(lang, "siPaperYourExistingListsAreSavedToYourAccountSector")}</p></div>
      <Link className={styles.textLink} href="/terminal">{sectorPaperText(lang, "siPaperManageWatchlists")} ↗</Link></div>
    {status!=="ready" ? <div className={styles.emptyState} role="status"><h3>{
      status==="loading" ? sectorPaperText(lang, "siPaperLoadingYourLists") :
      status==="access" ? sectorPaperText(lang, "siPaperSignInToReadSavedLists") :
      status==="invalid" ? sectorPaperText(lang, "siPaperTheSavedListResponseNeedsACheck") :
      sectorPaperText(lang, "siPaperSavedListsCouldNotBeRead")}</h3>
      {status==="access" ? <Link className={styles.textLink} href="/login">{sectorPaperText(lang, "lgSignIn")} →</Link> :
        status!=="loading" && <button type="button" className={styles.textButton} onClick={()=>setReload(value=>value+1)}>{sectorPaperText(lang, "siPaperReloadLists")} →</button>}
    </div> : <div className={styles.instrumentGrid}><div>
      {activeSave && activeSave.status!=="saving" && <p className={styles.saveStatus} role="status">{
        activeSave.status==="saved" ? sectorPaperText(lang, "siPaperSaveConfirmedTheListsHaveBeenReadAgainFrom") :
        sectorPaperText(lang, "siPaperTheSaveWasNotConfirmedTheListsHaveBeen")}</p>}
      {current!.lists.length===0 && <div className={styles.emptyState}><h3>{sectorPaperText(lang, "siPaperNoSavedListsAreAvailable")}</h3>
        <p>{sectorPaperText(lang, "siPaperCreateAListInTheSharedChartWorkspaceThen")}</p></div>}
      {current!.lists.map(list=><section key={list.id} className={styles.watchList} data-watchlist-id={list.id}>
        <div className={styles.sectionHeading}><div><h3>{list.name}</h3><p className={styles.label}>{list.symbols.length} {sectorPaperText(lang, "siPaperSavedSymbols")}</p></div>
          {validTicker && <button type="button" className={styles.neutralButton}
            disabled={activeSave?.status==="saving" || list.symbols.some(row=>row.symbol===validTicker)}
            onClick={()=>void addToList(list)} aria-label={sectorPaperText(lang, "siPaperWatchIn", validTicker, list.name)}>{
            list.symbols.some(row=>row.symbol===validTicker) ? sectorPaperText(lang, "siPaperIsSaved", validTicker) :
            activeSave?.status==="saving" && activeSave.listId===list.id ? sectorPaperText(lang, "siPaperSaving") :
            sectorPaperText(lang, "siPaperWatch", validTicker)}</button>}</div>
        <ul className={styles.watchSymbols}>{list.symbols.slice(0,60).map(item=>{
          const matches=sectors.filter(row=>text(row.ticker)===item.symbol);
          const match=matches.length===1 ? matches[0] : null, href=companyHref(item.symbol);
          return <li key={item.symbol}><div><strong>{item.symbol}</strong>{item.section && <small>{item.section}</small>}</div>
            {match ? <button type="button" className={styles.textButton} onClick={()=>onInspect(text(match.id))}>{sectorPaperText(lang, "siPaperInspectSector")} →</button> :
              href ? <Link className={styles.textLink} href={href}>{sectorPaperText(lang, "siPaperOpenResearch")} ↗</Link> : <span>{sectorPaperText(lang, "siPaperResearchLinkUnavailable")}</span>}</li>;
        })}</ul>
        {list.symbols.length>60 && <p className={styles.chartNote}>{sectorPaperText(lang, "siPaperTheFirst60SymbolsAreShownHereTheFull")}</p>}
        {!list.symbols.length && <p className={styles.chartNote}>{sectorPaperText(lang, "siPaperThisListHasNoSavedSymbolsYet")}</p>}
      </section>)}
    </div><aside className={styles.inspector}><p className={styles.label}>{sectorPaperText(lang, "siPaperSelectedSectorProxy")}</p><h3>{sectorName || "—"}</h3>
      <p className={styles.distinctionNote}>{sectorPaperText(lang, "siPaperSavingASymbolPreservesAWayBackToThe")}</p>
      {validTicker && <button type="button" className={styles.textButton} onClick={()=>onInspect(text(sector.id))}>{sectorPaperText(lang, "siPaperOpenSectorDossier")} →</button>}
      <p className={styles.chartNote}>{sectorPaperText(lang, "siPaperListsSharedWithYouDeletionAndListOrganizationRemain")}</p>
    </aside></div>}
  </section>;
}
