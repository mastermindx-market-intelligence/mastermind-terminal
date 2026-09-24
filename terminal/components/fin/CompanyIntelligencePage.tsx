"use client";

// Owned here rather than in app/layout.tsx: this sheet styles ONLY the `.ci-*` intelligence
// surface (this page + its descendant cards) and the `.analysis-*` chrome that
// components/workspaces/AnalysisWorkspace imports it for. In the root layout it was
// render-blocking CSS on all nine other routes — 61 KB decoded — none of which can show a
// single one of its selectors. Imported by the two components that DO, so it rides their
// chunk. Both import sites are required; dropping either leaves that surface unstyled.
import "../../app/company-intelligence.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../../lib/i18n";
import { fmtDate, pick } from "../../lib/finFormat";
import { topicStatusLabel } from "../../lib/plainLabels";
import {
  getCompanyIntelligence,
  type CompanyIntelligenceContext,
  type CompanyIntelligenceEvent,
  type CompanyIntelligenceResult,
  type CompanyIntelligenceSource,
} from "../../lib/companyIntelligence";
import { getCurrentEventWorkspace, type EventWorkspaceResult } from "../../lib/eventWorkspace";
import CompanyIntelligenceV2Current from "./CompanyIntelligenceV2Current";
import CompanyIntelligenceBriefLayout, { type CompanyIntelligenceBriefItem } from "./CompanyIntelligenceBriefLayout";
import CompanyIntelligenceCallLayout from "./CompanyIntelligenceCallLayout";
import CompanyIntelligenceResultsLayout, {
  type CompanyIntelligenceResultsComparison,
  type CompanyIntelligenceResultsItem,
} from "./CompanyIntelligenceResultsLayout";
import CompanySourceManifest from "./CompanySourceManifest";
import EvidenceRail, { type CompanyEvidenceSelection } from "./EvidenceRail";
import TranscriptSearchWorkspace from "./TranscriptSearchWorkspace";
import CompanyThemeContextCard from "./CompanyThemeContextCard";
import CompanyInstitutionalContextCard from "./CompanyInstitutionalContextCard";
import { openMastermindBrainForSymbol } from "../../lib/mastermindBrain";
import type { TranscriptOpenTarget } from "../../lib/transcriptSearch";
import { topicTagLabel } from "../../lib/companyIntelligenceLabels";

type Lens = "brief" | "results" | "transcript" | "history" | "topics" | "sources";

export interface CompanyIntelligencePageProps {
  sym: string;
  name?: string | null;
  onOpenTx: (target: string | TranscriptOpenTarget) => void;
  onEvidenceOpenChange?: (open: boolean) => void;
}

interface LoadState {
  sym: string;
  nonce: number;
  v1: CompanyIntelligenceResult | null | undefined;
  v2: EventWorkspaceResult | null | undefined;
}

const LENSES: readonly Lens[] = ["brief", "results", "transcript", "history", "topics", "sources"];

function lensLabel(lens: Lens, zh: boolean): string {
  const labels: Record<Lens, [string, string]> = {
    brief: ["Brief", "简报"],
    results: ["Results", "业绩"],
    transcript: ["Call + Q&A", "电话会 + 问答"],
    history: ["History", "历史"],
    topics: ["Topics", "主题"],
    sources: ["Sources", "来源"],
  };
  return pick(zh, labels[lens][0], labels[lens][1]);
}

function stateLabel(state: CompanyIntelligenceContext["status"], zh: boolean): string {
  if (state === "ready") return pick(zh, "Ready", "已就绪");
  if (state === "partial") return pick(zh, "Partial coverage", "部分覆盖");
  if (state === "stale") return pick(zh, "Last verified view", "最近验证视图");
  return pick(zh, "Not covered", "尚未覆盖");
}

function statusColor(state: CompanyIntelligenceContext["status"]): string {
  if (state === "ready") return "var(--up)";
  if (state === "partial" || state === "stale") return "var(--warn)";
  return "var(--muted)";
}

function warningLabel(code: string, zh: boolean): string {
  const labels: Record<string, [string, string]> = {
    earnings_history_metadata_only: [
      "The structured earnings record is available; the issuer-hosted raw document is not yet linked.",
      "结构化财报记录可用；尚未关联发行人托管的原始文档。",
    ],
    transcripts_partial: [
      "Transcript coverage is incomplete across the selected company history.",
      "所选公司历史中的电话会记录覆盖尚不完整。",
    ],
    freshness_reference_missing: [
      "Freshness could not be evaluated for this generation.",
      "本版本暂无法评估数据新鲜度。",
    ],
    tx_index_missing_or_invalid: [
      "Transcript availability could not be verified.",
      "无法验证电话会记录的可用性。",
    ],
  };
  const label = labels[code];
  return label ? pick(zh, label[0], label[1]) : code.replaceAll("_", " ");
}

function missingSourceLabel(code: string, zh: boolean): string {
  const labels: Record<string, [string, string]> = {
    earnings_history: ["Earnings history", "财报历史"],
    earnings_history_raw_source: ["Issuer-hosted raw earnings document", "发行人托管的原始财报文档"],
    terminal_transcript_index: ["Verified transcript index", "已验证电话会索引"],
    transcripts_for_some_events: ["Transcripts for some historical events", "部分历史事件的电话会记录"],
  };
  const label = labels[code];
  return label ? pick(zh, label[0], label[1]) : code.replaceAll("_", " ");
}

function allEvents(context: CompanyIntelligenceContext): CompanyIntelligenceEvent[] {
  const events = context.latest_event ? [context.latest_event, ...context.history] : [...context.history];
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.event_id)) return false;
    seen.add(event.event_id);
    return true;
  });
}

function preferredSource(event: CompanyIntelligenceEvent, kind?: CompanyIntelligenceSource["kind"]): CompanyIntelligenceSource | null {
  const candidates = kind ? event.sources.filter((source) => source.kind === kind) : event.sources;
  return candidates.find((source) => source.status === "present")
    ?? candidates.find((source) => source.status === "metadata_only")
    ?? candidates[0]
    ?? null;
}

function sourceByRef(
  event: CompanyIntelligenceEvent,
  sourceRef: CompanyIntelligenceSource["source_ref"] | null | undefined,
): CompanyIntelligenceSource | null {
  return sourceRef ? event.sources.find((source) => source.source_ref === sourceRef) ?? null : null;
}

function transcriptId(source: CompanyIntelligenceSource | null): string | null {
  if (!source || source.kind !== "transcript") return null;
  const match = source.url?.match(/\/(\d{4}Q[1-4])\.json\.gz(?:[?#].*)?$/);
  return match?.[1] ?? null;
}

function pct(value: number | null | undefined, signed = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function numeric(value: number | null | undefined, signed = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${Number.isInteger(value) ? value : value.toFixed(1)}`;
}

function eventPeriod(event: CompanyIntelligenceEvent): string {
  return `Q${event.fiscal_quarter} FY${event.fiscal_year}`;
}

function EmptyState({ title, why, action }: { title: string; why: string; action?: React.ReactNode }) {
  return (
    <div className="fin-empty fin-empty-lg ci-state" role="status">
      <div className="ci-state-mark" aria-hidden><i /><i /><i /></div>
      <div className="fin-empty-title">{title}</div>
      <div className="fin-empty-why">{why}</div>
      {action}
    </div>
  );
}

export default function CompanyIntelligencePage({ sym, name, onOpenTx, onEvidenceOpenChange }: CompanyIntelligencePageProps) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const ticker = sym.trim().toUpperCase();
  const [retryNonce, setRetryNonce] = useState(0);
  const [load, setLoad] = useState<LoadState>({ sym: "", nonce: -1, v1: undefined, v2: undefined });
  const [lens, setLens] = useState<Lens>("brief");
  const [eventState, setEventState] = useState<{ sym: string; id: string }>({ sym: "", id: "" });
  const [evidence, setEvidence] = useState<CompanyEvidenceSelection | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const evidenceOverlay = true;
  const evidenceTriggerRef = useRef<HTMLElement | null>(null);
  const receiptsButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const selectLens = useCallback((next: Lens) => {
    setLens(next);
    // The lens bar remains sticky while a reader is deep in a long transcript.
    // Bring the newly-selected panel back beneath that bar so its first rows
    // are never painted underneath the navigation surface.
    window.requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ block: "start", behavior: "auto" }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ sym: ticker, nonce: retryNonce, v1: undefined, v2: undefined });
    const v1Fail: CompanyIntelligenceResult = { ok: false, state: "error", error: { code: "upstream_unavailable", message: "Company intelligence request failed", retryable: true } };
    const v2Fail: EventWorkspaceResult = { ok: false, state: "error", available: false, error: { code: "upstream_unavailable", message: "Event workspace request failed", retryable: true } };
    void getCurrentEventWorkspace(ticker, { signal: controller.signal, retryNonce })
      .catch(() => v2Fail)
      .then((v2) => {
        if (controller.signal.aborted) return;
        setLoad((current) => current.sym === ticker && current.nonce === retryNonce ? { ...current, v2 } : current);
      });
    void getCompanyIntelligence(ticker, { signal: controller.signal, retryNonce })
      .catch(() => v1Fail)
      .then((v1) => {
        if (controller.signal.aborted) return;
        setLoad((current) => current.sym === ticker && current.nonce === retryNonce ? { ...current, v1 } : current);
      });
    return () => controller.abort();
  }, [retryNonce, ticker]);

  useEffect(() => {
    setLens("brief");
    setEvidence(null);
  }, [ticker]);

  useEffect(() => {
    setEvidence(null);
  }, [zh]);

  useEffect(() => {
    onEvidenceOpenChange?.(evidenceOpen && evidenceOverlay);
    return () => onEvidenceOpenChange?.(false);
  }, [evidenceOpen, evidenceOverlay, onEvidenceOpenChange]);

  const v2Pending = load.sym !== ticker || load.nonce !== retryNonce || load.v2 === undefined;
  const v1Pending = load.sym !== ticker || load.nonce !== retryNonce || load.v1 === undefined;
  const result = v1Pending ? null : load.v1 ?? null;
  const v2 = v2Pending ? null : load.v2 ?? null;
  const context = result?.ok ? result.context : null;
  const events = useMemo(() => context ? allEvents(context) : [], [context]);
  const transcriptSearchEvents = useMemo(() => events.map((candidate) => ({
    event_id: candidate.event_id,
    label: eventPeriod(candidate),
    call_date: candidate.call_date,
    transcript_id: transcriptId(preferredSource(candidate, "transcript")),
    fiscal_year: candidate.fiscal_year,
    fiscal_quarter: candidate.fiscal_quarter,
  })), [events]);
  const selectedId = eventState.sym === ticker ? eventState.id : "";
  const event = events.find((candidate) => candidate.event_id === selectedId) ?? events[0] ?? null;

  useEffect(() => {
    if (!event || evidence) return;
    const text = event.summary || event.highlights[0] || "";
    if (!text) return;
    const sourceRef = event.summary
      ? event.field_lineage.summary
      : event.field_lineage.highlights[0] ?? null;
    setEvidence({
      id: `${event.event_id}:summary`,
      kind: "summary",
      label: pick(zh, "Structured event context", "结构化事件背景"),
      text,
      source: sourceByRef(event, sourceRef),
    });
  }, [event, evidence, zh]);

  const chooseEvidence = useCallback((selection: CompanyEvidenceSelection) => {
    evidenceTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEvidence(selection);
    setEvidenceOpen(true);
  }, []);

  const closeEvidence = useCallback(() => {
    setEvidenceOpen(false);
    const trigger = evidenceTriggerRef.current ?? receiptsButtonRef.current;
    evidenceTriggerRef.current = null;
    window.requestAnimationFrame(() => trigger?.focus());
  }, []);

  const askBrain = useCallback(() => {
    // The widget can outlive TerminalShell across client-side navigation.  Give
    // its singleton config this workspace's ticker *before* opening it rather
    // than relying on the stale Terminal symbol that first mounted the script.
    if (openMastermindBrainForSymbol(ticker)) return;
    window.location.assign(`/terminal?symbol=${encodeURIComponent(ticker)}&ai=1`);
  }, [ticker]);

  if (v2Pending) {
    return (
      <div className="ci-page" aria-busy="true">
        <span className="fin-skel-sr">{pick(zh, `Loading ${ticker} company intelligence…`, `正在加载 ${ticker} 公司情报…`)}</span>
        <div className="ci-skeleton-head fin-skel" aria-hidden />
        <div className="ci-skeleton-grid" aria-hidden><div className="fin-skel" /><div className="fin-skel" /></div>
      </div>
    );
  }

  if (v2?.ok) {
    return (
      <CompanyIntelligenceV2Current
        ticker={ticker}
        name={name}
        result={v2}
        v1={result?.ok ? result.context : null}
        onOpenTx={onOpenTx}
        onEvidenceOpenChange={onEvidenceOpenChange}
      />
    );
  }

  if (v2 && !v2.ok && v2.error.code !== "not_found") {
    return (
      <div className="ci-page">
        <EmptyState
          title={pick(zh, "Current event workspace unavailable", "当期事件工作区暂不可用")}
          why={v2.error.message}
          action={v2.error.retryable ? (
            <button className="btn btn-primary" onClick={() => setRetryNonce(Date.now())}>{pick(zh, "Retry", "重试")}</button>
          ) : undefined}
        />
      </div>
    );
  }

  if (v2 && !v2.ok && v2.error.code === "not_found" && v1Pending) {
    return (
      <div className="ci-page" aria-busy="true">
        <span className="fin-skel-sr">{pick(zh, `Loading ${ticker} company intelligence…`, `正在加载 ${ticker} 公司情报…`)}</span>
        <div className="ci-skeleton-head fin-skel" aria-hidden />
        <div className="ci-skeleton-grid" aria-hidden><div className="fin-skel" /><div className="fin-skel" /></div>
      </div>
    );
  }

  if (!result || !result.ok) {
    const message = result && !result.ok ? result.error.message : pick(zh, "No response was returned.", "未返回响应。");
    return (
      <div className="ci-page">
        <EmptyState
          title={pick(zh, "Company intelligence unavailable", "公司情报暂不可用")}
          why={message}
          action={(result?.ok === false ? result.error.retryable : true) ? (
            <button className="btn btn-primary" onClick={() => setRetryNonce(Date.now())}>{pick(zh, "Retry", "重试")}</button>
          ) : undefined}
        />
      </div>
    );
  }

  const activeContext = result.context;
  if (activeContext.status === "not_covered" || !event) {
    return (
      <div className="ci-page">
        <EmptyState
          title={pick(zh, `${ticker} is not covered yet`, `${ticker} 尚未覆盖`)}
          why={pick(
            zh,
            "No company-event view exists for this symbol. This is a coverage boundary, not a processing queue.",
            "该标的尚无公司事件视图。这是数据覆盖边界，并非正在排队处理。",
          )}
        />
      </div>
    );
  }

  const transcriptSource = preferredSource(event, "transcript");
  const txId = transcriptId(transcriptSource);
  const metrics = event.metrics;
  const deltas = event.previous_event_deltas;
  const displayName = activeContext.company.display_name || name || ticker;
  // A general highlight has no polarity. Never relabel it as Constructive when
  // the producer did not retain an explicitly positive highlight for the event.
  const positiveItems = event.positive_highlights;
  const positiveLineage = event.field_lineage.positive_highlights;
  const warningText = activeContext.warnings[0]
    ? warningLabel(activeContext.warnings[0], zh)
    : activeContext.status === "partial"
      ? pick(zh, "Some source families are missing; available findings remain usable.", "部分来源尚缺失；现有结论仍可使用。")
      : activeContext.status === "stale"
        ? pick(zh, "Showing the last verified generation while the current source is unavailable.", "当前来源不可用，正在显示最近一次验证版本。")
        : "";

  const briefEvidenceById = new Map<string, CompanyEvidenceSelection>();
  const registerBriefItem = (
    item: CompanyIntelligenceBriefItem,
    selection: CompanyEvidenceSelection,
  ): CompanyIntelligenceBriefItem => {
    briefEvidenceById.set(item.id, selection);
    return item;
  };
  const briefMetrics: CompanyIntelligenceBriefItem[] = [];
  const addBriefMetric = (
    suffix: string,
    label: string,
    value: number | null | undefined,
    delta: number | null | undefined,
    sourceRef: CompanyIntelligenceSource["source_ref"] | null | undefined,
    integer = false,
  ) => {
    if (value == null || !Number.isFinite(value)) return;
    const id = `${event.event_id}:${suffix}`;
    const rendered = integer ? numeric(value) : pct(value);
    const renderedDelta = delta == null || !Number.isFinite(delta)
      ? null
      : `${integer ? numeric(delta, true) : pct(delta, true)} ${pick(zh, "vs prior", "较上期")}`;
    briefMetrics.push(registerBriefItem(
      { id, label, value: rendered, detail: renderedDelta },
      {
        id,
        kind: "metric",
        label,
        text: `${label}: ${rendered}.`,
        derived_comparison: renderedDelta
          ? `${renderedDelta}. ${pick(zh, "Derived from current and prior structured-event values; it is not attributed to the current metric source alone.", "由当期及上期结构化事件数值派生；不会仅归属于当前指标来源。")}`
          : undefined,
        source: sourceByRef(event, sourceRef),
      },
    ));
  };
  addBriefMetric("revenue", pick(zh, "Revenue growth", "营收增长"), metrics.revenue_growth_pct, deltas.revenue_growth_pct, event.field_lineage.metrics.revenue_growth_pct);
  addBriefMetric("eps", pick(zh, "EPS growth", "每股盈利增长"), metrics.eps_growth_pct, deltas.eps_growth_pct, event.field_lineage.metrics.eps_growth_pct);
  addBriefMetric("margin", pick(zh, "Gross margin", "毛利率"), metrics.gross_margin_pct, deltas.gross_margin_pct, event.field_lineage.metrics.gross_margin_pct);
  addBriefMetric("questions", pick(zh, "Analyst questions", "分析师提问"), metrics.questions_count, deltas.questions_count, event.field_lineage.metrics.questions_count, true);

  const briefHeadline = event.highlights[0]
    || event.summary
    || pick(zh, "No structured event context is present for this event.", "本事件暂无结构化事件背景。");
  const briefSummary = event.summary && event.summary !== briefHeadline ? event.summary : null;
  const briefTakeaways = event.highlights.slice(1, 4).map((text, offset) => {
    const index = offset + 1;
    const id = `${event.event_id}:highlight:${index}`;
    return registerBriefItem(
      { id, label: pick(zh, "Event fact", "事件事实"), value: text },
      { id, kind: "highlight", label: pick(zh, "Event fact", "事件事实"), text, source: sourceByRef(event, event.field_lineage.highlights[index]) },
    );
  });
  const briefChanges = positiveItems.slice(0, 3).map((text, index) => {
    const id = `${event.event_id}:positive:${index}`;
    return registerBriefItem(
      { id, label: pick(zh, "Reported change", "报告变化"), value: text },
      { id, kind: "highlight", label: pick(zh, "Reported change", "报告变化"), text, source: sourceByRef(event, positiveLineage[index]) },
    );
  });
  const briefRisks = event.negative_highlights.slice(0, 3).map((text, index) => {
    const id = `${event.event_id}:negative:${index}`;
    return registerBriefItem(
      { id, label: pick(zh, "Watch item", "关注项"), value: text },
      { id, kind: "highlight", label: pick(zh, "Watch item", "关注项"), text, source: sourceByRef(event, event.field_lineage.negative_highlights[index]) },
    );
  });
  const chooseBriefItem = (item: CompanyIntelligenceBriefItem) => {
    const selection = briefEvidenceById.get(item.id);
    if (selection) chooseEvidence(selection);
  };

  const resultsMetrics: CompanyIntelligenceResultsItem[] = briefMetrics.map((item) => ({
    id: item.id,
    label: item.label,
    value: item.value,
    detail: item.detail,
  }));
  const resultsComparisons: CompanyIntelligenceResultsComparison[] = [];
  const addResultsComparison = (
    suffix: string,
    label: string,
    current: number | null | undefined,
    delta: number | null | undefined,
    integer = false,
  ) => {
    if (current == null || delta == null || !Number.isFinite(current) || !Number.isFinite(delta)) return;
    const prior = current - delta;
    const renderValue = (value: number) => integer ? numeric(value) : pct(value);
    const renderChange = integer ? numeric(delta, true) : pct(delta, true);
    resultsComparisons.push({
      id: `${event.event_id}:${suffix}`,
      label,
      current: renderValue(current),
      prior: pick(zh, `${renderValue(prior)} prior`, `上期 ${renderValue(prior)}`),
      change: pick(zh, `${renderChange} vs prior`, `较上期 ${renderChange}`),
      detail: pick(
        zh,
        "Derived from current and prior structured-event values; not a consensus comparison.",
        "由当期及上期结构化事件数值派生；并非共识比较。",
      ),
    });
  };
  addResultsComparison("revenue", pick(zh, "Revenue growth", "营收增长"), metrics.revenue_growth_pct, deltas.revenue_growth_pct);
  addResultsComparison("eps", pick(zh, "EPS growth", "每股盈利增长"), metrics.eps_growth_pct, deltas.eps_growth_pct);
  addResultsComparison("margin", pick(zh, "Gross margin", "毛利率"), metrics.gross_margin_pct, deltas.gross_margin_pct);
  addResultsComparison("questions", pick(zh, "Analyst questions", "分析师提问"), metrics.questions_count, deltas.questions_count, true);

  const resultsNonAssertions: CompanyIntelligenceResultsItem[] = [
    {
      id: "boundary:consensus",
      label: pick(zh, "Consensus surprise", "共识超预期/不及预期"),
      value: pick(zh, "Not asserted · no licensed pre-event consensus", "未断言 · 无已授权的事件前共识"),
    },
    {
      id: "boundary:reaction",
      label: pick(zh, "Event-price reaction", "事件价格反应"),
      value: pick(zh, "Not asserted · no qualified price join", "未断言 · 无合格价格关联"),
    },
    {
      id: "boundary:authority",
      label: pick(zh, "Trade authority", "交易权限"),
      value: pick(zh, "Not asserted · context only", "未断言 · 仅供背景参考"),
    },
  ];
  const chooseResultsItem = (item: CompanyIntelligenceResultsItem) => {
    const selection = briefEvidenceById.get(item.id);
    if (selection) chooseEvidence(selection);
  };

  return (
    <div className="ci-page">
      <header className="ci-hero">
        <div className="ci-hero-main">
          <div className="ci-identity">
            <span className="ci-company-mark" aria-hidden>{displayName.trim().charAt(0).toUpperCase()}</span>
            <div>
              <div className="ci-title-line">
                <h2>{displayName}</h2>
                <span className="ci-ticker num">{ticker}</span>
                <span className="fin-tag" style={{ "--c": statusColor(activeContext.status) } as React.CSSProperties}>{stateLabel(activeContext.status, zh)}</span>
              </div>
              <p>{pick(zh, "Company Intelligence", "公司情报")} · {eventPeriod(event)} · <time dateTime={event.call_date}>{fmtDate(event.call_date)}</time></p>
            </div>
          </div>
          <div className="ci-hero-actions">
            <label className="ci-event-select">
              <span>{pick(zh, "Event", "事件")}</span>
              <select
                value={event.event_id}
                onChange={(change) => {
                  setEventState({ sym: ticker, id: change.target.value });
                  setEvidence(null);
                }}
                aria-label={pick(zh, "Select company event", "选择公司事件")}
              >
                {events.map((candidate) => <option key={candidate.event_id} value={candidate.event_id}>{eventPeriod(candidate)} · {candidate.call_date}</option>)}
              </select>
            </label>
            <button
              ref={receiptsButtonRef}
              className="btn btn-ghost ci-receipts-button"
              onClick={(click) => {
                evidenceTriggerRef.current = click.currentTarget;
                setEvidenceOpen(true);
              }}
            >
              {pick(zh, "View receipts", "查看凭证")}
            </button>
            <button className="btn btn-primary" onClick={askBrain}>{pick(zh, "Ask Mastermind", "询问 Mastermind")}</button>
          </div>
        </div>

        <div className="ci-provenance-bar">
          <span><i className="ci-live-dot" />{pick(zh, "As known at", "截至")} <time className="num" dateTime={activeContext.generated_at}>{activeContext.generated_at.replace("T", " ").slice(0, 16)} UTC</time></span>
          <span>{pick(zh, "Generation", "版本")} <code>{activeContext.generation_id.slice(0, 12)}</code></span>
          <span>{pick(zh, "Authority", "权限")} <b>{pick(zh, "Context only", "仅供背景参考")}</b></span>
        </div>
        {warningText && <div className="ci-state-banner" role="status"><span aria-hidden>!</span><p>{warningText}</p></div>}
      </header>

      <nav className="ci-lenses" role="tablist" aria-label={pick(zh, "Company intelligence lenses", "公司情报视图")}>
        {LENSES.map((item) => (
          <button
            key={item}
            id={`ci-tab-${item}`}
            role="tab"
            aria-selected={lens === item}
            aria-controls={`ci-panel-${item}`}
            tabIndex={lens === item ? 0 : -1}
            className={lens === item ? "on" : ""}
            onClick={() => selectLens(item)}
            onKeyDown={(key) => {
              const current = LENSES.indexOf(item);
              const target = key.key === "ArrowRight" ? (current + 1) % LENSES.length
                : key.key === "ArrowLeft" ? (current - 1 + LENSES.length) % LENSES.length
                  : key.key === "Home" ? 0 : key.key === "End" ? LENSES.length - 1 : -1;
              if (target < 0) return;
              key.preventDefault();
              selectLens(LENSES[target]);
              document.getElementById(`ci-tab-${LENSES[target]}`)?.focus();
            }}
          >
            {lensLabel(item, zh)}
            {item === "sources" && <span className="num">{event.sources.filter((source) => source.status !== "missing").length}</span>}
          </button>
        ))}
      </nav>

      <div ref={workspaceRef} className={`ci-workspace${evidenceOpen ? " evidence-open" : ""}`}>
        <main className="ci-canvas" id={`ci-panel-${lens}`} role="tabpanel" aria-labelledby={`ci-tab-${lens}`}>
          {lens === "brief" && (
            <CompanyIntelligenceBriefLayout
              zh={zh}
              ticker={ticker}
              periodLabel={eventPeriod(event)}
              eventDate={event.call_date}
              headline={briefHeadline}
              summary={briefSummary}
              metrics={briefMetrics}
              takeaways={briefTakeaways}
              changes={briefChanges}
              implications={[]}
              risks={briefRisks}
              watch={[]}
              selectedId={evidence?.id}
              onSelect={chooseBriefItem}
              footer={(
                <div className="ci-paper-boundary">
                  <div className="ci-paper-context-grid">
                    <CompanyThemeContextCard
                      ticker={ticker}
                      selectedEventId={event.event_id}
                      companyIntelligenceGenerationId={activeContext.generation_id}
                      latestEventId={activeContext.latest_event_id}
                      selectedEventLabel={eventPeriod(event)}
                      onUseLatest={activeContext.latest_event_id ? () => {
                        const latest = events.find((candidate) => candidate.event_id === activeContext.latest_event_id);
                        if (!latest) return;
                        setEventState({ sym: ticker, id: latest.event_id });
                        setEvidence(null);
                      } : undefined}
                    />
                    <CompanyInstitutionalContextCard
                      ticker={ticker}
                      selectedEventId={event.event_id}
                      companyIntelligenceGenerationId={activeContext.generation_id}
                      latestEventId={activeContext.latest_event_id}
                      selectedEventLabel={eventPeriod(event)}
                      onUseLatest={activeContext.latest_event_id ? () => {
                        const latest = events.find((candidate) => candidate.event_id === activeContext.latest_event_id);
                        if (!latest) return;
                        setEventState({ sym: ticker, id: latest.event_id });
                        setEvidence(null);
                      } : undefined}
                    />
                  </div>
                  {event.key_quote && (
                    <section className="ci-quote">
                      <button className={evidence?.id === `${event.event_id}:quote` ? "selected" : ""} onClick={() => chooseEvidence({ id: `${event.event_id}:quote`, kind: "quote", label: pick(zh, "Key quote", "关键引语"), text: event.key_quote || "", source: sourceByRef(event, event.field_lineage.key_quote) })} aria-pressed={evidence?.id === `${event.event_id}:quote`}>
                        <span aria-hidden>“</span><blockquote>{event.key_quote}</blockquote><i>{pick(zh, "Event receipt", "事件凭证")} ↗</i>
                      </button>
                    </section>
                  )}
                  <section className="ci-coverage">
                    <div><strong>{pick(zh, "What is missing", "缺失内容")}</strong><p>{activeContext.missing_sources.length ? activeContext.missing_sources.map((source) => missingSourceLabel(source, zh)).join(" · ") : pick(zh, "No required source family is marked missing for this view.", "本视图所需来源均未标记为缺失。")}</p></div>
                    <CompanySourceManifest event={event} onOpenTranscript={onOpenTx} compact />
                  </section>
                </div>
              )}
            />
          )}

          {lens === "results" && (
            <section className="ci-lens-panel ci-results">
              <CompanyIntelligenceResultsLayout
                zh={zh}
                periodLabel={eventPeriod(event)}
                eventDate={event.call_date}
                metrics={resultsMetrics}
                guidance={[]}
                callReadthrough={[]}
                comparisons={resultsComparisons}
                nonAssertions={resultsNonAssertions}
                selectedId={evidence?.id}
                onSelect={chooseResultsItem}
                onOpenCall={txId ? () => selectLens("transcript") : undefined}
                guidanceNote={pick(
                  zh,
                  "v1 fallback has no structured guidance object; none is inferred from scores or highlights.",
                  "v1 回退路径没有结构化指引对象；不会从评分或摘要中推断。",
                )}
                callNote={pick(
                  zh,
                  "The canonical transcript remains available separately; v1 carries no normalized Q&A read-through.",
                  "规范电话会记录仍可单独打开；v1 不携带标准化问答解读。",
                )}
              />
            </section>
          )}

          {lens === "transcript" && (
            <section className="ci-lens-panel ci-call">
              <CompanyIntelligenceCallLayout
                zh={zh}
                periodLabel={eventPeriod(event)}
                eventDate={event.call_date}
                transcriptId={txId}
                transcriptAvailable={transcriptSource?.status === "present" && Boolean(txId)}
                eventId={event.event_id}
                eventAlias={eventPeriod(event)}
                exchanges={[]}
                onOpenFullTranscript={txId ? () => onOpenTx(txId) : undefined}
                onOpenSources={() => selectLens("sources")}
                fallbackNote={pick(
                  zh,
                  "v1 fallback does not carry canonical normalized Q&A exchanges. Score-overlay question counts and highlights are not promoted into this research layer.",
                  "v1 回退路径不携带规范化标准问答轮次；不会将评分覆盖层的提问计数或摘要提升到此研究层。",
                )}
                searchContent={(
                  <TranscriptSearchWorkspace
                    ticker={ticker}
                    events={transcriptSearchEvents}
                    initialEventId={event.event_id}
                    onOpenTranscript={onOpenTx}
                  />
                )}
              />
            </section>
          )}

          {lens === "history" && (
            <section className="ci-lens-panel">
              <div className="ci-lens-heading"><div><span className="fin-eyebrow">{pick(zh, "EVENT HISTORY", "事件历史")}</span><h3>{pick(zh, "Quarter-over-quarter narrative", "季度叙事变化")}</h3></div><span>{events.length} {pick(zh, "events", "个事件")}</span></div>
              <div className="ci-history-wrap"><table className="fin-table ci-history-table"><thead><tr><th>{pick(zh, "Period", "期间")}</th><th>{pick(zh, "Date", "日期")}</th><th>{pick(zh, "Revenue", "营收")}</th><th>{pick(zh, "EPS", "每股盈利")}</th><th>{pick(zh, "Margin", "毛利率")}</th><th>{pick(zh, "Questions", "提问")}</th></tr></thead><tbody>{events.map((candidate) => <tr key={candidate.event_id} className={candidate.event_id === event.event_id ? "selected" : ""} onClick={() => { setEventState({ sym: ticker, id: candidate.event_id }); setEvidence(null); }}><td><button>{eventPeriod(candidate)}</button></td><td className="num">{candidate.call_date}</td><td className="num">{pct(candidate.metrics.revenue_growth_pct)}</td><td className="num">{pct(candidate.metrics.eps_growth_pct)}</td><td className="num">{pct(candidate.metrics.gross_margin_pct)}</td><td className="num">{numeric(candidate.metrics.questions_count)}</td></tr>)}</tbody></table></div>
            </section>
          )}

          {lens === "topics" && (
            <section className="ci-lens-panel">
              <div className="ci-lens-heading"><div><span className="fin-eyebrow">{pick(zh, "TOPIC MEMORY", "主题记忆")}</span><h3>{pick(zh, "What entered, persisted, or dropped", "新增、延续与退出的主题")}</h3></div><span>{activeContext.topics.timeline.length} {pick(zh, "tracked", "个追踪主题")}</span></div>
              {activeContext.topics.timeline.length ? (
                <ul className="ci-topic-list">{activeContext.topics.timeline.map((topic) => <li key={topic.tag}><span className={`ci-topic-status ${topic.status}`} aria-hidden /><div><strong>{topicTagLabel(topic.tag, zh)}</strong></div><span className="fin-tag" style={{ "--c": topic.status === "added" ? "var(--up)" : topic.status === "dropped" ? "var(--down)" : "var(--brand-2)" } as React.CSSProperties}>{topicStatusLabel(topic.status, zh ? "zh" : "en")}</span><b className="num">{topic.event_count}</b></li>)}</ul>
              ) : (
                <EmptyState title={pick(zh, "No repeated topics yet", "暂无重复主题")} why={pick(zh, "The structured history does not yet contain enough tagged events to establish a topic timeline.", "结构化历史中的标记事件尚不足以形成主题时间线。")} />
              )}
            </section>
          )}

          {lens === "sources" && (
            <section className="ci-lens-panel">
              <div className="ci-lens-heading"><div><span className="fin-eyebrow">{pick(zh, "SOURCE MANIFEST", "来源清单")}</span><h3>{pick(zh, "Availability and receipts", "可用性与凭证")}</h3></div><span>{pick(zh, "No inferred availability", "不推测来源状态")}</span></div>
              <CompanySourceManifest event={event} onOpenTranscript={onOpenTx} />
              <div className="ci-lineage"><strong>{pick(zh, "Transport lineage", "传输链路")}</strong><dl><div><dt>{pick(zh, "Earnings generation", "财报版本")}</dt><dd><code>{activeContext.transport_lineage.earnings_manifest.generation_id}</code></dd></div><div><dt>{pick(zh, "Transcript index", "电话会索引")}</dt><dd><code>{activeContext.transport_lineage.tx_index.generation_id}</code></dd></div><div><dt>{pick(zh, "Builder", "构建器")}</dt><dd><code>{activeContext.transport_lineage.builder}</code></dd></div></dl></div>
            </section>
          )}
        </main>

        <EvidenceRail
          event={event}
          evidence={evidence}
          open={evidenceOpen}
          overlay={evidenceOverlay}
          onClose={closeEvidence}
          onOpenTranscript={onOpenTx}
        />
      </div>
    </div>
  );
}
