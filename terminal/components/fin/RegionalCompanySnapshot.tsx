"use client";

/**
 * RegionalCompanySnapshot — the listing-backed Intelligence surface for CN / HK / Canada.
 *
 * NOT a company-intelligence page. This renders REPORTED listing facts that are already loaded
 * in the shell: profile, the latest reported annual figures with genuinely comparable prior-year
 * deltas, and vendor estimates. It asserts no issuer identity, no earnings event, no transcript
 * and no holder, and it never claims a freshness it cannot source — the fund contract carries no
 * retrieval time, so the surface says so in those words.
 *
 * The synthesis lives in `lib/regionalCompanySnapshot.ts` (pure, tested); this file is the
 * presentation that turns its states into EN/ZH copy. Every visible string goes through `pick`,
 * so a zh string cannot reach the EN view and vice versa.
 *
 * Navigation is the shell's existing `onNavigate` — statements / earnings / forecast / ownership —
 * so a snapshot row is a doorway to the surface that owns that data rather than a dead end.
 */
import "../../app/company-intelligence.css";
import "../../app/regional-company-snapshot.css";

import { useLang } from "../../lib/i18n";
import { fmtNum, fmtPct, pick } from "../../lib/finFormat";
import {
  selectRegionalCompanySnapshot,
  type RegionalSectionStatus,
  type RegionalSnapshotState,
} from "../../lib/regionalCompanySnapshot";
import type { Fund } from "../../lib/fund";
import type { FinPage } from "./finPages";

export interface RegionalCompanySnapshotProps {
  sym: string;
  /** Display name when the host already resolved one (MegaPane's header identity). */
  name?: string | null;
  fund: Fund | null | undefined;
  fundLoading?: boolean;
  onNavigate: (page: FinPage) => void;
}

/** Section state → the one word a reader needs. Never a colour alone. */
function stateLabel(state: RegionalSnapshotState, zh: boolean): string {
  if (state === "available") return pick(zh, "Reported", "已披露");
  if (state === "partial") return pick(zh, "Partial", "部分");
  if (state === "unknown_freshness") return pick(zh, "Age unknown", "时效未知");
  return pick(zh, "Unavailable", "不可用");
}

function StateBadge({ status, zh }: { status: RegionalSectionStatus; zh: boolean }) {
  return (
    <span className="ci-regional-state" data-state={status.state} data-ci-regional-state={status.state}>
      {stateLabel(status.state, zh)}
    </span>
  );
}

/** Section-level navigation, so every card is a doorway rather than a dead end. */
function SectionLinks({ targets, onNavigate }: { targets: { page: FinPage; label: string }[]; onNavigate: (page: FinPage) => void }) {
  return (
    <ul className="ci-regional-links">
      {targets.map((target) => (
        <li key={target.page}>
          <button type="button" onClick={() => onNavigate(target.page)}>
            {target.label}
            <i aria-hidden>›</i>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function RegionalCompanySnapshot({ sym, name, fund, fundLoading = false, onNavigate }: RegionalCompanySnapshotProps) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const ticker = sym.trim().toUpperCase();
  const snapshot = selectRegionalCompanySnapshot({ sym, fund, zh });

  // Loading and unavailable are DIFFERENT states and are rendered differently: a skeleton while
  // the deferred fetch is in flight, an honest empty state once it has settled to nothing.
  if (fundLoading && !snapshot) {
    return (
      <section className="ci-page" data-regional-company-snapshot="" data-ci-regional-load-state="loading" role="status" aria-busy="true">
        <div className="ci-regional-empty">
          <h2>{pick(zh, "Loading reported company information", "正在载入公司已披露信息")}</h2>
          <p>{pick(zh, "Reading this listing's reported fundamentals.", "正在读取该代码的上市财务数据。")}</p>
        </div>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className="ci-page" data-regional-company-snapshot="" data-ci-regional-load-state="unavailable" role="status">
        <div className="ci-regional-empty">
          <h2>{pick(zh, "No reported company information available", "暂无可用的公司已披露信息")}</h2>
          <p>
            {fund
              ? pick(zh, "The loaded fundamentals file does not match this symbol, so nothing is shown.", "已加载的财务文件与当前代码不匹配，因此不予展示。")
              : pick(zh, "No listing fundamentals have been published for this symbol yet.", "该代码尚未发布上市财务数据。")}
          </p>
        </div>
      </section>
    );
  }

  const annual = snapshot.annual;
  const estimates = snapshot.estimates;

  return (
    <section className="ci-page" data-regional-company-snapshot="" data-ci-regional-sym={snapshot.sym}>
      <header className="ci-regional-head">
        <span className="ci-regional-kicker">{pick(zh, "INTELLIGENCE · COMPANY SNAPSHOT", "公司情报 · 公司概况")}</span>
        {/* Exact ticker always; the display name only when the host actually resolved one. The
            MegaPane fallback is the ticker itself, so this never renders "0700.HK 0700.HK". */}
        <h2>{name && name.trim() && name.trim().toUpperCase() !== ticker ? `${ticker} · ${name}` : ticker}</h2>
        <p>{pick(zh, "Reported company information and financial context", "公司已披露信息与财务背景")}</p>
      </header>

      <div className="ci-regional-meta">
        <span>
          <b>{pick(zh, "Artifact generated", "数据生成时间")}</b>
          {snapshot.artifactGenerated ?? "—"}
        </span>
        <span>
          <b>{pick(zh, "Latest report period end", "最新报告期")}</b>
          {[annual?.periodEnd, snapshot.interim?.periodEnd].filter((end): end is string => !!end).sort().at(-1) ?? "—"}
        </span>
        <span>
          <b>{pick(zh, "Statement currency", "报表币种")}</b>
          {snapshot.stmtCurrency ?? pick(zh, "Unknown", "未知")}
        </span>
        <span data-ci-retrieval-note="">
          {snapshot.sourceRetrieval
            ? <><b>{pick(zh, "Annual statement source acquired", "年度报表来源获取时间")}</b>{snapshot.sourceRetrieval}</>
            : pick(zh, "Source retrieval time unavailable", "来源获取时间不可用")}
        </span>
        <span>
          {/* This is the internal public data object a reader can open and read — NOT immutable
              company-intelligence evidence. The label says which one it is. */}
          <b>{pick(zh, "Data file", "数据文件")}</b>
          <a href={snapshot.evidenceHref} target="_blank" rel="noreferrer">{snapshot.ticker}.fund.json</a>
          <small>{pick(zh, "(internal public data, not immutable evidence)", "（内部公开数据，非不可变证据）")}</small>
        </span>
      </div>

      <div className="ci-regional-grid">
        {/* ── Business ── */}
        <section className="ci-regional-card" data-ci-regional-section="business">
          <header>
            <h3>{pick(zh, "Business", "业务")}</h3>
            <StateBadge status={snapshot.sections.business} zh={zh} />
          </header>
          <div className="ci-regional-body">
            <p>{snapshot.description ?? pick(zh, "This listing artifact carries no business description.", "该上市档案未提供业务描述。")}</p>
          </div>
          <dl className="ci-regional-facts">
            <div>
              <dt>{pick(zh, "Sector", "板块")}</dt>
              <dd>{snapshot.sector ?? "—"}</dd>
            </div>
            <div>
              <dt>{pick(zh, "Industry", "行业")}</dt>
              <dd>{snapshot.industry ?? "—"}</dd>
            </div>
            {snapshot.website ? (
              <div>
                <dt>{pick(zh, "Website", "官网")}</dt>
                <dd>
                  <a href={snapshot.website} target="_blank" rel="noreferrer">{snapshot.website}</a>
                </dd>
              </div>
            ) : null}
          </dl>
          <SectionLinks
            onNavigate={onNavigate}
            targets={[{ page: "statements", label: pick(zh, "Open statements", "查看报表") }]}
          />
        </section>

        {/* ── Reported performance ── */}
        <section className="ci-regional-card" data-ci-regional-section="performance">
          <header>
            <h3>{pick(zh, "Reported performance", "已披露业绩")}</h3>
            <StateBadge status={snapshot.sections.performance} zh={zh} />
          </header>
          {annual ? (
            <>
              <p className="ci-regional-note">
                {[
                  annual.periodLabel,
                  annual.fiscalYear ? `${pick(zh, "FY", "财年")} ${annual.fiscalYear}` : null,
                  annual.periodEnd,
                  snapshot.stmtCurrency,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <dl className="ci-regional-rows">
                {annual.metrics.map((metric) => (
                  <div key={metric.id} data-ci-regional-metric={metric.id}>
                    <dt>{metric.label}</dt>
                    <dd>
                      <strong data-absent={metric.value == null ? "true" : "false"}>{fmtNum(metric.value)}</strong>
                      {metric.yoyPct != null ? (
                        <small
                          data-tone={metric.yoyPct >= 0 ? "up" : "down"}
                          data-ci-regional-yoy={metric.id}
                        >
                          {fmtPct(metric.yoyPct, { alreadyPct: true, sign: true })}
                        </small>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
              {/* No delta rendered above means no delta was supportable — an unknown prior period,
                  a zero or missing prior, or an unknown statement currency. Nothing is imputed. */}
              <p className="ci-regional-note">
                {snapshot.stmtCurrency
                  ? pick(zh, "Year-over-year appears only where a comparable prior period exists.", "同比仅在存在可比上年同期时显示。")
                  : pick(zh, "Statement currency is unknown, so no year-over-year change is shown.", "报表币种未知，因此不显示同比变化。")}
              </p>
            </>
          ) : (
            <p className="ci-regional-note">{pick(zh, "This listing artifact has no usable annual statement.", "该上市档案没有可用的年度报表。")}</p>
          )}
          <SectionLinks
            onNavigate={onNavigate}
            targets={[{ page: "statements", label: pick(zh, "Open statements", "查看报表") }]}
          />
        </section>

        {/* ── Estimates and coverage ── */}
        <section className="ci-regional-card" data-ci-regional-section="estimates">
          <header>
            <h3>{pick(zh, "Estimates and coverage", "预测与覆盖")}</h3>
            <StateBadge status={snapshot.sections.estimates} zh={zh} />
          </header>
          {estimates ? (
            <dl className="ci-regional-facts">
              <div>
                <dt>{pick(zh, "Source", "来源")}</dt>
                <dd>{pick(zh, "Vendor estimates", "供应商预测")}</dd>
              </div>
              <div>
                <dt>{pick(zh, "Fiscal period", "预测财年")}</dt>
                <dd>{estimates.fiscalPeriod}</dd>
              </div>
              {estimates.items.map((item) => (
                <div key={item.id}>
                  <dt>{item.label}</dt>
                  <dd>{fmtNum(item.value)}{snapshot.stmtCurrency ? ` ${snapshot.stmtCurrency}` : ""}</dd>
                </div>
              ))}
              {estimates.source ? (
                <div>
                  <dt>{pick(zh, "Estimate source", "估算来源")}</dt>
                  <dd>{estimates.source}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="ci-regional-note">{pick(zh, "No vendor estimates are available for this listing.", "该上市档案没有可用的供应商预测。")}</p>
          )}
          {snapshot.interim ? (
            <p className="ci-regional-note" data-ci-regional-interim="">
              {/* Coverage only. Interim figures are never synthesized here — a cumulative YTD
                  ladder is not a quarter, and a HK half-year is not a quarter either. */}
              {[
                pick(zh, "Latest interim period", "最新中期期间"),
                snapshot.interim.periodLabel,
                snapshot.interim.periodEnd,
                snapshot.interim.cadenceLabel,
                snapshot.interim.periodCountLabel,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : (
            <p className="ci-regional-note">{pick(zh, "No interim statement is available for this listing.", "该上市档案没有可用的中期报表。")}</p>
          )}
          <SectionLinks
            onNavigate={onNavigate}
            targets={[
              { page: "earnings", label: pick(zh, "Earnings", "财报事件") },
              { page: "forecast", label: pick(zh, "Analyst", "分析师预测") },
              { page: "ownership", label: pick(zh, "Ownership", "持仓") },
            ]}
          />
        </section>
      </div>
    </section>
  );
}