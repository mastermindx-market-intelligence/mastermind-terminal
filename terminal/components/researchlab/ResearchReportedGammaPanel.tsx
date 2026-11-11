"use client";
/**
 * Replay-lens panel for the matched reported-Gamma comparison.
 *
 * A pure consumer: the incumbent Market Memory owner supplies its READY
 * validated bound snapshots and this read's explicit origin clock, and the
 * panel answers one question — does the exactly selected contract have a
 * qualified reported-Gamma change between the two dated snapshots — through
 * the incumbent `buildResearchReportedGamma` view-model and its incumbent
 * comparator.
 *
 * Deliberately NOT done here: no fetch, store, clock, fingerprint, valuation
 * or persistence; no per-option gamma claim (these are reported aggregate
 * dollars under the incumbent sign convention); no velocity, percentage,
 * point-in-time or trading-flow attribution; no zero fill for absent or
 * unqualified members; no substitution of another row or strike; no CSS or
 * palette of its own — only the existing OptionsCompanion inspector classes.
 */
import { useMemo } from "react";
import type { Lang } from "@/lib/i18n";
import { formatExposureMn, type CompanionGexSnapshot } from "@/lib/optionsCompanion";
import { optionsT } from "@/components/options-companion/optionsStrings";
import styles from "@/components/options-companion/OptionsCompanion.module.css";
import type { ResearchRow } from "./researchLabAdapter";
import { buildResearchReportedGamma } from "./researchReportedGamma";

const LEX = {
  title: ["Reported Gamma comparison", "已报告 Gamma 比较"],
  basis: ["Matched reported contracts · reported Gamma dollars", "匹配的已报告合约 · 已报告 Gamma 美元"],
  selected: ["Selected contract", "所选合约"],
  matchedNet: ["Matched net", "匹配净值"],
  call: ["Call", "看涨"], put: ["Put", "看跌"],
  sourceKeys: ["Report source keys", "报告来源键"],
  availability: ["Recorded availability", "记录的可得时间"],
  noSelection: ["Select a coordinate to compare its reported contributions.", "选择一个坐标以比较其已报告贡献。"],
  foreign: ["The selected coordinate is outside this comparison context.", "所选坐标不在此比较范围内。"],
  memberAbsent: ["The selected contract is not reported on both sessions. No change is shown.", "所选合约未在两个交易日同时报告，因此不显示变化。"],
  memberUnqualified: ["The selected contract has no qualified reported value on one session. No change is shown.", "所选合约在某一个交易日没有合格的已报告数值，因此不显示变化。"],
  sessionUnknown: ["The matrix source session is unknown. Comparison withheld.", "期权矩阵交易日未知，已暂停比较。"],
  rootMismatch: ["The supplied source does not describe this instrument. Comparison withheld.", "所提供的数据源不属于此标的，已暂停比较。"],
  sessionMismatch: ["The supplied source describes a different session. Comparison withheld.", "所提供的数据源属于其他交易日，已暂停比较。"],
} as const;

/** Reported dollars stay in the incumbent unit-aware memory formatter. Unknown is never 0. */
const usd = (value: number | null) => value == null ? "—" : formatExposureMn(value / 1_000_000);

export function ResearchReportedGammaPanel({ root, matrixSession, current, previous, originMs, selected, lang }: {
  root: string;
  /** The Lab's known matrix source session, or null when unknown. */
  matrixSession: string | null;
  /** The memory owner's validated, fingerprint-bound snapshots. */
  current: CompanionGexSnapshot;
  previous: CompanionGexSnapshot;
  /** The origin clock of the read that produced the bound pair. */
  originMs: number;
  /** The exact selected coordinate row, or null when nothing is pinned. */
  selected: ResearchRow | null;
  lang: Lang;
}) {
  const pick = (key: keyof typeof LEX) => LEX[key][lang === "zh" ? 1 : 0];
  const mem = optionsT(lang);
  const view = useMemo(() => buildResearchReportedGamma(
    current.measurement?.reportedGamma ?? null,
    previous.measurement?.reportedGamma ?? null,
    { root, matrixSession, originMs, selected },
  ), [current, previous, root, matrixSession, originMs, selected]);
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const interval = <div className={styles.memoryInterval}>
    <time dateTime={previous.session}>{previous.session}</time>
    <span aria-hidden="true">→</span>
    <time dateTime={current.session}>{current.session}</time>
  </div>;
  const heading = <div className={styles.memoryMatchedHeading}>
    <strong>{pick("title")}</strong>
    <b>{view.state === "data"
      ? `${view.comparison.aggregate.contracts.toLocaleString(locale)} ${mem("memoryMatchedContracts")}` : null}</b>
  </div>;
  const plain = <p className={styles.memoryPlain}>{mem("memoryMatchedPlain")}</p>;

  if (view.state === "withheld") {
    return <div data-testid="research-reported-gamma" data-comparison-state="withheld" data-reason={view.reason}
      className={styles.memoryWithheld}>
      {heading}{interval}
      <p role="status" className={styles.scopeHint}>
        {pick(view.reason === "context_session_unknown" ? "sessionUnknown"
          : view.reason === "context_root_mismatch" ? "rootMismatch" : "sessionMismatch")}
      </p>
      {plain}
    </div>;
  }

  if (view.state === "unavailable") {
    return <div data-testid="research-reported-gamma" data-comparison-state="unavailable" data-reason={view.reason}
      className={styles.memoryWithheld}>
      {heading}{interval}
      <p role="status">{mem(view.reason === "missing_basis" ? "memoryMissingComparison"
        : view.reason === "identity" ? "memoryIdentityMismatch"
        : view.reason === "scope" ? "memoryScopeMismatch"
        : view.reason === "definition" ? "memoryDefinitionMismatch"
        : view.reason === "time" ? "memoryTimeMismatch"
        : view.reason === "malformed" ? "memoryInvalidComparison"
        : "memoryNoMatch")}</p>
      {plain}
    </div>;
  }

  // The incumbent comparator's refusal words are reused verbatim above; only
  // the data state renders the dollar readout, always labeled by its basis.
  const pin = view.pin;
  const pinCell = pin.pin === "pinned" ? <div data-testid="research-reported-gamma-pin" data-pin-state="pinned">
    <span>{pick("selected")} · {pin.coordinates.strike.toLocaleString(locale)} {pick(pin.coordinates.right === "C" ? "call" : "put")} · {pin.coordinates.expiry}</span>
    <b>{usd(pin.previousValueUsd)} → {usd(pin.currentValueUsd)}</b>
    <small>{mem("memoryDelta")} · {usd(pin.signedChangeUsd)}</small>
  </div> : <div data-testid="research-reported-gamma-pin" data-pin-state={pin.reason}>
    <span>{pick("selected")}</span>
    <b>—</b>
    <small role="status">{pick(pin.reason === "no_selection" ? "noSelection"
      : pin.reason === "foreign_selection" ? "foreign"
      : pin.reason === "member_absent" ? "memberAbsent" : "memberUnqualified")}</small>
  </div>;
  return <div data-testid="research-reported-gamma" data-comparison-state="data" className={styles.matchedChange}>
    {heading}{interval}
    <p className={styles.memoryUnit}>{pick("basis")} · {mem("memoryGammaUnit")}</p>
    <div className={styles.nodeStats}>
      {pinCell}
      <div>
        <span>{pick("matchedNet")}</span>
        <b>{usd(view.comparison.aggregate.previousNetUsd)} → {usd(view.comparison.aggregate.currentNetUsd)}</b>
        <small>{mem("memoryDelta")} · {usd(view.comparison.aggregate.signedChangeUsd)}</small>
      </div>
    </div>
    {plain}
    <p className={styles.scopeHint}>{mem("memoryReportedLimits")}</p>
    <details className={styles.memoryDetails} data-testid="research-reported-gamma-details">
      <summary>{mem("memorySourceDetails")}</summary>
      <div className={styles.memoryDetailBody}>
        <dl className={styles.memoryCoverage} aria-label={pick("sourceKeys")}>
          <div><dt>{view.previousSession}</dt><dd>{view.comparison.previousKey}</dd></div>
          <div><dt>{view.currentSession}</dt><dd>{view.comparison.currentKey}</dd></div>
        </dl>
        <dl className={styles.memoryCoverage} aria-label={pick("availability")}>
          <div><dt>{view.previousSession}</dt><dd><time dateTime={previous.measurement?.reportedGamma?.availableAt}>
            {previous.measurement?.reportedGamma?.availableAt ?? mem("memoryUnavailableEither")}</time></dd></div>
          <div><dt>{view.currentSession}</dt><dd><time dateTime={current.measurement?.reportedGamma?.availableAt}>
            {current.measurement?.reportedGamma?.availableAt ?? mem("memoryUnavailableEither")}</time></dd></div>
        </dl>
        <dl className={styles.memoryCoverage} aria-label={mem("memorySourceCoverage")}>
          <div><dt>{mem("memoryObservedCounts")}</dt>
            <dd>{view.comparison.population.previousObserved.toLocaleString(locale)} → {view.comparison.population.currentObserved.toLocaleString(locale)}</dd></div>
          <div><dt>{mem("memoryQualifiedCounts")}</dt>
            <dd>{view.comparison.population.previousQualified.toLocaleString(locale)} → {view.comparison.population.currentQualified.toLocaleString(locale)}</dd></div>
          <div><dt>{mem("memoryReportedOnly")}</dt>
            <dd>{view.comparison.population.previousOnlyReported.toLocaleString(locale)} / {view.comparison.population.currentOnlyReported.toLocaleString(locale)}</dd></div>
        </dl>
        <p className={styles.scopeHint}>{mem("memorySignConvention")}</p>
      </div>
    </details>
  </div>;
}
