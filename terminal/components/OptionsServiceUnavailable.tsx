"use client";

import { useLang, type Lang } from "@/lib/i18n";
import { BrandMark } from "@/components/BrandMark";
import Link from "next/link";
import styles from "./OptionsAccess.module.css";

/** Local bilingual copy avoids changing the globally evidence-locked shell LEX. */
function pick(lang: Lang, en: string, zh: string): string {
  return lang === "zh" ? zh : en;
}

/** An entitlement-provider outage is not a subscription downgrade. No data or
 * workspace is rendered on uncertainty; users can retry without a billing flow. */
export default function OptionsServiceUnavailable() {
  const { lang } = useLang();
  return (
    <main id="shared-shell-content" tabIndex={-1} className={styles.viewport} data-options-access="temporarily-unavailable">
      <div className={styles.card} role="status">
        <div className={styles.brand}><BrandMark size={48} /></div>
        <h1 className={styles.title}>
          {pick(lang, "Options is temporarily unavailable", "期权服务暂时不可用")}
        </h1>
        <p className={styles.body}>
          {pick(lang, "We couldn't verify Options access right now. This does not mean your subscription changed. Please retry.", "暂时无法验证访问权限。您的订阅状态尚未改变，请稍后重试。")}
        </p>
        <div className={styles.actions}>
          <button className={`btn btn-primary ${styles.action}`} type="button" onClick={() => window.location.reload()}>
            {pick(lang, "Try again", "重试")}
          </button>
          <Link className={`${styles.action} ${styles.secondary}`} href="/terminal" prefetch={false}>{pick(lang, "Go to chart", "返回图表")}</Link>
        </div>
      </div>
    </main>
  );
}
