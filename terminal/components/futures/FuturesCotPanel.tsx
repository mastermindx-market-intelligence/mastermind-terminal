"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { CFTC_TFF_SOURCE, type CotPair, type CotSummary, type CotCategoryKey } from "@/lib/futuresCot";
import css from "./futuresLab.module.css";

type Load = { pair: CotPair; status: "loading" | "ok" | "unavailable"; data?: CotSummary };
const NAMES: Record<CotCategoryKey, { en: string; zh: string }> = {
  dealer: { en: "Dealer / intermediary", zh: "交易商 / 中介" },
  assetManager: { en: "Asset managers", zh: "资产管理机构" },
  leveragedMoney: { en: "Leveraged funds", zh: "杠杆基金" },
  otherReportable: { en: "Other reportables", zh: "其他申报交易者" },
};

export default function FuturesCotPanel({ pair, refresh }: { pair: CotPair; refresh: number }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [state, setState] = useState<Load>({ pair, status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    // The render gates stale responses by pair; do not synchronously set state in an effect.
    void fetch("/api/futures/cot?pair=" + pair, { signal: controller.signal, credentials: "same-origin" })
      .then(async response => {
        if (!response.ok) return null;
        const body = await response.json() as CotSummary;
        return body?.kind === "weekly_cftc_tff_futures_only" &&
          body.pair === pair && body.replayEligible === false ? body : null;
      })
      .then(report => {
        if (!controller.signal.aborted)
          setState(report ? { pair, status: "ok", data: report } : { pair, status: "unavailable" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ pair, status: "unavailable" });
      });
    return () => controller.abort();
  }, [pair, refresh]);

  const current = state.pair === pair ? state : { pair, status: "loading" as const };
  const report = current.status === "ok" ? current.data : undefined;
  const number = (value: number) => value.toLocaleString("en-US");
  const signed = (value: number | null) => value === null ? "—" :
    (value > 0 ? "+" : "") + number(value);
  return <section className={css.inspector} style={{ marginTop: 16 }} data-testid="futures-cot-panel">
    <h2>{zh ? "CFTC 每周机构持仓" : "CFTC weekly institutional positioning"}</h2>
    <p>{zh
      ? "公开的每周期货持仓报告（周二持仓，通常周五公布）。不是实时成交、订单簿深度、期权做市商 Gamma，也不属于历史回放。"
      : "Free public futures-only report: Tuesday positions, normally released Friday. Not live order flow, market depth, options dealer gamma, or part of historical replay."}</p>
    {current.status === "loading" && <p role="status" data-testid="cot-loading">{zh ? "正在读取报告…" : "Loading weekly CFTC report…"}</p>}
    {current.status === "unavailable" && <p role="status" data-testid="cot-unavailable">
      {zh ? "报告不可用；不会以零持仓替代。" : "CFTC report unavailable; missing positions are not zero."}
    </p>}
    {report && <>
      <p data-testid="cot-report-date">
        <strong>{zh ? "持仓日期" : "Positions as of"}: {report.reportDate}</strong>
        {" · "}{zh ? "合约未平仓量" : "Open interest"}: {number(report.openInterest)}
        {report.openInterestChange !== null && <> ({signed(report.openInterestChange)} {zh ? "周变化" : "vs prior week"})</>}
      </p>
      <p style={{ opacity: 0.8 }} data-testid="cot-market">{report.market} · CFTC {report.cftcCode}</p>
      <div style={{ maxWidth: "100%", overflowX: "auto" }}>
        <table style={{ minWidth: 520, width: "100%" }}>
          <thead><tr>
            <th>{zh ? "类别" : "Category"}</th><th>{zh ? "多头" : "Long"}</th>
            <th>{zh ? "空头" : "Short"}</th><th>{zh ? "净头寸" : "Net"}</th>
            <th>{zh ? "周净变化" : "Weekly Δ net"}</th>
          </tr></thead>
          <tbody>{report.categories.map(category => <tr key={category.key} data-testid={"cot-row-" + category.key}>
            <td>{NAMES[category.key][zh ? "zh" : "en"]}</td>
            <td>{number(category.long)}</td><td>{number(category.short)}</td>
            <td data-testid={"cot-net-" + category.key}>{signed(category.net)}</td>
            <td>{signed(category.weeklyNetChange)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
    <p><a href={CFTC_TFF_SOURCE} target="_blank" rel="noopener noreferrer">
      {zh ? "来源：美国商品期货交易委员会（CFTC）" : "Source: U.S. CFTC — Traders in Financial Futures"}
    </a></p>
  </section>;
}
