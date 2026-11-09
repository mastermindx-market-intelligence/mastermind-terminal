"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { INTELLIGENCE_DESTINATIONS, intelligenceActiveKey, type IntelligenceKey } from "@/lib/shared-shell/intelligenceNavigation";
import s from "./Intelligence.module.css";
const GLYPHS: Record<IntelligenceKey, string> = {
 overview: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
 macro: "M3 19h18M5 15V9m7 6V4m7 11v-7",
 prophet: "M3 12c4-7 14-7 18 0-4 7-14 7-18 0ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
 cycles: "M19 8a8 8 0 0 0-13-2L3 9m0-5v5h5m-3 7a8 8 0 0 0 13 2l3-3m0 5v-5h-5",
 sectors: "M12 3v6M5 15v6m14-6v6M5 15h14V9H5z",
};
export default function IntelligenceNav({ mode = "context", labelled = true, onNavigate }: {
 mode?: "context" | "rail" | "drawer"; labelled?: boolean; onNavigate?: () => void;
}) {
 const path = usePathname(), params = useSearchParams(), { lang } = useLang();
 const active = intelligenceActiveKey(path, params.toString());
 const title = lang === "zh" ? "市场情报" : "Market Intelligence";
 return <div role="group" aria-label={title} className={`${s.navigation} ${s[mode]} ${!labelled ? s.compact : ""}`} data-intelligence-nav={mode}>
  {mode !== "context" && labelled && <h2>{title}</h2>}
  <div className={s.links}>{INTELLIGENCE_DESTINATIONS.map(item => <Link key={item.key} href={item.href}
   onClick={onNavigate} prefetch={false} title={item.label[lang === "zh" ? 1 : 0]}
   aria-label={item.label[lang === "zh" ? 1 : 0]} aria-current={active === item.key ? "page" : undefined}>
   <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={GLYPHS[item.key]} /></svg>
   {labelled && <span>{item.label[lang === "zh" ? 1 : 0]}</span>}
  </Link>)}</div>
 </div>;
}
