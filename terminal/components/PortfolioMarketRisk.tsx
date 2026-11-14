"use client";

import { useMemo, useState } from "react";
import type { Position } from "@/lib/portfolio";
import { marketAllocation } from "@/lib/portfolioAllocation";
import type { WorkspaceManifest, WorkspaceQuote } from "@/lib/portfolioWorkspace";
import { useLang } from "@/lib/i18n";
import s from "./PortfolioAllocation.module.css";

const sectorColors = ["#97b9e8", "#86b4a7", "#b5a1d5", "#c8af79", "#ad93a6", "#789cac",
  "#a8ba99", "#bba18d", "#b6adcf", "#789abb", "#b4b1a3", "#788599"];

export default function PortfolioMarketRisk({ positions, quotes, manifest }: {
  positions: Position[];
  quotes: Record<string, WorkspaceQuote>;
  manifest: Record<string, WorkspaceManifest>;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const book = useMemo(() => marketAllocation(positions, quotes, manifest), [positions, quotes, manifest]);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  if (!book) return null;

  const unknown = zh ? "未分类" : "Unclassified";
  const sectorFor = (ticker: string) => manifest[ticker]?.gics?.trim() || unknown;
  const weights = new Map<string, number>();
  for (const row of book.rows) {
    const sector = sectorFor(row.ticker);
    weights.set(sector, (weights.get(sector) ?? 0) + row.weight);
  }
  let end = 0;
  const sectors = Array.from(weights).sort((a, b) => b[1] - a[1]).map(([name, weight], index) => {
    const start = end;
    end += weight;
    return { name, weight, start, end, color: sectorColors[index % sectorColors.length] };
  });
  const active = sectors.find(sector => sector.name === selectedSector);
  const shown = active ?? sectors[0];
  const gradient = sectors.map(sector => `${sector.color} ${sector.start}% ${sector.end}%`).join(", ");
  const effective = 1 / book.rows.reduce((sum, row) => sum + Math.pow(row.weight / 100, 2), 0);
  const largest = book.rows[0];
  const title = (row: typeof largest) => row.unlisted && row.institutionName ? row.institutionName : row.ticker;

  return <section className={s.allocation} data-testid="portfolio-market-risk">
    <header><h2>{zh ? "市值敞口" : "Exposure at market value"}</h2>
      <p>{zh ? "按全部未平仓持仓市值加权" : "Weighted across all open holdings"} · {book.currency}</p></header>
    <div className={s.metrics}>
      <div><small>{zh ? "最大持仓" : "Largest holding"}</small><strong>{title(largest)} · {largest.weight.toFixed(1)}%</strong></div>
      <div><small>{zh ? "前三大持仓" : "Top three holdings"}</small><strong>{book.rows.slice(0, 3).reduce((sum, row) => sum + row.weight, 0).toFixed(1)}%</strong></div>
      <div><small>{zh ? "等权等效持仓数" : "Effective number of holdings"}</small><strong>{effective.toFixed(1)}</strong></div>
    </div>
    <h3>{zh ? "板块敞口" : "Sector exposure"}</h3>
    <div className={s.sectorGrid}>
      <div className={s.donut} aria-hidden="true" style={{ backgroundImage: `conic-gradient(${gradient})` }}>
        <div><strong>{shown.weight.toFixed(1)}%</strong><span>{shown.name}</span></div>
      </div>
      <ul className={s.sectorList}>{sectors.map(sector => <li key={sector.name}>
        <button type="button" aria-pressed={active?.name === sector.name}
          onClick={() => setSelectedSector(active?.name === sector.name ? null : sector.name)}>
          <i aria-hidden="true" style={{ background: sector.color }}/><span>{sector.name}</span><b>{sector.weight.toFixed(1)}%</b>
        </button>
      </li>)}</ul>
    </div>
    {active && <div className={s.sectorDetails} aria-live="polite">
      <h3>{active.name}</h3><ul className={s.rows}>{book.rows.filter(row => sectorFor(row.ticker) === active.name).map(row =>
        <li key={row.ticker}><span className={s.name}>{title(row)}</span><strong>{row.weight.toFixed(1)}%</strong></li>
      )}</ul>
    </div>}
    <p>{zh ? "等效持仓数为权重平方和的倒数。" : "Effective holdings is one divided by the sum of squared portfolio weights."}</p>
  </section>;
}
