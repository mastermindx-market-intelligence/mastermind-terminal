"use client";

import { useEffect, useId, useState } from "react";
import { classify } from "@/lib/intradayShared";
import { parseBottomPivotContext, type BottomPivotView, type PivotField } from "@/lib/bottomPivotContext";
import { pivotFieldLabel, pivotStateLabel, pivotText, pivotValue } from "./bottomPivotLex";
import styles from "./BottomPivotContextCard.module.css";

type Result = { kind: "source"; view: BottomPivotView } | { kind: "signIn" | "entitled" | "failed" };
const PRIMARY: readonly PivotField[] = ["coiled_fire", "above200", "hold_state", "knife_score", "dist_21d_low_pct", "dist_126d_high_pct"];
const API = "/api/nw?f=bottom_sensors";

/** Symbol-keyed ownership clears both the old view and its in-flight request. */
export default function BottomPivotContextCard({ sym, zh = false }: { sym: string; zh?: boolean }) {
  const symbol = sym.trim().toUpperCase();
  return <SymbolPivotContext key={symbol} symbol={symbol} zh={zh} />;
}

function SymbolPivotContext({ symbol, zh }: { symbol: string; zh: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const supported = classify(symbol) === "us";
  const t = (key: Parameters<typeof pivotText>[1]) => pivotText(zh, key);

  // No request on page load, recurring poller, shared user cache, service token,
  // speculative fallback, or retry after an entitlement refusal.
  useEffect(() => {
    if (!open || !supported) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    void fetch(API, { signal: controller.signal, cache: "no-store", credentials: "same-origin" })
      .then(async (response): Promise<Result> => {
        if (response.status === 401) return { kind: "signIn" };
        if (response.status === 402 || response.status === 403) return { kind: "entitled" };
        if (!response.ok) return { kind: "failed" };
        const raw: unknown = await response.json();
        return { kind: "source", view: parseBottomPivotContext(raw, symbol, Date.now()) };
      })
      .catch((): Result => ({ kind: "failed" }))
      .then(value => { if (active) setResult(value); })
      .finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [open, revision, supported, symbol]);

  const view = result?.kind === "source" ? result.view : null;
  const state = !open ? "closed" : !supported ? "unsupported" : !result ? "loading" : result.kind === "source" ? result.view.kind : result.kind;
  const retryAllowed = result !== null && result.kind !== "signIn" && result.kind !== "entitled";

  return <section className={styles.card} data-testid="bottom-pivot-context" data-state={state} aria-labelledby={`${id}-title`}>
    <div className={styles.header}>
      <div><h3 id={`${id}-title`}>{t("title")}</h3><span className={styles.scope}>{symbol} · {t("scope")}</span></div>
      <button className={styles.button} type="button" aria-expanded={open} aria-controls={`${id}-body`}
        onClick={() => { if (!open) setResult(null); setOpen(!open); }}>
        {t(open ? "close" : "open")}
      </button>
    </div>
    {open && <div id={`${id}-body`} className={styles.body}>
      <p>{t("intro")}</p>
      <p className={styles.limit} data-testid="pivot-authority-limit">{t("noProbability")}</p>
      {!supported ? <p role="status">{t("unsupported")}</p> : !result ? <p role="status">{t("loading")}</p> :
        result.kind !== "source" ? <p role="status">{t(result.kind)}</p> :
        view?.kind === "unavailable" ? <p role="status">{t(view.reason === "not_covered" ? "notCovered" : view.reason === "feed" ? "failed" : "invalid")}</p> :
        view?.kind === "evidence" ? <>
          <div className={styles.meta}>
            <strong>{t(view.mode === "as_issued" ? "historical" : "snapshot")}</strong>
            <span>{t(view.quality)} · {t("usable")}: {view.observed}/{view.fields.length}</span>
            <span>{t("clock")}: <time dateTime={view.decisionAt}>{view.decisionAt}</time></span>
            <span>{t("inspected")}: <time dateTime={view.inspectedAt}>{view.inspectedAt}</time></span>
          </div>
          <dl className={styles.grid}>
            {PRIMARY.map(field => {
              const row = view.fields.find(item => item.field === field)!;
              return <div key={field} data-field={field} data-evidence-state={row.state}>
                <dt>{pivotFieldLabel(field, zh)}</dt><dd>{pivotValue(row, zh)}</dd>
                <small>{pivotStateLabel(row.state, zh)} · {row.asOf ?? t("unknown")}</small>
              </div>;
            })}
          </dl>
          <details className={styles.details}>
            <summary>{t("details")}</summary>
            <dl className={styles.sources}>
              {view.fields.map(row => <div key={row.field} data-source-field={row.field}>
                <dt>{pivotFieldLabel(row.field, zh)}</dt>
                <dd>{pivotValue(row, zh)} · {pivotStateLabel(row.state, zh)}</dd>
                <dd>{t("source")}: <code>{row.source ?? t("unknown")}</code></dd>
                <dd>{t("vintage")}: {row.asOf ?? t("unknown")} · {t("firstKnown")}: {row.availableAt ?? t("unknown")}</dd>
              </div>)}
            </dl>
          </details>
          {view.firstSeenUnknown && <p className={styles.limit}>{t("firstSeen")}</p>}
        </> : null}
      <p className={styles.limit}>{t("unmeasured")}</p>
      {supported && retryAllowed && <button type="button" className={styles.button} onClick={() => { setResult(null); setRevision(value => value + 1); }}>{t("refresh")}</button>}
    </div>}
  </section>;
}
