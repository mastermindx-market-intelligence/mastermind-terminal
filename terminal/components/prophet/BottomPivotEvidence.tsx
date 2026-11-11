"use client";

/**
 * A small, deliberately opt-in daily evidence drawer for the selected Prophet symbol.
 *
 * Macro is the sole source of Bottom Pivot facts; this component does not score,
 * rank, time entries, size positions or decide trades. No request is made until
 * the user opens the drawer. A symbol change discards prior evidence.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  canonicalBottomSymbol, parseBottomPivotSelection,
  type BottomPivotSelection,
} from "@/lib/bottomPivotSelection";
import styles from "./BottomPivotEvidence.module.css";

type Language = "en" | "zh";
type Failure = "sign_in_required" | "not_entitled" | "unavailable";
type State = "idle" | "loading" | "ready" | "failed";

const LABELS: Record<string, [string, string]> = {
  trigger_tier: ["Trigger tier", "触发档位"],
  trigger_age_ticks: ["Trigger age (ticks)", "触发时长（tick）"],
  coiled: ["Coiled", "盘整背景"],
  star: ["STAR", "STAR"],
  coiled_fire: ["Early-turn marker", "早期转折标记"],
  above200: ["Above 200-day average", "高于 200 日均线"],
  hold_state: ["Hold state", "持有状态"],
  hold_days_basing: ["Days basing", "筑底天数"],
  hold_ret_since_anchor_pct: ["Return since anchor (%)", "锚点以来收益（%）"],
  knife_score: ["Knife score (source)", "Knife 来源分数"],
  dist_21d_low_pct: ["Distance from 21-day low (%)", "距 21 日低点（%）"],
  dist_126d_high_pct: ["Distance from 126-day high (%)", "距 126 日高点（%）"],
  sponsorship_state: ["Sponsorship", "资金参与状态"],
};

const WORDING = {
  en: {
    toggle: "Daily pivot evidence",
    details: "Source observations for this symbol, not a trading recommendation",
    loading: "Loading source evidence…",
    retry: "Retry",
    noName: "Evidence is not available for this symbol.",
    absent: "The daily producer has no row for this symbol.",
    missing: "The producer has not published usable pivot context for this symbol.",
    signIn: "Sign in to view this entitled research.",
    entitlement: "Your session does not have access to this research.",
    failed: "The source is unavailable. No evidence has been assumed.",
    quality: "Evidence quality",
    asOf: "Source as of",
    missingClock: "The original first-seen time is not established.",
    caution: "Daily snapshot only · Not a live entry trigger · No bottom forecast or trade authority",
    observed: "Recorded observations",
    noFields: "No usable field observations were recorded.",
    true: "Yes",
    false: "No",
  },
  zh: {
    toggle: "日频底部转折证据",
    details: "该标的的来源观测，不构成交易建议",
    loading: "正在读取来源证据…",
    retry: "重试",
    noName: "该标的暂无证据。",
    absent: "日频数据源尚无该标的记录。",
    missing: "数据源尚未发布该标的可用的底部转折背景。",
    signIn: "请登录以查看有权限的研究内容。",
    entitlement: "当前会话无权访问此研究内容。",
    failed: "来源暂不可用。不会假定任何证据。",
    quality: "证据质量",
    asOf: "来源日期",
    missingClock: "原始首次可知时间尚未确认。",
    caution: "仅限日频快照 · 不是实时入场触发 · 不具有底部预测或交易权限",
    observed: "已记录的观测",
    noFields: "未记录可用的字段观测。",
    true: "是",
    false: "否",
  },
} as const;

function displayValue(value: string | number | boolean | null, lang: Language): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return WORDING[lang][value ? "true" : "false"];
  return String(value);
}

export function BottomPivotEvidence({ symbol, lang }: { symbol: string; lang: Language }) {
  const t = WORDING[lang];
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [failure, setFailure] = useState<Failure>("unavailable");
  const [selection, setSelection] = useState<BottomPivotSelection | null>(null);
  const request = useRef<AbortController | null>(null);
  const ticker = canonicalBottomSymbol(symbol);

  // The parent keys the component by symbol, so switching stocks remounts it.
  // Only clean up the old in-flight request: no fetch or state update on mount.
  useEffect(() => () => request.current?.abort(), []);

  const load = useCallback(async () => {
    if (!ticker) return;
    request.current?.abort();
    const ctrl = new AbortController();
    request.current = ctrl;
    setState("loading");
    try {
      const response = await fetch(
        "/api/nw?f=bottom_sensors&symbol=" + encodeURIComponent(ticker),
        { signal: ctrl.signal, cache: "no-store" },
      );
      if (ctrl.signal.aborted) return;
      if (!response.ok) {
        setFailure(response.status === 401 ? "sign_in_required" :
          response.status === 403 ? "not_entitled" : "unavailable");
        setState("failed");
        return;
      }
      const parsed = parseBottomPivotSelection(await response.json(), ticker);
      if (ctrl.signal.aborted) return;
      if (!parsed) {
        setFailure("unavailable");
        setState("failed");
        return;
      }
      setSelection(parsed);
      setState("ready");
    } catch {
      if (!ctrl.signal.aborted) {
        setFailure("unavailable");
        setState("failed");
      }
    }
  }, [ticker]);

  const toggle = () => {
    if (expanded) {
      setExpanded(false);
      request.current?.abort();
      if (state === "loading") setState("idle");
      return;
    }
    setExpanded(true);
    if (state === "idle" || state === "failed") void load();
  };

  const context = state === "ready" ? selection?.context : null;
  const observed = context?.evidence.filter((entry) => entry.state === "observed") ?? [];
  const message = state === "failed"
    ? (failure === "sign_in_required" ? t.signIn : failure === "not_entitled" ? t.entitlement : t.failed)
    : !selection ? "" : selection.reason === "symbol_absent" ? t.absent : t.missing;

  return (
    <section className={styles.container} data-testid="bottom-pivot-evidence">
      <button
        type="button"
        className={styles.toggle}
        onClick={toggle}
        disabled={!ticker}
        aria-expanded={expanded}
        aria-controls={id}
        data-testid="bottom-pivot-toggle"
      >
        <span>{t.toggle}</span>
        <span className={styles.chevron} aria-hidden>{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div id={id} className={styles.body} aria-live="polite">
          <p className={styles.explainer}>{t.details}</p>
          {state === "loading" ? <p className={styles.note}>{t.loading}</p> : null}
          {state === "failed" ? (
            <div className={styles.failure}>
              <p>{message}</p>
              <button type="button" onClick={() => void load()} className={styles.retry}>{t.retry}</button>
            </div>
          ) : null}
          {state === "ready" && !context ? <p className={styles.note}>{message}</p> : null}
          {context ? (
            <>
              <div className={styles.meta}>
                <span>{t.quality}: {context.quality}</span>
                {selection?.as_of ? <span>{t.asOf}: {selection.as_of}</span> : null}
              </div>
              <p className={styles.explanation}>{context.explanation[lang]}</p>
              <strong className={styles.subheading}>{t.observed}</strong>
              {observed.length ? (
                <dl className={styles.evidence}>
                  {observed.map((entry) => (
                    <div key={entry.field} className={styles.fact}>
                      <dt>{LABELS[entry.field]?.[lang === "zh" ? 1 : 0] ?? entry.field}</dt>
                      <dd>{displayValue(entry.value, lang)}</dd>
                    </div>
                  ))}
                </dl>
              ) : <p className={styles.note}>{t.noFields}</p>}
              {context.limitations.includes("first_seen_unknown") ? (
                <p className={styles.note}>{t.missingClock}</p>
              ) : null}
            </>
          ) : null}
          <p className={styles.caution}>{t.caution}</p>
        </div>
      )}
      {!ticker ? <p className={styles.note}>{t.noName}</p> : null}
    </section>
  );
}
