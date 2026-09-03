/**
 * Deterministic presentation adapter for event_workspace.v1.
 *
 * Formatting and prioritization only. No v1 summary, score_overlay, Qwen, or
 * model call. Beat/miss language is refused when basis_match is false.
 */

import {
  transcriptIdFromWorkspace,
  type EventWorkspace,
  type EventWorkspaceClaim,
  type EventWorkspaceCompletenessBlock,
  type EventWorkspaceFact,
  type EventWorkspaceGuidance,
  type EventWorkspaceReceiptState,
  type EventWorkspaceSource,
  type EventWorkspaceSourceSpan,
  type EventWorkspaceTypedAbsence,
} from "./eventWorkspace";

export interface EventWorkspaceEvidenceView {
  receipt_state: EventWorkspaceReceiptState | "status_only";
  excerpt: string | null;
  document_id: string | null;
  document_label: string;
  speaker: string | null;
  role: string | null;
  segment_index: number | null;
  span_start_byte: number | null;
  span_end_byte: number | null;
  text_sha256: string | null;
  source_sha256: string | null;
  source_clock: string | null;
  typed_absence: EventWorkspaceTypedAbsence | null;
  transcript_id: string | null;
  source_url: string | null;
  status_label: string | null;
}

export interface EventWorkspacePresentedItem {
  id: string;
  label: string;
  value: string;
  detail: string | null;
  evidence: EventWorkspaceEvidenceView;
}

export interface EventWorkspacePresented {
  event_id: string;
  generation_id: string;
  ticker: string;
  display_name: string;
  period_label: string;
  event_date: string;
  lifecycle_state: EventWorkspace["lifecycle"]["state"];
  canonical_event_id: string;
  plane: "event_workspace.v1";
  transcript_id: string | null;
  reported: EventWorkspacePresentedItem[];
  guidance: EventWorkspacePresentedItem[];
  watch: EventWorkspacePresentedItem[];
  facts: EventWorkspacePresentedItem[];
  deltas: EventWorkspacePresentedItem[];
  completeness: EventWorkspacePresentedItem[];
  sources: EventWorkspacePresentedSource[];
  honest: {
    questions_count_unavailable: boolean;
    consensus_unlicensed: boolean;
    slides_absent: boolean;
    reaction_not_joined: boolean;
    no_beat_miss: boolean;
  };
}

export interface EventWorkspacePresentedSource {
  kind: string;
  label: string;
  status: string;
  receipt_state: EventWorkspaceReceiptState;
  document_id: string | null;
  filing_key: EventWorkspaceSource["filing_key"];
  source_sha256: string | null;
  url: string | null;
  transcript_id: string | null;
  typed_absence: EventWorkspaceTypedAbsence | null;
}

function sourceLabel(kind: string, zh: boolean): string {
  if (kind === "issuer_release" || kind === "filing" || kind === "release") {
    return zh ? "8-K / Exhibit 99.1" : "8-K / Exhibit 99.1";
  }
  if (kind === "transcript") return zh ? "电话会记录" : "Earnings call transcript";
  if (kind === "public_wire") return zh ? "公开快讯" : "Public wire record";
  if (kind === "edgar_collector") return zh ? "EDGAR 采集行" : "EDGAR collector row";
  if (kind === "presentation") return zh ? "演示文稿" : "Slides";
  return kind.replaceAll("_", " ");
}

function documentLabel(documentId: string | null, zh: boolean): string {
  if (!documentId) return zh ? "来源文档" : "Source document";
  if (documentId.startsWith("tx:")) return zh ? "电话会记录" : "Call transcript";
  if (documentId.startsWith("disclosure_document_")) return zh ? "Exhibit 99.1" : "Exhibit 99.1";
  return documentId;
}

function formatUsdMillions(value: number): string {
  const billions = value / 1_000;
  if (Math.abs(billions) >= 1) {
    const digits = Number.isInteger(billions) ? 0 : 1;
    return `$${billions.toFixed(digits)}B`;
  }
  return `$${Math.round(value)}M`;
}

function formatPercentRange(low: number | null, high: number | null): string | null {
  if (low == null && high == null) return null;
  if (low != null && high != null && low !== high) return `${low}–${high}%`;
  const sole = low ?? high;
  return sole == null ? null : `${sole}%`;
}

function eventDate(workspace: EventWorkspace): string {
  const stamp = workspace.lifecycle.source_available_at || workspace.lifecycle.observed_at || workspace.generated_at;
  return stamp.slice(0, 10);
}

function formatEventDay(isoDate: string, zh: boolean): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const months = zh
    ? ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]
    : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(match[2]) - 1];
  return zh ? `${Number(match[3])} ${month}` : `${Number(match[3])} ${month}`;
}

function evidenceFromSpan(
  span: EventWorkspaceSourceSpan,
  workspace: EventWorkspace,
  sourceUrl: string | null,
): EventWorkspaceEvidenceView {
  return {
    receipt_state: span.receipt_state,
    excerpt: span.display_excerpt,
    document_id: span.document_id,
    document_label: documentLabel(span.document_id, false),
    speaker: span.locator.speaker ?? null,
    role: span.locator.role ?? null,
    segment_index: span.locator.segment_index ?? span.receipt?.segment_index ?? null,
    span_start_byte: span.locator.span_start_byte ?? span.receipt?.span_start_byte ?? null,
    span_end_byte: span.locator.span_end_byte ?? span.receipt?.span_end_byte ?? null,
    text_sha256: span.text_sha256 ?? span.receipt?.text_sha256 ?? null,
    source_sha256: span.receipt?.source_sha256 ?? null,
    source_clock: workspace.lifecycle.source_available_at,
    typed_absence: null,
    transcript_id: span.document_id?.startsWith("tx:") ? transcriptIdFromWorkspace(workspace) : null,
    source_url: sourceUrl,
    status_label: null,
  };
}

function evidenceFromAbsence(
  absence: EventWorkspaceTypedAbsence,
  workspace: EventWorkspace,
): EventWorkspaceEvidenceView {
  return {
    receipt_state: "typed_absence",
    excerpt: null,
    document_id: absence.document_id,
    document_label: documentLabel(absence.document_id, false),
    speaker: null,
    role: null,
    segment_index: null,
    span_start_byte: null,
    span_end_byte: null,
    text_sha256: null,
    source_sha256: null,
    source_clock: workspace.lifecycle.source_available_at,
    typed_absence: absence,
    transcript_id: absence.document_id?.startsWith("tx:") ? transcriptIdFromWorkspace(workspace) : null,
    source_url: null,
    status_label: null,
  };
}

function evidenceForFact(fact: EventWorkspaceFact, workspace: EventWorkspace): EventWorkspaceEvidenceView | null {
  if (fact.source_span) {
    const release = workspace.sources.find((source) => source.document_id === fact.source_span?.document_id);
    return evidenceFromSpan(fact.source_span, workspace, release?.url ?? null);
  }
  if (fact.typed_absence) return evidenceFromAbsence(fact.typed_absence, workspace);
  return null;
}

function evidenceForClaim(claim: EventWorkspaceClaim, workspace: EventWorkspace): EventWorkspaceEvidenceView | null {
  if (claim.source_span) return evidenceFromSpan(claim.source_span, workspace, null);
  if (claim.typed_absence) return evidenceFromAbsence(claim.typed_absence, workspace);
  return null;
}

function evidenceForGuidance(item: EventWorkspaceGuidance, workspace: EventWorkspace): EventWorkspaceEvidenceView | null {
  if (item.source_span) return evidenceFromSpan(item.source_span, workspace, null);
  if (item.typed_absence) return evidenceFromAbsence(item.typed_absence, workspace);
  return null;
}

function yoyFromRevenueClaim(claim: EventWorkspaceClaim | undefined): string | null {
  if (!claim) return null;
  const match = claim.text.match(/up\s+(\d+(?:\.\d+)?)\s*%/i) || claim.text.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? `+${match[1]}%` : null;
}

function guidanceHorizonLabel(horizon: string | null, workspace: EventWorkspace): string {
  if (!horizon) return "Guidance";
  const next = workspace.fiscal_period.quarter === 4 ? 1 : workspace.fiscal_period.quarter + 1;
  const qMatch = horizon.match(/Q([1-4])/i);
  if (qMatch && Number(qMatch[1]) === next) return `Q${next} revenue growth`;
  return horizon;
}

function isWatchClaim(claim: EventWorkspaceClaim): boolean {
  if (claim.kind === "quote") return true;
  const key = `${claim.claim_id} ${claim.metric ?? ""} ${claim.text}`.toLowerCase();
  return /memory|flood|fx|headwind|supply|constraint/.test(key);
}

function completenessItem(
  key: string,
  label: string,
  block: EventWorkspaceCompletenessBlock,
  workspace: EventWorkspace,
): EventWorkspacePresentedItem | null {
  const present = block.status === "present" || block.status === "bound";
  const source = workspace.sources.find((row) => (
    (block.document_id && row.document_id === block.document_id)
    || (key === "transcript" && row.kind === "transcript")
    || (key === "filing" && row.kind === "filing")
    || (key === "release" && (row.kind === "issuer_release" || row.kind === "release"))
    || (key === "slides" && (row.kind === "presentation" || row.kind === "slides"))
    || (key === "consensus" && row.kind === "consensus")
    || (key === "reaction" && (row.kind === "reaction" || row.kind === "market_reaction"))
  ));
  let evidence: EventWorkspaceEvidenceView;
  if (block.typed_absence) {
    evidence = evidenceFromAbsence(block.typed_absence, workspace);
  } else if (source && source.receipt_state !== "typed_absence") {
    evidence = {
      receipt_state: source.receipt_state,
      excerpt: null,
      document_id: source.document_id,
      document_label: documentLabel(source.document_id, false),
      speaker: null,
      role: null,
      segment_index: null,
      span_start_byte: null,
      span_end_byte: null,
      text_sha256: null,
      source_sha256: source.source_sha256,
      source_clock: workspace.lifecycle.source_available_at,
      typed_absence: null,
      transcript_id: key === "transcript" ? transcriptIdFromWorkspace(workspace) : null,
      source_url: source.url,
      status_label: source.receipt_state === "byte_replayed" ? null : sourceStatusLabel(source),
    };
  } else {
    evidence = {
      receipt_state: "status_only",
      excerpt: null,
      document_id: block.document_id ?? block.filing_key?.accession ?? null,
      document_label: documentLabel(block.document_id ?? null, false),
      speaker: null,
      role: null,
      segment_index: null,
      span_start_byte: null,
      span_end_byte: null,
      text_sha256: null,
      source_sha256: null,
      source_clock: workspace.lifecycle.source_available_at,
      typed_absence: null,
      transcript_id: key === "transcript" ? transcriptIdFromWorkspace(workspace) : null,
      source_url: null,
      status_label: block.status.replaceAll("_", " "),
    };
  }
  const value = present
    ? (key === "filing" && block.filing_key
      ? `${block.filing_key.accession}`
      : block.status.replaceAll("_", " "))
    : block.status.replaceAll("_", " ");
  return { id: `completeness:${key}`, label, value, detail: block.typed_absence?.detail ?? null, evidence };
}

function sourceStatusLabel(source: EventWorkspaceSource): string {
  if (source.receipt_state === "byte_replayed") return "Present";
  if (source.receipt_state === "address_only") return "Address only";
  if (source.join_status === "unjoinable") return "Unjoinable";
  return "Unavailable";
}

export function presentEventWorkspace(workspace: EventWorkspace, options: { zh?: boolean } = {}): EventWorkspacePresented {
  const zh = options.zh === true;
  const ticker = workspace.issuer.listings.find((row) => row.is_primary)?.ticker
    ?? workspace.issuer.listings[0]?.ticker
    ?? "";
  const date = eventDate(workspace);
  const transcriptId = transcriptIdFromWorkspace(workspace);
  const revenue = workspace.facts.find((fact) => fact.metric === "revenue" && fact.value != null);
  const revenueClaim = workspace.claims.find((claim) => claim.claim_id === "claim_revenue_lede" || claim.metric === "revenue");
  const questions = workspace.facts.find((fact) => fact.metric === "questions_count");
  const qaCount = workspace.qa_exchanges.length;
  const reported: EventWorkspacePresentedItem[] = [];
  if (revenue && revenue.value != null) {
    const growth = yoyFromRevenueClaim(revenueClaim);
    const evidence = evidenceForFact(revenue, workspace);
    if (evidence) {
      reported.push({
        id: revenue.fact_id,
        label: zh ? "营收" : "Revenue",
        value: growth ? `${formatUsdMillions(revenue.value)} · ${growth}` : formatUsdMillions(revenue.value),
        detail: revenueClaim?.text ?? null,
        evidence,
      });
    }
  }
  const guidance: EventWorkspacePresentedItem[] = [];
  workspace.guidance.forEach((item, index) => {
    const evidence = evidenceForGuidance(item, workspace);
    if (!evidence) return;
    const range = formatPercentRange(item.low, item.high);
    guidance.push({
      id: `guidance:${item.metric}:${index}`,
      label: guidanceHorizonLabel(item.horizon, workspace),
      value: range ?? (zh ? "无结构化指引" : "No structured range"),
      detail: item.source_span?.display_excerpt ?? item.horizon,
      evidence,
    });
  });
  const shown = new Set(reported.map((item) => item.id));
  if (revenueClaim) shown.add(revenueClaim.claim_id);
  const watch: EventWorkspacePresentedItem[] = [];
  for (const claim of workspace.claims) {
    if (shown.has(claim.claim_id) || !isWatchClaim(claim)) continue;
    const evidence = evidenceForClaim(claim, workspace);
    if (!evidence) continue;
    watch.push({
      id: claim.claim_id,
      label: claim.kind === "quote" ? (zh ? "关注" : "Watch") : claim.metric ?? (zh ? "关注" : "Watch"),
      value: claim.text,
      detail: claim.speaker,
      evidence,
    });
  }
  const facts: EventWorkspacePresentedItem[] = [];
  for (const fact of workspace.facts) {
    const evidence = evidenceForFact(fact, workspace);
    if (!evidence) continue;
    if (fact.metric === "questions_count") {
      if (qaCount > 0) continue;
      facts.push({
        id: fact.fact_id,
        label: zh ? "分析师提问" : "Analyst questions",
        value: zh ? "暂无结构化计数" : "Unavailable / unstructured",
        detail: fact.typed_absence?.detail ?? null,
        evidence,
      });
      continue;
    }
    const formatted = fact.metric === "revenue" && fact.value != null
      ? formatUsdMillions(fact.value)
      : fact.value == null ? (zh ? "暂无" : "Unavailable") : String(fact.value);
    facts.push({
      id: fact.fact_id,
      label: fact.metric.replaceAll("_", " "),
      value: formatted,
      detail: fact.basis,
      evidence,
    });
  }
  const deltas: EventWorkspacePresentedItem[] = [];
  for (const delta of workspace.deltas) {
    const current = delta.current && "value" in delta.current
      ? (delta.metric === "revenue" ? formatUsdMillions(delta.current.value) : String(delta.current.value))
      : (zh ? "当期已报告" : "Reported");
    const priorMissing = delta.prior && "schema" in delta.prior;
    const consensusMissing = delta.consensus && "schema" in delta.consensus;
    const evidence = consensusMissing && delta.consensus && "schema" in delta.consensus
      ? evidenceFromAbsence(delta.consensus, workspace)
      : priorMissing && delta.prior && "schema" in delta.prior
        ? evidenceFromAbsence(delta.prior, workspace)
        : (revenue ? evidenceForFact(revenue, workspace) : null);
    if (!evidence) continue;
    deltas.push({
      id: `delta:${delta.metric}`,
      label: delta.metric.replaceAll("_", " "),
      value: current,
      detail: [
        priorMissing ? (zh ? "上期未按同表绑定" : "Prior period is not bound") : null,
        consensusMissing || !delta.basis_match ? (zh ? "共识未授权 · 不显示超预期或不及预期" : "Consensus unlicensed · no beat/miss") : null,
      ].filter(Boolean).join(" · ") || null,
      evidence,
    });
  }
  const completeness: EventWorkspacePresentedItem[] = [
    completenessItem("filing", "8-K", workspace.completeness.filing, workspace),
    completenessItem("release", "Exhibit 99.1", workspace.completeness.release, workspace),
    completenessItem("transcript", zh ? "电话会" : "Transcript", workspace.completeness.transcript, workspace),
    completenessItem("slides", zh ? "演示文稿" : "Slides", workspace.completeness.slides, workspace),
    completenessItem("consensus", zh ? "共识" : "Consensus", workspace.completeness.consensus, workspace),
    completenessItem("reaction", zh ? "市场反应" : "Market reaction", workspace.completeness.reaction, workspace),
  ].filter((item): item is EventWorkspacePresentedItem => item != null);
  if (questions && qaCount === 0) {
    const evidence = evidenceForFact(questions, workspace);
    if (evidence) {
      completeness.push({
        id: questions.fact_id,
        label: zh ? "分析师提问" : "Analyst questions",
        value: zh ? "暂无结构化计数" : "Unavailable / unstructured",
        detail: questions.typed_absence?.detail ?? null,
        evidence,
      });
    }
  }
  const sources: EventWorkspacePresentedSource[] = workspace.sources.map((source) => ({
    kind: source.kind,
    label: sourceLabel(source.kind, zh),
    status: sourceStatusLabel(source),
    receipt_state: source.receipt_state,
    document_id: source.document_id,
    filing_key: source.filing_key,
    source_sha256: source.source_sha256,
    url: source.url,
    transcript_id: source.kind === "transcript" ? transcriptId : null,
    typed_absence: source.typed_absence,
  }));
  return {
    event_id: workspace.event_id,
    generation_id: workspace.generation_id,
    ticker,
    display_name: workspace.issuer.display_name,
    period_label: zh
      ? `Q${workspace.fiscal_period.quarter} FY${workspace.fiscal_period.year}`
      : `Q${workspace.fiscal_period.quarter} FY${workspace.fiscal_period.year}`,
    event_date: date,
    lifecycle_state: workspace.lifecycle.state,
    canonical_event_id: workspace.event_id,
    plane: "event_workspace.v1",
    transcript_id: transcriptId,
    reported,
    guidance,
    watch,
    facts,
    deltas,
    completeness,
    sources,
    honest: {
      questions_count_unavailable: qaCount > 0 ? false : (questions?.typed_absence != null || questions?.value == null),
      consensus_unlicensed: workspace.completeness.consensus.status === "unlicensed" || workspace.warnings.includes("consensus_unlicensed"),
      slides_absent: workspace.completeness.slides.status === "absent" || workspace.warnings.includes("slides_absent"),
      reaction_not_joined: workspace.completeness.reaction.status === "not_joined" || workspace.warnings.includes("reaction_not_joined"),
      no_beat_miss: workspace.deltas.every((delta) => delta.basis_match === false),
    },
  };
}

export function eventWorkspaceGlanceTitle(presented: EventWorkspacePresented, zh = false): string {
  const day = formatEventDay(presented.event_date, zh);
  return `${presented.ticker} · ${presented.period_label.replace("FY", zh ? "财年" : "FY")} · ${day}`;
}

export function eventWorkspaceHasBeatMissLanguage(text: string): boolean {
  return /\b(beat|miss|beats|misses|above consensus|below consensus)\b/i.test(text);
}
