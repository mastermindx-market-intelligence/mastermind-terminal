"use client";
import React, { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Lang } from "@/lib/i18n";
import { adaptResearchMatrix, buildResearchDomain, buildResearchMarks, filterResearchRows, reconcileResearchSelection, toggleComparison,
  type ResearchMetric, type ResearchRow, type ResearchSelection } from "./researchLabAdapter";
import styles from "./ResearchLab.module.css";
import { adaptResearchVolatility } from "./researchVolatility";
import { ResearchVolatilitySlice } from "./ResearchVolatilitySlice";

const ResearchScene = dynamic(() => import("./ResearchScene"), { ssr: false });
const LEX = {
  title: ["3D Research Lab", "3D 期权研究室"], back: ["Back to Exposure", "返回敞口"],
  chain: ["Chain landscape", "期权链分布"], volatility: ["Volatility terrain", "波动率曲面"],
  replay: ["Replay & change", "回放与变化"], flow: ["Flow & packages", "成交与组合"], scenario: ["Scenario lab", "情景研究"],
  volume: ["Volume", "成交量"], openInterest: ["Open interest", "未平仓量"], deltaOi: ["ΔOI", "未平仓变化"],
  unknown: ["Unavailable", "不可用"], session: ["Source session", "数据交易日"], built: ["Built", "生成时间"],
  oi: ["OI reference session unknown", "未平仓参考交易日未知"], all: ["Both sides", "看涨与看跌"], call: ["Calls", "看涨"], put: ["Puts", "看跌"],
  expiry: ["All expiries", "全部到期日"], save: ["Save investigation", "保存研究"], sources: ["Sources & coverage", "来源与覆盖"],
  saveGap: ["Options evidence is not yet admitted by Saved Research", "已保存研究尚未接入期权证据"],
  empty: ["Matrix unavailable", "矩阵不可用"], emptyDetail: ["No admitted matrix for this instrument and session. Previous values are withdrawn.", "此标的和交易日无可用矩阵，先前数值已撤回。"],
  description: ["Inspect concentration. Keep the exact evidence.", "检查集中度，保留精确证据。"],
  caution: ["Published volume and OI may describe different sessions. Their ratio does not confirm opening trades or direction.", "已发布的成交量和未平仓量可能对应不同交易日，其比值不代表确认开仓或交易方向。"],
  selection: ["Pinned selection", "已固定选择"], choose: ["Select a coordinate in the landscape or exact table.", "在分布图或精确表中选择一个坐标。"],
  coordinate: ["Source coordinate · instrument identity unverified", "来源坐标 · 合约身份未验证"],
  compare: ["Compare selection", "加入对比"], removeCompare: ["Remove comparison", "移除对比"], dismiss: ["Dismiss selection", "取消选择"],
  outside: ["Selection is outside the current filter", "所选项不在当前筛选范围内"],
  exact: ["Exact slice", "精确切片"], table: ["Table", "表格"], chart: ["3D", "3D"],
  noValues: ["No nonzero values for this metric. Zero and unavailable remain separate in the table.", "此指标没有非零数值，表格中保留零值与缺失的区别。"],
  unavailable: ["This lens needs additional admitted evidence", "此视图需要额外的有效证据"],
  volatilityGap: ["Per-contract IV, fit provenance and a compatible model are not in this snapshot. No fitted surface is inferred.", "此快照未提供逐合约隐含波动率、拟合来源及兼容模型，不推断拟合曲面。"],
  replayGap: ["This matrix is a single session. Dated chain frames and availability times are not supplied by the shared replay owner.", "此矩阵为单一交易日数据，共享回放尚未提供带日期的期权链帧和可得时间。"],
  flowGap: ["Package identity and dated quotes are not in this snapshot. Nearby equal-size legs do not prove a package.", "此快照不含组合身份和带时间的报价，相邻同规模合约并不能确认组合。"],
  scenarioGap: ["Verified deliverables, entry prices and admitted valuation output are required from Plan. No parallel pricer is created.", "需要计划工具提供经过验证的交割规格、入场价格及估值结果。"],
  quantities: ["Counts: contracts · ΔOI: signed contracts", "数量单位：张 · 未平仓变化：带正负号的张数"],
  nullLaw: ["Missing values stay unavailable. Zero is a known value. Net producer GEX is aggregate dollars, not per-option gamma.", "缺失值保持不可用，零值为已知数值。生产者净 GEX 为汇总美元敞口，并非单一期权 Gamma。"],
  clockLaw: ["Build time is not availability time. OI session, settlement time, multiplier and deliverable are unknown.", "生成时间不等于数据可得时间。未平仓交易日、结算时间、乘数及交割规格未知。"],
  excluded: ["Excluded cells / metrics", "已排除单元格／指标"], next: ["Next", "下一页"], previous: ["Previous", "上一页"],
  rendererFailed: ["3D unavailable. Your selection and exact slice are preserved.", "3D 不可用，已保留选择和精确切片。"],
  renderLaw: ["Orthographic · expiry depth · puts mirrored only for separation · hollow marks: negative ΔOI", "正交投影 · 到期日纵深 · 看跌仅镜像分开 · 空心标记为负未平仓变化"],
  areaLaw: ["Marker area: |value|, capped at 2–{cap} px diameter for this snapshot's density. Zero has no mark. All exact values remain below.", "标记面积按数值绝对值，依此快照密度将直径限为 2–{cap} 像素。零值无标记，精确数值保留于下方。"],
  markCap: ["3D shows at most 20,000 marks in expiry/strike order. The table retains every admitted row.", "3D 按到期日和行权价顺序最多显示 20,000 个标记，表格保留全部有效行。"],
  ratio: ["Published volume / published OI", "已发布成交量／已发布未平仓量"], strike: ["Strike", "行权价"], expiryLabel: ["Expiry", "到期日"],
  gamma: ["Gamma, bid/ask, trade direction", "Gamma、买卖报价、交易方向"],
  notSnapshot: ["Not in this snapshot", "此快照未提供"],
  rawIv: ["Published IV · matching source session", "已发布隐含波动率 · 同一数据交易日"],
} as const;
type Lens = "chain" | "volatility" | "replay" | "flow" | "scenario";
const lenses: Lens[] = ["chain", "volatility", "replay", "flow", "scenario"];
const metricNames: ResearchMetric[] = ["volume", "openInterest", "deltaOi"];
class SceneBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** No I/O, clock, cache, valuation or persistence ownership lives in this consumer. */
export function OptionsResearchLab({ root, matrix, volatility = null, lang, onClose }: { root: string; matrix: unknown; volatility?: unknown; lang: Lang; onClose: () => void }) {
  const t = (key: keyof typeof LEX) => LEX[key][lang === "zh" ? 1 : 0];
  const number = (v: number | null) => v == null ? t("unknown") : v.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 4 });
  const data = useMemo(() => adaptResearchMatrix(matrix, root), [matrix, root]);
  const vol = useMemo(() => adaptResearchVolatility(volatility, root), [volatility, root]);
  const [lens, setLens] = useState<Lens>("chain");
  const [metric, setMetric] = useState<ResearchMetric>("volume");
  const [side, setSide] = useState<"all" | "call" | "put">("all");
  const [expiry, setExpiry] = useState("all");
  const [mode, setMode] = useState<"3d" | "table">(() => typeof window !== "undefined" && window.innerWidth < 600 ? "table" : "3d");
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<ResearchSelection>({ selected: null, comparisons: [] });
  const safeSelection = useMemo(() => reconcileResearchSelection(selection, data.rows), [selection, data.rows]);
  // Adjust only this component's state before committing an incompatible source.
  // Derived safeSelection already gates this render; the bounded adjustment also
  // prevents a removed coordinate from reappearing if a later payload restores it.
  if (safeSelection.selected !== selection.selected || safeSelection.comparisons.length !== selection.comparisons.length) setSelection(safeSelection);
  const focusOrigin = useRef<HTMLElement | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const rows = useMemo(() => filterResearchRows(data.rows, { side, expiry }), [data.rows, side, expiry]);
  const marks = useMemo(() => buildResearchMarks(rows, metric), [rows, metric]);
  const domain = useMemo(() => buildResearchDomain(data.rows, metric), [data.rows, metric]);
  const selected = data.rows.find(r => r.key === safeSelection.selected);
  const sameVolSession = data.session !== null && data.session === vol.session;
  const selectedVol = sameVolSession ? vol.rows.find(r => r.key === safeSelection.selected)?.ivRatio ?? null : null;
  const comparisons = safeSelection.comparisons
    .map(key => data.rows.find(r => r.key === key))
    .filter((r): r is ResearchRow => r !== undefined);
  const pages = Math.max(1, Math.ceil(rows.length / 50)), shownPage = Math.min(page, pages - 1);
  const label = (r: ResearchRow) => `${number(r.strike)} ${lang === "zh" ? r.side === "call" ? "看涨" : "看跌" : r.side === "call" ? "Call" : "Put"} · ${r.expiry}`;
  const pin = (key: string) => setSelection(s => ({ ...s, selected: key }));
  const dismiss = () => {
    setSelection(s => ({ ...s, selected: null }));
    if (focusOrigin.current?.isConnected) focusOrigin.current.focus(); else backRef.current?.focus();
  };
  const unavailable = <p className={styles.notice} role="status">{t("rendererFailed")}</p>;
  return <section className={styles.lab} aria-label={t("title")}>
    <header className={styles.header}>
      <div><button ref={backRef} className={styles.back} onClick={onClose}>{t("back")}</button><h2>{t("title")} <span>{root}</span></h2></div>
      <div className={styles.context}><span>{t("session")}: {data.session ?? t("unknown")}</span><span>{t("oi")}</span><a href="#research-sources">{t("sources")}</a></div>
    </header>
    <div className={styles.summary}><strong>{t("description")}</strong><p>{t("caution")}</p></div>
    <nav className={styles.lenses} aria-label={t("title")}>{lenses.map(l => <button key={l} aria-pressed={lens === l} onClick={() => setLens(l)}>{t(l)}</button>)}</nav>
    {data.status === "unavailable" && <div role="status" className={styles.notice}><h3>{t("empty")}</h3><p>{t("emptyDetail")}</p></div>}
    <div className={styles.columns}>
      <div className={styles.main}>
        {lens === "chain" ? <div className={styles.plotPanel}>
          <div className={styles.toolbar}>
            <div className={styles.metrics}>{metricNames.map(m => <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>{t(m)}</button>)}</div>
            <label><span className={styles.sr}>{t("all")}</span><select value={side} onChange={e => { setSide(e.target.value as typeof side); setPage(0); }}><option value="all">{t("all")}</option><option value="call">{t("call")}</option><option value="put">{t("put")}</option></select></label>
            <label><span className={styles.sr}>{t("expiry")}</span><select value={expiry} onChange={e => { setExpiry(e.target.value); setPage(0); }}><option value="all">{t("expiry")}</option>{[...new Set(data.rows.map(r => r.expiry))].map(exp => <option key={exp}>{exp}</option>)}</select></label>
            <button aria-pressed={mode === "3d"} onClick={() => setMode(mode === "3d" ? "table" : "3d")}>{mode === "3d" ? t("table") : t("chart")}</button>
          </div>
          {mode === "3d" && !failed && marks.length > 0 && <SceneBoundary fallback={unavailable}><ResearchScene marks={marks} domain={domain} selected={safeSelection.selected}
            onSelect={(key, origin) => { focusOrigin.current = origin; pin(key); }} onFailure={() => setFailed(true)} lang={lang} /></SceneBoundary>}
          {failed && unavailable}
          {marks.length === 0 && <p className={styles.notice}>{t("noValues")}</p>}
          <p className={styles.legend}><i className={styles.call} />{t("call")} <i className={styles.put} />{t("put")} · {t(metric)} · {t("renderLaw")}</p>
          <p className={styles.legend}>{t("areaLaw").replace("{cap}", String(domain.maxDiameter))}</p>{marks.length > 20000 && <p className={styles.notice}>{t("markCap")}</p>}
        </div> : lens === "volatility" ? <ResearchVolatilitySlice data={vol} lang={lang} side={side} expiry={expiry}
          selected={sameVolSession ? safeSelection.selected : null} canPin={key => sameVolSession && data.rows.some(r => r.key === key)}
          onSelect={(key, origin) => { focusOrigin.current = origin; pin(key); }} />
          : <div className={styles.capability}><span>{t(lens)}</span><h3>{t("unavailable")}</h3><p>{t(`${lens}Gap`)}</p><p>{t("clockLaw")}</p></div>}
        <section className={styles.tablePanel} aria-label={t("exact")}>
          <div className={styles.toolbar}><h3>{t("exact")}</h3><span>{rows.length} · {t("quantities")}</span></div>
          <div className={styles.tableScroll} tabIndex={0} aria-label={t("exact")}><table><thead><tr><th scope="col">{t("strike")} · {t("expiryLabel")}</th>{metricNames.map(m => <th scope="col" key={m}>{t(m)}</th>)}</tr></thead>
            <tbody>{rows.slice(shownPage * 50, shownPage * 50 + 50).map(r => <tr key={r.key} data-selected={r.key === safeSelection.selected}>
              <th scope="row"><button aria-pressed={r.key === safeSelection.selected} onClick={e => { focusOrigin.current = e.currentTarget; pin(r.key); }}>{label(r)}</button></th>
              {metricNames.map(m => <td key={m}>{number(r[m])}</td>)}
            </tr>)}</tbody></table></div>
          <div className={styles.toolbar}><button disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>{t("previous")}</button><span>{shownPage + 1} / {pages}</span><button disabled={shownPage + 1 >= pages} onClick={() => setPage(shownPage + 1)}>{t("next")}</button></div>
        </section>
      </div>
      <aside className={styles.inspector} data-testid="research-inspector" aria-label={t("selection")}>
        <span className={styles.eyebrow}>{t("selection")} · {comparisons.length} / 3</span>
        {selected ? <><h3>{root} {label(selected)}</h3><p>{t("coordinate")}</p>
          {!rows.some(r => r.key === selected.key) && <p role="status" className={styles.notice}>{t("outside")}</p>}
          <dl>{metricNames.map(m => <React.Fragment key={m}><dt>{t(m)}</dt><dd>{number(selected[m])}</dd></React.Fragment>)}<dt>{t("ratio")}</dt><dd>{selected.volume != null && selected.openInterest != null && selected.openInterest > 0 ? `${(selected.volume / selected.openInterest).toFixed(2)}×` : t("unknown")}</dd><dt>{t("gamma")}</dt><dd>{t("notSnapshot")}</dd></dl>
          <p className={styles.notice}>{t("caution")}</p>
          <dl><dt>{t("rawIv")}</dt><dd>{selectedVol === null ? t("unknown") : number(selectedVol * 100) + "%"}</dd></dl>
          <button disabled={comparisons.length >= 3 && !safeSelection.comparisons.includes(selected.key)} onClick={() => setSelection(s => ({ ...s, comparisons: toggleComparison(safeSelection.comparisons, selected.key) }))}>{t(safeSelection.comparisons.includes(selected.key) ? "removeCompare" : "compare")}</button>
          <button onClick={dismiss}>{t("dismiss")}</button></> : <p>{t("choose")}</p>}
        {comparisons.length > 0 && <ul className={styles.comparisons}>{comparisons.map(r => <li key={r.key}><button onClick={e => { focusOrigin.current = e.currentTarget; pin(r.key); }}>{label(r)}</button><strong>{t(metric)}: {number(r[metric])}</strong></li>)}</ul>}
        <div className={styles.save}><button disabled>{t("save")}</button><p>{t("saveGap")}</p></div>
      </aside>
    </div>
    <details className={styles.sources} id="research-sources"><summary>{t("sources")}</summary><p>{t("built")}: {data.builtAt ?? t("unknown")} · {t("session")}: {data.session ?? t("unknown")}</p><p>{t("nullLaw")}</p><p>{t("clockLaw")}</p><p>{t("excluded")}: {Object.values(data.excluded).reduce((a,b) => a+b,0)} ({lang === "zh" ? "重复／无效身份／无效指标" : "duplicate / invalid identity / invalid metric"}: {data.excluded.duplicate} / {data.excluded.invalidIdentity} / {data.excluded.invalidMetric})</p></details>
  </section>;
}
