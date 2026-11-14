"use client";
import {useMemo} from "react";
import type {Position} from "@/lib/portfolio";
import {marketAllocation} from "@/lib/portfolioAllocation";
import type {WorkspaceManifest,WorkspaceQuote} from "@/lib/portfolioWorkspace";
import {useLang} from "@/lib/i18n";
import s from "./PortfolioAllocation.module.css";

export default function PortfolioMarketRisk({positions,quotes,manifest}:{positions:Position[];quotes:Record<string,WorkspaceQuote>;manifest:Record<string,WorkspaceManifest>}){
  const {lang}=useLang(),zh=lang==="zh";
  const book=useMemo(()=>marketAllocation(positions,quotes,manifest),[positions,quotes,manifest]);
  if(!book)return null;
  const groups=new Map<string,number>();
  for(const row of book.rows){const sector=manifest[row.ticker]?.gics?.trim() || (zh?"未分类":"Unclassified");groups.set(sector,(groups.get(sector)??0)+row.weight);}
  const sectors=[...groups].sort((a,b)=>b[1]-a[1]);
  const effective=1/book.rows.reduce((sum,row)=>sum+Math.pow(row.weight/100,2),0);
  return <section className={s.allocation} data-testid="portfolio-market-risk"><header><h2>{zh?"市值敞口":"Exposure at market value"}</h2>
    <p>{zh?"按全部未平仓持仓市值加权":"Weighted across all open holdings"} · {book.currency}</p></header>
    <div className={s.metrics}><div><small>{zh?"最大持仓":"Largest holding"}</small><strong>{book.rows[0].ticker} · {book.rows[0].weight.toFixed(1)}%</strong></div>
    <div><small>{zh?"前三大持仓":"Top three holdings"}</small><strong>{book.rows.slice(0,3).reduce((sum,row)=>sum+row.weight,0).toFixed(1)}%</strong></div>
    <div><small>{zh?"等权等效持仓数":"Effective number of holdings"}</small><strong>{effective.toFixed(1)}</strong></div></div>
    <h3>{zh?"板块敞口":"Sector exposure"}</h3>
    <ul className={s.rows}>{sectors.map(([name,weight])=><li key={name}><span className={s.name}>{name}</span><meter min={0} max={100} value={weight} aria-label={name}/><strong>{weight.toFixed(1)}%</strong></li>)}</ul>
    <p>{zh?"等效持仓数为权重平方和的倒数。":"Effective holdings is one divided by the sum of squared portfolio weights."}</p>
  </section>;
}
