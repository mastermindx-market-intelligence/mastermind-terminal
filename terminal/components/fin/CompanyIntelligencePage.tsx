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
import {
  getCompanyIntelligence,
  type CompanyIntelligenceContext,
  type CompanyIntelligenceEvent,
  type CompanyIntelligenceResult,
  type CompanyIntelligenceSource,
} from "../../lib/companyIntelligence";
import { getCurrentEventWorkspace, type EventWorkspaceResult } from "../../lib/eventWorkspace";
import CompanyIntelligenceV2Current from "./CompanyIntelligenceV2Current";
import CompanySourceManifest from "./CompanySourceManifest";
import EvidenceRail, { type CompanyEvidenceSelection } from "./EvidenceRail";
import TranscriptSearchWorkspace from "./TranscriptSearchWorkspace";
import CompanyThemeContextCard from "./CompanyThemeContextCard";
import CompanyInstitutionalContextCard from "./CompanyInstitutionalContextCard";
import { openMastermindBrainForSymbol } from "../../lib/mastermindBrain";
import type { TranscriptOpenTarget } from "../../lib/transcriptSearch";
import { topicTagLabel } from "../../lib/companyIntelligenceLabels";

type Lens = "brief" | "transcript" | "history" | "topics" | "sources";

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

const LENSES: readonly Lens[] = ["brief", "transcript", "history", "topics", "sources"];

function lensLabel(lens: Lens, zh: boolean): string {
  const labels: Record<Lens, [string, string]> = {
    brief: ["Brief", "简报"],
    transcript: ["Transcript", "电话会"],
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

function sourceStateLabel(status: CompanyIntelligenceSource["status"] | undefined, zh: boolean): string {
  if (status === "present") return pick(zh, "Present", "可用");
  if (status === "metadata_only") return pick(zh, "Metadata only", "仅元数据");
  return pick(zh, "Missing", "缺失");
}

function topicStateLabel(status: "added" | "persistent" | "dropped", zh: boolean): string {
  if (status === "added") return pick(zh, "Added", "新增");
  if (status === "dropped") return pick(zh, "Dropped", "退出");
  return pick(zh, "Persistent", "延续");
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

function MetricTile({
  label,
  value,
  delta,
  onEvidence,
}: {
  label: string;
  value: string;
  delta: string;
  onEvidence: () => void;
}) {
  return (
    <button className="ci-metric" onClick={onEvidence}>
      <span>{label}</span>
      <strong className="num">{value}</strong>
      <small className="num">{delta}</small>
    </button>
  );
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
  const [evidenceOverlay, setEvidenceOverlay] = useState(false);
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
    const desktop = window.matchMedia("(min-width: 1101px)");
    const sync = () => {
      setEvidenceOverlay(!desktop.matches);
      setEvidenceOpen(desktop.matches);
    };
    sync();
    desktop.addEventListener("change", sync);
    return () => desktop.removeEventListener("change", sync);
  }, [ticker]);

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
  const summarySourceRef = event.summary
    ? event.field_lineage.summary
    : event.field_lineage.highlights[0] ?? null;
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
            <div className="ci-brief">
              <section className="ci-stance">
                <div className="ci-section-label"><span>{pick(zh, "STRUCTURED EVENT CONTEXT", "结构化事件背景")}</span><small>{pick(zh, "Source-authored event record · not a signal", "来源编制的事件记录 · 非交易信号")}</small></div>
                <button
                  className={`ci-claim ci-stance-copy${evidence?.id === `${event.event_id}:summary` ? " selected" : ""}`}
                  onClick={() => chooseEvidence({ id: `${event.event_id}:summary`, kind: "summary", label: pick(zh, "Structured event context", "结构化事件背景"), text: event.summary || event.highlights[0] || pick(zh, "No structured event context is present for this event.", "本事件暂无结构化事件背景。"), source: sourceByRef(event, summarySourceRef) })}
                  aria-pressed={evidence?.id === `${event.event_id}:summary`}
                >
                  <span>{event.summary || event.highlights[0] || pick(zh, "No structured event context is present for this event.", "本事件暂无结构化事件背景。")}</span>
                  <i>{pick(zh, "Event receipt", "事件凭证")} ↗</i>
                </button>
              </section>

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

              <section className="ci-material">
                <div className="ci-section-label"><span>{pick(zh, "REPORTED CHANGE", "报告变化")}</span><small>{pick(zh, "Deterministic event fields", "确定性事件字段")}</small></div>
                <div className="ci-metrics">
                  <MetricTile label={pick(zh, "Revenue growth", "营收增长")} value={pct(metrics.revenue_growth_pct)} delta={`${pct(deltas.revenue_growth_pct, true)} ${pick(zh, "vs prior", "较上期")}`} onEvidence={() => chooseEvidence({ id: `${event.event_id}:revenue`, kind: "metric", label: pick(zh, "Revenue growth", "营收增长"), text: `${pick(zh, "Reported revenue growth", "报告营收增长")}: ${pct(metrics.revenue_growth_pct)}.`, derived_comparison: `${pick(zh, "Change versus prior event", "较上期变化")}: ${pct(deltas.revenue_growth_pct, true)}. ${pick(zh, "Derived from current and prior structured-event values; it is not attributed to the current metric source alone.", "由当期及上期结构化事件数值派生；不会仅归属于当前指标来源。")}`, source: sourceByRef(event, event.field_lineage.metrics.revenue_growth_pct) })} />
                  <MetricTile label={pick(zh, "EPS growth", "每股盈利增长")} value={pct(metrics.eps_growth_pct)} delta={`${pct(deltas.eps_growth_pct, true)} ${pick(zh, "vs prior", "较上期")}`} onEvidence={() => chooseEvidence({ id: `${event.event_id}:eps`, kind: "metric", label: pick(zh, "EPS growth", "每股盈利增长"), text: `${pick(zh, "Reported EPS growth", "报告每股盈利增长")}: ${pct(metrics.eps_growth_pct)}.`, derived_comparison: `${pick(zh, "Change versus prior event", "较上期变化")}: ${pct(deltas.eps_growth_pct, true)}. ${pick(zh, "Derived from current and prior structured-event values; it is not attributed to the current metric source alone.", "由当期及上期结构化事件数值派生；不会仅归属于当前指标来源。")}`, source: sourceByRef(event, event.field_lineage.metrics.eps_growth_pct) })} />
                  <MetricTile label={pick(zh, "Gross margin", "毛利率")} value={pct(metrics.gross_margin_pct)} delta={`${pct(deltas.gross_margin_pct, true)} ${pick(zh, "vs prior", "较上期")}`} onEvidence={() => chooseEvidence({ id: `${event.event_id}:margin`, kind: "metric", label: pick(zh, "Gross margin", "毛利率"), text: `${pick(zh, "Reported gross margin", "报告毛利率")}: ${pct(metrics.gross_margin_pct)}.`, derived_comparison: `${pick(zh, "Change versus prior event", "较上期变化")}: ${pct(deltas.gross_margin_pct, true)}. ${pick(zh, "Derived from current and prior structured-event values; it is not attributed to the current metric source alone.", "由当期及上期结构化事件数值派生；不会仅归属于当前指标来源。")}`, source: sourceByRef(event, event.field_lineage.metrics.gross_margin_pct) })} />
                  <MetricTile label={pick(zh, "Analyst questions", "分析师提问")} value={numeric(metrics.questions_count)} delta={`${numeric(deltas.questions_count, true)} ${pick(zh, "vs prior", "较上期")}`} onEvidence={() => chooseEvidence({ id: `${event.event_id}:questions`, kind: "metric", label: pick(zh, "Analyst questions", "分析师提问"), text: `${pick(zh, "Questions recorded", "记录提问数")}: ${numeric(metrics.questions_count)}.`, derived_comparison: `${pick(zh, "Change versus prior event", "较上期变化")}: ${numeric(deltas.questions_count, true)}. ${pick(zh, "Derived from current and prior structured-event values; it is not attributed to the current metric source alone.", "由当期及上期结构化事件数值派生；不会仅归属于当前指标来源。")}`, source: sourceByRef(event, event.field_lineage.metrics.questions_count) })} />
                </div>
              </section>

              <section className="ci-changes">
                <div className="ci-section-label"><span>{pick(zh, "MATERIAL READ-THROUGHS", "关键解读")}</span><small>{pick(zh, "Select any row to inspect its event/source-family receipt", "选择任一条目以检查事件或来源类别凭证")}</small></div>
                <div className="ci-change-columns">
                  <div>
                    <h3><span className="ci-direction positive" />{pick(zh, "Constructive", "积极")}</h3>
                    {positiveItems.map((item, index) => {
                      const id = `${event.event_id}:positive:${index}`;
                      return <button key={id} className={`ci-change-row${evidence?.id === id ? " selected" : ""}`} aria-pressed={evidence?.id === id} onClick={() => chooseEvidence({ id, kind: "highlight", label: pick(zh, "Constructive read-through", "积极解读"), text: item, source: sourceByRef(event, positiveLineage[index]) })}><span>{index + 1}</span><p>{item}</p><i>↗</i></button>;
                    })}
                    {positiveItems.length === 0 && <p className="ci-inline-empty">{pick(zh, "The structured record retained no explicitly constructive highlight for this event.", "结构化记录未保留本事件明确积极的要点。")}</p>}
                  </div>
                  <div>
                    <h3><span className="ci-direction negative" />{pick(zh, "Watch items", "关注项")}</h3>
                    {(event.negative_highlights.length ? event.negative_highlights : []).map((item, index) => {
                      const id = `${event.event_id}:negative:${index}`;
                      return <button key={id} className={`ci-change-row${evidence?.id === id ? " selected" : ""}`} aria-pressed={evidence?.id === id} onClick={() => chooseEvidence({ id, kind: "highlight", label: pick(zh, "Watch item", "关注项"), text: item, source: sourceByRef(event, event.field_lineage.negative_highlights[index]) })}><span>{index + 1}</span><p>{item}</p><i>↗</i></button>;
                    })}
                    {event.negative_highlights.length === 0 && <p className="ci-inline-empty">{pick(zh, "No negative highlight was retained in the structured record.", "结构化记录中未保留负面要点。")}</p>}
                  </div>
                </div>
              </section>

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

          {lens === "transcript" && (
            <section className="ci-lens-panel">
              <div className="ci-lens-heading"><div><span className="fin-eyebrow">{pick(zh, "SELECTED EVENT", "当前事件")}</span><h3>{eventPeriod(event)} {pick(zh, "earnings call", "财报电话会")}</h3></div><span className="fin-tag" style={{ "--c": transcriptSource?.status === "present" ? "var(--up)" : "var(--warn)" } as React.CSSProperties}>{sourceStateLabel(transcriptSource?.status, zh)}</span></div>
              {txId ? (
                <div className="ci-transcript-launch"><div className="ci-transcript-glyph" aria-hidden><span>T</span><i /></div><div><strong>{pick(zh, "Normalized call record is available", "标准化电话会记录可用")}</strong><p>{pick(zh, "Open the event-selected transcript in Mastermind's existing reader with speaker and Q&A structure intact.", "在 Mastermind 现有阅读器中打开本事件电话会，并保留发言人与问答结构。")}</p></div><button className="btn btn-primary" onClick={() => onOpenTx(txId)}>{pick(zh, "Read transcript", "阅读电话会")}</button></div>
              ) : (
                <EmptyState title={pick(zh, "Transcript body unavailable", "电话会正文不可用")} why={pick(zh, "Event metadata is retained, but this fiscal period does not resolve to a transcript document.", "事件元数据已保留，但该财季尚未关联到电话会文档。")} />
              )}
              <TranscriptSearchWorkspace
                ticker={ticker}
                events={transcriptSearchEvents}
                initialEventId={event.event_id}
                onOpenTranscript={onOpenTx}
              />
              <CompanySourceManifest event={event} onOpenTranscript={onOpenTx} />
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
                <ul className="ci-topic-list">{activeContext.topics.timeline.map((topic) => <li key={topic.tag}><span className={`ci-topic-status ${topic.status}`} aria-hidden /><div><strong>{topicTagLabel(topic.tag, zh)}</strong></div><span className="fin-tag" style={{ "--c": topic.status === "added" ? "var(--up)" : topic.status === "dropped" ? "var(--down)" : "var(--brand-2)" } as React.CSSProperties}>{topicStateLabel(topic.status, zh)}</span><b className="num">{topic.event_count}</b></li>)}</ul>
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
