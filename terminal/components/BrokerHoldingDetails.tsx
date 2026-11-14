"use client";
import {useEffect,useRef} from "react";
import type {Position} from "@/lib/portfolio";
import {useLang} from "@/lib/i18n";
import s from "./PortfolioWorkspace.module.css";
export default function BrokerHoldingDetails({position,onClose}:{position:Position;onClose:()=>void}){
  const {lang}=useLang(),zh=lang==="zh",dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=dialog.current,origin=document.activeElement as HTMLElement|null;d?.showModal();return()=>{d?.close();if(origin?.isConnected)origin.focus();};},[]);
  const asset=position.brokerage;
  if(!asset)return null;
  const label=zh?"券商估值":"Institution valuation";
  return <dialog ref={dialog} className={s.recordDialog} aria-labelledby="broker-asset-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <div className={s.dialogInner}><header className={s.dialogHeader}>
      <button className="pf-btn" onClick={onClose}>{zh?"关闭":"Close"}</button>
      <h2 id="broker-asset-title">{asset.name}</h2><p>{asset.account}</p></header>
      <div className={s.dialogBody}><dl className={s.recordFields}>
        <div><dt>{label}</dt><dd>{asset.value!==null && asset.currency ? asset.currency+" "+asset.value.toLocaleString(zh?"zh-CN":"en-US") : "—"}</dd></div>
        <div><dt>{zh?"数量":"Quantity"}</dt><dd>{position.shares ?? "—"}</dd></div>
        <div><dt>{zh?"估值日期":"Valuation date"}</dt><dd>{asset.asOf ?? "—"}</dd></div>
        <div><dt>{zh?"最后同步":"Last synced"}</dt><dd>{new Date(asset.syncedAt).toLocaleString(zh?"zh-CN":"en-US")}</dd></div>
      </dl></div></div>
  </dialog>;
}
