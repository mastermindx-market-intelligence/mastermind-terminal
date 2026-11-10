"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { pickLang } from "@/lib/portfolioBrief";
import { SHARED_SHELL_MARKETS } from "@/lib/sharedShellNavigation";
import { SHARED_SHELL_COPY } from "@/lib/sharedShellCopy";
import today from "./TodayWorkspace.module.css";

/** Entrances to existing owners, not another opportunity feed or route registry.
 * Keep prefetch off: opening Today must not load every full research workspace.
 * Admission and access remain with the existing shared-shell route projection. */
const DESTINATIONS = [
  { href: "/us_stocks.html", en: "Prophet candidates", zh: "先知候选", detail: "US stock board", detailZh: "美国股票看板", icon: "discover" },
  { href: "/sector_central.html", en: "Sectors & themes", zh: "行业与主题", detail: "Leadership and rotation", detailZh: "市场领导者与轮动", icon: "sectors" },
  { href: "/macro_context.html", en: "Risk backdrop", zh: "风险背景", detail: "Macro conditions", detailZh: "宏观环境", icon: "risk" },
  { href: "/discover?tab=catalysts", en: "Company catalysts", zh: "公司催化剂", detail: "Events and disclosures", detailZh: "事件与披露", icon: "events" },
] as const;

function DestinationIcon({ icon }: { icon: typeof DESTINATIONS[number]["icon"] }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {icon === "discover" ? <><circle cx="12" cy="12" r="8" /><path d="m15 9-2 4-4 2 2-4Z" /></>
      : icon === "sectors" ? <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>
      : icon === "risk" ? <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="M12 8v5m0 3h.01" /></>
      : <><rect x="4" y="6" width="16" height="15" rx="2" /><path d="M8 3v6m8-6v6M4 12h16m-12 4h3m3 0h2" /></>}
  </svg>;
}

export default function TodayDeskDestinations() {
  const { lang } = useLang();
  const zh = lang === "zh";
  const pick = (en: string, zh: string) => pickLang({ en, zh }, lang);
  return <section className={today.deskDestinations} aria-labelledby="today-explore">
    <h2 id="today-explore">{pick("From market to company", "从市场到公司")}</h2>
    <nav aria-label={pick("Research workflows", "研究工作流")}>
      {DESTINATIONS.map(item => <Link key={item.href} href={item.href} prefetch={false} className={today.deskDestination}>
        <DestinationIcon icon={item.icon} />
        <span><strong>{zh ? item.zh : item.en}</strong><small>{zh ? item.detailZh : item.detail}</small></span>
        <span className={today.destinationArrow} aria-hidden="true">→</span>
      </Link>)}
    </nav>
    <div className={today.marketDestinations}>
      <h3>{pick("Other markets", "其他市场")}</h3>
      <nav aria-label={pick("Other market overviews", "其他市场概览")}>
        {SHARED_SHELL_MARKETS.filter(market => market.code !== "US").map(market =>
          <Link key={market.code} href={market.href} prefetch={false}>{SHARED_SHELL_COPY[market.k]?.(lang) ?? market.label}</Link>)}
      </nav>
    </div>
  </section>;
}
