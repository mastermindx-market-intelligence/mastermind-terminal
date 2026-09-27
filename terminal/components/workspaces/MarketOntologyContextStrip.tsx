"use client";

import { useLang } from "@/lib/i18n";
import { marketOntologyReturnHref, type MarketOntologyContext } from "@/lib/marketOntologyContext";
import styles from "./MarketOntologyContextStrip.module.css";

function copy(lang: "en" | "zh") {
  if (lang === "zh") {
    return {
      title: "来自 WTI 实时路径",
      body: "该公司是从 MarketOntology 研究路径打开的。此上下文不会保存到你的论点中。",
      asof: "截至 {date}",
      knowledgeCutoff: "知识截止 {date}",
      action: "返回 WTI 实时路径",
    };
  }
  return {
    title: "Opened from WTI Live Path",
    body: "This company was opened from a MarketOntology research path. The context is not saved into your theses.",
    asof: "As of {date}",
    knowledgeCutoff: "Knowledge cutoff {date}",
    action: "Back to WTI Live Path",
  };
}

function formatDate(value: string, locale: string) {
  const [year, month, day] = value.split("-");
  const formatted = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
  return formatted;
}

export default function MarketOntologyContextStrip({ context }: { context: MarketOntologyContext }) {
  const { lang } = useLang();
  const labels = copy(lang);
  const locale = lang === "zh" ? "zh-CN" : "en-CA";

  return (
    <section className={styles.strip} data-testid="mo-context-strip">
      <div className={styles.copy}>
        <p className={styles.title}>{labels.title}</p>
        <p className={styles.body}>{labels.body}</p>
        {(context.asof || context.kc) && (
          <p className={styles.dates}>
            {context.asof && (
              <time dateTime={context.asof}>{labels.asof.replace("{date}", formatDate(context.asof, locale))}</time>
            )}
            {context.kc && (
              <time dateTime={context.kc}>
                {labels.knowledgeCutoff.replace("{date}", formatDate(context.kc, locale))}
              </time>
            )}
          </p>
        )}
      </div>
      <a className={styles.return} href={marketOntologyReturnHref(context)} rel="noopener">
        {labels.action}
      </a>
    </section>
  );
}
