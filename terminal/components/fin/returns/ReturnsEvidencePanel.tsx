"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { isValidRoot } from "@/lib/flowRoot";
import { completedReturnSession, type ReturnSeries, type ReturnsHorizon } from "@/lib/returnsIntelligence";
import { flowEvidence, gexEvidence, qualifyReturnsForecast, type FlowEvidence, type ForecastRead, type GexEvidence, type EvidenceState } from "@/lib/returnsEvidence";
import { pct, price, returnsT, type ReturnsKey } from "./returnsCopy";
import styles from "./ReturnsWorkspace.module.css";

const stateKey: Record<EvidenceState, ReturnsKey> = { ready: "evidence", stale: "snapshotStale", absent: "optionsAbsent", unavailable: "optionsError", access: "optionsAccess", mismatch: "optionsMismatch" };
const money = (v: number | null) => v == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(v);
type Read = { state: "loading" | "ready"; gex: GexEvidence | null; flow: FlowEvidence | null; gexStatus: EvidenceState; flowStatus: EvidenceState };

export default function ReturnsEvidencePanel({ symbol, session, series, horizon, zh, composite }: {
  symbol: string; session: string; series: ReturnSeries; horizon: ReturnsHorizon; zh: boolean; composite: boolean;
}) {
  const identity = useShellIdentity(), t = returnsT(zh), key = `${symbol}|${session}|${composite}`;
  const [received, setReceived] = useState<{ identity: typeof identity; key: string; read: Read } | null>(null);
  const [forecastRead, setForecastRead] = useState<{ identity: typeof identity; key: string; horizon: ReturnsHorizon; read: ForecastRead; status: "ready" | "error" | "access" } | null>(null);
  const read = received?.identity === identity && received.key === key ? received.read : null;
  const forward = forecastRead?.identity === identity && forecastRead.key === key && forecastRead.horizon === horizon ? forecastRead : null;
  useEffect(() => {
    if (composite || !isValidRoot(symbol)) return;
    const controller = new AbortController(), current = completedReturnSession();
    const source = session === current ? `gex:${symbol}` : `gex_at:${symbol}:${session}`;
    async function fetchOwner(f: string): Promise<{ state: EvidenceState; data: unknown }> {
      try {
        const res = await fetch(`/api/flow?f=${encodeURIComponent(f)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!res.ok) return { state: res.status === 401 || res.status === 403 ? "access" : res.status === 404 || res.status === 410 ? "absent" : "unavailable", data: null };
        return { state: "ready", data: await res.json() };
      } catch { return { state: "unavailable", data: null }; }
    }
    void Promise.all([fetchOwner(source), session === current ? fetchOwner(`ticker:${symbol}`) : Promise.resolve({ state: "absent" as const, data: null })]).then(([a, b]) => {
      if (controller.signal.aborted) return;
      const gex = a.state === "ready" ? gexEvidence(a.data, symbol, session) : null, flow = b.state === "ready" ? flowEvidence(b.data, symbol, session) : null;
      setReceived({ identity, key, read: { state: "ready", gex, flow, gexStatus: gex?.state ?? a.state, flowStatus: flow?.state ?? b.state } });
    });
    return () => controller.abort();
  }, [composite, identity, key, session, symbol]);
  useEffect(() => {
    if (composite) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const params = new URLSearchParams({ symbol, asOf: session, horizon: String(horizon) });
        const res = await fetch(`/api/returns/forecast?${params}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const body = await res.json();
        const qualified = qualifyReturnsForecast(body, { symbol, asOf: session, horizon, basis: series.basis, quality: series.quality });
        if (!controller.signal.aborted) setForecastRead({ identity, key, horizon, read: qualified, status: res.status === 401 || res.status === 403 ? "access" : res.ok || res.status === 404 ? "ready" : "error" });
      } catch { if (!controller.signal.aborted) setForecastRead({ identity, key, horizon, read: { status: "abstain", reasons: ["READ_UNAVAILABLE"] }, status: "error" }); }
    })();
    return () => controller.abort();
  }, [composite, horizon, identity, key, series.basis, series.quality, session, symbol]);
  const gex = read?.gex && ["ready", "stale"].includes(read.gexStatus) ? read.gex : null;
  const flow = read?.flow && ["ready", "stale"].includes(read.flowStatus) ? read.flow : null;
  const forecast = forward?.status === "ready" && forward.read.status === "ready" ? forward.read.forecast : null;
  return <div className={styles.evidenceGrid}>
    <section className={styles.evidencePanel} aria-label={t("options")}><div className={styles.panelHead}><h3>{t("options")}</h3><Link href={`/options?tab=gex&symbol=${encodeURIComponent(symbol)}`}>{t("optionsDesk")} ↗</Link></div>
      {composite ? <p className={styles.evidenceNote}>{t("basketOptions")}</p> : !read ? <p className={styles.evidenceNote}>{t("optionsLoading")}</p> : !gex ? <p className={styles.evidenceNote}>{t(stateKey[read.gexStatus])}</p> : <><h4 className={styles.evidenceTitle}>{gex.netBn === null ? "—" : t(gex.netBn > 0 ? "gexPositive" : gex.netBn < 0 ? "gexNegative" : "gexNeutral")}</h4><p className={styles.evidenceNote}>{t("gexNote")}</p><div className={styles.evidenceNumbers}><div><span>{t("netGex")}</span><strong>{money(gex.netBn === null ? null : gex.netBn * 1e9)}</strong></div><div><span>{t("flip")}</span><strong>{price(gex.flip)}</strong></div><div><span>{t("callWall")}</span><strong>{price(gex.callWall)}</strong></div><div><span>{t("putWall")}</span><strong>{price(gex.putWall)}</strong></div></div><details className={styles.smallDetails}><summary>{t("evidence")} · {gex.asOf}{read.gexStatus === "stale" ? ` · ${t("snapshotStale")}` : ""}</summary><p>{gex.convention ?? "—"}</p></details></>}
      {!composite && <div className={styles.flowRow}><div><span>{t("flow")}</span><small>{flow ? `${flow.events ?? "—"} ${t("observedPrints")} · ${flow.asOf}${read?.flowStatus === "stale" ? ` · ${t("snapshotStale")}` : ""}` : t(!read ? "optionsLoading" : read.flowStatus === "access" ? "optionsAccess" : read.flowStatus === "unavailable" ? "flowError" : read.flowStatus === "mismatch" ? "flowMismatch" : "flowHistoryMissing")}</small></div>{flow && <div><strong>{money(flow.gross)}</strong><small>{t("grossPremium")}</small></div>}{flow && <small>{t("flowNote")}</small>}</div>}
    </section>
    <section className={styles.evidencePanel} aria-label={t("outlook")}><div className={styles.panelHead}><h3>{t("outlook")}</h3><time>{session} · {horizon} {t("sessions")}</time></div>
      {forecast ? <><h4 className={styles.evidenceTitle}>{session === completedReturnSession() ? t("nextSessions") : t("archivedForecast")} · {forecast.asOf}</h4><div className={styles.probabilities}>{(["down", "flat", "up"] as const).map(k => <div key={k}><span>{t(k === "flat" ? "neutral" : k)}</span><strong>{pct(forecast.probabilities[k] * 100, false, 0)}</strong></div>)}</div><p className={styles.evidenceNote}>{t("range80")}: {pct(forecast.quantilesPct.p10)} → {pct(forecast.quantilesPct.p90)}</p><details className={styles.modelDetails}><summary>{t("modelDetails")}</summary><p>{forecast.model.id} · {forecast.model.version}<br />Brier {forecast.validation.brier.toFixed(3)} / {forecast.validation.baselineBrier.toFixed(3)}<br />N = {forecast.validation.effectiveObservations}<br />±{forecast.event.neutralBandPct.toFixed(2)}%<br />{forecast.validation.receiptSha256}</p></details></> : <><h4 className={styles.evidenceTitle}>{!composite && !forward ? t("forecastLoading") : forward?.status === "error" ? t("forecastError") : forward?.status === "access" ? t("forecastAccess") : t("noForecast")}</h4><p className={styles.evidenceNote}>{t("outlookNote")}</p><div className={styles.outlookMonitor}><h4>{t("monitor")}</h4><p>{t("monitorNote")}</p></div>{forward?.read.status === "abstain" && <details className={styles.modelDetails}><summary>{t("modelDetails")}</summary><p>{forward.read.reasons.map(r => r.replaceAll("_", " ").toLowerCase()).join(" · ")}</p></details>}</>}
    </section>
  </div>;
}
