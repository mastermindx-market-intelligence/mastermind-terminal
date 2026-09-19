"use client";

import { useCallback, useEffect, useState } from "react";
import { flowGet, flowGetFresh } from "@/lib/flowClientCache";
import { useLang, type Lang } from "@/lib/i18n";
import { makeProphetT } from "./prophetStrings";
import {
  normalizeOptionsAlphaMeasuredFeed,
  type OptionsAlphaMeasuredFeed,
  type OptionsAlphaMeasuredEvent,
} from "./optionsAlphaMeasuredEvidence";
import {
  OPTIONS_ALPHA_OUTCOME_HORIZONS,
  normalizeOptionsAlphaPayload,
  compactOptionsWatchlist,
  optionsAlphaDistinctFireDates,
  optionsAlphaFlowDisplayValue,
  readinessDetail,
  readinessStatus,
  type ForwardLedgerBook,
  type OptionsAlphaOpportunity,
  type OptionsAlphaPayload,
  type OptionsAlphaWatchCandidate,
  type ReadinessNode,
} from "./optionsAlphaTypes";

type T = ReturnType<typeof makeProphetT>;

function fmtDate(value: string | null, lang: Lang): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00-04:00` : value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function fmtNumber(value: number | null, digits = 1): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function fmtNorm(value: number | null): string {
  if (value == null) return "—";
  const absolute = Math.abs(value);
  if (absolute === 0) return "0";
  if (absolute >= 100) return value.toFixed(0);
  if (absolute >= 1) return value.toFixed(2);
  return value.toPrecision(3);
}

function fmtPct(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function exactClock(value: string | null, t: T): string {
  return value ?? t("optionsClockUnavailable");
}

function localizedStatus(status: string | null, t: T, lang: Lang): string {
  if (!status) return t("optionsStatusUnavailable");
  const key = status.toLowerCase().replace(/[\s-]+/g, "_");
  if (["ready", "go", "fresh", "aligned", "passed"].includes(key)) return t("optionsStatusReady");
  if (["measured", "scored", "available"].includes(key)) return t("optionsStatusMeasured");
  if (["building", "building_history", "accruing", "insufficient_sample"].includes(key)) return t("optionsStatusBuilding");
  if (["blocked", "failed", "halted"].includes(key)) return t("optionsStatusBlocked");
  if (["pending", "unknown", "not_ready"].includes(key)) return t("optionsStatusPending");
  if (["shadow", "shadow_only", "display_only"].includes(key)) return t("optionsStatusShadow");
  if (["unavailable", "missing", "not_available"].includes(key)) return t("optionsStatusUnavailable");
  return lang === "zh" ? t("optionsStatusPending") : status.replaceAll("_", " ");
}

function statusTone(status: string | null): string {
  const key = (status ?? "").toLowerCase();
  if (/ready|fresh|aligned|passed|measured|scored/.test(key)) return "ready";
  if (/blocked|failed|halted|missing|unavailable/.test(key)) return "blocked";
  return "building";
}

function groupStatus(nodes: Array<ReadinessNode | null>): string | null {
  const statuses = nodes.map(readinessStatus).filter((value): value is string => value != null);
  if (!statuses.length) return null;
  const score = (value: string) => {
    const key = value.toLowerCase();
    if (/blocked|failed|halted|missing|unavailable/.test(key)) return 3;
    if (/building|pending|insufficient|accruing|shadow/.test(key)) return 2;
    return 1;
  };
  return [...statuses].sort((a, b) => score(b) - score(a))[0];
}

function groupDetail(nodes: Array<ReadinessNode | null>): string | null {
  for (const node of nodes) {
    const detail = readinessDetail(node);
    if (detail) return detail;
  }
  return null;
}

function ReadinessCard({
  label,
  caption,
  nodes,
  t,
  lang,
}: {
  label: string;
  caption: string;
  nodes: Array<ReadinessNode | null>;
  t: T;
  lang: Lang;
}) {
  const status = groupStatus(nodes);
  const detail = lang === "en" ? groupDetail(nodes) : null;
  return (
    <article className="obs-options-alpha-readiness-card">
      <div className="obs-options-alpha-readiness-head">
        <b>{label}</b>
        <span className={`obs-options-alpha-status ${statusTone(status)}`}>
          {localizedStatus(status, t, lang)}
        </span>
      </div>
      <p>{detail ?? caption}</p>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="obs-options-alpha-metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function ClockPair({
  decisionAt,
  availableAt,
  t,
}: {
  decisionAt: string | null;
  availableAt: string | null;
  t: T;
}) {
  return (
    <div className="obs-options-alpha-clocks">
      <div>
        <span>{t("optionsDecisionAt")}</span>
        {decisionAt
          ? <time dateTime={decisionAt}>{decisionAt}</time>
          : <b>{t("optionsClockUnavailable")}</b>}
      </div>
      <div>
        <span>{t("optionsAvailableAt")}</span>
        {availableAt
          ? <time dateTime={availableAt}>{availableAt}</time>
          : <b>{t("optionsClockUnavailable")}</b>}
      </div>
    </div>
  );
}

function laneLabel(value: string, t: T): string {
  if (value === "flow_leader") return t("optionsLaneFlowLeader");
  if (value === "flow_washout") return t("optionsLaneFlowWashout");
  if (value === "board_a") return t("optionsLaneBoardA");
  if (value === "board_b") return t("optionsLaneBoardB");
  return "—";
}

function engineLabel(value: string, t: T): string {
  if (value === "plab_flow_leader") return t("optionsLaneFlowLeader");
  if (value === "plab_flow_washout") return t("optionsLaneFlowWashout");
  return "—";
}

function OpportunityCard({ pick, lang, t }: { pick: OptionsAlphaOpportunity; lang: Lang; t: T }) {
  const reasons = lang === "en" && pick.why.length > 0 ? pick.why : [t("optionsFireEvidenceFallback")];
  const signing = signingLabel(pick.signing_source, t);
  return (
    <article className="obs-card obs-options-alpha-candidate is-fire" data-testid="options-alpha-fire">
      <div className="obs-options-alpha-candidate-head">
        <strong>{pick.symbol}</strong>
        <span className="obs-tag" style={{ "--c": "var(--up)" } as React.CSSProperties}>{t("optionsFireTag")}</span>
      </div>
      <div className="obs-options-alpha-candidate-meta">
        <span>{t("optionsLane")} {laneLabel(pick.lane, t)}</span>
        {pick.source_rank != null && <span>{t("optionsSourceRank")} #{pick.source_rank}</span>}
        {pick.fire_date && <span>{fmtDate(pick.fire_date, lang)}</span>}
        {signing && <span>{t("optionsSigning")} {signing}</span>}
      </div>
      <ClockPair decisionAt={pick.decision_at} availableAt={pick.available_at} t={t} />
      <div className="obs-options-alpha-metrics">
        <Metric label={t("optionsDirectionSoft")} value="—" />
        <Metric label={t("optionsReferenceClose")} value={pick.close_at_fire == null ? "—" : `$${fmtNumber(pick.close_at_fire, 2)}`} />
        <Metric label={t("optionsEvidence")} value={engineLabel(pick.engine_id, t)} />
        <Metric
          label={t("optionsSigningReliability")}
          value={sourceSigningReliability(pick.source_signing_reliable, t)}
        />
      </div>
      {!pick.source_signing_reliable && (
        <p className="obs-options-alpha-signing-note">{t("optionsFireSigningNote")}</p>
      )}
      {reasons.length > 0 && (
        <ul className="obs-options-alpha-why">
          {reasons.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
        </ul>
      )}
      <div className="obs-options-alpha-execution" data-testid="options-alpha-execution-withheld">
        <div>
          <b>{t("optionsExecutionWithheld")}</b>
          <span>{t("optionsExecutionBody")}</span>
        </div>
        <div className="obs-options-alpha-execution-grid">
          <Metric label={t("optionsContractStrikeExpiry")} value={t("optionsWithheldValue")} />
          <Metric label={t("optionsEntryReceipt")} value={t("optionsWithheldValue")} />
          <Metric label={t("stop")} value={t("optionsWithheldValue")} />
          <Metric label={t("optionsTargets")} value={t("optionsWithheldValue")} />
          <Metric label={t("optionsTakeProfitManagement")} value={t("optionsWithheldValue")} />
        </div>
      </div>
    </article>
  );
}

function oiLabel(value: boolean | null, t: T): string {
  if (value === true) return t("optionsOiYes");
  if (value === false) return t("optionsOiNo");
  return t("optionsOiPending");
}

function signingLabel(value: string | null, t: T): string | null {
  if (!value) return null;
  if (value === "tape") return t("optionsSigningTape");
  if (value === "minute_tick") return t("optionsSigningMinuteTick");
  if (value === "minute_bar") return t("optionsSigningMinuteBar");
  if (value === "bar") return t("optionsSigningBar");
  return null;
}

function gammaLabel(value: string | null, t: T): string {
  if (!value) return "—";
  if (value === "long") return t("optionsGammaLong");
  if (value === "short") return t("optionsGammaShort");
  return "—";
}

function sourceSigningReliability(value: boolean | null, t: T): string {
  if (value === true) return t("optionsSigningReliable");
  if (value === false) return t("optionsSigningUnreliable");
  return t("optionsSigningPending");
}

function WatchCard({ candidate, t }: { candidate: OptionsAlphaWatchCandidate; t: T }) {
  const obs = candidate.observations;
  const signing = signingLabel(candidate.signing_source, t);
  const deEscalationLabels: Record<string, string> = {
    earnings_window: t("optionsEarningsWindow"),
    vol_trade: t("optionsVolTrade"),
    protective_put: t("optionsProtectivePut"),
    gamma_caution: t("optionsGammaCaution"),
  };
  const activeDeEscalations = Object.entries(candidate.de_escalation)
    .filter(([, value]) => value !== false && value != null && value !== "")
    .map(([key]) => deEscalationLabels[key] ?? key.replaceAll("_", " "));
  const positions = [
    candidate.source_positions.board_a == null ? null : `${t("optionsLaneBoardA")} #${candidate.source_positions.board_a}`,
    candidate.source_positions.board_b == null ? null : `${t("optionsLaneBoardB")} #${candidate.source_positions.board_b}`,
  ].filter((value): value is string => value !== null);
  return (
    <article className="obs-card obs-options-alpha-candidate is-watch" data-testid="options-alpha-watch">
      <div className="obs-options-alpha-candidate-head">
        <strong>{candidate.symbol}</strong>
        <span className="obs-tag" style={{ "--c": "var(--warn)" } as React.CSSProperties}>{t("optionsWatchTag")}</span>
      </div>
      <div className="obs-options-alpha-candidate-meta">
        {candidate.order != null && <span>#{candidate.order}</span>}
        {candidate.lanes.length > 0 && <span>{t("optionsLane")} {candidate.lanes.map((lane) => laneLabel(lane, t)).join(" · ")}</span>}
        {positions.length > 0 && <span>{t("optionsSourcePositions")} {positions.join(" · ")}</span>}
        {signing && <span>{t("optionsSigning")} {signing}</span>}
      </div>
      <ClockPair decisionAt={candidate.decision_at} availableAt={candidate.available_at} t={t} />
      <div className="obs-options-alpha-metrics">
        <Metric label={t("optionsRecurrence")} value={obs.recurrence_count == null ? "—" : `${fmtNumber(obs.recurrence_count, 0)}×`} />
        <Metric
          label={candidate.source_signing_reliable === true ? t("optionsFlowZ") : t("optionsFlowMagnitudeOnly")}
          value={fmtNumber(
            optionsAlphaFlowDisplayValue(obs.flow_z, candidate.source_signing_reliable),
            2,
          )}
        />
        <Metric label={t("optionsNormPremium")} value={fmtNorm(obs.net_prem_norm_abs)} />
        <Metric label={t("optionsOi")} value={oiLabel(obs.oi_confirmed, t)} />
        <Metric label={t("optionsGamma")} value={gammaLabel(obs.gamma_regime, t)} />
        <Metric
          label={t("optionsSigningReliability")}
          value={sourceSigningReliability(candidate.source_signing_reliable, t)}
        />
        <Metric
          label={t("optionsInflectionAge")}
          value={obs.days_since_inflection == null ? "—" : `${fmtNumber(obs.days_since_inflection, 0)}${t("optionsDays")}`}
        />
      </div>
      {candidate.source_signing_reliable !== true && (
        <p className="obs-options-alpha-signing-note">{t("optionsFlowMagnitudeNote")}</p>
      )}
      {activeDeEscalations.length > 0 && (
        <div className="obs-options-alpha-deescalation">
          <b>{t("optionsDeescalated")}</b>
          <span>{activeDeEscalations.join(" · ")}</span>
        </div>
      )}
    </article>
  );
}

function PortfolioBoundary({ payload, t }: { payload: OptionsAlphaPayload; t: T }) {
  const batch = payload.selection_policy.target_batch_size;
  const batchLabel = batch.min == null || batch.max == null ? "—" : `${batch.min}–${batch.max}`;
  return (
    <section className="obs-options-alpha-boundary" data-testid="options-alpha-portfolio-boundary">
      <div className="obs-options-alpha-boundary-copy">
        <span>{t("optionsAbstentionFirst")}</span>
        <h3>{t("optionsPortfolioBoundary")}</h3>
        <p>{t("optionsPortfolioBoundaryBody")}</p>
      </div>
      <div className="obs-options-alpha-boundary-facts">
        <Metric label={t("optionsFutureBatch")} value={batchLabel} />
        <Metric label={t("optionsDecisionAt")} value={exactClock(payload.decision_at, t)} />
        <Metric label={t("optionsAvailableAt")} value={payload.available_at} />
      </div>
      <p className="obs-options-alpha-boundary-note">
        {payload.selection_policy.capacity_breach ? t("optionsCapacityBreach") : t("optionsAbstentionBody")}
      </p>
    </section>
  );
}

function AccrualSection({ payload, lang, t }: { payload: OptionsAlphaPayload; lang: Lang; t: T }) {
  const events = payload.accrual.events;
  const coverage = events?.timestamp_coverage;
  const distinctDates = optionsAlphaDistinctFireDates(events);
  return (
    <section className="obs-options-alpha-section" data-testid="options-alpha-accrual">
      <div className="obs-options-alpha-section-head">
        <h3>{t("optionsAccrual")}</h3>
        <span>{t("optionsAccrualSeparateNote")}</span>
      </div>
      <div className="obs-options-alpha-accrual-events">
        <div>
          <b>{t("optionsEventAccrual")}</b>
          <span>{events ? t("optionsAlphaAuthority") : t("optionsStatusUnavailable")}</span>
        </div>
        <Metric label={t("optionsPublishedNow")} value={fmtNumber(events?.published_now ?? null, 0)} />
        <Metric label={t("optionsDistinctDates")} value={fmtNumber(distinctDates, 0)} />
        <Metric label={t("optionsExactDecisionCoverage")} value={fmtNumber(coverage?.n_exact_decision_at ?? null, 0)} />
        <Metric label={t("optionsExactAvailableCoverage")} value={fmtNumber(coverage?.n_exact_available_at ?? null, 0)} />
      </div>
      <div className="obs-options-alpha-accrual-label">{t("optionsOutcomeAccrual")}</div>
      <div className="obs-options-alpha-horizons">
        {OPTIONS_ALPHA_OUTCOME_HORIZONS.map((horizon) => {
          const cell = payload.accrual.outcomes.horizons[horizon];
          const n = cell.instrumented
            ? cell.books.reduce((sum, book) => sum + (book.n ?? 0), 0)
            : null;
          return (
            <article key={horizon} className="obs-options-alpha-horizon" data-testid={`options-alpha-horizon-${horizon}`}>
              <div>
                <b>{horizon.toUpperCase()}</b>
                <span>{cell.instrumented ? localizedStatus(cell.status, t, lang) : t("optionsNotInstrumented")}</span>
              </div>
              <strong>{fmtNumber(n, 0)}</strong>
              <small>{cell.instrumented
                ? `${t("optionsDescriptiveOnly")} · ${cell.pit_exact === true ? t("optionsPitExact") : t("optionsPitLegacy")}`
                : t("optionsStatusUnavailable")}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function KonsekiContext({ payload, t }: { payload: OptionsAlphaPayload; t: T }) {
  const context = payload.context_inputs.konseki_market_memory;
  return (
    <section className="obs-options-alpha-konseki" data-testid="options-alpha-konseki">
      <div>
        <span>{t("optionsKonsekiContextOnly")}</span>
        <h3>{t("optionsKonseki")}</h3>
        <p>{t("optionsKonsekiBody")}</p>
      </div>
      <div className="obs-options-alpha-konseki-facts">
        <Metric
          label={t("optionsMemoryReceipt")}
          value={context.connected ? t("optionsKonsekiConnected") : t("optionsKonsekiDisconnected")}
        />
        <Metric label={t("optionsWeight")} value="0" />
        <Metric label={t("optionsDecisionAt")} value={exactClock(context.decision_at, t)} />
        <Metric label={t("optionsAvailableAt")} value={exactClock(context.available_at, t)} />
      </div>
    </section>
  );
}

function LedgerRow({ book, lang, t }: { book: ForwardLedgerBook; lang: Lang; t: T }) {
  const name = lang === "zh" ? book.name_zh ?? book.name_en : book.name_en ?? book.name_zh;
  return (
    <div className="obs-options-alpha-ledger-row" data-testid="options-alpha-ledger-row">
      <div className="obs-options-alpha-ledger-book">
        <b>{name ?? book.engine_id}</b>
        <span>{localizedStatus(book.status, t, lang)}</span>
      </div>
      <Metric label={t("optionsFires")} value={fmtNumber(book.n_fires, 0)} />
      <Metric label={t("optionsOpen")} value={fmtNumber(book.n_open, 0)} />
      <Metric label={t("optionsH5")} value={fmtNumber(book.h5_n, 0)} />
      <Metric label={t("optionsH21")} value={fmtNumber(book.h21_n, 0)} />
    </div>
  );
}

function Guardrails({ payload, lang, t }: { payload: OptionsAlphaPayload; lang: Lang; t: T }) {
  const weight = payload.macro_feedback.weight;
  return (
    <div className="obs-options-alpha-guards">
      <div>
        <span>{t("optionsMacroFeedback")}</span>
        <b>{payload.macro_feedback.enabled ? localizedStatus(payload.macro_feedback.mode, t, lang) : t("optionsFeedbackOff")}</b>
        <small>{t("optionsWeight")} {weight == null ? "—" : fmtNumber(weight, 2)}</small>
      </div>
      <div>
        <span>{t("optionsTrajectory")}</span>
        <b>{t("optionsTrajectoryWithheld")}</b>
        <small>{lang === "en" ? payload.trajectory.reason ?? t("optionsTrajectoryReason") : t("optionsTrajectoryReason")}</small>
      </div>
      <div>
        <span>{t("optionsDirectionSoft")}</span>
        <b>—</b>
        <small>{lang === "en" ? payload.direction.reason ?? t("optionsDirectionReason") : t("optionsDirectionReason")}</small>
      </div>
    </div>
  );
}


function measuredCopy(lang: Lang) {
  return lang === "zh" ? {
    title: "实测资金流证据",
    note: "成交位置与 NBBO 覆盖率仅为实测背景，不代表买方身份、客户意图、方向概率或交易评分。",
    unavailable: "当前快照没有可用的实测 NBBO 事件。",
    sourceClock: "来源时间",
    buildClock: "快照时间",
    coverage: "NBBO 权利金覆盖",
    prints: "有效报价成交",
    atAsk: "成交于卖价",
    atBid: "成交于买价",
    inside: "价差内成交",
    outside: "报价外成交",
    spread: "中位价差",
    quoteAge: "中位报价时延",
    volOi: "成交量 / 前一日 OI",
    available: "可用时间",
    contract: "精确合约",
    recent: "按可用时间显示最近事件，不按分数排序",
    loadFailed: "实测资金流来源暂不可用；研究影子数据仍可独立显示。",
  } : {
    title: "Measured flow evidence",
    note: "Trade location and NBBO coverage are measured context only — not buyer identity, customer intent, directional probability, or a trading score.",
    unavailable: "No measured NBBO events are available in this snapshot.",
    sourceClock: "Source as of",
    buildClock: "Snapshot as of",
    coverage: "NBBO premium coverage",
    prints: "Valid-NBBO prints",
    atAsk: "At ask",
    atBid: "At bid",
    inside: "Inside spread",
    outside: "Outside quote",
    spread: "Median spread",
    quoteAge: "Median quote age",
    volOi: "Volume / prior OI",
    available: "Available at",
    contract: "Exact contract",
    recent: "Latest by availability; not ranked or scored",
    loadFailed: "Measured-flow source is unavailable; the research shadow view remains independent.",
  };
}

function MeasuredEvidenceCard({
  event,
  lang,
}: {
  event: OptionsAlphaMeasuredEvent;
  lang: Lang;
}) {
  const copy = measuredCopy(lang);
  const micro = event.microstructure;
  const contract = event.root + " " + event.right + " " + fmtNumber(event.strike, 3)
    + " · " + fmtDate(event.expiration, lang);
  const printCoverage = String(micro.nbbo_valid_print_count) + "/" + String(micro.source_print_count);
  return (
    <article className="obs-card obs-options-alpha-candidate" data-testid="options-alpha-measured-event">
      <div className="obs-options-alpha-candidate-head">
        <strong>{event.root}</strong>
        <span className="obs-tag" style={{ "--c": "var(--muted)" } as React.CSSProperties}>
          {lang === "zh" ? "实测" : "Measured"}
        </span>
      </div>
      <div className="obs-options-alpha-candidate-meta">
        <span>{copy.contract} {contract}</span>
      </div>
      <div className="obs-options-alpha-metrics">
        <Metric label={copy.coverage} value={fmtPct(micro.nbbo_premium_coverage)} />
        <Metric label={copy.prints} value={printCoverage} />
        <Metric label={copy.atAsk} value={fmtPct(micro.at_ask_share)} />
        <Metric label={copy.atBid} value={fmtPct(micro.at_bid_share)} />
        <Metric label={copy.inside} value={fmtPct(micro.inside_share)} />
        <Metric label={copy.outside} value={fmtPct(micro.outside_share)} />
        <Metric
          label={copy.spread}
          value={micro.spread_median_usd == null ? "—" : "$" + fmtNumber(micro.spread_median_usd, 3)}
        />
        <Metric
          label={copy.quoteAge}
          value={micro.quote_age_median_ms == null ? "—" : fmtNumber(micro.quote_age_median_ms, 0) + " ms"}
        />
        <Metric label={copy.volOi} value={event.vol_gt_oi_ratio == null ? "—" : fmtNumber(event.vol_gt_oi_ratio, 2) + "×"} />
      </div>
      <div className="obs-options-alpha-clocks">
        <div>
          <span>{copy.available}</span>
          <time dateTime={event.available_at}>{event.available_at}</time>
        </div>
      </div>
    </article>
  );
}

function MeasuredEvidenceSection({
  feed,
  failed,
  lang,
}: {
  feed: OptionsAlphaMeasuredFeed | null;
  failed: boolean;
  lang: Lang;
}) {
  const copy = measuredCopy(lang);
  const visible = feed?.events.slice(0, 6) ?? [];
  return (
    <section className="obs-options-alpha-section" data-testid="options-alpha-measured-evidence">
      <div className="obs-options-alpha-section-head">
        <div>
          <h3>{copy.title}</h3>
          <small>{copy.recent}</small>
        </div>
        <span>{visible.length}</span>
      </div>
      <p className="obs-options-alpha-footnote">{copy.note}</p>
      {feed && (
        <div className="obs-options-alpha-accrual-events">
          <Metric label={copy.sourceClock} value={feed.source_asof ?? "—"} />
          <Metric label={copy.buildClock} value={feed.asof ?? "—"} />
        </div>
      )}
      {visible.length > 0 ? (
        <div className="obs-options-alpha-candidate-grid">
          {visible.map((event) => <MeasuredEvidenceCard key={event.id} event={event} lang={lang} />)}
        </div>
      ) : (
        <p className="obs-options-alpha-empty">{failed ? copy.loadFailed : copy.unavailable}</p>
      )}
    </section>
  );
}

export function OptionsAlphaView() {
  const { lang } = useLang();
  const t = makeProphetT(lang);
  const [payload, setPayload] = useState<OptionsAlphaPayload | null>(null);
  const [measuredFeed, setMeasuredFeed] = useState<OptionsAlphaMeasuredFeed | null>(null);
  const [measuredError, setMeasuredError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const normalized = normalizeOptionsAlphaPayload(await flowGet("options_prophet_idx"));
      if (!normalized) throw new Error("empty options alpha payload");
      setPayload(normalized);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMeasured = useCallback(async () => {
    try {
      const normalized = normalizeOptionsAlphaMeasuredFeed(await flowGetFresh("feed"));
      if (!normalized) throw new Error("invalid measured-flow feed");
      setMeasuredFeed(normalized);
      setMeasuredError(false);
    } catch {
      setMeasuredError(true);
    }
  }, []);

  useEffect(() => {
    // Initializing the external evidence feeds is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    fetchMeasured();
    const timer = window.setInterval(fetchMeasured, 30_000);
    return () => window.clearInterval(timer);
  }, [fetchData, fetchMeasured]);

  if (loading && !payload) return <div className="obs-options-alpha-state">{t("loading")}</div>;
  if (error && !payload) {
    return (
      <div className="obs-options-alpha-state">
        <span>{t("optionsLoadError")}</span>
        <button className="obs-chip" onClick={fetchData}>{t("retry")}</button>
      </div>
    );
  }
  if (!payload) return null;

  // These are producer-owned lifecycle assessments. Do not synthesize readiness
  // by re-bucketing lower-level engines in the browser.
  const infoNodes = [payload.readiness.components.information];
  const positioningNodes = [payload.readiness.components.positioning];
  const executionNodes = [payload.readiness.components.execution];
  const attribution = payload.forward_ledgers.incremental_options_attribution;
  const visibleWatchlist = compactOptionsWatchlist(payload.watchlist);
  const watchCount = t("optionsShowing")
    .replace("{shown}", String(visibleWatchlist.length))
    .replace("{total}", String(payload.watchlist.length));

  return (
    <section className="obs-options-alpha" data-testid="options-alpha-desk">
      <header className="obs-options-alpha-head">
        <div className="obs-options-alpha-title">
          <span>{t("optionsAlphaEyebrow")}</span>
          <div>
            <h2>{t("optionsAlphaTitle")}</h2>
            <span className="obs-tag" style={{ "--c": "var(--warn)" } as React.CSSProperties}>{t("optionsAlphaAuthority")}</span>
          </div>
          <p>{t("optionsAlphaProvenance")}</p>
        </div>
        <div className="obs-options-alpha-kpis">
          <Metric label={t("optionsTrueFires")} value={fmtNumber(payload.opportunities.length, 0)} />
          <Metric label={t("optionsResearchQueue")} value={fmtNumber(payload.watchlist.length, 0)} />
          <Metric label={t("optionsAvailableAt")} value={payload.available_at} />
          <Metric label={t("optionsShadow")} value={localizedStatus(payload.mode, t, lang)} />
        </div>
      </header>

      <div className="obs-options-alpha-scroll obs-scroll">
        {payload.stale && (
          <div className="obs-options-alpha-stale" role="status" data-testid="options-alpha-stale">
            <b>{t("optionsStaleTitle")}</b>
            <span>{t("optionsStaleBody")}</span>
          </div>
        )}
        <PortfolioBoundary payload={payload} t={t} />

        <section className="obs-options-alpha-section" data-testid="options-alpha-fires-section">
          <div className="obs-options-alpha-section-head">
            <h3>{t("optionsTrueFires")}</h3>
            <span>{payload.opportunities.length}</span>
          </div>
          {payload.opportunities.length > 0 ? (
            <div className="obs-options-alpha-candidate-grid">
              {payload.opportunities.map((pick, index) => (
                <OpportunityCard key={`${pick.engine_id ?? pick.lane}-${pick.symbol}-${index}`} pick={pick} lang={lang} t={t} />
              ))}
            </div>
          ) : <p className="obs-options-alpha-empty">{t("optionsNoFires")}</p>}
        </section>

        <MeasuredEvidenceSection feed={measuredFeed} failed={measuredError} lang={lang} />

        <AccrualSection payload={payload} lang={lang} t={t} />

        <Guardrails payload={payload} lang={lang} t={t} />

        <section className="obs-options-alpha-section" data-testid="options-alpha-readiness">
          <div className="obs-options-alpha-section-head">
            <h3>{t("optionsReadiness")}</h3>
          </div>
          <div className="obs-options-alpha-readiness-grid">
            <ReadinessCard label={t("optionsInformation")} caption={t("optionsInfoNote")} nodes={infoNodes} t={t} lang={lang} />
            <ReadinessCard label={t("optionsPositioning")} caption={t("optionsPositioningNote")} nodes={positioningNodes} t={t} lang={lang} />
            <ReadinessCard label={t("optionsExecution")} caption={t("optionsExecutionNote")} nodes={executionNodes} t={t} lang={lang} />
          </div>
        </section>

        <KonsekiContext payload={payload} t={t} />

        {payload.watchlist.length > 0 ? (
          <details className="obs-options-alpha-section obs-options-alpha-research" data-testid="options-alpha-research-queue">
            <summary>
              <div>
                <h3>{t("optionsResearchQueue")}</h3>
                <small>{t("optionsResearchQueueSummary")}</small>
              </div>
              <span>{watchCount}</span>
            </summary>
            <div className="obs-options-alpha-candidate-grid">
              {visibleWatchlist.map((candidate, index) => (
                <WatchCard key={`${candidate.symbol}-${candidate.order ?? index}`} candidate={candidate} t={t} />
              ))}
            </div>
          </details>
        ) : (
          <section className="obs-options-alpha-section">
            <div className="obs-options-alpha-section-head"><h3>{t("optionsResearchQueue")}</h3></div>
            <p className="obs-options-alpha-empty">{t("optionsNoWatchlist")}</p>
          </section>
        )}

        <section className="obs-options-alpha-section">
          <div className="obs-options-alpha-section-head">
            <h3>{t("optionsForward")}</h3>
            {!attribution.available && <span>{t("optionsAttributionUnavailable")}</span>}
          </div>
          {payload.forward_ledgers.books.length > 0 ? (
            <div className="obs-options-alpha-ledger">
              {payload.forward_ledgers.books.map((book) => (
                <LedgerRow key={book.engine_id} book={book} lang={lang} t={t} />
              ))}
            </div>
          ) : <p className="obs-options-alpha-empty">{t("optionsNoLedger")}</p>}
          {!attribution.available && (
            <p className="obs-options-alpha-footnote">
              {lang === "en" ? attribution.reason ?? t("optionsAttributionReason") : t("optionsAttributionReason")}
            </p>
          )}
        </section>

        {payload.method_note && (
          <footer className="obs-options-alpha-method">
            <b>{t("optionsMethod")}</b>
            <span>{lang === "en" ? payload.method_note : t("optionsMethodFallback")}</span>
          </footer>
        )}
      </div>
    </section>
  );
}
