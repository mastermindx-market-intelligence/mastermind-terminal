"use client";

import { useEffect, useMemo, useState } from "react";
import { useLang } from "../../lib/i18n";
import { pick } from "../../lib/finFormat";
import {
  getCompanyInstitutionalContext,
  type CompanyInstitutionalAction,
  type CompanyInstitutionalContext,
  type CompanyInstitutionalPosition,
  type CompanyInstitutionalResult,
} from "../../lib/companyInstitutionalContext";
import { managerStyleLabel } from "../../lib/companyIntelligenceLabels";

export interface CompanyInstitutionalContextCardProps {
  ticker: string;
  selectedEventId: string;
  companyIntelligenceGenerationId: string;
  latestEventId: string | null;
  selectedEventLabel: string;
  onUseLatest?: () => void;
}

function stateLabel(state: "ready" | "partial" | "no_covered_holder" | "stale", zh: boolean): string {
  if (state === "ready") return pick(zh, "Verified", "已验证");
  if (state === "stale") return pick(zh, "Last verified", "最近验证");
  if (state === "no_covered_holder") return pick(zh, "No tracked holder", "无追踪持有人");
  return pick(zh, "Partial coverage", "部分覆盖");
}

function actionLabel(action: CompanyInstitutionalAction, zh: boolean): string {
  const labels: Record<CompanyInstitutionalAction, [string, string]> = {
    new: ["New", "新建仓"], add: ["Added", "增持"], hold: ["Held", "持有"], trim: ["Trimmed", "减持"],
    exit: ["Exited", "退出"], unavailable: ["Comparison unavailable", "比较不可用"],
  };
  return pick(zh, labels[action][0], labels[action][1]);
}

function warningLabel(code: string, zh: boolean): string {
  const labels: Record<string, [string, string]> = {
    current_snapshots_missing: ["Not every active tracked manager has filed the selected quarter.", "并非所有活跃追踪管理人都已提交所选季度文件。"],
    comparison_snapshots_missing: ["Prior-quarter coverage is incomplete, so some movement labels are withheld.", "上季度覆盖不完整，因此部分变动标签未显示。"],
    resolution_partial: ["Some reported positions could not be resolved to a covered ticker.", "部分申报持仓无法解析为已覆盖代码。"],
    history_coverage_incomplete: ["The history rail lacks two fully aligned periods, so no direction is asserted.", "历史轨道缺少两个完整对齐时期，因此不会断言方向。"],
  };
  const label = labels[code];
  return label ? pick(zh, label[0], label[1]) : code.replaceAll("_", " ");
}

function errorCopy(code: string, zh: boolean): string {
  if (code === "unauthorized") return pick(zh, "Sign in to use verified institutional context.", "登录后可使用已验证的机构背景。");
  if (code === "invalid_payload") return pick(zh, "The publication did not pass its receipt and lineage checks.", "该发布未通过凭证和来源链验证。");
  if (code === "invalid_symbol") return pick(zh, "This ticker is not valid for institutional context.", "该代码无法用于机构背景。");
  return pick(zh, "Verified institutional context could not be reached. Try again shortly.", "暂时无法获取已验证的机构背景，请稍后重试。");
}

function currency(value: number, zh: boolean): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(zh ? "zh-CN" : "en-US", {
    style: "currency", currency: "USD", notation: value >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: 1,
  }).format(value);
}

function compact(value: number, zh: boolean): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(zh ? "zh-CN" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function pct(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(Math.abs(value) < 10 ? 1 : 0)}%`;
}

function directionLabel(direction: CompanyInstitutionalContext["trend"]["direction"], zh: boolean): string {
  if (direction === "accumulating") return pick(zh, "Accumulating", "持续积累");
  if (direction === "distributing") return pick(zh, "Distributing", "持续减持");
  if (direction === "stable") return pick(zh, "Stable", "保持稳定");
  return pick(zh, "Not asserted", "未作断言");
}

function EventBoundary({ label, onUseLatest }: { label: string; onUseLatest?: () => void }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  return (
    <section className="ci-inst-card ci-inst-boundary" aria-live="polite">
      <div className="ci-inst-header">
        <div><span className="ci-inst-kicker">{pick(zh, "INSTITUTIONAL POSITIONING", "机构持仓背景")}</span><h3>{pick(zh, "Pinned to the latest company event", "仅锚定最新公司事件")}</h3></div>
        <span className="fin-tag" style={{ "--c": "var(--muted)" } as React.CSSProperties}>{pick(zh, "Context only", "仅供背景")}</span>
      </div>
      <p>{pick(
        zh,
        `Point-in-time 13F context is only shown beside the latest company event. ${label} is historical, so today's filing set is not mixed into that older record.`,
        `时点 13F 背景仅与最新公司事件一同展示。${label} 为历史事件，因此不会将当前申报集混入旧记录。`,
      )}</p>
      {onUseLatest && <button className="btn btn-ghost ci-inst-latest" onClick={onUseLatest}>{pick(zh, "Use latest event", "切换至最新事件")}</button>}
    </section>
  );
}

function LoadingCard() {
  const { lang } = useLang();
  return <section className="ci-inst-card ci-inst-loading" aria-busy="true" aria-label={pick(lang === "zh", "Loading verified institutional context", "正在加载已验证的机构背景")}><span className="fin-skel" /><span className="fin-skel" /><span className="fin-skel" /><span className="fin-skel" /></section>;
}

function ManagerRow({ position, zh }: { position: CompanyInstitutionalPosition; zh: boolean }) {
  return (
    <li className={`ci-inst-manager ${position.action}`}>
      <span className="ci-inst-action">{actionLabel(position.action, zh)}</span>
      <div className="ci-inst-manager-name"><strong>{position.manager_name}</strong><small>{managerStyleLabel(position.manager_style, zh)} · {position.manager_grade}</small></div>
      <span><small>{pick(zh, "Filed", "提交")}</small><time className="num" dateTime={position.filing_date}>{position.filing_date}</time></span>
      <span><small>{pick(zh, "Position", "持仓价值")}</small><b className="num">{currency(position.value_usd, zh)}</b></span>
      <span><small>{pick(zh, "Book weight", "组合权重")}</small><b className="num">{pct(position.book_weight_pct)}</b></span>
      <span className="ci-inst-move"><small>{pick(zh, "Shares / move", "股份 / 变动")}</small><b className="num">{compact(position.shares, zh)} <i>{pct(position.shares_change_pct, true)}</i></b></span>
    </li>
  );
}

function ContextCard({ context, state }: { context: CompanyInstitutionalContext; state: "ready" | "partial" | "no_covered_holder" | "stale" }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const holders = context.consensus.current_holder_count;
  const sortedPositions = useMemo(() => [...context.positions].sort((left, right) => {
    if (left.is_current_holder !== right.is_current_holder) return left.is_current_holder ? -1 : 1;
    return right.value_usd - left.value_usd || left.manager_name.localeCompare(right.manager_name);
  }), [context.positions]);
  const visible = showAll ? sortedPositions : sortedPositions.slice(0, 6);
  const maxTrendValue = Math.max(1, ...context.trend.periods.map((point) => point.total_value_usd));
  const palette = state === "ready" ? "var(--up)" : state === "no_covered_holder" ? "var(--muted)" : "var(--warn)";
  const headline = holders
    ? pick(zh, `${holders} tracked managers reported a position`, `${holders} 家追踪管理人申报持仓`)
    : pick(zh, "No position among the tracked manager set", "追踪管理人集合中暂无持仓");

  return (
    <section className="ci-inst-card" aria-labelledby="ci-inst-title">
      <div className="ci-inst-header">
        <div>
          <span className="ci-inst-kicker">{pick(zh, "INSTITUTIONAL POSITIONING", "机构持仓背景")}</span>
          <h3 id="ci-inst-title">{headline}</h3>
        </div>
        <div className="ci-inst-badges">
          <span className="fin-tag" style={{ "--c": palette } as React.CSSProperties}>{stateLabel(state, zh)}</span>
          <span className="ci-inst-delay">13F · {pick(zh, "reported with filing lag", "按申报时滞披露")}</span>
        </div>
      </div>

      <p className="ci-inst-rule">{pick(
        zh,
        "A point-in-time view of public 13F filings from the tracked manager roster. It describes disclosed positioning; it does not estimate total ownership, rank the company, or issue a signal.",
        "基于追踪管理人名册公开 13F 文件的时点视图。它仅描述已披露持仓，不估算总持股、不对公司排序，也不产生信号。",
      )}</p>

      <div className="ci-inst-stats" aria-label={pick(zh, "Institutional filing coverage", "机构申报覆盖") }>
        <span><small>{pick(zh, "Reporting set", "申报集合")}</small><b className="num">{context.coverage.reporting_manager_count}/{context.coverage.active_manager_count}</b><i>{pick(zh, "active managers", "活跃管理人")}</i></span>
        <span><small>{pick(zh, "Current holders", "当前持有人")}</small><b className="num">{holders}</b><i>{pick(zh, `${context.consensus.buyer_count} buyers · ${context.consensus.trimmer_count} trimmers`, `${context.consensus.buyer_count} 增持 · ${context.consensus.trimmer_count} 减持`)}</i></span>
        <span><small>{pick(zh, "Tracked value", "追踪价值")}</small><b className="num">{currency(context.consensus.total_value_usd, zh)}</b><i>{pick(zh, "reported market value", "申报市值")}</i></span>
        <span><small>{pick(zh, "Tracked concentration", "追踪集中度")}</small><b className="num">{context.consensus.ownership_hhi === null ? "—" : context.consensus.ownership_hhi.toFixed(3)}</b><i>{pick(zh, "HHI within this roster", "仅限该名册的 HHI")}</i></span>
      </div>

      <div className="ci-inst-period">
        <span><small>{pick(zh, "Consensus quarter", "共识季度")}</small><b className="num">{context.period.consensus_period}</b></span>
        <span><small>{pick(zh, "Filing set complete", "申报集合完成")}</small><b className="num">{context.period.consensus_available_on ?? pick(zh, "Not complete", "尚未完成")}</b></span>
        <span><small>{pick(zh, "Built as known on", "构建认知截止")}</small><b className="num">{context.period.build_as_of}</b></span>
      </div>

      {visible.length > 0 ? (
        <div className="ci-inst-tape">
          <div className="ci-inst-subhead"><div><span>{pick(zh, "MANAGER TAPE", "管理人持仓带")}</span><small>{pick(zh, "Current positions and reported exits", "当前持仓及已申报退出")}</small></div><b className="num">{context.positions.length}</b></div>
          <ul>{visible.map((position) => <ManagerRow key={position.manager} position={position} zh={zh} />)}</ul>
          {sortedPositions.length > 6 && <button className="ci-inst-more" onClick={() => setShowAll((open) => !open)}>{pick(zh, showAll ? "Show top managers" : `Show all ${sortedPositions.length}`, showAll ? "仅显示主要管理人" : `显示全部 ${sortedPositions.length} 家`)}</button>}
        </div>
      ) : <div className="ci-inst-empty">{pick(zh, "The company remains in the covered universe, but no current tracked manager position or reported exit is present for this aligned quarter.", "该公司仍在覆盖范围内，但本对齐季度没有当前追踪管理人持仓或已申报退出。")}</div>}

      <div className="ci-inst-trend">
        <div className="ci-inst-subhead"><div><span>{pick(zh, "ALIGNED HISTORY", "对齐历史")}</span><small>{pick(zh, "Only fully reported quarters can assert direction", "仅完整申报季度可断言方向")}</small></div><strong className={context.trend.direction ?? "none"}>{directionLabel(context.trend.direction, zh)}</strong></div>
        {context.trend.periods.length ? <div className="ci-inst-trend-grid">{context.trend.periods.map((point) => (
          <div key={point.period_end} className={point.eligible ? "eligible" : "excluded"}>
            <span><time className="num" dateTime={point.period_end}>{point.period_end}</time><small>{point.eligible ? pick(zh, "Aligned", "已对齐") : pick(zh, "Excluded", "已排除")}</small></span>
            <i><b style={{ width: `${Math.max(point.total_value_usd > 0 ? 5 : 0, point.total_value_usd / maxTrendValue * 100)}%` }} /></i>
            <strong className="num">{currency(point.total_value_usd, zh)}</strong>
            <em className="num">{point.holder_count} {pick(zh, "holders", "持有人")}</em>
          </div>
        ))}</div> : <p className="ci-inst-no-trend">{pick(zh, "No coverage-aligned history is available yet.", "尚无覆盖对齐的历史记录。")}</p>}
      </div>

      {context.warnings.length > 0 && <div className="ci-inst-warning" role="status"><span aria-hidden>!</span><p>{context.warnings.map((item) => warningLabel(item, zh)).join(" ")}</p></div>}

      <div className="ci-inst-footer">
        <span>{pick(zh, "Latest filing", "最新申报")} <b className="num">{context.period.latest_reporting_filing_date ?? "—"}</b></span>
        <button className="ci-inst-receipts" aria-expanded={receiptsOpen} aria-controls="ci-inst-receipts" onClick={() => setReceiptsOpen((open) => !open)}>{pick(zh, receiptsOpen ? "Hide provenance" : "View provenance", receiptsOpen ? "隐藏来源" : "查看来源")}</button>
      </div>

      {receiptsOpen && <dl id="ci-inst-receipts" className="ci-inst-receipts-panel">
        <div><dt>{pick(zh, "Institutional generation", "机构背景版本")}</dt><dd><code>{context.generation_id}</code></dd></div>
        <div><dt>{pick(zh, "Company Intelligence pin", "公司情报锚点")}</dt><dd><code>{context.company_intelligence.generation_id}</code></dd></div>
        <div><dt>{pick(zh, "Latest event pin", "最新事件锚点")}</dt><dd><code>{context.company_intelligence.latest_event_id ?? "—"}</code></dd></div>
        <div><dt>{pick(zh, "Company-context receipt", "公司背景凭证")}</dt><dd><code>{context.company_intelligence.context_sha256}</code></dd></div>
        <div><dt>{pick(zh, "Filing window closed", "申报窗口关闭")}</dt><dd className="num">{context.period.filing_window_closed_on}</dd></div>
        <div><dt>{pick(zh, "Authority", "权限")}</dt><dd>{pick(zh, "Context only", "仅供背景参考")}</dd></div>
      </dl>}
    </section>
  );
}

export default function CompanyInstitutionalContextCard({
  ticker, selectedEventId, companyIntelligenceGenerationId, latestEventId, selectedEventLabel, onUseLatest,
}: CompanyInstitutionalContextCardProps) {
  const [loaded, setLoaded] = useState<{ key: string; result: CompanyInstitutionalResult } | null>(null);
  const [nonce, setNonce] = useState(0);
  const selectedHistorical = !!latestEventId && selectedEventId !== latestEventId;
  const requestKey = `${ticker}:${companyIntelligenceGenerationId}:${latestEventId ?? "none"}:${nonce}`;
  useEffect(() => {
    if (selectedHistorical) return;
    const controller = new AbortController();
    getCompanyInstitutionalContext(ticker, { signal: controller.signal, retryNonce: nonce })
      .then((result) => { if (!controller.signal.aborted) setLoaded({ key: requestKey, result }); })
      .catch(() => { if (!controller.signal.aborted) setLoaded({ key: requestKey, result: { ok: false, state: "error", error: { code: "upstream_unavailable", message: "Institutional context request failed", retryable: true } } }); });
    return () => controller.abort();
  }, [nonce, requestKey, selectedHistorical, ticker]);
  const result = loaded?.key === requestKey ? loaded.result : null;
  const { lang } = useLang();
  const zh = lang === "zh";

  if (selectedHistorical) return <EventBoundary label={selectedEventLabel} onUseLatest={onUseLatest} />;
  if (!result) return <LoadingCard />;
  if (!result.ok) {
    if (result.error.code === "not_found") return null;
    return <section className="ci-inst-card ci-inst-unavailable" role="status"><div><span className="ci-inst-kicker">{pick(zh, "INSTITUTIONAL POSITIONING", "机构持仓背景")}</span><h3>{pick(zh, "Verified filing context unavailable", "已验证申报背景暂不可用")}</h3><p>{errorCopy(result.error.code, zh)}</p></div>{result.error.retryable && <button className="btn btn-ghost" onClick={() => setNonce(Date.now())}>{pick(zh, "Retry", "重试")}</button>}</section>;
  }
  if (result.context.company_intelligence.generation_id !== companyIntelligenceGenerationId
    || result.context.company_intelligence.latest_event_id !== latestEventId) {
    return <section className="ci-inst-card ci-inst-unavailable" role="status"><div><span className="ci-inst-kicker">{pick(zh, "INSTITUTIONAL POSITIONING", "机构持仓背景")}</span><h3>{pick(zh, "Filing context is refreshing", "申报背景正在刷新")}</h3><p>{pick(zh, "The 13F sidecar is not pinned to this Company Intelligence generation, so it remains quarantined until publication catches up.", "13F 侧车尚未锚定当前公司情报版本，因此在发布追平前不会展示。")}</p></div><button className="btn btn-ghost" onClick={() => setNonce(Date.now())}>{pick(zh, "Retry", "重试")}</button></section>;
  }
  const state = result.state === "stale" ? "stale" : result.context.status;
  return <ContextCard context={result.context} state={state} />;
}
