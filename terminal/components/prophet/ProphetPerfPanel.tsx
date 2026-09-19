"use client";

import { useCallback, useEffect, useState } from "react";
import { flowGet } from "@/lib/flowClientCache";
import styles from "./ProphetPerfPanel.module.css";
import { makeProphetPerfT } from "./prophetPerfStrings";
import {
  normalizeProphetPerfPayload,
  PROPHET_PERF_OUTCOMES,
  type ProphetPerfOutcome,
  type ProphetPerfPayload,
  type ProphetPerfPlan,
} from "./prophetPerfTypes";

function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return sign + value.toFixed(2) + "%";
}

function formatDate(value: string | null, lang: "en" | "zh"): string {
  if (!value) return "—";
  try {
    const date = new Date(value.slice(0, 10) + "T12:00:00Z");
    if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
    return date.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return value.slice(0, 10) || "—";
  }
}

function outcomeLabel(
  outcome: ProphetPerfOutcome,
  t: ReturnType<typeof makeProphetPerfT>,
): string {
  switch (outcome) {
    case "T1_HIT": return t("outcomeT1");
    case "T2_HIT": return t("outcomeT2");
    case "INVALIDATED": return t("outcomeInvalidated");
    case "EXPIRED": return t("outcomeExpired");
    case "CLOSED_EARLY": return t("outcomeClosedEarly");
    case "NO_ENTRY": return t("outcomeNoEntry");
  }
}

function missingLabel(
  reason: string | null,
  t: ReturnType<typeof makeProphetPerfT>,
): string {
  return reason === "no_entry_no_position" ? t("noPosition") : t("notPublished");
}

function PlanRow({
  plan,
  lang,
}: {
  plan: ProphetPerfPlan;
  lang: "en" | "zh";
}) {
  const t = makeProphetPerfT(lang);
  const direction = plan.direction === "BULL" ? t("bull") : t("bear");
  const held = String(plan.days_held) + " " + (plan.days_held === 1 ? t("day") : t("days"));
  const stockResult = plan.stock_result_pct == null
    ? missingLabel(plan.stock_result_pct_unavailable_reason, t)
    : formatPct(plan.stock_result_pct);
  const optionResult = plan.option_result_pct == null
    ? missingLabel(plan.option_result_pct_unavailable_reason, t)
    : formatPct(plan.option_result_pct);

  return (
    <div className={styles.historyRow} data-testid="prophet-perf-history-row">
      <div className={styles.identityCell}>
        <b>{plan.ticker}</b>
        <span className={plan.direction === "BULL" ? styles.bull : styles.bear}>
          {direction}
        </span>
      </div>
      <div className={styles.cell}>
        <span className={styles.mobileLabel}>{t("signalDate")}</span>
        <span>{formatDate(plan.signal_date, lang)}</span>
      </div>
      <div className={styles.cell}>
        <span className={styles.mobileLabel}>{t("closeDate")}</span>
        <span>{formatDate(plan.close_date, lang)}</span>
      </div>
      <div className={styles.cell}>
        <span className={styles.mobileLabel}>{t("outcome")}</span>
        <span className={styles.outcomeChip}>{outcomeLabel(plan.outcome, t)}</span>
      </div>
      <div className={styles.cell}>
        <span className={styles.mobileLabel}>{t("held")}</span>
        <span>{held}</span>
      </div>
      <div className={styles.returnCell}>
        <span className={styles.mobileLabel}>{t("stockReturn")}</span>
        <span>{stockResult}</span>
      </div>
      <div className={styles.returnCell}>
        <span className={styles.mobileLabel}>{t("optionReturn")}</span>
        <span>{optionResult}</span>
      </div>
      <div className={styles.adherenceCell}>
        <span className={styles.mobileLabel}>{t("adherence")}</span>
        <span>{plan.plan_adherence}</span>
      </div>
    </div>
  );
}

function Summary({
  payload,
  lang,
}: {
  payload: ProphetPerfPayload;
  lang: "en" | "zh";
}) {
  const t = makeProphetPerfT(lang);
  const raw = payload.summary.raw_stock_return;
  const benchmark = payload.summary.benchmarked_performance;
  const rawRange = raw.min_pct == null || raw.max_pct == null
    ? "—"
    : formatPct(raw.min_pct) + " → " + formatPct(raw.max_pct);

  return (
    <>
      <div className={styles.summaryGrid}>
        <div className={styles.metricCard}>
          <span>{t("closedPlans")}</span>
          <b>{payload.summary.closed_plan_count}</b>
        </div>
        <div className={styles.metricCard}>
          <span>{t("noEntry")}</span>
          <b>{payload.summary.no_entry_count}</b>
        </div>
        <div className={styles.metricCard}>
          <span>{t("rawMean")}</span>
          <b>{formatPct(raw.mean_pct)}</b>
        </div>
        <div className={styles.metricCard}>
          <span>{t("rawMedian")}</span>
          <b>{formatPct(raw.median_pct)}</b>
        </div>
        <div className={styles.metricCard}>
          <span>{t("rawRange")}</span>
          <b>{rawRange}</b>
        </div>
      </div>

      <div className={styles.truthGrid}>
        <section className={styles.truthCard} data-testid="prophet-perf-raw-return-note">
          <span className={styles.eyebrow}>{t("rawTitle")}</span>
          <p>{t("rawBody")}</p>
        </section>
        <section className={styles.truthCard} data-testid="prophet-perf-benchmark">
          <span className={styles.eyebrow}>{t("benchmarkTitle")}</span>
          {benchmark.available ? (
            <div className={styles.benchmarkValues}>
              <span>{t("benchmarkReturn")} <b>{formatPct(benchmark.benchmark_return_pct)}</b></span>
              <span>{t("excessReturn")} <b>{formatPct(benchmark.excess_return_pct)}</b></span>
            </div>
          ) : (
            <p>{t("benchmarkUnavailable")}</p>
          )}
        </section>
      </div>

      <section className={styles.outcomeSection}>
        <div className={styles.sectionHead}>
          <div>
            <span className={styles.eyebrow}>{t("outcome")}</span>
            <p>{t("historyBody")}</p>
          </div>
        </div>
        <div className={styles.outcomeGrid}>
          {PROPHET_PERF_OUTCOMES.map((outcome) => (
            <div className={styles.outcomeMetric} key={outcome}>
              <span>{outcomeLabel(outcome, t)}</span>
              <b>{payload.summary.outcome_counts[outcome]}</b>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function ProphetPerfPanel({ lang }: { lang: "en" | "zh" }) {
  const t = makeProphetPerfT(lang);
  const [payload, setPayload] = useState<ProphetPerfPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setUnavailable(false);
    try {
      const raw = await flowGet("prophet_perf");
      const normalized = normalizeProphetPerfPayload(raw);
      if (!normalized) throw new Error("invalid prophet perf payload");
      setPayload(normalized);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initializing the private external feed is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loading && !payload) {
    return (
      <div className={styles.state} data-testid="prophet-perf-loading">
        <span className={styles.spinner} aria-hidden />
        <span>{t("loading")}</span>
      </div>
    );
  }

  if (unavailable && !payload) {
    return (
      <div className={styles.state} data-testid="prophet-perf-unavailable">
        <b>{t("unavailableTitle")}</b>
        <p>{t("unavailableBody")}</p>
        <button type="button" onClick={() => void load()}>{t("retry")}</button>
      </div>
    );
  }

  if (!payload) return null;

  return (
    <div className={styles.root} data-testid="prophet-perf-panel">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{t("subtitle")}</span>
          <h3>{t("title")}</h3>
        </div>
        <div className={styles.receipts} data-testid="prophet-perf-source">
          <span><em>{t("source")}</em><b>{payload.source.path}</b></span>
          <span><em>{t("ledgerAsOf")}</em><b>{formatDate(payload.source.latest_asof, lang)}</b></span>
          <span><em>{t("latestClose")}</em><b>{formatDate(payload.source.latest_close_date, lang)}</b></span>
        </div>
      </header>

      <Summary payload={payload} lang={lang} />

      <section className={styles.integrity} data-testid="prophet-perf-integrity">
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>{t("integrityTitle")}</span>
        </div>
        <div className={styles.integrityGrid}>
          <span><em>{t("canonicalRows")}</em><b>{payload.integrity.canonical_row_count}</b></span>
          <span><em>{t("effectiveRows")}</em><b>{payload.integrity.effective_row_count}</b></span>
          <span><em>{t("excludedRows")}</em><b>{payload.integrity.quarantined_excluded_count}</b></span>
          <span><em>{t("correctedRows")}</em><b>{payload.integrity.corrected_row_count}</b></span>
        </div>
      </section>

      <section className={styles.history}>
        <div className={styles.sectionHead}>
          <div>
            <span className={styles.eyebrow}>{t("historyTitle")}</span>
            <p>{t("historyBody")}</p>
          </div>
        </div>

        {payload.plans.length === 0 ? (
          <div className={styles.empty} data-testid="prophet-perf-empty">
            <b>{t("emptyTitle")}</b>
            <p>{t("emptyBody")}</p>
          </div>
        ) : (
          <div className={styles.historyTable}>
            <div className={styles.historyHeader} aria-hidden>
              <span>{t("ticker")} / {t("direction")}</span>
              <span>{t("signalDate")}</span>
              <span>{t("closeDate")}</span>
              <span>{t("outcome")}</span>
              <span>{t("held")}</span>
              <span>{t("stockReturn")}</span>
              <span>{t("optionReturn")}</span>
              <span>{t("adherence")}</span>
            </div>
            <div className={styles.historyRows}>
              {payload.plans.map((plan) => (
                <PlanRow key={plan.id} plan={plan} lang={lang} />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
