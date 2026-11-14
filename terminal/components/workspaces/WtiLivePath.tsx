"use client";
import { useSyncExternalStore } from "react";
import { useLang } from "@/lib/i18n";
import { useSettings } from "@/components/settings/SettingsProvider";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { primaryReading, readingText, WTI_LEGS, type WtiLegId, type WtiRead, type WtiReceipt } from "@/lib/wtiPath";
import styles from "./WtiLivePath.module.css";

const names = {
  oil_shock: ["Oil", "原油"], breakeven_rise: ["Inflation", "通胀"], yield_rise: ["Real yields", "实际收益率"], duration_derate: ["Duration", "久期"],
};
const operator: Record<string, string> = { gt: ">", lt: "<", eq: "=", gte: "≥", lte: "≤" };
const messages = {
  signin: ["Sign in to see the four current readings.", "登录后查看四项条件的当前读数。"],
  restricted: ["Your plan needs research access to open these readings.", "查看这些读数需要研究权限。"],
  unavailable: ["The source reading is unavailable.", "暂时无法获取来源读数。"],
  incoherent: ["The source records disagree. A consistent reading is needed.", "来源记录不一致，暂时无法确认读数。"],
  limited: ["The source is receiving too many requests. Try again shortly.", "来源请求过多，请稍后重试。"],
};
const subscribeHash = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};
const hashLeg = () => window.location.hash.replace(/^#ox-leg-/, "");
function metricLabel(r: WtiReceipt, id: WtiLegId, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    ma_slope: ["Moving-average change", "移动平均线变化"], ret: ["Return", "回报"], ret_pct: ["Return", "回报"],
    rs: ["Relative return", "相对回报"], rs_pp: ["Relative return", "相对回报"], ret_bp: ["Breakeven change", "盈亏平衡通胀率变化"],
  };
  const label = labels[r.metric ?? ""] ?? (id === "yield_rise" && r.op === "eq" ? ["Yield direction", "收益率方向"] :
    id === "yield_rise" && r.op === "gt" ? ["Real-yield change", "实际收益率变化"] : ["Source reading", "来源读数"]);
  return label[zh ? 1 : 0];
}

export default function WtiLivePath({ read, requestedRevision, explorer }: { read: WtiRead; explorer: string; requestedRevision: string | null }) {
  const { lang } = useLang(), zh = lang === "zh";
  const t = (en: string, cn: string) => zh ? cn : en;
  const onboarding = useOnboarding(), settings = useSettings();
  const hash = useSyncExternalStore(subscribeHash, hashLeg, () => "");
  const fallback = <a className={styles.link} href={explorer}>{t("Open full transmission explorer", "打开完整传导研究")} ↗</a>;
  const path = read.status === "ready" ? read.data : null;
  const revisionChanged = path && requestedRevision !== null && requestedRevision !== String(path.revision);
  const focus = WTI_LEGS.find(id => id === hash);
  const selected = path?.legs.find(leg => leg.id === (focus ?? path.blocker ?? WTI_LEGS[0]));
  const blocked = path?.legs.find(leg => leg.id === path.blocker);
  const verdict = (value: boolean | null) => value === null ? t("No reading", "暂无读数") : value ? t("Met", "满足") : t("Unmet", "未满足");
  const headline = blocked ? names[blocked.id][zh ? 1 : 0] + (blocked.confirmed === null ? t(" reading unavailable", "读数暂缺") : t(" condition unmet", "条件未满足"))
    : t("All four conditions met", "四项条件均满足");
  const primary = selected && primaryReading(selected);
  return <main id="shared-shell-content" tabIndex={-1} className={`main2 ${styles.viewport}`}>
    <div className={styles.page}>
      <header className={styles.header}><span>{t("Research / Capital & regimes", "研究 / 资本与市场环境")}</span><h1>{t("WTI Live Path", "WTI 实时路径")}</h1></header>
      {read.status !== "ready" ? <section className={styles.hero}>
        <h2>{t("Oil, inflation and real yields", "原油、通胀与实际收益率")}</h2>
        <p>{messages[read.status][zh ? 1 : 0]}</p>
        {read.status === "signin" ? <button type="button" onClick={() => onboarding.open("signin")}>{t("Sign in", "登录")}</button> :
          read.status === "restricted" ? <button type="button" onClick={() => settings.open("billing")}>{t("View plan", "查看订阅")}</button> :
          <button type="button" onClick={() => window.location.reload()}>{t("Try again", "重试")}</button>}
      </section> : path && selected && <>
        {revisionChanged && <p role="status" className={styles.notice}>{t("The linked revision differs. Showing the current revision", "链接版本与当前版本不同，现显示版本")} {path.revision}.</p>}
        <section className={styles.hero}>
          <div className={styles.meta}>{t("Episode", "传导状态")} · {path.episode[lang]}</div>
          <h2>{headline}</h2>
          <p>{path.contradiction ? path.contradiction[lang] :
            t("Read each condition in transmission order.", "按传导顺序查看每个条件。")}</p>
          <div className={styles.meta}>{t("Observed", "观测日期")} · {path.observed ?? t("Date unavailable", "日期未知")}</div>
        </section>
        <section aria-label={t("Transmission conditions", "传导条件")} className={styles.legs}>
          {path.legs.map((leg, i) => {
            const first = primaryReading(leg);
            return <a key={leg.id} href={"#ox-leg-" + leg.id} aria-current={selected.id === leg.id ? "true" : undefined}
              className={styles.leg} data-status={leg.confirmed === true ? "met" : leg.confirmed === false ? "unmet" : "unknown"}>
              <small>{String(i + 1).padStart(2, "0")} · {verdict(leg.confirmed)}</small>
              <strong>{names[leg.id][zh ? 1 : 0]}</strong>
              <span>{first ? readingText(first.value, first, leg.id, lang) : "—"}</span>
            </a>;
          })}
        </section>
        <section className={styles.evidence} id={"ox-leg-" + selected.id} aria-labelledby="wti-evidence-title" aria-live="polite">
          <div className={styles.evidenceHead}><div><small>{t("Selected condition", "选中条件")}</small>
            <h2 id="wti-evidence-title">{selected.title[lang]}</h2></div>
            <strong className={styles.number}>{primary ? readingText(primary.value, primary, selected.id, lang) : "—"}</strong></div>
          {selected.receipts.length > 0 ? <div className={styles.receipts}>{selected.receipts.map((r, i) =>
            <article key={i}><small>{[r.series, r.vs && "vs " + r.vs, r.window && r.window + t(" observations", " 次观测")].filter(Boolean).join(" · ")}</small>
              <h3>{metricLabel(r, selected.id, zh)}</h3><strong>{readingText(r.value, r, selected.id, lang)}</strong>
              <p>{t("Requires", "要求")} {r.op ? operator[r.op] ?? r.op : "—"} {readingText(r.threshold, r, selected.id, lang)}</p>
              <span>{verdict(r.passed)}</span></article>)}</div>
            : <p>{t("The source has no reading for this condition.", "来源未提供此条件的读数。")}</p>}
          <details><summary>{t("Source and timing", "来源与时间")}</summary><dl>
            <dt>{t("Source", "来源")}</dt><dd>{selected.source ?? "—"}</dd>
            <dt>{t("Observed", "观测日期")}</dt><dd>{path.observed ?? "—"}</dd>
            <dt>{t("Built", "构建时间")}</dt><dd>{path.built ?? "—"}</dd>
            <dt>{t("Revision", "版本")}</dt><dd>{path.revision}</dd>
            <dt>{t("Snapshot", "快照")}</dt><dd>{path.manifest}</dd></dl></details>
        </section>
        <section className={styles.history}><h2>{t("Continue this investigation", "继续研究这条路径")}</h2>
          <div className={styles.actions}>
            <a href={explorer + "#ox-scenario"}>{t("Test an assumption", "检验情景假设")} →</a>
            <a href={explorer + "#ox-company"}>{t("Inspect company exposure", "查看公司敞口")} →</a>
            <a href={explorer + "#ox-portfolio"}>{t("Inspect portfolio exposure", "查看投资组合敞口")} →</a>
          </div></section>
        <details className={styles.history}><summary>{t("What changed", "变化记录")}</summary>
          <p>{path.comparison.note?.[lang] ?? ([path.comparison.asof, path.comparison.transition].filter(Boolean).join(" · ") || t("Comparison unavailable", "暂无可比记录"))}</p></details>
      </>}
      {fallback}
    </div>
  </main>;
}
