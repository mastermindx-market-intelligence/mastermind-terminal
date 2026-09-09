"use client";

import { useLang } from "../../lib/i18n";
import { pick } from "../../lib/finFormat";
import { sourceKindLabel, sourceStatusLabel } from "../../lib/plainLabels";
import type {
  CompanyIntelligenceEvent,
  CompanyIntelligenceSource,
} from "../../lib/companyIntelligence";
import type { EventWorkspacePresentedSource } from "../../lib/eventWorkspacePresent";

export interface CompanySourceManifestProps {
  event: CompanyIntelligenceEvent;
  onOpenTranscript: (id: string) => void;
  compact?: boolean;
  v2Sources?: EventWorkspacePresentedSource[];
}

function note(source: CompanyIntelligenceSource, zh: boolean): string {
  if (source.status === "present" && source.kind === "transcript") {
    return pick(zh, "Normalized call body available", "标准化电话会正文可用");
  }
  if (source.status === "present") return pick(zh, "Source-backed event record", "具备来源支持的事件记录");
  if (source.status === "metadata_only") return pick(zh, "The record is kept, but the original file is not linked", "记录已保留，尚未关联原始文件");
  return pick(zh, "Not available for this event", "本事件暂无此来源");
}

function txId(url: string | null): string | null {
  const match = url?.match(/\/(\d{4}Q[1-4])\.json\.gz(?:[?#].*)?$/);
  return match?.[1] ?? null;
}

function v2Color(state: EventWorkspacePresentedSource["receipt_state"]): string {
  if (state === "byte_replayed") return "var(--rcpt-exact)";
  if (state === "address_only") return "var(--rcpt-superseded)";
  return "var(--rcpt-absent)";
}

function v2Note(source: EventWorkspacePresentedSource, zh: boolean): string {
  if (source.typed_absence) return source.typed_absence.detail;
  if (source.filing_key) return `${source.filing_key.cik} · ${source.filing_key.accession}`;
  if (source.receipt_state === "address_only") {
    return pick(zh, "The document address is known but the bytes cannot be replayed.", "文档地址已知，但无法回放其字节。");
  }
  return source.document_id ?? sourceStatusLabel(source.status, zh ? "zh" : "en");
}

function v2Glyph(kind: string): string {
  if (kind === "transcript") return "T";
  if (kind === "issuer_release" || kind === "filing" || kind === "release") return "8";
  if (kind === "public_wire") return "W";
  if (kind === "presentation") return "S";
  return "·";
}

export default function CompanySourceManifest({ event, onOpenTranscript, compact = false, v2Sources }: CompanySourceManifestProps) {
  const { lang } = useLang();
  const zh = lang === "zh";

  return (
    <ul className={`ci-source-list${compact ? " compact" : ""}`} aria-label={pick(zh, "Event sources", "事件来源")}>
      {v2Sources ? v2Sources.map((source, index) => {
        const color = v2Color(source.receipt_state);
        const id = source.transcript_id;
        return (
          <li key={`${source.kind}:${source.document_id ?? index}`} data-ci-source-kind={source.kind} data-ci-receipt-state={source.receipt_state} data-plain-kind={sourceKindLabel(source.kind, zh ? "zh" : "en")}>
            <span className="ci-source-icon" style={{ "--ci-source": color } as React.CSSProperties} aria-hidden>
              {v2Glyph(source.kind)}
            </span>
            <span className="ci-source-copy">
              <strong>{source.label}</strong>
              <small>{v2Note(source, zh)}</small>
            </span>
            <span className="ci-source-state">
              <span className="fin-tag" style={{ "--c": color } as React.CSSProperties}>{sourceStatusLabel(source.status, zh ? "zh" : "en")}</span>
              {!compact && id && <button onClick={() => onOpenTranscript(id)}>{pick(zh, "Read", "阅读")} ›</button>}
              {!compact && source.url?.startsWith("https://") && (
                <a href={source.url} target="_blank" rel="noreferrer">{pick(zh, "Open", "打开")} ↗</a>
              )}
            </span>
          </li>
        );
      }) : event.sources.map((source, index) => {
        const id = txId(source.url);
        const color = source.status === "present" ? "var(--up)" : source.status === "metadata_only" ? "var(--warn)" : "var(--muted)";
        return (
          <li key={`${source.kind}:${index}`} data-plain-kind={sourceKindLabel(source.kind, zh ? "zh" : "en")}>
            <span className="ci-source-icon" style={{ "--ci-source": color } as React.CSSProperties} aria-hidden>
              {source.kind === "transcript" ? "T" : source.kind === "score_overlay" ? "◇" : "H"}
            </span>
            <span className="ci-source-copy">
              <strong>{sourceKindLabel(source.kind, zh ? "zh" : "en")}</strong>
              <small>{note(source, zh)}</small>
            </span>
            <span className="ci-source-state">
              <span className="fin-tag" style={{ "--c": color } as React.CSSProperties}>{sourceStatusLabel(source.status, zh ? "zh" : "en")}</span>
              {!compact && id && <button onClick={() => onOpenTranscript(id)}>{pick(zh, "Read", "阅读")} ›</button>}
              {!compact && source.url?.startsWith("https://") && (
                <a href={source.url} target="_blank" rel="noreferrer">{pick(zh, "Open", "打开")} ↗</a>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
