"use client";

import { useEffect } from "react";
import Link from "next/link";
import { applyLang, useLang } from "@/lib/i18n";
import { pick } from "@/lib/finFormat";
import styles from "./not-found.module.css";

export default function NotFoundActions() {
  const { lang } = useLang();
  const zh = lang === "zh";
  useEffect(() => {
    // A streamed 404 may omit the root startup script. Use the existing language
    // applier only when no active language exists; the account owner keeps priority.
    if (document.documentElement.hasAttribute("data-lang")) return;
    try {
      const saved = localStorage.getItem("mm.lang");
      if (saved === "en" || saved === "zh") applyLang(saved);
    } catch { /* Retain the provider default when storage is unavailable. */ }
  }, []);

  return <>
    <p className={styles.body}>{pick(zh,
      "This link may be out of date or the address may be incorrect. Start again from Today or browse the available tools.",
      "此链接可能已失效，或地址有误。你可以从今日概览重新开始，或浏览可用工具。"
    )}</p>
    <nav className={styles.actions} aria-label={pick(zh, "Recovery destinations", "返回入口")}>
      <Link href="/today" prefetch={false} className={`${styles.action} ${styles.primary}`}>
        {pick(zh, "Go to Today", "前往今日")} <span aria-hidden="true">→</span>
      </Link>
      <Link href="/discover" prefetch={false} className={`${styles.action} ${styles.secondary}`}>
        {pick(zh, "Browse tools", "浏览工具")}
      </Link>
      <Link href="/terminal" prefetch={false} className={`${styles.action} ${styles.chart}`}>
        {pick(zh, "Go to chart", "返回图表")}
      </Link>
    </nav>
  </>;
}
