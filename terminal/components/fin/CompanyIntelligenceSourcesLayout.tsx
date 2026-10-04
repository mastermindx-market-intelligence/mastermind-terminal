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
          <span>{pick(zh, "SOURCES & METHOD", "来源与方法")}</span>
          <h3>{pick(
            zh,
            "Know what this research view knows — and what it does not",
            "明确此研究视图已知什么，以及尚未知什么",
          )}</h3>
        </div>
        <div className="ci-paper-sources-period">
          <strong>{periodLabel}</strong>
          <time dateTime={eventDate}>{eventDate}</time>
        </div>
      </header>

      <section className="ci-paper-sources-coverage" aria-label={pick(zh, "Coverage matrix", "覆盖矩阵")}>
        <header>
          <span>{pick(zh, "COVERAGE MATRIX", "覆盖矩阵")}</span>
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
            <span>{pick(zh, "SOURCE RECEIPTS", "来源凭证")}</span>
            <p>{pick(
              zh,
              "Exact material and source states available to this generation",
              "此版本可用的精确材料与来源状态",
            )}</p>
          </div>
          <small>{pick(zh, "Existing source manifest", "现有来源清单")}</small>
        </header>
        <div className="ci-paper-sources-manifest">{sourceContent}</div>
      </section>

      <section className="ci-paper-sources-method">
        <div>
          <header>
            <span>{pick(zh, "TIME & IDENTITY", "时间与身份")}</span>
            <p>{pick(zh, "Generation and selected-event boundaries", "版本与当前事件边界")}</p>
          </header>
          <MethodList items={identity} />
        </div>
        <div>
          <header>
            <span>{pick(zh, "INTEGRITY BOUNDARIES", "完整性边界")}</span>
            <p>{pick(zh, "What the page refuses to overstate", "此页面明确拒绝夸大的内容")}</p>
          </header>
          <MethodList items={boundaries} />
        </div>
      </section>
    </section>
  );
}
