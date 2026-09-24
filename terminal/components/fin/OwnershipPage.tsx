"use client";

import "../../app/company-intelligence.css";
import { useEffect, useState } from "react";
import { useLang } from "../../lib/i18n";
import { pick } from "../../lib/finFormat";
import {
  getCompanyIntelligence,
  type CompanyIntelligenceResult,
} from "../../lib/companyIntelligence";
import CompanyInstitutionalContextCard from "./CompanyInstitutionalContextCard";

interface OwnershipPageProps {
  sym: string;
}

function periodLabel(result: Extract<CompanyIntelligenceResult, { ok: true }>): string {
  const event = result.context.latest_event;
  if (!event) return "";
  return `Q${event.fiscal_quarter} FY${event.fiscal_year}`;
}

function errorCopy(result: Extract<CompanyIntelligenceResult, { ok: false }>, zh: boolean): string {
  if (result.error.code === "invalid_symbol") {
    return pick(zh, "This symbol cannot be used for ownership context.", "该代码无法用于持仓背景。");
  }
  if (result.error.code === "invalid_payload") {
    return pick(zh, "The company context did not pass its verification checks.", "公司背景未通过验证检查。");
  }
  if (result.error.code === "not_found") {
    return pick(zh, "No verified company context is published for this symbol yet.", "该代码尚未发布已验证公司背景。");
  }
  return pick(zh, "Verified company context is temporarily unavailable.", "已验证公司背景暂时不可用。");
}

export default function OwnershipPage({ sym }: OwnershipPageProps) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const ticker = sym.trim().toUpperCase();
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; result: CompanyIntelligenceResult } | null>(null);
  const requestKey = `${ticker}:${nonce}`;

  useEffect(() => {
    const controller = new AbortController();
    getCompanyIntelligence(ticker, { signal: controller.signal, retryNonce: nonce })
      .then((result) => {
        if (!controller.signal.aborted) setLoaded({ key: requestKey, result });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoaded({
            key: requestKey,
            result: {
              ok: false,
              state: "error",
              error: {
                code: "upstream_unavailable",
                message: "Company context request failed",
                retryable: true,
              },
            },
          });
        }
      });
    return () => controller.abort();
  }, [nonce, requestKey, ticker]);

  const result = loaded?.key === requestKey ? loaded.result : null;

  if (!result) {
    return (
      <section className="fin-ownership-page" aria-busy="true">
        <div className="fin-ownership-intro">
          <span>{pick(zh, "OWNERSHIP · INSTITUTIONAL", "持仓 · 机构")}</span>
          <h2>{pick(zh, "Tracked institutional positioning", "追踪机构持仓")}</h2>
          <p>{pick(
            zh,
            "Point-in-time public filings from the tracked manager roster · not total ownership",
            "追踪管理人名册的时点公开申报 · 并非总持股",
          )}</p>
        </div>
        <div className="ci-inst-card ci-inst-loading" aria-hidden>
          <span className="fin-skel" /><span className="fin-skel" /><span className="fin-skel" /><span className="fin-skel" />
        </div>
      </section>
    );
  }

  if (!result.ok) {
    return (
      <section className="fin-ownership-page">
        <div className="fin-ownership-intro">
          <span>{pick(zh, "OWNERSHIP · INSTITUTIONAL", "持仓 · 机构")}</span>
          <h2>{pick(zh, "Tracked institutional positioning", "追踪机构持仓")}</h2>
          <p>{pick(
            zh,
            "Point-in-time public filings from the tracked manager roster · not total ownership",
            "追踪管理人名册的时点公开申报 · 并非总持股",
          )}</p>
        </div>
        <div className="fin-empty fin-empty-lg" role="status">
          <div className="fin-empty-title">{pick(zh, "Ownership context unavailable", "持仓背景不可用")}</div>
          <div className="fin-empty-why">{errorCopy(result, zh)}</div>
          {result.error.retryable ? (
            <button className="btn btn-ghost" onClick={() => setNonce((value) => value + 1)}>
              {pick(zh, "Retry", "重试")}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const context = result.context;
  const latestEventId = context.latest_event_id;
  const latestEvent = context.latest_event;
  if (result.state === "not_covered" || !latestEventId || !latestEvent) {
    return (
      <section className="fin-ownership-page">
        <div className="fin-ownership-intro">
          <span>{pick(zh, "OWNERSHIP · INSTITUTIONAL", "持仓 · 机构")}</span>
          <h2>{pick(zh, "Tracked institutional positioning", "追踪机构持仓")}</h2>
          <p>{pick(
            zh,
            "Point-in-time public filings from the tracked manager roster · not total ownership",
            "追踪管理人名册的时点公开申报 · 并非总持股",
          )}</p>
        </div>
        <div className="fin-empty fin-empty-lg" role="status">
          <div className="fin-empty-title">{pick(zh, "No verified company-event pin yet", "尚无已验证公司事件锚点")}</div>
          <div className="fin-empty-why">{pick(
            zh,
            "Institutional context remains hidden until it can be aligned to a verified Company Intelligence generation.",
            "机构背景会保持隐藏，直到能够与已验证的公司情报版本对齐。",
          )}</div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="fin-ownership-page"
      data-ownership-page=""
      data-ownership-company-generation={context.generation_id}
      data-ownership-event-id={latestEventId}
    >
      <div className="fin-ownership-intro">
        <div>
          <span>{pick(zh, "OWNERSHIP · INSTITUTIONAL", "持仓 · 机构")}</span>
          <h2>{pick(zh, "Tracked institutional positioning", "追踪机构持仓")}</h2>
        </div>
        <div className="fin-ownership-intro-meta">
          <strong>{periodLabel(result)}</strong>
          <time dateTime={latestEvent.call_date}>{latestEvent.call_date}</time>
        </div>
        <p>{pick(
          zh,
          "Point-in-time public 13F filings from the tracked manager roster. This is not total ownership, not a company rank, and not a trading signal.",
          "基于追踪管理人名册公开 13F 文件的时点视图。它并非总持股、公司排名或交易信号。",
        )}</p>
      </div>

      <CompanyInstitutionalContextCard
        ticker={ticker}
        selectedEventId={latestEventId}
        companyIntelligenceGenerationId={context.generation_id}
        latestEventId={latestEventId}
        selectedEventLabel={periodLabel(result)}
      />
    </section>
  );
}
