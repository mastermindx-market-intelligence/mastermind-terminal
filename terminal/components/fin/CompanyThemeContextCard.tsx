"use client";

import { useEffect, useMemo, useState } from "react";
import { useLang } from "../../lib/i18n";
import { pick } from "../../lib/finFormat";
import {
  getCompanyThemeExposure,
  type CompanyThemeExposure,
  type CompanyThemeExposureItem,
  type CompanyThemeExposureResult,
} from "../../lib/companyThemeExposure";
import { TECHNICAL_DETAILS_SUMMARY } from "../../lib/companyIntelligenceLabels";

export interface CompanyThemeContextCardProps {
  ticker: string;
  selectedEventId: string;
  /** Identity from the already verified Company Intelligence workspace. */
  companyIntelligenceGenerationId: string;
  latestEventId: string | null;
  /** The event period already rendered in the Company Intelligence selector. */
  selectedEventLabel: string;
  onUseLatest?: () => void;
}

function qualifier(item: CompanyThemeExposureItem, zh: boolean): string {
  if (item.mapping_qualifier === "direct") return pick(zh, "Direct crosswalk", "直接映射");
  if (item.mapping_qualifier === "proxy") return pick(zh, "Proxy crosswalk", "代理映射");
  return pick(zh, "Curated crosswalk", "策展映射");
}

function warning(code: string, zh: boolean): string {
  const labels: Record<string, [string, string]> = {
    theme_state_stale: ["The separate theme-state receipt is stale.", "独立主题状态凭证已过期。"],
    theme_state_missing: ["A theme-state receipt is not available for this generation.", "此版本没有主题状态凭证。"],
    theme_state_invalid: ["The theme-state receipt was invalid and is not used.", "主题状态凭证无效，未被使用。"],
    theme_state_future: ["The theme-state receipt is dated after this generation and is not used.", "主题状态凭证日期晚于此版本，未被使用。"],
    active_membership_unmapped: ["Some active curated baskets are deliberately outside this theme crosswalk.", "部分活跃策展篮子被有意排除在此主题映射之外。"],
  };
  const label = labels[code];
  return label ? pick(zh, label[0], label[1]) : code.replaceAll("_", " ");
}

function stateLabel(state: "ready" | "partial" | "stale", zh: boolean): string {
  if (state === "ready") return pick(zh, "Verified", "已验证");
  if (state === "stale") return pick(zh, "Last verified", "最近验证");
  return pick(zh, "Partial", "部分覆盖");
}

function themeStateLabel(state: CompanyThemeExposure["theme_state"]["status"], zh: boolean): string {
  if (state === "fresh") return pick(zh, "Fresh", "新鲜");
  if (state === "stale") return pick(zh, "Stale", "已过期");
  if (state === "missing") return pick(zh, "Missing", "缺失");
  return pick(zh, "Invalid", "无效");
}

function errorCopy(code: "invalid_symbol" | "not_found" | "unauthorized" | "upstream_unavailable" | "invalid_payload", zh: boolean): string {
  if (code === "unauthorized") return pick(zh, "Sign in to use verified company theme context.", "登录后可使用已验证的公司主题背景。");
  if (code === "invalid_payload") return pick(zh, "The published theme context did not pass its lineage checks.", "已发布的主题背景未通过来源链验证。");
  if (code === "invalid_symbol") return pick(zh, "This ticker is not valid for theme context.", "该代码无法用于主题背景。");
  return pick(zh, "The verified theme context could not be reached. Try again shortly.", "暂时无法获取已验证的主题背景，请稍后重试。");
}

function effectiveState(result: CompanyThemeExposureResult): "ready" | "partial" | "stale" {
  if (!result.ok) return "partial";
  return result.state === "stale" ? "stale" : result.context.status;
}

function EventBoundary({ label, onUseLatest }: { label: string; onUseLatest?: () => void }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  return (
    <section className="ci-theme-card ci-theme-boundary" aria-live="polite">
      <div className="ci-theme-header">
        <div><span className="ci-theme-kicker">{pick(zh, "CURRENT THEME CONTEXT", "当前主题背景")}</span><h3>{pick(zh, "Pinned to the latest reported event", "仅锚定最新报告事件")}</h3></div>
        <span className="fin-tag" style={{ "--c": "var(--muted)" } as React.CSSProperties}>{pick(zh, "Context only", "仅供背景")}</span>
      </div>
      <p className="ci-theme-boundary-copy">{pick(
        zh,
        `Theme context is only published beside the latest company event. ${label} is historical, so no current-theme reading is shown here.`,
        `主题背景仅与最新公司事件一同发布。${label} 为历史事件，因此此处不展示当前主题读数。`,
      )}</p>
      {onUseLatest && <button className="btn btn-ghost ci-theme-latest" onClick={onUseLatest}>{pick(zh, "Use latest event", "切换至最新事件")}</button>}
    </section>
  );
}

function LoadingCard() {
  const { lang } = useLang();
  return <section className="ci-theme-card ci-theme-loading" aria-busy="true" aria-label={pick(lang === "zh", "Loading verified company theme context", "正在加载已验证的公司主题背景")}><span className="fin-skel" /><span className="fin-skel" /><span className="fin-skel" /></section>;
}

function ContextCard({ context, state }: { context: CompanyThemeExposure; state: "ready" | "partial" | "stale" }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const noMembership = context.coverage.status === "no_active_membership";
  const noMapped = context.coverage.mapped_basket_count === 0;
  const mappedWord = context.coverage.mapped_basket_count === 1 ? pick(zh, "mapping", "个映射") : pick(zh, "mappings", "个映射");
  const palette = state === "ready" ? "var(--up)" : "var(--warn)";
  const contextHeadline = noMembership
    ? pick(zh, "No active curated basket membership", "暂无活跃策展篮子成员身份")
    : noMapped
      ? pick(zh, "Active baskets are outside the current crosswalk", "活跃篮子位于当前映射范围之外")
      : pick(zh, "Curated basket context", "策展篮子背景");

  return (
    <section className="ci-theme-card" aria-labelledby="ci-theme-title">
      <div className="ci-theme-header">
        <div>
          <span className="ci-theme-kicker">{pick(zh, "CURRENT THEME CONTEXT", "当前主题背景")}</span>
          <h3 id="ci-theme-title">{contextHeadline}</h3>
        </div>
        <span className="fin-tag" style={{ "--c": palette } as React.CSSProperties}>{stateLabel(state, zh)}</span>
      </div>

      <p className="ci-theme-rule">{pick(
        zh,
        "This is a point-in-time curated membership projection. It does not rank, explain, forecast, or recommend the company.",
        "这是时点策展成员身份投影，不对公司进行排序、解释、预测或推荐。",
      )}</p>

      {!noMapped && (
        <ul className="ci-theme-list" aria-label={pick(zh, "Mapped curated theme context", "已映射的策展主题背景")}>
          {context.exposures.map((item) => (
            <li key={`${item.theme_id}-${item.basket_id}`}>
              <span className={`ci-theme-qualifier ${item.mapping_qualifier}`} aria-hidden>{item.mapping_qualifier === "direct" ? "D" : item.mapping_qualifier === "proxy" ? "P" : "C"}</span>
              <div>
                <strong>{pick(zh, item.name_en, item.name_zh)}</strong>
                <span className="ci-theme-meta-row">
                  <small>{qualifier(item, zh)}</small>
                  <details>
                    <summary>{pick(zh, TECHNICAL_DETAILS_SUMMARY.en, TECHNICAL_DETAILS_SUMMARY.zh)}</summary>
                    <code>{item.basket_id}</code>
                  </details>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {noMembership && <p className="ci-theme-empty">{pick(zh, "This company has no active membership in the current curated basket roster.", "该公司不在当前策展篮子名册的活跃成员中。")}</p>}
      {!noMembership && noMapped && <p className="ci-theme-empty">{pick(zh, "The active membership is retained as coverage, but no theme label is inferred for it.", "活跃成员身份已保留为覆盖信息，但不会为其推断主题标签。")}</p>}

      <div className="ci-theme-coverage" aria-label={pick(zh, "Crosswalk coverage", "映射覆盖情况")}>
        <span><b className="num">{context.coverage.active_basket_count}</b>{pick(zh, "active baskets", "活跃篮子")}</span>
        <span><b className="num">{context.coverage.mapped_basket_count}</b>{mappedWord}</span>
        <span className={context.coverage.unmapped_basket_count ? "warn" : ""}><b className="num">{context.coverage.unmapped_basket_count}</b>{pick(zh, "excluded", "排除")}</span>
      </div>

      {(context.warnings.length > 0 || context.coverage.unmapped_basket_count > 0) && <div className="ci-theme-warning" role="status"><span aria-hidden>!</span><p>{context.warnings.map((item) => warning(item, zh)).join(" ") || pick(zh, "Some active curated baskets are excluded from the crosswalk; no label is inferred.", "部分活跃策展篮子被排除在映射之外；不会推断标签。")}</p></div>}

      <div className="ci-theme-footer">
        <span>{pick(zh, "Theme state", "主题状态")} <b>{themeStateLabel(context.theme_state.status, zh)}</b>{context.theme_state.as_of ? <time className="num" dateTime={context.theme_state.as_of}>{context.theme_state.as_of}</time> : null}</span>
        <button className="ci-theme-receipts" aria-expanded={receiptsOpen} aria-controls="ci-theme-receipts" onClick={() => setReceiptsOpen((open) => !open)}>{pick(zh, receiptsOpen ? "Hide receipts" : "View receipts", receiptsOpen ? "隐藏凭证" : "查看凭证")}</button>
      </div>

      {receiptsOpen && (
        <dl id="ci-theme-receipts" className="ci-theme-receipts-panel">
          <div><dt>{pick(zh, "Theme generation", "主题版本")}</dt><dd><code>{context.generation_id}</code></dd></div>
          <div><dt>{pick(zh, "Company event generation", "公司事件版本")}</dt><dd><code>{context.company_intelligence.generation_id}</code></dd></div>
          <div><dt>{pick(zh, "Latest event pin", "最新事件锚点")}</dt><dd><code>{context.company_intelligence.latest_event_id ?? "—"}</code></dd></div>
          <div><dt>{pick(zh, "Company-context receipt", "公司背景凭证")}</dt><dd><code>{context.company_intelligence.context_sha256}</code></dd></div>
          <div><dt>{pick(zh, "Theme-state receipt", "主题状态凭证")}</dt><dd><code>{context.theme_state.sha256 ?? "—"}</code></dd></div>
          <div><dt>{pick(zh, "Authority", "权限")}</dt><dd>{pick(zh, "Context only", "仅供背景参考")}</dd></div>
        </dl>
      )}
    </section>
  );
}

export default function CompanyThemeContextCard({
  ticker,
  selectedEventId,
  companyIntelligenceGenerationId,
  latestEventId,
  selectedEventLabel,
  onUseLatest,
}: CompanyThemeContextCardProps) {
  const [loaded, setLoaded] = useState<{ key: string; result: CompanyThemeExposureResult } | null>(null);
  const [nonce, setNonce] = useState(0);
  const selectedHistorical = !!latestEventId && latestEventId !== selectedEventId;
  const requestKey = `${ticker}:${companyIntelligenceGenerationId}:${latestEventId ?? "none"}:${nonce}`;

  useEffect(() => {
    // Current-vs-historical is owned by the already loaded Company Intelligence
    // record. A missing or lagging sidecar must never decide that boundary.
    if (selectedHistorical) return;
    const controller = new AbortController();
    getCompanyThemeExposure(ticker, { signal: controller.signal, retryNonce: nonce })
      .then((result) => { if (!controller.signal.aborted) setLoaded({ key: requestKey, result }); })
      .catch(() => { if (!controller.signal.aborted) setLoaded({ key: requestKey, result: { ok: false, state: "error", error: { code: "upstream_unavailable", message: "Company theme context request failed", retryable: true } } }); });
    return () => controller.abort();
  }, [nonce, requestKey, selectedHistorical, ticker]);

  const result = loaded?.key === requestKey ? loaded.result : null;
  const state = useMemo(() => result ? effectiveState(result) : "partial", [result]);
  const { lang } = useLang();
  const zh = lang === "zh";

  if (selectedHistorical) return <EventBoundary label={selectedEventLabel} onUseLatest={onUseLatest} />;
  if (!result) return <LoadingCard />;
  if (!result.ok) {
    if (result.error.code === "not_found") return null;
    return <section className="ci-theme-card ci-theme-unavailable" role="status"><div><span className="ci-theme-kicker">{pick(zh, "CURRENT THEME CONTEXT", "当前主题背景")}</span><h3>{pick(zh, "Verified theme context unavailable", "已验证主题背景暂不可用")}</h3><p>{errorCopy(result.error.code, zh)}</p></div>{result.error.retryable && <button className="btn btn-ghost" onClick={() => setNonce(Date.now())}>{pick(zh, "Retry", "重试")}</button>}</section>;
  }
  if (result.context.company_intelligence.generation_id !== companyIntelligenceGenerationId
    || result.context.company_intelligence.latest_event_id !== latestEventId) {
    return <section className="ci-theme-card ci-theme-unavailable" role="status"><div><span className="ci-theme-kicker">{pick(zh, "CURRENT THEME CONTEXT", "当前主题背景")}</span><h3>{pick(zh, "Theme context is refreshing", "主题背景正在刷新")}</h3><p>{pick(zh, "The sidecar is not pinned to this Company Intelligence generation, so it is quarantined until publication catches up.", "主题侧车尚未锚定当前公司情报版本，因此在发布追平前不会展示。")}</p></div><button className="btn btn-ghost" onClick={() => setNonce(Date.now())}>{pick(zh, "Retry", "重试")}</button></section>;
  }
  return <ContextCard context={result.context} state={state} />;
}
