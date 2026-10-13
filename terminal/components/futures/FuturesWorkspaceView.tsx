"use client";
/** Production-route consumer. All data comes from the authenticated API, never a fixture. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLang, applyLang } from "@/lib/i18n";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { futuresQuery, parseFuturesRequest, type FuturesRequest } from "@/lib/futuresRequest";
import { useFuturesText } from "@/lib/futuresUiCopy";
import { useFuturesWorkspace } from "./useFuturesWorkspace";
import FuturesMicrostructureChart from "./FuturesMicrostructureChart";
import css from "./futuresLab.module.css";

export default function FuturesWorkspaceView({ initialRequest }: { initialRequest: FuturesRequest }) {
  const { lang } = useLang(), t = useFuturesText(), identity = useShellIdentity();
  const [request, setRequest] = useState(initialRequest), [refresh, setRefresh] = useState(0);
  const [mode, setMode] = useState<"depth" | "footprint">("depth"), [showGex, setShowGex] = useState(true);
  const [showCvd, setShowCvd] = useState(true), [zoom, setZoom] = useState(1);
  const state = useFuturesWorkspace(request, JSON.stringify(identity), refresh);
  const data = state.status === "data" ? state.data : undefined;
  const current = data?.frames.at(-1)?.gex;
  const update = (patch: Partial<FuturesRequest>) => {
    const next = { ...request, ...patch };
    if (patch.pair && patch.pair !== request.pair) { next.cutoffMs = null; next.expiry = "all"; }
    setRequest(next); window.history.replaceState(null, "", `/options/futures?${futuresQuery(next)}`);
  };
  useEffect(() => {
    const changed = () => { const parsed = parseFuturesRequest(new URLSearchParams(window.location.search)); if (parsed) setRequest(parsed); };
    window.addEventListener("popstate", changed); return () => window.removeEventListener("popstate", changed);
  }, []);
  const volume = data?.frames.reduce((n, f) => n + f.bar.total, 0), delta = data?.frames.reduce((n, f) => n + f.bar.deltaKnown, 0);
  const unknown = data?.frames.reduce((n, f) => n + f.bar.unknown, 0);
  const date = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace(".000Z", " UTC");
  return <main className="main2" style={{ overflow: "auto", minWidth: 0 }}>
    <section className={css.page} data-testid="futures-workspace" lang={lang}>
      <header className={css.header}><div><h1>{t("title")}</h1><p>{t("subtitle")}</p>
        <p><Link href="/options">{t("back")}</Link> · <Link href="/terminal">{t("chart")}</Link></p></div>
        <button aria-label="Language" onClick={() => applyLang(lang === "en" ? "zh" : "en")}>{lang === "en" ? "中文" : "English"}</button>
      </header>
      <section className={css.controls} aria-label={t("title")}>
        <div className={css.tabs} role="tablist" aria-label={t("chartView")}>
          {(["depth", "footprint"] as const).map(v => <button key={v} role="tab" aria-selected={mode === v} onClick={() => setMode(v)}>{t(v)}</button>)}
        </div>
        <label>{t("instrument")}<select aria-label={t("instrument")} value={request.pair} onChange={e => update({ pair: e.target.value as "ES" | "NQ" })}>
          <option value="ES">{t("esPair")}</option><option value="NQ">{t("nqPair")}</option></select></label>
        <label>{t("interval")}<select aria-label={t("interval")} value={request.intervalMinutes} onChange={e => update({ intervalMinutes: Number(e.target.value) as 1 | 5 })}>
          <option value="1">1 {t("minute")}</option><option value="5">5 {t("minutes")}</option></select></label>
        <label>{t("rows")}<select aria-label={t("rows")} value={request.priceStepTicks} onChange={e => update({ priceStepTicks: Number(e.target.value) as 1 | 4 | 8 })}>
          {[1, 4, 8].map(n => <option key={n} value={n}>{n} {t("ticks")} · {(n / 4).toFixed(2)}</option>)}</select></label>
        <label>{t("expiry")}<select aria-label={t("expiry")} value={request.expiry} onChange={e => update({ expiry: e.target.value })}>
          <option value="all">{t("all")}</option><option value="zero">{t("zero")}</option><option value="ex-zero">{t("later")}</option>
          {!['all', 'zero', 'ex-zero'].includes(request.expiry) && <option value={request.expiry}>{request.expiry}</option>}
        </select></label>
        <label>{t("mapping")}<select aria-label={t("mapping")} value={request.method} onChange={e => update({ method: e.target.value as "ratio" | "basis" })}>
          <option value="ratio">{t("ratio")}</option><option value="basis">{t("basis")}</option></select></label>
        <button onClick={() => setRefresh(v => v + 1)}>{t("refresh")}</button>
      </section>
      {state.status === "loading" ? <p role="status" data-testid="futures-loading" className={css.warning}>{t("loading")}</p>
        : !data ? <p role="status" data-testid="futures-unavailable" className={css.warning}>{t(state.reason ?? "source_unavailable")}</p> : <>
        <p className={css.warning} data-testid="futures-basis">{t(data.basis)} · {data.contract} · {t("through")}: {date(data.cutoffMs)}</p>
        <section className={css.metrics}>
          <div><span>{t("volume")}</span><strong data-testid="futures-volume">{volume?.toLocaleString("en-US")}</strong></div>
          <div><span>{t("delta")}</span><strong>{delta?.toLocaleString("en-US")}</strong></div>
          <div><span>{t("unknown")}</span><strong>{unknown}</strong></div>
        </section>
        <section className={css.controls}>
          <label className={css.checkbox}><input type="checkbox" checked={showGex} onChange={e => setShowGex(e.target.checked)} />{t("gamma")}</label>
          <label className={css.checkbox}><input type="checkbox" checked={showCvd} onChange={e => setShowCvd(e.target.checked)} />{t("cvd")}</label>
          <button onClick={() => setZoom(v => v === 1 ? 2 : 1)}>{t("zoom")} {zoom}×</button>
          <label>{t("replay")}<select aria-label={t("replay")} value={request.cutoffMs === null ? "latest" : data.cutoffMs}
            onChange={e => update({ cutoffMs: e.target.value === "latest" ? null : Number(e.target.value) })}>
            <option value="latest">{t("latest")}</option>
            {data.replayCutoffsMs.map(ms => <option key={ms} value={ms}>{date(ms)}</option>)}
          </select></label>
        </section>
        <FuturesMicrostructureChart frames={data.frames} mode={mode} showGex={showGex} showCvd={showCvd} zoom={zoom}
          lowTick={data.lowTick} highTick={data.highTick} priceStepTicks={request.priceStepTicks} lang={lang === "zh" ? 1 : 0}
          contract={data.contract} method={request.method} />
        <section className={css.inspector} style={{ marginTop: 16 }}>
          <h2>{t("source")}</h2><p>{data.sourceId} · {date(data.sourceAsOfMs)}</p>
          <p>{t("expiryNotice")} {t("replayNotice")}</p>
          {!current || current.status !== "ok" ? <p data-testid="gex-unavailable">{current?.status === "unavailable" && String(current.reason) === "cash_closed" ? t("cashClosed") : t("gammaMissing")}</p> :
            <table><thead><tr><th>{t("strike")}</th><th>{t("level")}</th><th>{t("gammaHeading")}</th></tr></thead>
              <tbody>{current.projection.mapped.map(row => <tr key={row.sourceStrike}><td>{row.sourceStrike}</td>
                <td data-testid="mapped-level">{row.futuresPrice.toFixed(4)}</td><td>{row.gammaNetMn === null ? "—" : row.gammaNetMn.toFixed(2)}</td></tr>)}</tbody></table>}
        </section>
      </>}
      <p className={css.warning}>{t("notice")}</p>
    </section>
  </main>;
}
