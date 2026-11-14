"use client";
import {useEffect,useState} from "react";
import PortfolioAllocation from "./PortfolioAllocation";
import {SAMPLE_LOTS} from "@/lib/portfolioAllocation";
import type {WorkspaceQuote} from "@/lib/portfolioWorkspace";
const symbols=SAMPLE_LOTS.map(row=>row.ticker).join(",");
export default function PortfolioGuestSample(){
  const [quotes,setQuotes]=useState<Record<string,WorkspaceQuote>>({});
  useEffect(()=>{
    const controller=new AbortController();
    let pending=false;
    async function refresh(){
      if(pending||controller.signal.aborted||document.hidden)return;
      pending=true;
      try{
        const response=await fetch("/api/portfolio/prices?symbols="+encodeURIComponent(symbols),{credentials:"omit",cache:"no-store",signal:controller.signal});
        if(!response.ok)throw new Error("Quotes unavailable");
        const data=await response.json();
        if(!controller.signal.aborted)setQuotes(data.prices??{});
      }catch{if(!controller.signal.aborted)setQuotes({});}
      finally{pending=false;}
    }
    void refresh();const timer=setInterval(refresh,15000);
    document.addEventListener("visibilitychange",refresh);
    return ()=>{controller.abort();clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};
  },[]);
  return <PortfolioAllocation sample positions={[]} quotes={quotes} manifest={{}} />;
}
