"use client";

import { useEffect, useState } from "react";
import { useFuturesText, type FuturesCopyKey } from "@/lib/futuresUiCopy";
import { CFTC_TFF_SOURCE, type CotPair, type CotSummary, type CotCategoryKey } from "@/lib/futuresCot";
import css from "./futuresLab.module.css";

type Load = { pair: CotPair; status: "loading" | "ok" | "unavailable"; data?: CotSummary };
const NAMES: Record<CotCategoryKey, FuturesCopyKey> = {
  dealer: "cotDealer",
  assetManager: "cotAssetManager",
  leveragedMoney: "cotLeveragedMoney",
  otherReportable: "cotOtherReportable",
};

export default function FuturesCotPanel({ pair, refresh }: { pair: CotPair; refresh: number }) {
  const t = useFuturesText();
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
    <h2>{t("cotTitle")}</h2>
    <p>{t("cotNotice")}</p>
    {current.status === "loading" && <p role="status" data-testid="cot-loading">{t("cotLoading")}</p>}
    {current.status === "unavailable" && <p role="status" data-testid="cot-unavailable">
      {t("cotUnavailable")}
    </p>}
    {report && <>
      <p data-testid="cot-report-date">
        <strong>{t("cotDate")}: {report.reportDate}</strong>
        {" · "}{t("cotOi")}: {number(report.openInterest)}
        {report.openInterestChange !== null && <> ({signed(report.openInterestChange)} {t("cotWeek")})</>}
      </p>
      <p style={{ opacity: 0.8 }} data-testid="cot-market">{report.market} · CFTC {report.cftcCode}</p>
      <div style={{ maxWidth: "100%", overflowX: "auto" }}>
        <table style={{ minWidth: 520, width: "100%" }}>
          <thead><tr>
            <th>{t("cotCategory")}</th><th>{t("cotLong")}</th>
            <th>{t("cotShort")}</th><th>{t("cotNet")}</th>
            <th>{t("cotChange")}</th>
          </tr></thead>
          <tbody>{report.categories.map(category => <tr key={category.key} data-testid={"cot-row-" + category.key}>
            <td>{t(NAMES[category.key])}</td>
            <td>{number(category.long)}</td><td>{number(category.short)}</td>
            <td data-testid={"cot-net-" + category.key}>{signed(category.net)}</td>
            <td>{signed(category.weeklyNetChange)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
    <p><a href={CFTC_TFF_SOURCE} target="_blank" rel="noopener noreferrer">
      {t("cotSource")}
    </a></p>
  </section>;
}
