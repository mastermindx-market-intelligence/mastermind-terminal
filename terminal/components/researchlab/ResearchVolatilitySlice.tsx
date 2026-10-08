"use client";
import React, { useState } from "react";
import type { Lang } from "@/lib/i18n";
import type { ResearchVolatility } from "./researchVolatility";
import styles from "./ResearchLab.module.css";

const LEX = {
  title: ["Published IV observations", "已发布隐含波动率观测"],
  session: ["Nightly source session", "夜间数据交易日"], expiry: ["Expiry", "到期日"], strike: ["Strike", "行权价"],
  iv: ["Published IV", "已发布隐含波动率"], call: ["Call", "看涨"], put: ["Put", "看跌"], unknown: ["Unavailable", "不可用"],
  law: ["Raw percent values. Deep wings may contain poor inversions. Quote quality, exercise model and fit provenance are unavailable; no fitted surface, total variance or moneyness is inferred.", "原始百分比数值。深度价内外区域可能含不可靠反演值。报价质量、行权模型及拟合来源不可用，不推断拟合曲面、总方差或价内外程度。"],
  join: ["Pinning requires a coordinate in the Chain snapshot with the same known source session. Different or unknown sessions stay separate.", "固定选择需要期权链快照中存在相同坐标，且已知数据交易日一致。不同或未知交易日的数据保持分开。"],
  empty: ["No admitted volatility observations for this instrument.", "此标的无有效波动率观测。"],
  excluded: ["Excluded duplicates / identities / metrics", "已排除重复／身份／指标"], next: ["Next IV slice", "下一页波动率"], previous: ["Previous IV slice", "上一页波动率"],
} as const;
export function ResearchVolatilitySlice({ data, lang, side, expiry, selected, canPin, onSelect }: {
  data: ResearchVolatility; lang: Lang; side: "all" | "call" | "put"; expiry: string;
  selected: string | null; canPin: (key: string) => boolean; onSelect: (key: string, origin: HTMLButtonElement) => void;
}) {
  const t = (key: keyof typeof LEX) => LEX[key][lang === "zh" ? 1 : 0];
  const [page, setPage] = useState(0);
  const rows = data.rows.filter(r => (side === "all" || r.side === side) && (expiry === "all" || r.expiry === expiry));
  const pages = Math.max(1, Math.ceil(rows.length / 50)), shown = Math.min(page, pages - 1);
  return <section className={styles.tablePanel} aria-label={t("title")}>
    <div className={styles.toolbar}><h3>{t("title")}</h3><span>{t("session")}: {data.session ?? t("unknown")}</span></div>
    <p className={styles.notice}>{t("law")}</p><p className={styles.legend}>{t("join")}</p>
    {data.status === "unavailable" || !rows.length ? <p role="status" className={styles.notice}>{t("empty")}</p> :
      <div className={styles.tableScroll} tabIndex={0} aria-label={t("title")}><table><thead><tr><th>{t("strike")} · {t("expiry")}</th><th>{t("iv")}</th></tr></thead>
        <tbody>{rows.slice(shown * 50, shown * 50 + 50).map(r => <tr key={r.key} data-selected={r.key === selected}>
          <th><button disabled={!canPin(r.key)} aria-pressed={r.key === selected} onClick={e => onSelect(r.key, e.currentTarget)}>{r.strike} {t(r.side)} · {r.expiry}</button></th>
          <td>{r.ivRatio === null ? t("unknown") : (r.ivRatio * 100).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 4 }) + "%"}</td>
        </tr>)}</tbody></table></div>}
    <div className={styles.toolbar}><button disabled={shown === 0} onClick={() => setPage(shown - 1)}>{t("previous")}</button><span>{shown + 1} / {pages}</span><button disabled={shown + 1 >= pages} onClick={() => setPage(shown + 1)}>{t("next")}</button></div>
    <p className={styles.legend}>{t("excluded")}: {data.excluded.duplicate} / {data.excluded.invalidIdentity} / {data.excluded.invalidMetric}</p>
  </section>;
}
