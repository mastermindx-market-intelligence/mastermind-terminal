"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LEX, useLang } from "../../lib/i18n";
import { fmtDate, pick } from "../../lib/finFormat";
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
import CompanyIntelligenceCallLayout, { type CompanyIntelligenceCallExchange } from "./CompanyIntelligenceCallLayout";
import EarningsRepricingEvidence from "./EarningsRepricingEvidence";
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
import { EVENT_WORKSPACE_ATTRIBUTION } from "../../lib/companyIntelligenceLabels";
import CompanyTopicTimeline from "./CompanyTopicTimeline";
import { sharedShellTerminalHref } from "@/lib/sharedShellNavigation";

type Lens = "brief" | "results" | "transcript" | "history" | "topics" | "sources";

const LENSES: readonly Lens[] = ["brief", "results", "transcript", "history", "topics", "sources"];

export interface CompanyIntelligenceV2CurrentProps {
  ticker: string;
  name?: string | null;
  result: Pick<Extract<EventWorkspaceResult, { ok: true }>, "workspace" | "state">;
  retained?: boolean;
  headerActions?: ReactNode;
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
  retained = false,
  headerActions,
  onOpenTx,
  onEvidenceOpenChange,
}: CompanyIntelligenceV2CurrentProps) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const listing = result.workspace.issuer.listings.find(candidate => candidate.ticker === ticker);
  const presented = useMemo(
    () => presentEventWorkspace(result.workspace, { zh }),
    [result.workspace, zh],
  );
  const [lens, setLens] = useState<Lens>("brief");
  const [evidence, setEvidence] = useState<CompanyEvidenceSelection | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [selectionUnavailable, setSelectionUnavailable] = useState(false);
  const evidenceOverlay = true;
  const evidenceTriggerRef = useRef<HTMLElement | null>(null);
  const receiptsButtonRef = useRef<HTMLButtonElement>(null);

  const writeInvestigationSelection = useCallback((field: string, value: string | null) => {
    if (!retained) return;
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(field, value); else url.searchParams.delete(field);
    window.history.replaceState(window.history.state, "", url.toString());
    window.dispatchEvent(new Event("mmx:shell-location"));
  }, [retained]);

  const selectLens = useCallback((next: Lens) => {
    // Keep the outer research shell stable. The active lens swaps in place and
    // must not scroll .fin-body (or any ancestor) as a side effect.
    setLens(next);
    writeInvestigationSelection("ci_lens", next);
  }, [writeInvestigationSelection]);

  useEffect(() => {
    if (retained) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preserve the ordinary owner reset when a verified generation changes.
    setLens("brief");
    setEvidence(null);
  }, [ticker, result.workspace.generation_id, retained]);

  useEffect(() => {
    if (!retained) return;
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const selectedLens = params.get("ci_lens");
      setLens(retained && LENSES.includes(selectedLens as Lens) ? selectedLens as Lens : "brief");
      const id = retained ? params.get("ci_evidence") : null;
      const candidates = [...presented.reported, ...presented.guidance, ...presented.watch, ...presented.facts, ...presented.deltas, ...presented.completeness];
      const selected = id ? candidates.find(item => item.id === id) : null;
      // A URL carries an identifier, never source prose or a source URL. Resolve
      // evidence only against this freshly authorized immutable workspace.
      setEvidence(selected ? selectionFromItem(selected) : null);
      setEvidenceOpen(!!selected);
      setSelectionUnavailable(!!id && !selected);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [ticker, result.workspace.generation_id, presented, retained]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- translated evidence must belong to the current locale.
    if (!retained) setEvidence(null);
  }, [zh, retained]);

  useEffect(() => {
    onEvidenceOpenChange?.(evidenceOpen && evidenceOverlay);
    return () => onEvidenceOpenChange?.(false);
  }, [evidenceOpen, evidenceOverlay, onEvidenceOpenChange]);

  useEffect(() => {
    if (evidence) return;
    const first = presented.reported[0];
    if (!first) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initialize the inspector from the newly verified workspace.
    setEvidence(selectionFromItem(first));
  }, [evidence, presented]);

  const chooseEvidence = useCallback((selection: CompanyEvidenceSelection) => {
    evidenceTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEvidence(selection);
    setSelectionUnavailable(false);
    setEvidenceOpen(true);
    writeInvestigationSelection("ci_evidence", selection.id);
  }, [writeInvestigationSelection]);

  const chooseItem = useCallback((item: EventWorkspacePresentedItem) => {
    chooseEvidence(selectionFromItem(item));
  }, [chooseEvidence]);

  const closeEvidence = useCallback(() => {
    setEvidenceOpen(false);
    writeInvestigationSelection("ci_evidence", null);
    const trigger = evidenceTriggerRef.current ?? receiptsButtonRef.current;
    evidenceTriggerRef.current = null;
    window.requestAnimationFrame(() => trigger?.focus());
  }, [writeInvestigationSelection]);

  const askBrain = useCallback(() => {
    if (openMastermindBrainForSymbol(ticker)) return;
    window.location.assign(retained
      ? sharedShellTerminalHref(window.location.href, ticker, true)
      : `/terminal?symbol=${encodeURIComponent(ticker)}&ai=1`);
  }, [ticker, retained]);

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
  const freshness = result.state === "stale" ? "stale" : retained ? "retained" : "live";
  const eventAlias = tickerPeriodAliasFromWorkspace(result.workspace, ticker);
  const briefMetrics = usableBriefItems(presented.facts, presented.reported).slice(0, 4);
  const briefChanges = usableBriefItems(presented.deltas).slice(0, 3);
  const briefRisks = usableBriefItems(presented.watch).slice(0, 3);
  const briefWatch = usableBriefItems(presented.guidance).slice(0, 4);
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
  // The four headline metrics must not hide their native denominator convention.
  const resultsMetricContext = presented.facts
    .filter((item) => item.id === "fact_cancellation_rate_denominator" && item.evidence.receipt_state !== "typed_absence")
    .map((item) => ({ ...toResultsItem(item), label: pick(zh, "Cancellation rate denominator", "取消率分母") }));
  const resultsGuidance = usableBriefItems(presented.guidance).slice(0, 4).map(toResultsItem);
  const resultsCallReadthrough = qaReadthroughItems(result.workspace.qa_exchanges);
  const resultsComparisons: CompanyIntelligenceResultsComparison[] = [];
  const resultsNonAssertions: CompanyIntelligenceResultsItem[] = [
    {
      id: "boundary:consensus",
      label: pick(zh, "Consensus surprise", "共识超预期/不及预期"),
      value: presented.honest.consensus_unlicensed
        ? pick(zh, "Unavailable · pre-event estimates are unlicensed", "不可用 · 事件前预期数据未授权")
        : pick(zh, "No verified beat / miss comparison", "没有经过验证的超预期或不及预期比较"),
    },
    {
      id: "boundary:reaction",
      label: pick(zh, "Event-price reaction", "事件价格反应"),
      value: presented.honest.reaction_not_joined
        ? pick(zh, "Unavailable · event and price data are not linked", "不可用 · 事件与价格数据尚未关联")
        : pick(zh, "No verified market-reaction comparison", "没有经过验证的市场反应比较"),
    },
    {
      id: "boundary:authority",
      label: pick(zh, "Use", "用途"),
      value: pick(zh, "Research context · no trade ranking or position sizing", "研究背景 · 不提供交易排名或仓位建议"),
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
      label: pick(zh, "Event record", "事件记录"),
      displayStatus: pick(zh, "Present", "可用"),
      detail: pick(
        zh,
        "The event record passed its integrity check. Each claim retains its own source status.",
        "事件记录已通过完整性检查；每条主张保留独立的来源状态。",
      ),
      tone: "present",
    },
    {
      id: "transcript",
      label: pick(zh, "Transcript", "电话会记录"),
      displayStatus: sourceCoverageStatus(v2TranscriptSource, zh),
      detail: v2TranscriptSource
        ? pick(zh, "Availability of the call transcript linked to this event.", "此事件关联的电话会正文可用情况。")
        : pick(zh, "No transcript source is linked to this event.", "此事件未关联电话会来源。"),
      tone: sourceCoverageTone(v2TranscriptSource),
    },
    {
      id: "issuer",
      label: pick(zh, "Issuer disclosure", "发行人披露"),
      displayStatus: sourceCoverageStatus(v2IssuerSource, zh),
      detail: v2IssuerSource
        ? pick(zh, "Company filings or releases linked to this event.", "此事件关联的公司披露或公告。")
        : pick(zh, "No company filing or release is linked to this event.", "此事件未关联公司披露或公告。"),
      tone: sourceCoverageTone(v2IssuerSource),
    },
    {
      id: "slides",
      label: pick(zh, "Presentation / slides", "演示文稿"),
      displayStatus: presented.honest.slides_absent
        ? pick(zh, "Absent", "缺失")
        : sourceCoverageStatus(v2SlidesSource, zh),
      detail: presented.honest.slides_absent
        ? pick(zh, "Presentation material is recorded as missing from this event.", "此事件记录中明确缺少演示材料。")
        : pick(zh, "Availability follows the material linked to this event.", "可用情况以此事件关联的材料为准。"),
      tone: presented.honest.slides_absent ? "missing" : sourceCoverageTone(v2SlidesSource),
    },
    {
      id: "consensus",
      label: pick(zh, "Consensus", "共识"),
      displayStatus: presented.honest.consensus_unlicensed
        ? pick(zh, "Unlicensed", "未授权")
        : pick(zh, "No comparison shown", "未显示比较"),
      detail: presented.honest.consensus_unlicensed
        ? pick(zh, "No licensed pre-event estimates with a matching reporting basis are available for comparison.", "没有已授权且报告口径匹配的事件前预期数据可供比较。")
        : pick(zh, "This view does not add a beat or miss assessment.", "此视图不另行评估超预期或不及预期。"),
      tone: "boundary",
    },
    {
      id: "reaction",
      label: pick(zh, "Market reaction", "市场反应"),
      displayStatus: presented.honest.reaction_not_joined
        ? pick(zh, "Not linked", "未关联")
        : pick(zh, "No comparison shown", "未显示比较"),
      detail: presented.honest.reaction_not_joined
        ? pick(zh, "The event has no verified price comparison for measuring the market reaction.", "此事件没有经过验证的价格对照，无法衡量市场反应。")
        : pick(zh, "This view does not add a market-reaction assessment.", "此视图不另行评估市场反应。"),
      tone: "boundary",
    },
  ];
  const sourceIdentity: CompanyIntelligenceMethodItem[] = [
    {
      id: "generation",
      label: pick(zh, "Generation", "版本"),
      value: pick(zh, "Fixed research version", "固定研究版本"),
      detail: presented.generation_id.length > 12
        ? `${presented.generation_id.slice(0, 12)}…`
        : presented.generation_id,
      tone: "present",
    },
    {
      id: "as-known-at",
      label: pick(zh, "As known at", "截至"),
      value: result.workspace.generated_at.replace("T", " ").replace("Z", " UTC"),
      detail: pick(zh, "When this research version was produced", "此研究版本的生成时间"),
      tone: "present",
    },
    {
      id: "selected-event",
      label: pick(zh, "Selected event", "当前事件"),
      value: presented.period_label,
      detail: presented.event_id,
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
        "Each item distinguishes a verified passage, a source address without verified text, or missing evidence.",
        "每条记录区分已验证原文、只有地址而未验证正文的来源，以及缺失证据。",
      ),
      tone: "partial",
    },
    {
      id: "consensus-surprise",
      label: pick(zh, "Consensus surprise", "共识超预期/不及预期"),
      value: presented.honest.consensus_unlicensed || presented.honest.no_beat_miss
        ? pick(zh, "Not assessed", "未评估")
        : pick(zh, "No added interpretation", "不添加解释"),
      detail: pick(zh, "Requires licensed pre-event estimates with a matching reporting basis.", "需要已授权且报告口径匹配的事件前预期数据。"),
      tone: "boundary",
    },
    {
      id: "market-reaction",
      label: pick(zh, "Market reaction", "市场反应"),
      value: presented.honest.reaction_not_joined
        ? pick(zh, "Not assessed", "未评估")
        : pick(zh, "No added interpretation", "不添加解释"),
      detail: pick(zh, "Requires a verified link between the event and the relevant price data.", "需要验证事件与相应价格数据之间的关联。"),
      tone: "boundary",
    },
    {
      id: "trade-authority",
      label: pick(zh, "Use", "用途"),
      value: pick(zh, "Context only", "仅供背景参考"),
      detail: pick(zh, "This research does not rank trades, authorize execution or determine position size.", "此研究不对交易排名、不授权执行，也不决定仓位大小。"),
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
            <h2>{displayName}</h2>
          </div>
          <div className="ci-hero-actions">
            {headerActions}
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
            <details className="ci-source-details" onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
            }} onKeyDown={event => {
              if (event.key === "Escape") {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
                event.stopPropagation();
              }
            }}>
              <summary>
                <span className={`ci-source-dot${freshness === "stale" ? " partial" : ""}`} aria-hidden="true" />
                {lifecycleLabel}<span aria-hidden="true">⌄</span>
              </summary>
              <div className="ci-source-popover">
                <h3>{pick(zh, "Sources & freshness", "来源与时效")}</h3>
                <p className="ci-listing-context" data-ci-listing-context="">
                <span>{ticker}</span>{" · "}
                <span>{listing?.mic || pick(zh, "Venue unavailable", "交易场所不可用")}</span>{" · "}
                <span>{listing?.trading_currency || pick(zh, "Trading currency unavailable", "交易币种不可用")}</span>
              </p>
                <p data-ci-glance-title="">{glance}</p>
                <div className="ci-provenance-bar">
          <span>
            <i className={`ci-live-dot${freshness === "stale" ? " stale" : ""}`} />
            {freshness === "stale"
              ? pick(zh, "Last verified", "最近验证")
              : pick(zh, "As known at", "截至")}
            {" "}
            <time className="num" dateTime={presented.event_date}>{fmtDate(presented.event_date)}</time>
          </span>
          {retained && <span>{pick(zh, "Retained event", "已保留事件版本")}</span>}
          <span>{pick(zh, "Authority", "权限")} <b>{pick(zh, "Context only", "仅供背景参考")}</b></span>
          <span>{pick(zh, EVENT_WORKSPACE_ATTRIBUTION.en, EVENT_WORKSPACE_ATTRIBUTION.zh)}</span>
        </div>
        {freshness === "stale" && (
          <p className="ci-stale-banner" role="status" data-ci-stale-banner="">
            {pick(zh, "Last verified · upstream temporarily unavailable", "最近验证 · 上游暂时不可用")}
          </p>
        )}
              </div>
            </details>
            <button
              ref={receiptsButtonRef}
              className="btn btn-ghost ci-receipts-button"
              onClick={(click) => {
                evidenceTriggerRef.current = click.currentTarget;
                setEvidenceOpen(true);
              }}
            >
              {pick(zh, "Sources", "来源")}
            </button>
            <button className="btn btn-primary" onClick={askBrain}>{pick(zh, "Ask Mastermind", "询问 Mastermind")}</button>
          </div>
        </div>

      </header>

      {selectionUnavailable && <p className="ci-inline-empty" role="status">{pick(zh, "The selected evidence is unavailable in this event version. Choose a reported metric or claim to inspect its actual source.", "所选证据不在此事件版本中。请选择报告指标或主张，查看实际来源。")}</p>}
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
        <section className="ci-canvas" id={`ci-panel-${lens}`} role="tabpanel" aria-labelledby={`ci-tab-${lens}`}>
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
              risksHeading={pick(zh, "Commentary & context", "发言与背景")}
              risksDescription={pick(zh, "Remarks and context from the selected event", "所选事件中的发言与背景信息")}
              watchHeading={pick(zh, "Company guidance", "公司指引")}
              watchDescription={pick(zh, "Reported outlook for future periods", "已报告的未来期间展望")}
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
                      <strong>{pick(zh, retained ? "Selected event sources" : "Current sources", retained ? "所选事件来源" : "当期来源")}</strong>
                      <p>{pick(zh, "Sources belong to the selected event. Published research history does not verify its claims.", "来源属于当前事件；已发布研究历史不能验证当前事件的主张。")}</p>
                    </div>
                    <CompanySourceManifest event={stubEvent} v2Sources={presented.sources} onOpenTranscript={(id) => onOpenTx({ id, expected_document_sha256: txSha })} compact />
                  </section>
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
                metricContext={resultsMetricContext}
                guidance={resultsGuidance}
                callReadthrough={resultsCallReadthrough}
                comparisons={resultsComparisons}
                nonAssertions={resultsNonAssertions}
                selectedId={evidence?.id}
                onSelect={chooseResultsItem}
                onOpenCall={() => selectLens("transcript")}
                guidanceNote={resultsGuidance.length
                  ? pick(zh, "Reported guidance with supporting sources.", "附有来源支持的已报告指引。")
                  : pick(zh, "Verified guidance is not available for this event.", "此事件暂无已验证的业绩指引。")}
                callNote={resultsCallReadthrough.length
                  ? pick(zh, "Questions linked to their transcript passages.", "问题关联至对应的电话会原文。")
                  : pick(zh, "Structured Q&A is not available. Open the call to check the available transcript.", "暂无结构化问答。打开电话会以查看可用正文。")}
              />
              <EarningsRepricingEvidence presented={presented} zh={zh} onChooseEvidence={chooseItem} />
              <div className="ci-paper-results-support">
                <AnalystQaBlock
                  exchanges={result.workspace.qa_exchanges}
                  txId={txId}
                  txSha={txSha}
                  zh={zh}
                  onOpen={onOpenTx}
                />
                <GlanceRow
                  kicker={pick(zh, "MISSING INFORMATION", "缺失信息")}
                  region="typed-absences"
                  items={presented.completeness.filter((item) => item.evidence.receipt_state === "typed_absence")}
                  selectedId={evidence?.id}
                  onChoose={chooseItem}
                />
                <GlanceRow
                  kicker={pick(zh, "SOURCE COVERAGE", "来源覆盖")}
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
              <div className="ci-lens-heading">
                <div>
                  <span className="fin-eyebrow">{pick(zh, "RESEARCH HISTORY", "研究历史")}</span>
                  <h3>{pick(zh, "Does not control the selected event", "不控制所选事件")}</h3>
                </div>
                <span>{historicalEvents.length} {pick(zh, "rows", "行")}</span>
              </div>
              <p className="ci-v1-note">{pick(zh, "Historical research is shown for context. It is not used to verify the selected event or calculate its changes.", "历史研究仅供背景参考，不用于验证当前事件或计算其变化。")}</p>
              {historicalEvents.length ? (
                <div className="ci-history-wrap">
                  <table className="fin-table ci-history-table ci-history-readonly">
                    <thead>
                      <tr>
                        <th>{pick(zh, "Period", "期间")}</th>
                        <th>{pick(zh, "Date", "日期")}</th>
                        <th>{pick(zh, "Event", "事件")}</th>
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
                <p className="ci-inline-empty">{pick(zh, "No historical research records are linked to this company.", "此公司未关联历史研究记录。")}</p>
              )}
            </section>
          )}

          {lens === "topics" && (
            <section className="ci-lens-panel">
              <div className="ci-lens-heading">
                <div>
                  <span className="fin-eyebrow">{pick(zh, "TOPIC HISTORY", "主题历史")}</span>
                  <h3>{pick(zh, "Not evidence for this event", "不是此事件的证据")}</h3>
                </div>
                <span>{v1?.topics.timeline.length ?? 0} {pick(zh, "tracked", "个追踪主题")}</span>
              </div>
              <p className="ci-v1-note">{pick(zh, "Topics describe the published research history, not verified findings from this selected event.", "主题描述已发布的研究历史，并非当前事件的已验证结论。")}</p>
              <CompanyTopicTimeline topics={v1?.topics.timeline ?? []} zh={zh} />
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
        </section>

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
