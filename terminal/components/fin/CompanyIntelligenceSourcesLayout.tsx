"use client";

import "../../app/company-intelligence-sources.css";

import type { ReactNode } from "react";
import { pick } from "../../lib/finFormat";

export type CompanyIntelligenceSourceTone =
  | "present"
  | "partial"
  | "metadata"
  | "missing"
  | "boundary";

export interface CompanyIntelligenceCoverageItem {
  id: string;
  label: string;
  displayStatus: string;
  detail: string;
  tone: CompanyIntelligenceSourceTone;
}

export interface CompanyIntelligenceMethodItem {
  id: string;
  label: string;
  value: string;
  detail?: string | null;
  tone?: CompanyIntelligenceSourceTone;
}

interface CompanyIntelligenceSourcesLayoutProps {
  zh: boolean;
  periodLabel: string;
  eventDate: string;
  eventId?: string | null;
  generationId?: string | null;
  coverage: CompanyIntelligenceCoverageItem[];
  sourceContent: ReactNode;
  identity: CompanyIntelligenceMethodItem[];
  boundaries: CompanyIntelligenceMethodItem[];
  fallbackNote?: string | null;
}

function MethodList({ items }: { items: CompanyIntelligenceMethodItem[] }) {
  return (
    <dl className="ci-paper-sources-method-list">
      {items.map((item) => (
        <div key={item.id} data-tone={item.tone ?? "boundary"}>
          <dt>{item.label}</dt>
          <dd>
            <strong>{item.value}</strong>
            {item.detail ? <small>{item.detail}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function CompanyIntelligenceSourcesLayout({
  zh,
  periodLabel,
  eventDate,
  eventId,
  generationId,
  coverage,
  sourceContent,
  identity,
  boundaries,
  fallbackNote,
}: CompanyIntelligenceSourcesLayoutProps) {
  return (
    <section
      className="ci-paper-sources"
      data-ci-paper-sources=""
      data-ci-sources-event-id={eventId || ""}
      data-ci-sources-generation-id={generationId || ""}
    >
      <header className="ci-paper-sources-head">
        <div>
          <span>{pick(zh, "SOURCES", "来源")}</span>
          <h3>{pick(
            zh,
            "Evidence & coverage",
            "证据与覆盖范围",
          )}</h3>
        </div>
        <div className="ci-paper-sources-period">
          <strong>{periodLabel}</strong>
          <time dateTime={eventDate}>{eventDate}</time>
        </div>
      </header>

      <section className="ci-paper-sources-coverage" aria-label={pick(zh, "Source coverage", "来源覆盖")}>
        <header>
          <span>{pick(zh, "AVAILABLE MATERIAL", "可用材料")}</span>
          <small>{pick(zh, `Selected event · ${periodLabel}`, `当前事件 · ${periodLabel}`)}</small>
        </header>
        <div className="ci-paper-sources-coverage-grid">
          {coverage.map((item) => (
            <article key={item.id} data-tone={item.tone}>
              <div>
                <i aria-hidden />
                <strong>{item.label}</strong>
              </div>
              <b>{item.displayStatus}</b>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
        {fallbackNote ? <p className="ci-paper-sources-fallback">{fallbackNote}</p> : null}
      </section>

      <section className="ci-paper-sources-receipts">
        <header>
          <div>
            <span>{pick(zh, "DOCUMENTS & RECORDS", "文档与记录")}</span>
            <p>{pick(
              zh,
              "Open the available material and inspect its source status.",
              "打开可用材料，查看其来源状态。",
            )}</p>
          </div>
        </header>
        <div className="ci-paper-sources-manifest">{sourceContent}</div>
      </section>

      <section className="ci-paper-sources-method">
        <div>
          <header>
            <span>{pick(zh, "RESEARCH VERSION", "研究版本")}</span>
            <p>{pick(zh, "The event and version behind this view", "此视图对应的事件与版本")}</p>
          </header>
          <MethodList items={identity} />
        </div>
        <div>
          <header>
            <span>{pick(zh, "COVERAGE LIMITS", "覆盖限制")}</span>
            <p>{pick(zh, "What this evidence can support", "这些证据可以支持的判断")}</p>
          </header>
          <MethodList items={boundaries} />
        </div>
      </section>
    </section>
  );
}
