"use client";

import { useEffect, useRef } from "react";
import { useLang } from "../../lib/i18n";
import { pick } from "../../lib/finFormat";
import type {
  CompanyIntelligenceEvent,
  CompanyIntelligenceSource,
} from "../../lib/companyIntelligence";
import type { EventWorkspaceEvidenceView } from "../../lib/eventWorkspacePresent";
import { typedAbsenceReasonLabel } from "../../lib/companyIntelligenceLabels";

export type CompanyEvidenceKind = "summary" | "highlight" | "quote" | "metric";

export interface CompanyEvidenceSelection {
  id: string;
  kind: CompanyEvidenceKind;
  label: string;
  text: string;
  /** A deterministic cross-event calculation, deliberately separate from the source receipt. */
  derived_comparison?: string | null;
  source: CompanyIntelligenceSource | null;
  v2?: EventWorkspaceEvidenceView;
}

export interface EvidenceRailProps {
  event: CompanyIntelligenceEvent;
  evidence: CompanyEvidenceSelection | null;
  open: boolean;
  overlay: boolean;
  onClose: () => void;
  onOpenTranscript: (id: string) => void;
  periodCode?: string;
}

function sourceLabel(kind: CompanyIntelligenceSource["kind"], zh: boolean): string {
  if (kind === "transcript") return pick(zh, "Call transcript", "电话会记录");
  if (kind === "score_overlay") return pick(zh, "Event analysis", "事件分析");
  return pick(zh, "Earnings history", "财报历史");
}

function sourceStatus(status: CompanyIntelligenceSource["status"] | undefined, zh: boolean): string {
  if (status === "present") return pick(zh, "Present", "可用");
  if (status === "metadata_only") return pick(zh, "Metadata only", "仅元数据");
  return pick(zh, "Missing", "缺失");
}

function transcriptId(source: CompanyIntelligenceSource | null): string | null {
  if (!source || source.kind !== "transcript" || !source.url) return null;
  const match = source.url.match(/\/(\d{4}Q[1-4])\.json\.gz(?:[?#].*)?$/);
  return match?.[1] ?? null;
}

function receiptValue(source: CompanyIntelligenceSource | null): string {
  if (!source?.receipt) return "";
  return source.receipt.source_hash || source.receipt.record_id || "";
}

export default function EvidenceRail({
  event,
  evidence,
  open,
  overlay,
  onClose,
  onOpenTranscript,
  periodCode,
}: EvidenceRailProps) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const closeRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const txId = evidence?.v2?.transcript_id ?? transcriptId(evidence?.source ?? null);
  const receipt = receiptValue(evidence?.source ?? null);
  const precision = evidence?.source?.citation_precision ?? "metadata";
  const v2 = evidence?.v2 ?? null;
  const period = periodCode ?? `${event.fiscal_year}Q${event.fiscal_quarter}`;

  useEffect(() => {
    if (!open || !overlay) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.key === "Tab" && railRef.current) {
        const focusable = [...railRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        )].filter((element) => !element.hasAttribute("hidden"));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose, open, overlay]);

  return (
    <>
      <button
        className={`ci-evidence-scrim${open ? " open" : ""}`}
        aria-label={pick(zh, "Close evidence inspector", "关闭证据检查器")}
        aria-hidden={!open}
        onClick={onClose}
        tabIndex={open ? 0 : -1}
      />
      <aside
        ref={railRef}
        className={`ci-evidence${open ? " open" : ""}`}
        role={overlay ? "dialog" : "complementary"}
        aria-modal={overlay && open ? true : undefined}
        aria-label={pick(zh, "Evidence inspector", "证据检查器")}
        aria-hidden={!open}
        // On tablet/mobile the closed inspector remains in the DOM to preserve
        // its transition. `inert` makes that off-canvas tree impossible to tab
        // into or expose to assistive technology until the explicit open action.
        inert={!open}
      >
        <div className="ci-evidence-head">
          <div>
            <div className="fin-eyebrow">{pick(zh, "EVIDENCE", "证据")}</div>
            <h3>{pick(zh, "Event receipt", "事件凭证")}</h3>
          </div>
          <button
            ref={closeRef}
            className="ci-icon-button ci-evidence-close"
            onClick={onClose}
            aria-label={pick(zh, "Close evidence inspector", "关闭证据检查器")}
          >
            ×
          </button>
        </div>

        {evidence ? (
          <div className="ci-evidence-body">
            <div className="ci-evidence-kicker">
              <span className="fin-tag" style={{ "--c": "var(--brand-2)" } as React.CSSProperties}>
                {pick(zh, evidence.label, evidence.label)}
              </span>
              <span className="ci-event-code num">{period}</span>
            </div>
            <blockquote>{v2?.excerpt || evidence.text}</blockquote>

            {v2 ? (
              <div className="ci-receipt-card" data-ci-receipt-state={v2.receipt_state}>
                <div className="ci-receipt-row">
                  <span>{pick(zh, "Receipt state", "凭证状态")}</span>
                  <b>{v2.receipt_state === "byte_replayed"
                    ? pick(zh, "Byte-replayed", "字节回放")
                    : v2.receipt_state === "address_only"
                      ? pick(zh, "Address only", "仅地址")
                      : pick(zh, "Typed absence", "类型化缺项")}</b>
                </div>
                <div className="ci-receipt-row">
                  <span>{pick(zh, "Source document", "来源文档")}</span>
                  <b>{v2.document_label}</b>
                </div>
                {v2.receipt_state === "byte_replayed" && (
                  <>
                    {v2.speaker && (
                      <div className="ci-receipt-row">
                        <span>{pick(zh, "Speaker", "发言人")}</span>
                        <b>{v2.speaker}{v2.role ? ` · ${v2.role}` : ""}</b>
                      </div>
                    )}
                    {v2.segment_index != null && (
                      <div className="ci-receipt-row">
                        <span>{pick(zh, "Segment / bytes", "段落 / 字节")}</span>
                        <b className="num">{v2.segment_index}{v2.span_start_byte != null && v2.span_end_byte != null ? ` · ${v2.span_start_byte}–${v2.span_end_byte}` : ""}</b>
                      </div>
                    )}
                    {v2.text_sha256 && (
                      <div className="ci-receipt-hash">
                        <span>{pick(zh, "Text receipt", "文本凭证")}</span>
                        <code title={v2.text_sha256}>{`${v2.text_sha256.slice(0, 12)}…${v2.text_sha256.slice(-8)}`}</code>
                      </div>
                    )}
                    {v2.source_sha256 && (
                      <div className="ci-receipt-hash">
                        <span>{pick(zh, "Source hash", "来源哈希")}</span>
                        <code title={v2.source_sha256}>{`${v2.source_sha256.slice(0, 12)}…${v2.source_sha256.slice(-8)}`}</code>
                      </div>
                    )}
                    {v2.source_clock && (
                      <div className="ci-receipt-row">
                        <span>{pick(zh, "Source clock", "来源时钟")}</span>
                        <time className="num" dateTime={v2.source_clock}>{v2.source_clock.slice(0, 10)}</time>
                      </div>
                    )}
                    <div className="ci-evidence-note" role="note">
                      <span aria-hidden>i</span>
                      <p>{pick(
                        zh,
                        "This is the producer-issued receipt carried inside a SHA-verified workspace. Terminal did not recompute the source span from document bytes.",
                        "这是随 SHA 已验证工作区携带的生产者凭证。终端并未根据文档字节重新计算该来源片段。",
                      )}</p>
                    </div>
                  </>
                )}
                {v2.receipt_state === "typed_absence" && v2.typed_absence && (
                  <>
                    <div className="ci-receipt-row">
                      <span>{pick(zh, "Reason", "原因")}</span>
                      <b>{typedAbsenceReasonLabel(v2.typed_absence.reason, zh)}</b>
                    </div>
                    <div className="ci-receipt-row">
                      <span>{pick(zh, "Detail", "说明")}</span>
                      <b>{v2.typed_absence.detail}</b>
                    </div>
                  </>
                )}
                {v2.receipt_state === "address_only" && (
                  <div className="ci-evidence-note" role="note">
                    <span aria-hidden>i</span>
                    <p>{pick(zh, "The document address is known but the bytes cannot be replayed.", "文档地址已知，但无法回放其字节。")}</p>
                  </div>
                )}
                {v2.receipt_state === "status_only" && (
                  <div className="ci-evidence-note" role="note">
                    <span aria-hidden>i</span>
                    <p>{pick(
                      zh,
                      `Producer completeness status: ${v2.status_label ?? "recorded"}. This is not a line citation.`,
                      `生产者完整性状态：${v2.status_label ?? "已记录"}。这不是逐行引用。`,
                    )}</p>
                  </div>
                )}
              </div>
            ) : (
              <>
            {evidence.derived_comparison && (
              <div className="ci-evidence-derived" role="note">
                <span>{pick(zh, "DERIVED COMPARISON", "派生比较")}</span>
                <p>{evidence.derived_comparison}</p>
              </div>
            )}

            <div className="ci-receipt-card">
              <div className="ci-receipt-row">
                <span>{pick(zh, "Source family", "来源类别")}</span>
                <b>{evidence.source ? sourceLabel(evidence.source.kind, zh) : pick(zh, "Event record", "事件记录")}</b>
              </div>
              <div className="ci-receipt-row">
                <span>{pick(zh, "Coverage", "覆盖")}</span>
                <b>{evidence.source ? sourceStatus(evidence.source.status, zh) : pick(zh, "Metadata", "元数据")}</b>
              </div>
              <div className="ci-receipt-row">
                <span>{pick(zh, "Source material", "来源材料")}</span>
                <b>{precision === "document" ? pick(zh, "Document available", "文档可用") : pick(zh, "Metadata record", "元数据记录")}</b>
              </div>
              {evidence.source?.receipt?.source_date && (
                <div className="ci-receipt-row">
                  <span>{pick(zh, "Source date", "来源日期")}</span>
                  <time className="num" dateTime={evidence.source.receipt.source_date}>{evidence.source.receipt.source_date.slice(0, 10)}</time>
                </div>
              )}
              {receipt && (
                <div className="ci-receipt-hash">
                  <span>{pick(zh, "Receipt ID", "凭证编号")}</span>
                  <code title={receipt}>{receipt.length > 24 ? `${receipt.slice(0, 12)}…${receipt.slice(-8)}` : receipt}</code>
                </div>
              )}
            </div>

            <div className="ci-evidence-note" role="note">
              <span aria-hidden>i</span>
              <p>
                {evidence.source
                  ? pick(
                      zh,
                      evidence.derived_comparison
                        ? "This receipt covers the reported current-event value. The derived comparison above is separate and is not attributed to this source alone. Exact paragraph or source-span pinning is still pending."
                        : "This normalized field is attributed to the source family above. Exact paragraph or source-span pinning is still pending, so this is not presented as a line-level citation.",
                      evidence.derived_comparison
                        ? "本凭证仅覆盖所报告的当期事件数值。上方派生比较独立呈现，不会仅归属于该来源。精确到段落或来源片段的定位仍待补充。"
                        : "该标准化字段已归属于上方来源类别。精确到段落或来源片段的定位仍待补充，因此不会呈现为逐行引用。",
                    )
                  : pick(
                      zh,
                      "This item is retained at the event-record level. Exact field origin and source-span attribution are pending.",
                      "本条信息保留在事件记录层级；精确字段来源及来源片段归因仍待补充。",
                    )}
              </p>
            </div>
              </>
            )}

            <div className="ci-evidence-actions">
              {txId && (
                <button className="btn btn-primary" onClick={() => onOpenTranscript(txId)}>
                  {pick(zh, "Open transcript", "打开电话会")}
                </button>
              )}
              {(v2?.source_url?.startsWith("https://") || evidence.source?.url?.startsWith("https://")) && (
                <a className="btn btn-ghost" href={v2?.source_url || evidence.source?.url || undefined} target="_blank" rel="noreferrer">
                  {pick(zh, "Open source", "打开来源")}
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="ci-evidence-empty">
            <div className="ci-evidence-orbit" aria-hidden><i /><i /><i /></div>
            <strong>{pick(zh, "Select a research claim", "选择研究观点")}</strong>
            <p>{pick(zh, "Its source state and receipt will appear here without obscuring the brief.", "来源状态与凭证将在此显示，同时保留事件简报上下文。")}</p>
          </div>
        )}
      </aside>
    </>
  );
}
