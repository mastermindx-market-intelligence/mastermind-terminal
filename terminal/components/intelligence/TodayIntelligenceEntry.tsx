"use client";
import Link from "next/link";
import { useLang, type Lang } from "@/lib/i18n";
import s from "./Intelligence.module.css";
function pick(lang: Lang, en: string, zh: string): string {
 return lang === "zh" ? zh : en;
}
export default function TodayIntelligenceEntry() {
 const { lang } = useLang();
 return <Link className={s.entry} href="/intelligence" prefetch={false}>
  <span><strong>{pick(lang, "Market Intelligence", "市场情报")}</strong>
  <small>{pick(lang, "Macro context, Prophet plans, and sector cycles in one view.", "宏观环境、Prophet 计划与行业周期，一处查看。")}</small></span>
  <span aria-hidden="true">→</span>
 </Link>;
}
