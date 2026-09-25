"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LEX, useLang } from "../../lib/i18n";
import { fmtDate, pick } from "../../lib/finFormat";
import { topicStatusLabel } from "../../lib/plainLabels";
import type { CompanyIntelligenceContext, CompanyIntelligenceEvent } from "../../lib/companyIntelligence";
import {
  eventWorkspaceGlanceTitle,
  presentEventWorkspace,
  type EventWorkspacePresented,
  type EventWorkspacePresentedItem,
  type EventWorkspacePresentedSource,
} from "../../lib/eventWorkspacePresent";
import type { EventWorkspaceQaExchange, EventWorkspaceResult } from "../../lib/eventWorkspace";
import { tickerPeriodAliasFromWorkspace } from "../../lib/eventWorkspace";
import CompanySourceManifest from "./CompanySourceManifest";
import CompanyIntelligenceBriefLayout, { type CompanyIntelligenceBriefItem } from "./CompanyIntelligenceBriefLayout";
import CompanyIntelligenceEventHistoryStrip, { type CompanyIntelligenceEventHistoryItem } from "./CompanyIntelligenceEventHistoryStrip";
import CompanyIntelligenceHistoryLayout, {
  type CompanyIntelligenceHistoryEvent,
  type CompanyIntelligenceHistoryMetric,
} from "./CompanyIntelligenceHistoryLayout";
import CompanyIntelligenceTopicMemoryLayout, {
  type CompanyIntelligenceTopicMemoryItem,
} from "./CompanyIntelligenceTopicMemoryLayout";
import CompanyIntelligenceCallLayout, { type CompanyIntelligenceCallExchange } from "./CompanyIntelligenceCallLayout";
import CompanyIntelligenceResultsLayout, {
  type CompanyIntelligenceResultsComparison,
  type CompanyIntelligenceResultsItem,
} from "./CompanyIntelligenceResultsLayout";
import CompanyIntelligenceSourcesLayout, {
  type CompanyIntelligenceCoverageItem,
  type CompanyIntelligenceMethodItem,
  type CompanyIntelligenceSourceTone,
} from "./CompanyIntelligenceSourcesLayout";
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
    transcript: ["Call + Q&A", "电话会 + 问答"],
    history: ["History", "历史"],
    topics: ["Topics", "主题"],
    sources: ["Sources", "来源"],
  };
  return pick(zh, labels[lens][0], labels[lens][1]);
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

function sourceCoverageTone(source: EventWorkspacePresentedSource | undefined): CompanyIntelligenceSourceTone {
  if (!source) return "missing";
  if (source.receipt_state === "byte_replayed") return "present";
  if (source.receipt_state === "address_only") return "metadata";
  if (source.receipt_state === "typed_absence") return "missing";
  return "partial";
}

function sourceCoverageStatus(source: EventWorkspacePresentedSource | undefined, zh: boolean): string {
  if (!source) return pick(zh, "Missing", "缺失");
  if (source.receipt_state === "byte_replayed") return pick(zh, "Present", "可用");
  if (source.receipt_state === "address_only") return pick(zh, "Address only", "仅地址");
  if (source.receipt_state === "typed_absence") return pick(zh, "Unavailable", "不可用");
  return pick(zh, "Partial", "部分");
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

function toBriefItem(item: EventWorkspacePresentedItem): CompanyIntelligenceBriefItem {
  return { id: item.id, label: item.label, value: item.value, detail: item.detail };
}

function usableBriefItems(...groups: EventWorkspacePresentedItem[][]): EventWorkspacePresentedItem[] {
  const seen = new Set<string>();
  const items: EventWorkspacePresentedItem[] = [];
  for (const item of groups.flat()) {
    if (seen.has(item.id) || item.evidence.receipt_state !== "byte_replayed") continue;
    if (!item.value || /^unavailable\b/i.test(item.value)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

function toResultsItem(item: EventWorkspacePresentedItem): CompanyIntelligenceResultsItem {
  return { id: item.id, label: item.label, value: item.value, detail: item.detail };
}

function compactExcerpt(text: string, limit = 190): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function historicalPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function historicalNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function qaReadthroughItems(exchanges: EventWorkspaceQaExchange[]): CompanyIntelligenceResultsItem[] {
  return exchanges.map((exchange) => {
    const question = analystQuestionText(exchange);
    const affiliation = exchange.questioner.affiliation?.trim();
    const respondents = [...new Set(exchange.respondents.map((row) => (
      row.role ? `${row.name} · ${row.role}` : row.name
    )))].join(" · ");
    return {
      id: exchange.exchange_id,
      label: affiliation ? `${exchange.questioner.name} · ${affiliation}` : exchange.questioner.name,
      value: question ? compactExcerpt(question) : "Verified Q&A exchange",
      detail: respondents || null,
    };
  });
}

function qaCallExchanges(exchanges: EventWorkspaceQaExchange[]): CompanyIntelligenceCallExchange[] {
  return exchanges.map((exchange) => ({
    id: exchange.exchange_id,
    ordinal: exchange.ordinal,
    analyst: exchange.questioner.name,
    affiliation: exchange.questioner.affiliation?.trim() || null,
    question: compactExcerpt(analystQuestionText(exchange), 230),
    respondents: [...new Set(exchange.respondents.map((row) => (
      row.role ? `${row.name} · ${row.role}` : row.name
    )))],
    segmentIndex: firstAnalystSegment(exchange) ?? null,
  }));
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
        <p>{pick(zh, LEX.ciQaStructure[0], LEX.ciQaStructure[1])}</p>
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
                    {pick(zh, LEX.ciOpenInTranscript[0], LEX.ciOpenInTranscript[1])}
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
  const evidenceOverlay = true;
  const evidenceTriggerRef = useRef<HTMLElement | null>(null);
  const receiptsButtonRef = useRef<HTMLButtonElement>(null);

  const selectLens = useCallback((next: Lens) => {
    // Keep the outer research shell stable. The active lens swaps in place and
    // must not scroll .fin-body (or any ancestor) as a side effect.
    setLens(next);
  }, []);

  useEffect(() => {
    setLens("brief");
    setEvidence(null);
  }, [ticker, result.workspace.generation_id]);

  useEffect(() => {
    setEvidence(null);
  }, [zh]);

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
  const historyStripItems: CompanyIntelligenceEventHistoryItem[] = [
    {
      id: presented.event_id,
      label: presented.period_label,
      date: presented.event_date,
      status: "current",
    },
    ...historicalEvents
      .filter((candidate) => !(
        candidate.fiscal_year === result.workspace.fiscal_period.year
        && candidate.fiscal_quarter === result.workspace.fiscal_period.quarter
      ))
      .slice(0, 3)
      .map((candidate) => ({
        id: candidate.event_id,
        label: `Q${candidate.fiscal_quarter} FY${candidate.fiscal_year}`,
        date: candidate.call_date,
        status: "context" as const,
      })),
  ];
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
  const briefMetrics = usableBriefItems(presented.facts, presented.reported, presented.guidance).slice(0, 4);
  const historyCurrentFacts: CompanyIntelligenceHistoryMetric[] = briefMetrics.map((item) => ({
    id: item.id,
    label: item.label,
    value: item.value,
    detail: item.detail,
  }));
  const historyContextEvents: CompanyIntelligenceHistoryEvent[] = historicalEvents
    .slice(0, 6)
    .map((candidate) => ({
      id: candidate.event_id,
      label: `Q${candidate.fiscal_quarter} FY${candidate.fiscal_year}`,
      date: candidate.call_date,
      status: "context",
      summary: candidate.summary || candidate.highlights[0] || null,
      reference: candidate.event_id,
      metrics: [
        {
          id: "revenue_growth",
          label: pick(zh, "Revenue growth", "营收增长"),
          value: historicalPct(candidate.metrics.revenue_growth_pct),
        },
        {
          id: "eps_growth",
          label: pick(zh, "EPS growth", "每股盈利增长"),
          value: historicalPct(candidate.metrics.eps_growth_pct),
        },
        {
          id: "gross_margin",
          label: pick(zh, "Gross margin", "毛利率"),
          value: historicalPct(candidate.metrics.gross_margin_pct),
        },
        {
          id: "questions",
          label: pick(zh, "Analyst questions", "分析师提问"),
          value: historicalNumber(candidate.metrics.questions_count),
        },
      ],
    }));
  const historicalEventsById = new Map(historicalEvents.map((candidate) => [candidate.event_id, candidate]));
  const topicMemoryItems: CompanyIntelligenceTopicMemoryItem[] = (v1?.topics.timeline ?? []).map((topic) => {
    const first = historicalEventsById.get(topic.first_event_id);
    const last = historicalEventsById.get(topic.last_event_id);
    return {
      id: topic.tag,
      label: topicTagLabel(topic.tag, zh),
      status: topic.status,
      statusLabel: topicStatusLabel(topic.status, zh ? "zh" : "en"),
      eventCount: topic.event_count,
      firstLabel: first ? `Q${first.fiscal_quarter} FY${first.fiscal_year}` : null,
      firstDate: first?.call_date ?? null,
      lastLabel: last ? `Q${last.fiscal_quarter} FY${last.fiscal_year}` : null,
      lastDate: last?.call_date ?? null,
    };
  });
  const briefChanges = usableBriefItems(presented.deltas).slice(0, 3);
  const briefRisks = usableBriefItems(presented.watch).slice(0, 3);
  const briefWatch = usableBriefItems(presented.guidance, presented.watch).slice(0, 4);
  const briefTakeaways = usableBriefItems(presented.reported, presented.guidance, presented.watch).slice(0, 3);
  const briefEvidenceItems = [
    ...presented.facts,
    ...presented.reported,
    ...presented.guidance,
    ...presented.watch,
    ...presented.deltas,
  ];
  const briefHeadline = presented.reported[0]?.detail
    || presented.reported[0]?.value
    || presented.guidance[0]?.detail
    || glance;
  const briefSummary = presented.reported[0]?.detail ? presented.reported[0]?.value : null;
  const chooseBriefItem = (item: CompanyIntelligenceBriefItem) => {
    const evidenceItem = briefEvidenceItems.find((candidate) => candidate.id === item.id);
    if (evidenceItem) chooseItem(evidenceItem);
  };

  const resultsMetrics = usableBriefItems(
    presented.facts.filter((item) => item.id !== "fact_questions_count"),
    presented.reported,
  ).slice(0, 4).map(toResultsItem);
  const resultsGuidance = usableBriefItems(presented.guidance).slice(0, 4).map(toResultsItem);
  const resultsCallReadthrough = qaReadthroughItems(result.workspace.qa_exchanges);
  const resultsComparisons: CompanyIntelligenceResultsComparison[] = [];
  const resultsNonAssertions: CompanyIntelligenceResultsItem[] = [
    {
      id: "boundary:consensus",
      label: pick(zh, "Consensus surprise", "共识超预期/不及预期"),
      value: presented.honest.consensus_unlicensed || presented.honest.no_beat_miss
        ? pick(zh, "Not asserted · No beat/miss · consensus unlicensed", "未断言 · 不显示超预期/不及预期 · 共识未授权")
        : pick(zh, "Not asserted · no governed comparison in this view", "未断言 · 本视图无受治理的比较"),
    },
    {
      id: "boundary:reaction",
      label: pick(zh, "Event-price reaction", "事件价格反应"),
      value: presented.honest.reaction_not_joined
        ? pick(zh, "Not asserted · reaction not joined", "未断言 · 市场反应未关联")
        : pick(zh, "Not asserted · no qualified event-price join in this view", "未断言 · 本视图无合格事件价格关联"),
    },
    {
      id: "boundary:authority",
      label: pick(zh, "Trade authority", "交易权限"),
      value: pick(zh, "Not asserted · context only", "未断言 · 仅供背景参考"),
    },
  ];
  const resultsEvidenceItems = [
    ...presented.facts,
    ...presented.reported,
    ...presented.guidance,
    ...presented.deltas,
  ];
  const chooseResultsItem = (item: CompanyIntelligenceResultsItem) => {
    const evidenceItem = resultsEvidenceItems.find((candidate) => candidate.id === item.id);
    if (evidenceItem) chooseItem(evidenceItem);
  };

  const callExchanges = qaCallExchanges(result.workspace.qa_exchanges);
  const openCallExchange = (exchange: CompanyIntelligenceCallExchange) => {
    if (!txId || exchange.segmentIndex == null) return;
    onOpenTx({
      id: txId,
      segment_index: exchange.segmentIndex,
      expected_document_sha256: txSha,
    });
  };

  const v2TranscriptSource = presented.sources.find((source) => source.kind === "transcript");
  const v2IssuerSource = presented.sources.find((source) => (
    source.kind === "issuer_release"
    || source.kind === "filing"
    || source.kind === "release"
    || source.kind === "edgar_collector"
  ));
  const v2SlidesSource = presented.sources.find((source) => source.kind === "presentation");
  const sourcesCoverage: CompanyIntelligenceCoverageItem[] = [
    {
      id: "structured-event",
      label: pick(zh, "Structured event", "结构化事件"),
      displayStatus: pick(zh, "Present", "可用"),
      detail: pick(
        zh,
        "SHA-verified event workspace with deterministic normalized fields.",
        "经 SHA 验证的事件工作区，包含确定性的标准化字段。",
      ),
      tone: "present",
    },
    {
      id: "transcript",
      label: pick(zh, "Transcript", "电话会记录"),
      displayStatus: sourceCoverageStatus(v2TranscriptSource, zh),
      detail: v2TranscriptSource
        ? pick(zh, "Normalized call source state as carried by the selected event.", "当前事件携带的标准化电话会来源状态。")
        : pick(zh, "No transcript source is carried by the selected event.", "当前事件未携带电话会来源。"),
      tone: sourceCoverageTone(v2TranscriptSource),
    },
    {
      id: "issuer",
      label: pick(zh, "Issuer disclosure", "发行人披露"),
      displayStatus: sourceCoverageStatus(v2IssuerSource, zh),
      detail: v2IssuerSource
        ? pick(zh, "Issuer filing or release material tracked by the event workspace.", "事件工作区追踪的发行人披露或发布材料。")
        : pick(zh, "No issuer disclosure source is carried by the selected event.", "当前事件未携带发行人披露来源。"),
      tone: sourceCoverageTone(v2IssuerSource),
    },
    {
      id: "slides",
      label: pick(zh, "Presentation / slides", "演示文稿"),
      displayStatus: presented.honest.slides_absent
        ? pick(zh, "Absent", "缺失")
        : sourceCoverageStatus(v2SlidesSource, zh),
      detail: presented.honest.slides_absent
        ? pick(zh, "Producer records an explicit absence for presentation material.", "生产者已明确记录演示材料缺失。")
        : pick(zh, "Presentation coverage is shown only when carried by the producer.", "仅在生产者携带时显示演示材料覆盖。"),
      tone: presented.honest.slides_absent ? "missing" : sourceCoverageTone(v2SlidesSource),
    },
    {
      id: "consensus",
      label: pick(zh, "Consensus", "共识"),
      displayStatus: presented.honest.consensus_unlicensed
        ? pick(zh, "Unlicensed", "未授权")
        : pick(zh, "Producer state only", "仅生产者状态"),
      detail: presented.honest.consensus_unlicensed
        ? pick(zh, "No licensed matched pre-event consensus is available for surprise claims.", "没有可用于超预期/不及预期主张的已授权匹配事件前共识。")
        : pick(zh, "No extra consensus interpretation is added by Terminal.", "Terminal 不会额外解释共识状态。"),
      tone: "boundary",
    },
    {
      id: "reaction",
      label: pick(zh, "Market reaction", "市场反应"),
      displayStatus: presented.honest.reaction_not_joined
        ? pick(zh, "Not joined", "未关联")
        : pick(zh, "Producer state only", "仅生产者状态"),
      detail: presented.honest.reaction_not_joined
        ? pick(zh, "No qualified event-price join is attached to the selected event.", "当前事件未关联合格的事件价格数据。")
        : pick(zh, "No extra reaction inference is added by Terminal.", "Terminal 不会额外推断市场反应。"),
      tone: "boundary",
    },
  ];
  const sourceIdentity: CompanyIntelligenceMethodItem[] = [
    {
      id: "generation",
      label: pick(zh, "Generation", "版本"),
      value: pick(zh, "Pinned immutable context", "固定不可变上下文"),
      detail: presented.generation_id.length > 12
        ? `${presented.generation_id.slice(0, 12)}…`
        : presented.generation_id,
      tone: "present",
    },
    {
      id: "as-known-at",
      label: pick(zh, "As known at", "截至"),
      value: result.workspace.generated_at.replace("T", " ").replace("Z", " UTC"),
      detail: pick(zh, "Producer generation time", "生产者生成时间"),
      tone: "present",
    },
    {
      id: "selected-event",
      label: pick(zh, "Selected event", "当前事件"),
      value: presented.period_label,
      detail: pick(zh, "Canonical event identity preserved", "保留规范事件身份"),
      tone: "present",
    },
  ];
  const sourceBoundaries: CompanyIntelligenceMethodItem[] = [
    {
      id: "source-span",
      label: pick(zh, "Exact source span", "精确来源片段"),
      value: pick(zh, "Per item", "按条目"),
      detail: pick(
        zh,
        "Byte-replayed receipts stay exact; address-only and typed absence states remain explicit.",
        "字节回放凭证保持精确；仅地址与类型化缺项状态保持显式。",
      ),
      tone: "partial",
    },
    {
      id: "consensus-surprise",
      label: pick(zh, "Consensus surprise", "共识超预期/不及预期"),
      value: presented.honest.consensus_unlicensed || presented.honest.no_beat_miss
        ? pick(zh, "Not asserted", "未断言")
        : pick(zh, "No added inference", "不添加推断"),
      detail: pick(zh, "Requires a licensed, basis-matched pre-event consensus.", "需要已授权且口径匹配的事件前共识。"),
      tone: "boundary",
    },
    {
      id: "market-reaction",
      label: pick(zh, "Market reaction", "市场反应"),
      value: presented.honest.reaction_not_joined
        ? pick(zh, "Not asserted", "未断言")
        : pick(zh, "No added inference", "不添加推断"),
      detail: pick(zh, "Requires a qualified event-price join.", "需要合格的事件价格关联。"),
      tone: "boundary",
    },
    {
      id: "trade-authority",
      label: pick(zh, "Trade authority", "交易权限"),
      value: pick(zh, "Context only", "仅供背景参考"),
      detail: pick(zh, "This research view does not rank, gate or size trades.", "此研究视图不对交易进行排名、门控或仓位配置。"),
      tone: "boundary",
    },
  ];

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

      <div className={`ci-workspace${evidenceOpen ? " evidence-open" : ""}`}>
        <main className="ci-canvas" id={`ci-panel-${lens}`} role="tabpanel" aria-labelledby={`ci-tab-${lens}`}>
          {lens === "brief" && (
            <CompanyIntelligenceBriefLayout
              zh={zh}
              ticker={ticker}
              periodLabel={presented.period_label}
              eventDate={presented.event_date}
              headline={briefHeadline}
              summary={briefSummary}
              metrics={briefMetrics.map(toBriefItem)}
              takeaways={briefTakeaways.map(toBriefItem)}
              changes={briefChanges.map(toBriefItem)}
              implications={[]}
              risks={briefRisks.map(toBriefItem)}
              watch={briefWatch.map(toBriefItem)}
              selectedId={evidence?.id}
              onSelect={chooseBriefItem}
              footer={(
                <div className="ci-paper-boundary">
                  <section className="ci-honest" aria-label={pick(zh, "Typed absences", "类型化缺项")}>
                    <div className="ci-section-label"><span>{pick(zh, "RESEARCH BOUNDARIES", "研究边界")}</span></div>
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
                      <p>{pick(zh, "Receipt-backed workspace objects. No v1 overlay is promoted into current-event authority.", "凭证支持的工作区对象。不会将 v1 覆盖层提升为当期事件权限。")}</p>
                    </div>
                    <CompanySourceManifest event={stubEvent} v2Sources={presented.sources} onOpenTranscript={(id) => onOpenTx({ id, expected_document_sha256: txSha })} compact />
                  </section>
                  <CompanyIntelligenceEventHistoryStrip
                    zh={zh}
                    items={historyStripItems}
                    contextOnly
                    onOpenHistory={() => selectLens("history")}
                  />
                </div>
              )}
            />
          )}

          {lens === "results" && (
            <section className="ci-lens-panel ci-results">
              <CompanyIntelligenceResultsLayout
                zh={zh}
                periodLabel={presented.period_label}
                eventDate={presented.event_date}
                metrics={resultsMetrics}
                guidance={resultsGuidance}
                callReadthrough={resultsCallReadthrough}
                comparisons={resultsComparisons}
                nonAssertions={resultsNonAssertions}
                selectedId={evidence?.id}
                onSelect={chooseResultsItem}
                onOpenCall={() => selectLens("transcript")}
                guidanceNote={pick(
                  zh,
                  "Producer-issued guidance only; no range is inferred from commentary.",
                  "仅显示生产者签发的结构化指引；不会从评论中推断区间。",
                )}
                callNote={pick(
                  zh,
                  "Verified Q&A structure; topic labels are not inferred.",
                  "问答结构已验证；不会推断主题标签。",
                )}
              />
              <div className="ci-paper-results-support">
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
              </div>
            </section>
          )}

          {lens === "transcript" && (
            <section className="ci-lens-panel ci-call">
              <CompanyIntelligenceCallLayout
                zh={zh}
                periodLabel={presented.period_label}
                eventDate={presented.event_date}
                transcriptId={txId}
                transcriptAvailable={Boolean(txId)}
                eventId={presented.event_id}
                eventAlias={eventAlias ?? presented.period_label}
                exchanges={callExchanges}
                onOpenExchange={openCallExchange}
                onOpenFullTranscript={txId ? openSameTranscript : undefined}
                onOpenSources={() => selectLens("sources")}
                searchContent={(
                  <TranscriptSearchWorkspace
                    ticker={ticker}
                    events={transcriptSearchEvents}
                    initialEventId={presented.event_id}
                    onOpenTranscript={(target) => onOpenTx(typeof target === "string"
                      ? { id: target, expected_document_sha256: txSha }
                      : { ...target, expected_document_sha256: target.expected_document_sha256 ?? txSha })}
                  />
                )}
              />
            </section>
          )}

          {lens === "history" && (
            <section className="ci-lens-panel">
              <CompanyIntelligenceHistoryLayout
                zh={zh}
                mode="current-plus-context"
                currentLabel={presented.period_label}
                currentDate={presented.event_date}
                currentFacts={historyCurrentFacts}
                events={historyContextEvents}
                onOpenBrief={() => selectLens("brief")}
              />
            </section>
          )}

          {lens === "topics" && (
            <section className="ci-lens-panel">
              <CompanyIntelligenceTopicMemoryLayout
                zh={zh}
                mode="historical-context"
                currentLabel={presented.period_label}
                currentDate={presented.event_date}
                topics={topicMemoryItems}
                onOpenHistory={() => selectLens("history")}
              />
            </section>
          )}

          {lens === "sources" && (
            <section className="ci-lens-panel ci-sources">
              <CompanyIntelligenceSourcesLayout
                zh={zh}
                periodLabel={presented.period_label}
                eventDate={presented.event_date}
                eventId={presented.event_id}
                generationId={presented.generation_id}
                coverage={sourcesCoverage}
                identity={sourceIdentity}
                boundaries={sourceBoundaries}
                sourceContent={(
                  <CompanySourceManifest
                    event={stubEvent}
                    v2Sources={presented.sources}
                    onOpenTranscript={(id) => onOpenTx({ id, expected_document_sha256: txSha })}
                  />
                )}
              />
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
