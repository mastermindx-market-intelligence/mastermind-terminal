"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLang, useT } from "@/lib/i18n";
import { companyHref } from "@/lib/sectorIntelligence";
import { exampleAllocation, marketAllocation, SAMPLE_LOTS } from "@/lib/portfolioAllocation";
import type { WorkspaceQuote, WorkspaceManifest } from "@/lib/portfolioWorkspace";
import type { Position } from "@/lib/portfolio";
import AssetLogo from "./AssetLogo";
import s from "./PortfolioAllocation.module.css";

const colors = ["#91b3f0", "#57b6a8", "#caa963", "#a998cc", "#bb909b", "#88a4ac"];
type Props = {
  positions: readonly Position[];
  quotes: Readonly<Record<string, WorkspaceQuote>>;
  manifest: Readonly<Record<string, WorkspaceManifest>>;
  sample?: boolean;
  onAdd?: () => void;
};

export default function PortfolioAllocation({ positions, quotes, manifest, sample = false, onAdd }: Props) {
  const { lang } = useLang();
  const t = useT();
  const zh = lang === "zh";
  const sampleBook = useMemo(() => sample ? exampleAllocation(quotes) : null, [sample, quotes]);
  const book = useMemo(() => sampleBook?.allocation ?? marketAllocation(positions, quotes, manifest),
    [sampleBook, positions, quotes, manifest]);
  if (!book) return null;
  const { total, rows, currency } = book;
  const money = new Intl.NumberFormat(zh ? "zh-CN" : "en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 });
  const visible = rows.slice(0, 5);
  const remaining = rows.slice(5).reduce((sum, row) => sum + row.weight, 0);
  return <section className={s.allocation} data-testid={sample ? "portfolio-sample" : "portfolio-allocation"}>
    {sample && <div className={s.summary}>
      <div><p className={s.overline}>{zh ? "示例投资组合" : "Sample portfolio"}</p>
        <h2>{money.format(total)}</h2>
        <p>{sampleBook?.observed ? (zh ? "示例股数 · 市场报价" : "Example quantities · market quotes") : (zh ? "示例股数及价格" : "Illustrative quantities and prices")} · {currency}</p></div>
      {onAdd && <button type="button" className="pf-btn" onClick={onAdd}>{t("addPosition")}</button>}
    </div>}
    <header><h2>{zh ? "按市值分配" : "Allocation by market value"}</h2>
      <p>{sample ? (zh ? "这些示例持仓独立于您的账户。" : "These example positions are separate from your account.") : (zh ? "全部未平仓持仓" : "All open holdings")} · {currency}</p></header>
    <div className={s.bar} aria-hidden="true">
      {visible.map((row, i) => <span key={row.ticker} style={{ flexGrow: row.weight, background: colors[i] }} />)}
      {remaining > 0 && <span style={{ flexGrow: remaining, background: colors[5] }} />}
    </div>
    <ul className={s.rows}>{visible.map((row, i) => {
      const example = sample ? SAMPLE_LOTS.find(p => p.ticker === row.ticker) : null;
      const label = (zh && manifest[row.ticker]?.zh) || manifest[row.ticker]?.name || example?.name || row.ticker;
      const href = companyHref(row.ticker);
      return <li key={row.ticker}>
        <AssetLogo symbol={row.ticker} name={label} color={colors[i]} size={28} />
        <div className={s.name}>{href ? <Link href={href}>{row.ticker}</Link> : <b>{row.ticker}</b>}
          <small>{label}{example ? " · " + example.sector[zh ? 1 : 0] : ""}</small></div>
        <span>{money.format(row.value)}</span><strong>{row.weight.toFixed(1)}%</strong>
      </li>;
    })}{remaining > 0 && <li><div className={s.name}>{zh ? "其他持仓" : "Other holdings"}</div><strong>{remaining.toFixed(1)}%</strong></li>}</ul>
  </section>;
}
