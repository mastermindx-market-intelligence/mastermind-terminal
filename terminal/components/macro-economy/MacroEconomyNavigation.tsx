import Link from "next/link";
import type { ReactNode } from "react";
import s from "./MacroEconomy.module.css";

const COPY = {
  en: { macro: "Macro", today: "Today", economy: "Economy" },
  zh: { macro: "宏观", today: "今日", economy: "经济" },
} as const;

/** One product navigation across the daily view and its economic workspaces. */
export default function MacroEconomyNavigation({ active, lang, dashboardHref, overviewHref, children }: {
  active: "today" | "economy"; lang: "en" | "zh";
  dashboardHref: string; overviewHref: string; children?: ReactNode;
}) {
  const c = COPY[lang];
  return <nav className={s.productNav} aria-label={c.macro} data-macro-navigation="">
    <div className={s.productLinks}><strong className={s.productTitle}>{c.macro}</strong>
      <Link href={dashboardHref} aria-current={active === "today" ? "page" : undefined} prefetch={false}>{c.today}</Link>
      <Link href={overviewHref} aria-current={active === "economy" ? "page" : undefined} prefetch={false}>{c.economy}</Link>
    </div>{children}
  </nav>;
}
