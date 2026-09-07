"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../../lib/i18n";
import { fmtDate, pick } from "../../lib/finFormat";
import type { CompanyIntelligenceContext, CompanyIntelligenceEvent } from "../../lib/companyIntelligence";
import {
  eventWorkspaceGlanceTitle,
  presentEventWorkspace,
  type EventWorkspacePresented,
  type EventWorkspacePresentedItem,
} from "../../lib/eventWorkspacePresent";
import type { EventWorkspaceQaExchange, EventWorkspaceResult } from "../../lib/eventWorkspace";
import { tickerPeriodAliasFromWorkspace } from "../../lib/eventWorkspace";
import CompanySourceManifest from "./CompanySourceManifest";
import EvidenceRail, { type CompanyEvidenceSelection } from "./EvidenceRail";
import TranscriptSearchWorkspace from "./TranscriptSearchWorkspace";
import { openMastermindBrainForSymbol } from "../../lib/mastermindBrain";
import type { TranscriptOpenTarget } from "../../lib/transcriptSearch";
import { EVENT_WORKSPACE_ATTRIBUTION, topicTagLabel } from "../../lib/companyIntelligenceLabels";

type Lens = "brief" | "results" | "transcript" | "history" | "topics" | "sources";

const LENSES: readonly Lens[] = ["brief", "results", "transcript", "history", "topics", "sources"];

export interface CompanyIntelligenceV2CurrentProps {
  ticker: string;
  name?: string | null;
  result: Extract<EventWorkspaceResult, { ok: true }>;
  v1: CompanyIntelligenceContext | null;
  onOpenTx: (target: string | TranscriptOpenTarget) => void;
  onEvidenceOpenChange?: (open: boolean) => void;
}

function lensLabel(lens: Lens, zh: boolean): string {
  const labels: Record<Lens, [string, string]> = {
    brief: ["Brief", "简报"],
    results: ["Results", "业绩"],
    transcript: ["Transcript", "电话会"],
    history: ["History", "历史"],
    topics: ["Topics", "主题"],
    sources: ["Sources", "来源"],
  };
  return pick(zh, labels[lens][0], labels[lens][1]);
}

function topicStateLabel(status: "added" | "persistent" | "dropped", zh: boolean): string {
  if (status === "added") return pick(zh, "Added", "新增");
  if (status === "dropped") return pick(zh, "Dropped", "退出");
  return pick(zh, "Persistent", "延续");
}

const EMPTY_METRICS = {
  sentiment: null, performance: null, confidence: null, combined: null,
  call_positivity: null, management_confidence: null, analyst_criticism: null, future_outlook: null,
  revenue_growth_pct: null, eps_growth_pct: null, gross_margin_pct: null, analysts_count: null, questions_count: null,
};

function workspaceStubEvent(presented: EventWorkspacePresented, ticker: string, year: number, quarter: number): CompanyIntelligenceEvent {
  return {
    event_id: presented.event_id,
    ticker,
    fiscal_year: year,
    fiscal_quarter: quarter,
    call_date: presented.event_date,
    summary: null,
    highlights: [],
    positive_highlights: [],
    negative_highlights: [],
    key_quote: null,
    tags: [],
    metrics: EMPTY_METRICS,
    field_lineage: {
      summary: null,
      key_quote: null,
      metrics: { ...EMPTY_METRICS },
      positive_highlights: [],
      negative_highlights: [],
      highlights: [],
      tags: {},
    },
    previous_event_deltas: EMPTY_METRICS,
    sources: [],
    claim_citations_pending: true,
  };
}

function receiptColor(state: EventWorkspacePresentedItem["evidence"]["receipt_state"]): string {
  if (state === "byte_replayed") return "var(--rcpt-exact)";
  if (state === "address_only") return "var(--rcpt-superseded)";
  if (state === "status_only") return "var(--rcpt-meta)";
  return "var(--rcpt-absent)";
}

function selectionFromItem(item: EventWorkspacePresentedItem): CompanyEvidenceSelection {
  return {
    id: item.id,
    kind: "metric",
    label: item.label,
    text: item.detail || item.value,
    source: null,
    v2: item.evidence,
  };
}

function GlanceRow({
  kicker,
  items,
  selectedId,
  onChoose,
  region,
}: {
  kicker: string;
  items: EventWorkspacePresentedItem[];
  selectedId: string | undefined;
  onChoose: (item: EventWorkspacePresentedItem) => void;
  region?: "typed-absences" | "coverage-states";
}) {
  if (!items.length) return null;
  return (
    <section className="ci-glance-block" {...(region ? { "data-ci-results-region": region } : {})}>
      <div className="ci-section-label"><span>{kicker}</span></div>
      <div className="ci-glance-rows">
        {items.map((item) => (
          <button
            key={item.id}
            className={`ci-glance-row${selectedId === item.id ? " selected" : ""}`}
            aria-pressed={selectedId === item.id}
            onClick={() => onChoose(item)}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <i style={{ "--c": receiptColor(item.evidence.receipt_state) } as React.CSSProperties} aria-hidden />
          </button>
        ))}
      </div>
    </section>
  );
}


function isOperatorSpan(exchange: EventWorkspaceQaExchange, kind: "question" | "answer", index: number): boolean {
  const span = (kind === "question" ? exchange.question_spans : exchange.answer_spans)[index];
  const speaker = span?.locator.speaker?.trim().toLowerCase() ?? "";
  const role = span?.locator.role?.trim().toLowerCase() ?? "";
  return speaker === "operator" || role === "operator";
}

function analystQuestionText(exchange: EventWorkspaceQaExchange): string {
  return exchange.question_spans
    .filter((_, index) => !isOperatorSpan(exchange, "question", index))
    .map((span) => span.display_excerpt?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n\n");
}

function firstAnalystSegment(exchange: EventWorkspaceQaExchange): number | undefined {
  const span = exchange.question_spans.find((_, index) => !isOperatorSpan(exchange, "question", index));
  return span?.locator.segment_index;
}

function AnalystQaBlock({
  exchanges,
  txId,
  txSha,
  zh,
  onOpen,
}: {
  exchanges: EventWorkspaceQaExchange[];
  txId: string | null;
  txSha: string | undefined;
  zh: boolean;
  onOpen: (target: TranscriptOpenTarget) => void;
}) {
  if (!exchanges.length) return null;
  return (
    <section className="ci-qa" data-ci-results-region="analyst-qa" aria-label={zh ? "分析师问答" : "Analyst Q&A"}>
      <header className="ci-qa-head">
        <span className="fin-eyebrow">{zh ? `分析师问答 · ${exchanges.length} 轮` : `ANALYST Q&A · ${exchanges.length} exchanges`}</span>
        <p>{zh ? "结构已验证 · 主题增强暂不可用" : "Structure verified · topic enrichment unavailable"}</p>
      </header>
      <div className="ci-qa-list">
        {exchanges.map((exchange) => {
          const question = analystQuestionText(exchange);
          const segment = firstAnalystSegment(exchange);
          const affiliation = exchange.questioner.affiliation?.trim();
          return (
            <details key={exchange.exchange_id} className="ci-qa-row">
              <summary>
                <strong>Q{exchange.ordinal + 1}</strong>
                <span>
                  {exchange.questioner.name}
                  {affiliation ? ` · ${affiliation}` : ""}
                </span>
              </summary>
              <div className="ci-qa-body">
                {question ? <p className="ci-qa-question">{question}</p> : null}
                {exchange.respondents.map((respondent, index) => {
                  const answer = respondent.span_indexes
                    .map((spanIndex) => exchange.answer_spans[spanIndex]?.display_excerpt?.trim())
                    .filter((text): text is string => Boolean(text))
                    .join("\n\n");
                  return (
                    <div key={`${exchange.exchange_id}:${index}`} className="ci-qa-turn">
                      <span>{respondent.name}{respondent.role ? ` · ${respondent.role}` : ""}</span>
                      {answer ? <p>{answer}</p> : null}
                    </div>
                  );
                })}
                {txId && segment != null ? (
                  <button
                    type="button"
                    className="ci-qa-open"
                    onClick={() => onOpen({ id: txId, segment_index: segment, expected_document_sha256: txSha })}
                  >
                    {zh ? "在电话会中查看" : "Open in transcript"}
                  </button>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

export default function CompanyIntelligenceV2Current({
  ticker,
  name,
  result,
  v1,
  onOpenTx,
  onEvidenceOpenChange,
}: CompanyIntelligenceV2CurrentProps) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const presented = useMemo(
    () => presentEventWorkspace(result.workspace, { zh }),
    [result.workspace, zh],
  );
  const [lens, setLens] = useState<Lens>("brief");
  const [evidence, setEvidence] = useState<CompanyEvidenceSelection | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceOverlay, setEvidenceOverlay] = useState(false);
  const evidenceTriggerRef = useRef<HTMLElement | null>(null);
  const receiptsButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const selectLens = useCallback((next: Lens) => {
    setLens(next);
    window.requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ block: "start", behavior: "auto" }));
  }, []);

  useEffect(() => {
    setLens("brief");
    setEvidence(null);
  }, [ticker, result.workspace.generation_id]);

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

  useEffect(() => {
    if (evidence) return;
    const first = presented.reported[0];
    if (!first) return;
    setEvidence(selectionFromItem(first));
  }, [evidence, presented]);

  const chooseEvidence = useCallback((selection: CompanyEvidenceSelection) => {
    evidenceTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEvidence(selection);
    setEvidenceOpen(true);
  }, []);

  const chooseItem = useCallback((item: EventWorkspacePresentedItem) => {
    chooseEvidence(selectionFromItem(item));
  }, [chooseEvidence]);

  const closeEvidence = useCallback(() => {
    setEvidenceOpen(false);
    const trigger = evidenceTriggerRef.current ?? receiptsButtonRef.current;
    evidenceTriggerRef.current = null;
    window.requestAnimationFrame(() => trigger?.focus());
  }, []);

  const askBrain = useCallback(() => {
    if (openMastermindBrainForSymbol(ticker)) return;
    window.location.assign(`/terminal?symbol=${encodeURIComponent(ticker)}&ai=1`);
  }, [ticker]);

  const displayName = presented.display_name || name || ticker;
  const glance = eventWorkspaceGlanceTitle(presented, zh);
  const txId = presented.transcript_id;
  const txSha = presented.sources.find((source) => source.kind === "transcript")?.source_sha256 ?? undefined;
  const openSameTranscript = useCallback(() => {
    if (!txId) return;
    onOpenTx({ id: txId, expected_document_sha256: txSha });
  }, [onOpenTx, txId, txSha]);
  const stubEvent = workspaceStubEvent(
    presented,
    ticker,
    result.workspace.fiscal_period.year,
    result.workspace.fiscal_period.quarter,
  );
  const historicalEvents = v1
    ? (v1.latest_event ? [v1.latest_event, ...v1.history] : [...v1.history]).filter((event, index, all) => (
      all.findIndex((candidate) => candidate.event_id === event.event_id) === index
    ))
    : [];
  const transcriptSearchEvents = [
    {
      event_id: presented.event_id,
      label: presented.period_label,
      call_date: presented.event_date,
      transcript_id: txId,
      fiscal_year: result.workspace.fiscal_period.year,
      fiscal_quarter: result.workspace.fiscal_period.quarter,
    },
  ];
  const lifecycleLabel = result.state === "stale"
    ? pick(zh, "Last verified", "最近验证")
    : presented.lifecycle_state === "corrected"
      ? pick(zh, "Corrected", "已更正")
      : pick(zh, "Verified event", "已验证事件");
  const freshness = result.state === "stale" ? "stale" : "live";
  const eventAlias = tickerPeriodAliasFromWorkspace(result.workspace, ticker);

  return (
    <div
      className="ci-page"
      data-ci-plane="event_workspace.v1"
      data-ci-event-id={presented.event_id}
      data-ci-generation-id={presented.generation_id}
      data-ci-transcript-id={txId ?? ""}
      data-ci-freshness={freshness}
      data-ci-event-alias={eventAlias ?? ""}
    >
      <header className="ci-hero">
        <div className="ci-hero-main">
          <div className="ci-identity">
            <span className="ci-company-mark" aria-hidden>{displayName.trim().charAt(0).toUpperCase()}</span>
            <div>
              <div className="ci-title-line">
                <h2>{displayName}</h2>
                <span className="ci-ticker num">{ticker}</span>
                <span className="fin-tag" style={{ "--c": freshness === "stale" ? "var(--warn)" : "var(--rcpt-exact)" } as React.CSSProperties}>{lifecycleLabel}</span>
              </div>
              <p data-ci-glance-title="">{pick(zh, "Company Intelligence", "公司情报")} · {glance}</p>
            </div>
          </div>
          <div className="ci-hero-actions">
            <label className="ci-event-select">
              <span>{pick(zh, "Event", "事件")}</span>
              <select
                value={presented.event_id}
                disabled
                aria-label={pick(zh, "Event selected from workspace aliases", "来自工作区别名的事件")}
              >
                <option value={presented.event_id}>{presented.period_label} · {presented.event_date}</option>
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
          <span>
            <i className={`ci-live-dot${freshness === "stale" ? " stale" : ""}`} />
            {freshness === "stale"
              ? pick(zh, "Last verified", "最近验证")
              : pick(zh, "As known at", "截至")}
            {" "}
            <time className="num" dateTime={presented.event_date}>{fmtDate(presented.event_date)}</time>
          </span>
          <span>{pick(zh, "Authority", "权限")} <b>{pick(zh, "Context only", "仅供背景参考")}</b></span>
          <span>{pick(zh, EVENT_WORKSPACE_ATTRIBUTION.en, EVENT_WORKSPACE_ATTRIBUTION.zh)}</span>
        </div>
        {freshness === "stale" && (
          <p className="ci-stale-banner" role="status" data-ci-stale-banner="">
            {pick(zh, "Last verified · upstream temporarily unavailable", "最近验证 · 上游暂时不可用")}
          </p>
        )}
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
            {item === "sources" && <span className="num">{presented.sources.filter((source) => source.receipt_state === "byte_replayed").length}</span>}
          </button>
        ))}
      </nav>

      <div ref={workspaceRef} className={`ci-workspace${evidenceOpen ? " evidence-open" : ""}`}>
        <main className="ci-canvas" id={`ci-panel-${lens}`} role="tabpanel" aria-labelledby={`ci-tab-${lens}`}>
          {lens === "brief" && (
            <div className="ci-brief">
              <section className="ci-stance">
                <div className="ci-section-label">
                  <span>{pick(zh, "EVENT", "事件")}</span>
                  <small>{pick(zh, "Source-backed facts · not a model summary", "来源支持的事实 · 非模型摘要")}</small>
                </div>
                <p className="ci-glance-lede">{glance}</p>
              </section>
              <GlanceRow kicker={pick(zh, "REPORTED", "已报告")} items={presented.reported} selectedId={evidence?.id} onChoose={chooseItem} />
              <GlanceRow kicker={pick(zh, "GUIDANCE", "指引")} items={presented.guidance} selectedId={evidence?.id} onChoose={chooseItem} />
              <GlanceRow kicker={pick(zh, "WATCH", "关注")} items={presented.watch} selectedId={evidence?.id} onChoose={chooseItem} />
              <section className="ci-honest" aria-label={pick(zh, "Typed absences", "类型化缺项")}>
                <div className="ci-section-label"><span>{pick(zh, "HONEST STATES", "如实状态")}</span></div>
                <div className="ci-honest-grid">
                  {presented.completeness.filter((item) => (
                    item.id === "completeness:slides"
                    || item.id === "completeness:consensus"
                    || item.id === "completeness:reaction"
                    || (item.id === "fact_questions_count" && result.workspace.qa_exchanges.length === 0)
                  )).map((item) => (
                    <button key={item.id} className={`ci-honest-chip${evidence?.id === item.id ? " selected" : ""}`} onClick={() => chooseItem(item)} aria-pressed={evidence?.id === item.id}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </button>
                  ))}
                </div>
              </section>
              <section className="ci-coverage">
                <div>
                  <strong>{pick(zh, "Current sources", "当期来源")}</strong>
                  <p>{pick(zh, "Receipt-backed workspace objects, not v1 overlay coverage.", "凭证支持的工作区对象，而非 v1 覆盖层。")}</p>
                </div>
                <CompanySourceManifest event={stubEvent} v2Sources={presented.sources} onOpenTranscript={(id) => onOpenTx({ id, expected_document_sha256: txSha })} compact />
              </section>
            </div>
          )}

          {lens === "results" && (
            <section className="ci-lens-panel ci-results">
              <div className="ci-lens-heading">
                <div>
                  <span className="fin-eyebrow">{pick(zh, "RESULTS", "业绩")}</span>
                  <h3>{presented.period_label}</h3>
                </div>
                <span>{pick(zh, "No beat/miss · consensus unlicensed", "不显示超预期或不及预期 · 共识未授权")}</span>
              </div>
              <GlanceRow kicker={pick(zh, "REPORTED FACTS", "已报告事实")} items={presented.facts.filter((item) => item.id !== "fact_questions_count")} selectedId={evidence?.id} onChoose={chooseItem} />
              <GlanceRow kicker={pick(zh, "DELTAS", "变动")} items={presented.deltas} selectedId={evidence?.id} onChoose={chooseItem} />
              <GlanceRow kicker={pick(zh, "GUIDANCE", "指引")} items={presented.guidance} selectedId={evidence?.id} onChoose={chooseItem} />
              <AnalystQaBlock
                exchanges={result.workspace.qa_exchanges}
                txId={txId}
                txSha={txSha}
                zh={zh}
                onOpen={onOpenTx}
              />
              <GlanceRow
                kicker={pick(zh, "TYPED ABSENCES", "类型化缺项")}
                region="typed-absences"
                items={presented.completeness.filter((item) => item.evidence.receipt_state === "typed_absence")}
                selectedId={evidence?.id}
                onChoose={chooseItem}
              />
              <GlanceRow
                kicker={pick(zh, "COVERAGE STATES", "覆盖状态")}
                region="coverage-states"
                items={presented.completeness.filter((item) => (
                  item.evidence.receipt_state === "status_only"
                  && item.evidence.status_label !== "present"
                  && item.evidence.status_label !== "bound"
                ))}
                selectedId={evidence?.id}
                onChoose={chooseItem}
              />
            </section>
          )}

          {lens === "transcript" && (
            <section className="ci-lens-panel">
              <div className="ci-lens-heading">
                <div>
                  <span className="fin-eyebrow">{pick(zh, "SAME EVENT", "同一事件")}</span>
                  <h3>{presented.period_label} {pick(zh, "earnings call", "财报电话会")}</h3>
                </div>
                <span className="fin-tag" style={{ "--c": txId ? "var(--rcpt-exact)" : "var(--rcpt-absent)" } as React.CSSProperties}>
                  {txId ?? pick(zh, "Unavailable", "不可用")}
                </span>
              </div>
              <p className="ci-event-identity">
                <code>{presented.event_id}</code>
                <span>{eventAlias ?? presented.period_label}</span>
              </p>
              {txId ? (
                <div className="ci-transcript-launch">
                  <div className="ci-transcript-glyph" aria-hidden><span>T</span><i /></div>
                  <div>
                    <strong>{pick(zh, "This event's call record is available", "本事件电话会记录可用")}</strong>
                    <p>{pick(zh, `Opens ${txId} for ${presented.event_id}, not another ${ticker} transcript.`, `打开 ${presented.event_id} 的 ${txId}，而非该标的的其他电话会。`)}</p>
                  </div>
                  <button className="btn btn-primary" onClick={openSameTranscript}>{pick(zh, "Read transcript", "阅读电话会")}</button>
                </div>
              ) : (
                <div className="fin-empty fin-empty-lg ci-state" role="status">
                  <div className="fin-empty-title">{pick(zh, "Transcript body unavailable", "电话会正文不可用")}</div>
                  <div className="fin-empty-why">{pick(zh, "The workspace does not carry a transcript identity for this event.", "该工作区未携带本事件的电话会身份。")}</div>
                </div>
              )}
              <TranscriptSearchWorkspace
                ticker={ticker}
                events={transcriptSearchEvents}
                initialEventId={presented.event_id}
                onOpenTranscript={(target) => onOpenTx(typeof target === "string" ? { id: target, expected_document_sha256: txSha } : { ...target, expected_document_sha256: target.expected_document_sha256 ?? txSha })}
              />
            </section>
          )}

          {lens === "history" && (
            <section className="ci-lens-panel">
              <div className="ci-lens-heading">
                <div>
                  <span className="fin-eyebrow">{pick(zh, "HISTORICAL V1 CONTEXT", "历史 v1 背景")}</span>
                  <h3>{pick(zh, "Does not control the current event", "不控制当期事件")}</h3>
                </div>
                <span>{historicalEvents.length} {pick(zh, "rows", "行")}</span>
              </div>
              <p className="ci-v1-note">{pick(zh, "These older structured-history rows stay available for context. They cannot select the current event, derive current deltas, or stand in as v2 evidence.", "这些较早的结构化历史行仅作背景。它们不能选择当期事件、派生当期变动，或充当 v2 证据。")}</p>
              {historicalEvents.length ? (
                <div className="ci-history-wrap">
                  <table className="fin-table ci-history-table ci-history-readonly">
                    <thead>
                      <tr>
                        <th>{pick(zh, "Period", "期间")}</th>
                        <th>{pick(zh, "Date", "日期")}</th>
                        <th>{pick(zh, "v1 event", "v1 事件")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicalEvents.map((candidate) => (
                        <tr key={candidate.event_id}>
                          <td>Q{candidate.fiscal_quarter} FY{candidate.fiscal_year}</td>
                          <td className="num">{candidate.call_date}</td>
                          <td><code>{candidate.event_id}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="ci-inline-empty">{pick(zh, "No v1 historical rows are attached for this ticker.", "该标的暂无 v1 历史行。")}</p>
              )}
            </section>
          )}

          {lens === "topics" && (
            <section className="ci-lens-panel">
              <div className="ci-lens-heading">
                <div>
                  <span className="fin-eyebrow">{pick(zh, "HISTORICAL V1 TOPICS", "历史 v1 主题")}</span>
                  <h3>{pick(zh, "Not current-event evidence", "不是当期证据")}</h3>
                </div>
                <span>{v1?.topics.timeline.length ?? 0} {pick(zh, "tracked", "个追踪主题")}</span>
              </div>
              <p className="ci-v1-note">{pick(zh, "Topic memory remains v1 historical context. It does not overwrite v2 claims.", "主题记忆仍是 v1 历史背景，不会覆盖 v2 主张。")}</p>
              {v1?.topics.timeline.length ? (
                <ul className="ci-topic-list">
                  {v1.topics.timeline.map((topic) => (
                    <li key={topic.tag}>
                      <span className={`ci-topic-status ${topic.status}`} aria-hidden />
                      <div><strong>{topicTagLabel(topic.tag, zh)}</strong></div>
                      <span className="fin-tag" style={{ "--c": "var(--rcpt-exact)" } as React.CSSProperties}>{topicStateLabel(topic.status, zh)}</span>
                      <b className="num">{topic.event_count}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ci-inline-empty">{pick(zh, "No v1 topic timeline is attached.", "暂无 v1 主题时间线。")}</p>
              )}
            </section>
          )}

          {lens === "sources" && (
            <section className="ci-lens-panel">
              <div className="ci-lens-heading">
                <div>
                  <span className="fin-eyebrow">{pick(zh, "SOURCE MANIFEST", "来源清单")}</span>
                  <h3>{pick(zh, "Workspace completeness and receipts", "工作区完整性与凭证")}</h3>
                </div>
                <span>{pick(zh, EVENT_WORKSPACE_ATTRIBUTION.en, EVENT_WORKSPACE_ATTRIBUTION.zh)}</span>
              </div>
              <CompanySourceManifest event={stubEvent} v2Sources={presented.sources} onOpenTranscript={(id) => onOpenTx({ id, expected_document_sha256: txSha })} />
            </section>
          )}
        </main>

        <EvidenceRail
          event={stubEvent}
          evidence={evidence}
          open={evidenceOpen}
          overlay={evidenceOverlay}
          onClose={closeEvidence}
          onOpenTranscript={(id) => onOpenTx({ id, expected_document_sha256: txSha })}
          periodCode={`${result.workspace.fiscal_period.year}Q${result.workspace.fiscal_period.quarter}`}
        />
      </div>
    </div>
  );
}
