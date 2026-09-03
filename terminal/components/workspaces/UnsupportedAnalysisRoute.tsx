"use client";

import { useLang } from "@/lib/i18n";

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
    <main className="main2 ws-shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
      <section role="status" style={{ maxWidth: 560, padding: 28, border: "1px solid var(--border)", borderRadius: 12 }}>
        <p style={{ color: "var(--text-muted)", margin: "0 0 8px" }}>{copy.eyebrow}</p>
        <h1 style={{ fontSize: 24, margin: "0 0 10px" }}>{copy.title}</h1>
        <p style={{ color: "var(--text-muted)", margin: "0 0 14px" }}>{copy.body}</p>
        <a href="/analysis">{copy.return}</a>
        <span hidden>{reason}</span>
      </section>
    </main>
  );
}
