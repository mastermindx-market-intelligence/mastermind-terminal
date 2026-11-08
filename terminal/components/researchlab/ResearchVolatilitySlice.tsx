"use client";
import React, { useState } from "react";
import type { Lang } from "@/lib/i18n";
import type { ResearchVolatility, VolatilityMissingInput } from "./researchVolatility";
import styles from "./ResearchLab.module.css";

const LEX = {
  title: ["Published IV observations", "已发布隐含波动率观测"],
  session: ["Nightly source session", "夜间数据交易日"], expiry: ["Expiry", "到期日"], strike: ["Strike", "行权价"],
  iv: ["Published IV", "已发布隐含波动率"], call: ["Call", "看涨"], put: ["Put", "看跌"], unknown: ["Unavailable", "不可用"],
  law: ["Raw percent values. Deep wings may contain poor inversions. Quote quality, exercise model and fit provenance are unavailable; no fitted surface, total variance or moneyness is inferred.", "原始百分比数值。深度价内外区域可能含不可靠反演值。报价质量、行权模型及拟合来源不可用，不推断拟合曲面、总方差或价内外程度。"],
  join: ["Pinning requires a coordinate in the Chain snapshot with the same known source session. Different or unknown sessions stay separate.", "固定选择需要期权链快照中存在相同坐标，且已知数据交易日一致。不同或未知交易日的数据保持分开。"],
  empty: ["No admitted volatility observations for this instrument.", "此标的无有效波动率观测。"],
  filteredEmpty: ["No IV observations match the current side and expiry filters. Adjust the filters in Chain Landscape.", "当前看涨／看跌与到期日筛选没有匹配的隐含波动率观测。可在期权链分布中调整筛选。"],
  ivLoading: ["Loading IV source…", "正在加载隐含波动率…"],
  readFailed: ["IV read failed", "隐含波动率读取失败"],
  readFailedDetail: ["Source could not be read. Missing coverage has not been established.", "无法读取数据源，尚不能确定数据未发布。"],
  refreshFailed: ["IV refresh failed. Showing the last verified observations.", "隐含波动率刷新失败，当前显示上次验证的数据。"],
  notPublished: ["IV not published", "隐含波动率未发布"],
  retryIv: ["Retry IV", "重试隐含波动率"],
  excluded: ["Excluded duplicates / identities / metrics", "已排除重复／身份／指标"], next: ["Next IV slice", "下一页波动率"], previous: ["Previous IV slice", "上一页波动率"],
  diagnostics: ["Observation provenance and surface inputs", "观测来源与曲面输入"],
  noFit: ["Fitted surface unavailable", "拟合曲面不可用"],
  rawOnly: ["Published observations remain usable; they do not qualify a fitted model.", "已发布观测仍可查看，但不代表拟合模型已通过资格确认。"],
  declared: ["Producer declares mean IV by expiry, strike and side, converted from ratio to percent and rounded to four decimal places. These are aggregated observations, not individual quotes.", "生产端声明按到期日、行权价及方向计算平均隐含波动率，将比率转换为百分比并保留四位小数。这是聚合观测，不是逐笔报价。"],
  legacy: ["The existing feed defines IV in percent. This response does not supply observation transformation metadata.", "现有数据格式将隐含波动率定义为百分比；此响应未提供观测转换元数据。"],
  inconsistent: ["Observation metadata is inconsistent. Its source declarations are withheld.", "观测元数据不一致，已撤回其来源声明。"],
  unitsConflict: ["Output units conflict with the percent feed contract. IV values are withheld; no unit conversion is inferred.", "输出单位与百分比数据约定冲突，已撤回隐含波动率数值，不推断单位转换。"],
  noObservation: ["No compatible observation source is available for this instrument.", "此标的没有可用的兼容观测来源。"],
  clocks: ["A source session or expiry date is not a quote, observation or availability timestamp. Spot is not a supplied forward.", "数据交易日或到期日期不是报价、观测或可得时间戳；现货价格不等于已提供的远期价格。"],
  missingInputs: ["Not supplied by this feed", "此数据源未提供"],
  qualification: ["Supplying these fields would not itself admit a fit. Model compatibility, source qualification and supported regions still need to be established; excluded regions must remain empty.", "即使提供这些字段，也不代表拟合已获准使用。模型兼容性、来源资格及支持区域仍须确认；排除区域必须保持为空。"],
} as const;
const INPUT_LABELS: Record<VolatilityMissingInput, readonly [string, string]> = {
  product: ["Product identity", "产品身份"], exercise_style: ["Exercise style", "行权方式"],
  quote_timestamp: ["Per-quote timestamp", "逐笔报价时间戳"], quote_condition: ["Quote condition", "报价条件"],
  expiry_timestamp: ["Exact expiry and settlement time", "确切到期与结算时间"],
  forward: ["Forward and its provenance", "远期价格及其来源"], discount_factor: ["Discount factor and its provenance", "折现因子及其来源"],
  model: ["Model, version and input units", "模型、版本与输入单位"], support: ["Fit support and exclusions", "拟合支持区域与排除项"],
};
export function ResearchVolatilitySlice({ data, lang, side, expiry, selected, canPin, onSelect,
  sourceStatus = "data", onRetrySource }: {
  data: ResearchVolatility; lang: Lang; side: "all" | "call" | "put"; expiry: string;
  selected: string | null; canPin: (key: string) => boolean; onSelect: (key: string, origin: HTMLButtonElement) => void;
  sourceStatus?: "loading" | "data" | "absent" | "unavailable";
  onRetrySource?: () => void;
}) {
  const t = (key: keyof typeof LEX) => LEX[key][lang === "zh" ? 1 : 0];
  const [page, setPage] = useState(0);
  const rows = data.rows.filter(r => (side === "all" || r.side === side) && (expiry === "all" || r.expiry === expiry));
  const pages = Math.max(1, Math.ceil(rows.length / 50)), shown = Math.min(page, pages - 1);
  return <section className={styles.tablePanel} aria-label={t("title")}>
    <div className={styles.toolbar}><h3>{t("title")}</h3><span>{t("session")}: {data.session ?? t("unknown")}</span></div>
    <p className={styles.notice}>{t("law")}</p><p className={styles.legend}>{t("join")}</p>
    <details className={styles.sources} data-testid="research-vol-diagnostics">
      <summary>{t("diagnostics")} · {t("noFit")}</summary>
      <p>{data.diagnostics.status === "unavailable" ? t("noObservation")
        : data.diagnostics.issues.includes("units_mismatch") ? t("unitsConflict")
        : data.diagnostics.status === "inconsistent" ? t("inconsistent")
        : data.diagnostics.provenance === "producer_declared" ? t("declared") : t("legacy")}</p>
      {data.status === "available" && data.rows.length > 0 && <p>{t("rawOnly")}</p>}
      <p>{t("clocks")}</p>
      <h4>{t("missingInputs")}</h4>
      <ul>{data.diagnostics.missing.map(key => <li key={key}>{INPUT_LABELS[key][lang === "zh" ? 1 : 0]}</li>)}</ul>
      <p>{t("qualification")}</p>
    </details>
    {sourceStatus !== "data" && <div role="status" className={styles.notice}>
      {sourceStatus === "loading" ? t("ivLoading") : sourceStatus === "absent" ? t("notPublished")
        : <><strong>{t("readFailed")}</strong><p>{data.status === "unavailable" ? t("readFailedDetail") : t("refreshFailed")}</p>
          {onRetrySource && <button type="button" onClick={onRetrySource}>{t("retryIv")}</button>}</>}
    </div>}
    {data.status === "unavailable" || !rows.length
      ? sourceStatus === "data" ? <p role="status" className={styles.notice}>{t(data.status === "available" && data.rows.length > 0 ? "filteredEmpty" : "empty")}</p> : null
      :
      <div className={styles.tableScroll} tabIndex={0} aria-label={t("title")}><table><thead><tr><th scope="col">{t("strike")} · {t("expiry")}</th><th scope="col">{t("iv")}</th></tr></thead>
        <tbody>{rows.slice(shown * 50, shown * 50 + 50).map(r => <tr key={r.key} data-selected={r.key === selected}>
          <th scope="row"><button disabled={!canPin(r.key)} aria-pressed={r.key === selected} onClick={e => onSelect(r.key, e.currentTarget)}>{r.strike} {t(r.side)} · {r.expiry}</button></th>
          <td>{r.ivRatio === null ? t("unknown") : (r.ivRatio * 100).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 4 }) + "%"}</td>
        </tr>)}</tbody></table></div>}
    <div className={styles.toolbar}><button disabled={shown === 0} onClick={() => setPage(shown - 1)}>{t("previous")}</button><span>{shown + 1} / {pages}</span><button disabled={shown + 1 >= pages} onClick={() => setPage(shown + 1)}>{t("next")}</button></div>
    <p className={styles.legend}>{t("excluded")}: {data.excluded.duplicate} / {data.excluded.invalidIdentity} / {data.excluded.invalidMetric}</p>
  </section>;
}
