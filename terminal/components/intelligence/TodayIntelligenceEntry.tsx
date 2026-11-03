"use client";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import s from "./Intelligence.module.css";
export default function TodayIntelligenceEntry() {
 const { lang } = useLang();
 return <Link className={s.entry} href="/intelligence" prefetch={false}>
  <span><strong>{lang === "zh" ? "市场情报" : "Market Intelligence"}</strong>
  <small>{lang === "zh" ? "宏观环境、Prophet 计划与行业周期，一处查看。" : "Macro context, Prophet plans, and sector cycles in one view."}</small></span>
  <span aria-hidden="true">→</span>
 </Link>;
}
