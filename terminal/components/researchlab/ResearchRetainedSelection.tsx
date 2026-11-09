"use client";
import React, { useEffect, useMemo, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { decodeRetainedOptions, exactText, type RetainedContext, type RetainedInput, type RetainedView } from "@/lib/retainedOptionsWire";
import styles from "./ResearchLab.module.css";

/** A detached supplied-input projection, never a history reader, playback clock or cache. */
export function ResearchRetainedSelection({ input, context, lang }: {
  input: RetainedInput; context: RetainedContext | null; lang: Lang;
}) {
  const { root, session, ownerKey, wire } = input;
  const currentRoot = context?.root, currentSession = context?.session, currentOwner = context?.ownerKey;
  const matches = !!currentOwner && root === currentRoot && session === currentSession && ownerKey === currentOwner;
  // Bind the settled result to the exact input and expected context on EVERY render.
  // Cleanup also fences a hash promise settling after withdrawal, even A -> B -> A.
  const binding = useMemo(() => ({ wire, root, session, ownerKey, currentRoot, currentSession, currentOwner, matches }),
    [wire, root, session, ownerKey, currentRoot, currentSession, currentOwner, matches]);
  const [settled, setSettled] = useState<{ binding: typeof binding; view: RetainedView | null } | null>(null);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!binding.matches) return;
    let current = true;
    void decodeRetainedOptions(binding.wire, binding).then(view => {
      if (current) setSettled({ binding, view });
    });
    return () => { current = false; };
  }, [binding]);
  const view = matches && settled?.binding === binding ? settled.view : null;
  const pick = (en: string, zh: string) => lang === "zh" ? zh : en;
  const title = pick("Supplied retained selection", "已提供的留存选择");
  if (!view) return <section className={styles.sources} aria-label={title} data-testid="research-retained">
    <p role="status">{pick("Retained selection unavailable. Previous values are withdrawn.", "留存选择不可用，已撤回先前数值。")}</p>
  </section>;
  const fields = view.kind === "matrix" ? ["open_interest", "volume", "delta_oi", "unusual"] : ["root", "exp", "right", "strike", "size", "open_interest", "ts", "observed_at", "decision_at"];
  const names: Record<string, string> = { open_interest: "未平仓量", volume: "成交量", delta_oi: "未平仓变化", unusual: "异常标记", root: "标的", exp: "到期日", right: "方向", strike: "行权价", size: "规模", ts: "事件时间", observed_at: "观测时间", decision_at: "决策时间" };
  const pages = Math.max(1, Math.ceil(view.rows.length / 50)), shownPage = Math.min(page, pages - 1);
  return <details className={styles.sources} data-testid="research-retained" aria-label={title}>
    <summary>{title} · {view.root} · {view.session}</summary>
    <p>{view.kind === "matrix"
      ? pick("One known snapshot; history order, first availability, corrections and universe coverage are unknown.", "仅为一个已知快照；历史顺序、首次可得时间、修正与总体覆盖未知。")
      : pick("Individual aggregate events; no sourced package membership. Receipt order is not market order or complete-session coverage.", "独立的聚合事件；无来源支持的组合归属。回执顺序不代表市场时间顺序或完整交易日覆盖。")}</p>
    <p>{pick("Supplied capture; byte consistency is not authenticated acquisition. Read observation is not first availability.", "已提供的捕获数据；字节一致性不等于已认证获取，读取观测不代表首次可得时间。")}</p>
    <p>{pick("Read observation", "读取观测")}: {view.readAt} · {pick("Decision cutoff", "决策截止")}: {view.cutoff}</p>
    <p>SHA-256: <code>{view.fingerprint}</code></p>
    <p>{pick("∅ omitted · — explicit null · 0 observed zero. Exact decimal text; no inferred contracts, packages or valuation.", "∅ 键未提供 · — 显式空值 · 0 已观测零值。保留精确十进制文本，不推断合约、组合或估值。")}</p>
    <div className={styles.tableScroll} tabIndex={0} aria-label={title}><table><thead><tr><th scope="col">{pick("Source coordinate / event ID", "来源坐标／事件 ID")}</th>{fields.map(f => <th scope="col" key={f}>{lang === "zh" ? names[f] : f === "exp" ? "expiry" : f.replaceAll("_", " ")}</th>)}{view.kind === "events" && <th scope="col">{pick("Durable availability", "持久可得时间")}</th>}</tr></thead>
      <tbody>{view.rows.slice(shownPage * 50, shownPage * 50 + 50).map(row => <tr key={row.key}><th scope="row">{lang === "zh" && view.kind === "matrix" ? row.label.replace(/ · call$/, " · 看涨").replace(/ · put$/, " · 看跌") : row.label}</th>{fields.map(f => <td key={f}>{exactText(row.values[f])}</td>)}{view.kind === "events" && <td>{row.availableAt}</td>}</tr>)}</tbody></table></div>
    {!view.rows.length && <p>{pick("No supplied observations. Missing is unknown, not zero.", "未提供观测值；缺失表示未知，不表示零。")}</p>}
    <div className={styles.toolbar}><button disabled={!shownPage} onClick={() => setPage(shownPage - 1)}>{pick("Previous", "上一页")}</button><span>{shownPage + 1} / {pages}</span><button disabled={shownPage + 1 >= pages} onClick={() => setPage(shownPage + 1)}>{pick("Next", "下一页")}</button></div>
  </details>;
}
