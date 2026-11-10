"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";
import styles from "./UnsupportedAnalysisRoute.module.css";

const COPY = {
  en: {
    eyebrow: "ANALYSIS LINK",
    title: "This analysis view is not supported",
    body: "Nothing else was opened. Return to company research or use a valid Thesis workspace link.",
    return: "Company research",
  },
  zh: {
    eyebrow: "分析链接",
    title: "不支持此分析视图",
    body: "系统没有打开其他内容。请返回公司研究，或使用有效的研究论点工作区链接。",
    return: "公司研究",
  },
} as const;

export default function UnsupportedAnalysisRoute({ reason }: { reason: string }) {
  const { lang } = useLang();
  const copy = COPY[lang];
  return (
    <main className={`main2 ws-shell ${styles.root}`}>
      <section role="status" className={styles.card}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.body}>{copy.body}</p>
        <Link className={styles.action} href="/analysis" prefetch={false}>{copy.return}</Link>
        <span hidden>{reason}</span>
      </section>
    </main>
  );
}
