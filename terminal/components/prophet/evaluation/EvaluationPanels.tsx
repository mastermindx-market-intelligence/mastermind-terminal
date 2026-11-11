"use client";
/**
 * EvaluationPanels.tsx — the four SX12 disclosure bodies for the Strategy
 * Evaluation surface. Rendered inside one MobileSheet (drawer on mobile,
 * right-side panel ≥1080px via prophetEvaluation.css).
 *
 * LAWS
 *  - Every number comes from the decoded artifact; formatting only.
 *  - Engine-published prose (definitions, cap rule, headline, limitations,
 *    method text, peer reasons) is rendered VERBATIM (English); in ZH a note
 *    explains those fields are the engine's own words.
 *  - No alpha / outperformance / edge / recommendation language anywhere.
 */
import Link from "next/link";
import type { Lang } from "@/lib/i18n";
import {
  comparatorShortName, exclusionReasonLabel, criterionLabel, fillTemplate,
  getEvaluationStr, makeEvaluationT, releaseJobName, evaluationLevelLabel,
  type EvaluationLexKey,
} from "@/lib/prophetEvaluationStrings";
import {
  fmtCount, fmtPercent, fmtSignedPp, fmtCi95, fmtDate,
  fmtCriterionObserved,
} from "@/lib/prophetBetaEvaluationFormat";
import {
  INCUMBENT_COMPARATOR_ID, orderedComparators,
  type AttributionBook, type BetaEvaluation, type ReleaseCriterion,
} from "@/lib/prophetBetaEvaluation";
import { WaterfallChart } from "./evaluationCharts";

export type PanelKey = "details" | "attribution" | "coverage" | "portfolio";

export const EVALUATION_PANELS: Array<{ key: PanelKey; titleKey: EvaluationLexKey }> = [
  { key: "details", titleKey: "disclosureDetails" },
  { key: "attribution", titleKey: "disclosureAttribution" },
  { key: "coverage", titleKey: "disclosureCoverage" },
  { key: "portfolio", titleKey: "disclosurePortfolio" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pev-panel-sec">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="pev-field">
      <span className="pev-field-k">{label}</span>
      <span className="pev-field-v">{value}</span>
    </div>
  );
}

/** Engine-published English prose: verbatim + (in ZH) a one-time note. */
function Verbatim({ children, lang }: { children: React.ReactNode; lang: Lang }) {
  return (
    <div className="pev-verbatim">
      <div className="pev-verbatim-body">{children}</div>
      {lang === "zh" && <p className="pev-verbatim-note">{getEvaluationStr(lang, "zhVerbatimNote")}</p>}
    </div>
  );
}

function CriteriaTable({ rows, lang }: { rows: ReleaseCriterion[]; lang: Lang }) {
  const t = makeEvaluationT(lang);
  return (
    <div className="pev-table-scroll">
      <table className="pev-table">
        <thead>
          <tr>
            <th>{t("criterionCol")}</th><th>{t("requiredLabel")}</th><th>{t("observedLabel")}</th><th aria-label={t("statusLabel")} />
          </tr>
        </thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.criterion}>
              <td>{criterionLabel(lang, c.criterion)}</td>
              <td className="pev-num">{c.required}</td>
              <td className="pev-num">{fmtCriterionObserved(c.criterion, c.observed)}</td>
              <td className={`pev-chip ${c.met === null ? "is-unknown" : c.met ? "is-met" : "is-not"}`}>
                {c.met === null ? "—" : c.met ? t("metLabel") : t("notMetLabel")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DetailsPanel({ data, lang }: { data: BetaEvaluation; lang: Lang }) {
  const t = makeEvaluationT(lang);
  const { protocol, code, dataClocks, basis, window, release, claims, deviations } = data;
  return (
    <div className="pev-panel-body">
      <Section title={t("protocolTitle")}>
        <Field label={t("frozenOn")} value={fmtDate(protocol.frozenOn)} />
        <Field label={t("headerSha")} value={<span className="pev-mono">{protocol.headerSha256.slice(0, 16)}…</span>} />
        <Field label="id" value={<span className="pev-mono">{protocol.id}</span>} />
      </Section>
      <Section title={t("codeTitle")}>
        <Field label={t("codeCommit")} value={<span className="pev-mono">{code.commit.slice(0, 10)}</span>} />
        <Field label={t("codeModule")} value={<span className="pev-mono">{code.module}</span>} />
        <Field label={t("codeRunner")} value={<span className="pev-mono">{code.runner}</span>} />
        <Field label={t("codeHarness")} value={t("wordFalse")} />
      </Section>
      <Section title={t("statsTitle")}>
        <p>{fillTemplate(t("bootstrapLine"), {
          b: fmtCount(code.bootstrap.b), seed: fmtCount(code.bootstrap.seed),
          mean: fmtCount(code.bootstrap.meanBlock), sens: fmtCount(code.bootstrap.sensitivityBlock),
        })}</p>
        <p>{t("holmLine")}</p>
        <Verbatim lang={lang}><p>{data.contrasts.family}</p></Verbatim>
      </Section>
      <Section title={t("basisTitle")}>
        <Field label={t("basisMarket")} value={basis.market} />
        <Field label={t("basisBenchmark")} value={basis.benchmark} />
        <Field label={t("basisCurrency")} value={basis.currency} />
        <Field label={t("basisReturn")} value={basis.returnBasis} />
        <Field label={t("basisCash")} value={basis.cashInstrument} />
        <Field label={t("basisCosts")} value={`${basis.costsBpPerSide.etf} / ${basis.costsBpPerSide.stock}`} />
        <Field label={t("windowLabel")} value={`${fmtDate(window.firstReturnClose)} → ${fmtDate(window.lastClose)} · ${fmtCount(window.sessions)} ${t("sessionsUnit")}`} />
      </Section>
      <Section title={t("colComparator")}>
        <ul className="pev-defs">
          {orderedComparators(data.comparators).map(row => (
            <li key={row.id}>
              <b>{comparatorShortName(lang, row.id, row.label)}</b>
              {row.status === "evaluated" && row.definition
                ? <Verbatim lang={lang}><span>{row.definition}</span></Verbatim>
                : <span className="pev-dim">{fillTemplate(t("rowUnavailable"), { reason: row.reason ?? "" })}</span>}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("jobsCriteriaTitle")}>
        <p className="pev-dim">
          {evaluationLevelLabel(lang, release.overallLevel)}
          {release.globalMinimumMet ? "" : ` · ${t("capNote")}`}
        </p>
        {release.jobs.map(job => (
          <div key={job.key} className="pev-job">
            <h5>{releaseJobName(lang, job.key)} — {evaluationLevelLabel(lang, job.level)}</h5>
            <CriteriaTable rows={job.criteria} lang={lang} />
          </div>
        ))}
        <h5>{t("globalMinimumTitle")}</h5>
        <CriteriaTable rows={release.globalMinimumForL1} lang={lang} />
        <h5>{t("l0ChecksTitle")}</h5>
        <CriteriaTable rows={release.l0SourceChecks} lang={lang} />
        <Verbatim lang={lang}>
          <p><b>{t("capRuleTitle")}</b> {release.capRule}</p>
          <p><b>{t("l2l3Title")}</b> {release.l2L3Note}</p>
        </Verbatim>
      </Section>
      <Section title={t("claimsTitle")}>
        <div className="pev-table-scroll">
          <table className="pev-table">
            <thead><tr><th>{t("statusLabel")}</th><th /></tr></thead>
            <tbody>
              {claims.map(c => (
                <tr key={c.key}>
                  <td><span className="pev-mono">{c.key}</span><span className="pev-chip is-unknown">{c.status}</span></td>
                  <td className="pev-dim">{c.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={t("deviationsTitle")}>
        <Verbatim lang={lang}>
          <ol className="pev-defs">
            {deviations.map(d => (
              <li key={d.id}><b>{d.id} · {d.kind} · {d.when}</b><span>{d.what}</span><span className="pev-dim">{d.why}</span></li>
            ))}
          </ol>
        </Verbatim>
      </Section>
      <Section title={t("engineSummaryTitle")}>
        <Verbatim lang={lang}>
          <ol className="pev-defs pev-headline-list">{data.headline.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </Verbatim>
      </Section>
      <Section title={t("limitationsTitle")}>
        <Verbatim lang={lang}>
          <ul className="pev-defs">{data.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Verbatim>
      </Section>
      <Section title={t("clocksTitle")}>
        <Field label={t("clockMacro")} value={<span className="pev-mono">{dataClocks.macroDataCommit.slice(0, 10)}</span>} />
        <Field label={t("clockPlans")} value={`${fmtDate(dataClocks.plansIndex.asof)} · ${dataClocks.plansIndex.sha256.slice(0, 12)}…`} />
        <Field label={t("clockResolution")} value={`${fmtDate(dataClocks.resolutionLog.maxAsof)} · ${fmtCount(dataClocks.resolutionLog.rows)} rows`} />
        <Field label={t("clockPit")} value={`${fmtDate(dataClocks.pitMembership.lastRecordedChange)} · ${dataClocks.pitMembership.sha256.slice(0, 12)}…`} />
        <Field label={t("clockPrices")} value={`${dataClocks.prices.source} · ${fmtDate(dataClocks.prices.lastCloseUsed)}`} />
      </Section>
    </div>
  );
}

const BRIDGE_ROWS: Array<{ key: EvaluationLexKey; pick: (b: AttributionBook["bridge"]) => number }> = [
  { key: "bridgeBenchmark", pick: b => b.benchmark },
  { key: "bridgeUninvested", pick: b => b.uninvestedMarketShortfall },
  { key: "bridgeSector", pick: b => b.sectorAllocation },
  { key: "bridgeSelection", pick: b => b.selectionWithinSector },
  { key: "bridgeCash", pick: b => b.cash },
  { key: "bridgeCosts", pick: b => b.costs },
];

export function AttributionPanel({ data, lang }: { data: BetaEvaluation; lang: Lang }) {
  const t = makeEvaluationT(lang);
  const primary = data.attribution.find(entry => entry.bookId === INCUMBENT_COMPARATOR_ID);
  if (!primary) return null;
  const book = primary.book;
  const wfKeys: Record<string, EvaluationLexKey> = {
    benchmark: "wfBenchmark", uninvested: "wfUninvested", sector: "wfSector",
    selection: "wfSelection", cash: "wfCash", costs: "wfCosts", strategy: "wfStrategy",
  };
  const bars = [
    { key: "benchmark", label: t(wfKeys.benchmark), value: book.bridge.benchmark, kind: "base" as const },
    { key: "uninvested", label: t(wfKeys.uninvested), value: book.bridge.uninvestedMarketShortfall, kind: "delta" as const },
    { key: "sector", label: t(wfKeys.sector), value: book.bridge.sectorAllocation, kind: "delta" as const },
    { key: "selection", label: t(wfKeys.selection), value: book.bridge.selectionWithinSector, kind: "delta" as const },
    { key: "cash", label: t(wfKeys.cash), value: book.bridge.cash, kind: "delta" as const },
    { key: "costs", label: t(wfKeys.costs), value: book.bridge.costs, kind: "delta" as const },
    { key: "strategy", label: t(wfKeys.strategy), value: book.bridge.strategy, kind: "total" as const },
  ];
  const others = data.attribution.filter(entry => entry.bookId !== INCUMBENT_COMPARATOR_ID);
  return (
    <div className="pev-panel-body">
      <Section title={t("attributionMethodLabel")}>
        <Verbatim lang={lang}>
          <p>{book.method} · {book.linking} · {book.unit}</p>
        </Verbatim>
        <p>{t("bridgeIdentity")}</p>
        <p className="pev-dim">{t("modelBookNote")}</p>
      </Section>
      <Section title={t("bridgeTitle")}>
        <WaterfallChart bars={bars} ariaLabel={t("bridgeTitle")} />
        <p className="pev-dim">{t("tableIsAlternative")}</p>
        <div className="pev-table-scroll">
          <table className="pev-table">
            <thead><tr><th>{t("colComparator")}</th><th>{fillTemplate(t("colVsSpy"), { benchmark: data.basis.benchmark })}</th></tr></thead>
            <tbody>
              {BRIDGE_ROWS.map(row => (
                <tr key={row.key}>
                  <td>{row.key === "bridgeBenchmark"
                    ? fillTemplate(t(row.key), { benchmark: data.basis.benchmark })
                    : t(row.key)}</td>
                  <td className="pev-num">{fmtSignedPp(row.pick(book.bridge))}</td>
                </tr>
              ))}
              <tr className="pev-row-strong">
                <td>{t("bridgeStrategy")}</td>
                <td className="pev-num">{fmtSignedPp(book.bridge.strategy)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>{fillTemplate(t("compoundingNote"), {
          sum: fmtSignedPp(book.sumOfDailyNetReturns), total: fmtSignedPp(book.compoundedTotalNetReturn),
          residual: fmtSignedPp(book.compoundingResidual),
        })}</p>
        <p>{fillTemplate(t("identityErrorNote"), { value: (book.identityError * 100).toFixed(4) })}</p>
      </Section>
      {others.length > 0 && (
        <Section title={t("otherBooksTitle")}>
          <div className="pev-table-scroll">
            <table className="pev-table">
              <thead>
                <tr>
                  <th>{t("colComparator")}</th>
                  {BRIDGE_ROWS.map(r => (
                    <th key={r.key}>{r.key === "bridgeBenchmark"
                      ? fillTemplate(getEvaluationStr(lang, r.key), { benchmark: data.basis.benchmark })
                      : getEvaluationStr(lang, r.key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {others.map(entry => (
                  <tr key={entry.bookId}>
                    <td>{comparatorShortName(lang, entry.bookId, entry.bookId)}</td>
                    {BRIDGE_ROWS.map(r => (
                      <td key={r.key} className="pev-num">{fmtSignedPp(r.pick(entry.book.bridge))}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <Section title={t("concurrentTitle")}>
        {(() => {
          const post = data.postHocDiagnostics.books.find(entry => entry.bookId === INCUMBENT_COMPARATOR_ID);
          if (!post) return null;
          return (
            <p className="pev-num">
              {fmtCount(post.book.concurrentPositions.min)} / {fmtCount(post.book.concurrentPositions.median)} / {fmtCount(post.book.concurrentPositions.max)}
            </p>
          );
        })()}
      </Section>
    </div>
  );
}

export function CoveragePanel({ data, lang }: { data: BetaEvaluation; lang: Lang }) {
  const t = makeEvaluationT(lang);
  const c6 = data.comparators.find(row => row.id === INCUMBENT_COMPARATOR_ID) ?? null;
  const { coverage } = data;
  return (
    <div className="pev-panel-body">
      <Section title={t("coveragePlansTitle")}>
        <p>
          {t("coverageEraPlans")}: <b>{fmtCount(coverage.eraPlans)}</b> · {t("coverageEvaluated")}: <b>{fmtCount(coverage.evaluatedPositions)}</b>
        </p>
        <p className="pev-dim">
          {t("crit_era_plans_classified_share")}: {fmtPercent(coverage.classifiedShare)} · {t("crit_entered_positions_priced_share")}: {fmtPercent(coverage.pricedShare)}
        </p>
      </Section>
      <Section title={t("coverageExcludedTitle")}>
        <div className="pev-table-scroll">
          <table className="pev-table">
            <thead><tr><th>{t("statusLabel")}</th><th>{t("observedLabel")}</th></tr></thead>
            <tbody>
              {coverage.excluded.map(row => (
                <tr key={row.reason}>
                  <td>{exclusionReasonLabel(lang, row.reason)}</td>
                  <td className="pev-num">{fmtCount(row.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={t("coverageExitTitle")}>
        <ul className="pev-defs">
          <li><b>{fmtCount(coverage.exitBasis.recordedCloseDate)}</b> {t("exitRecorded")}</li>
          <li><b>{fmtCount(coverage.exitBasis.mechanicalPublishedLevels)}</b> {t("exitMechanical")}</li>
          <li><b>{fmtCount(coverage.exitBasis.censoredOpenAtWindowEnd)}</b> {t("exitCensored")}</li>
        </ul>
      </Section>
      <Section title={t("coverageMembershipTitle")}>
        <p>{fillTemplate(t("caveatRosterBody"), {
          date: fmtDate(data.dataClocks.pitMembership.lastRecordedChange), n: fmtCount(coverage.memberUniverseMissingPriceFiles.length),
        })}</p>
        <p className="pev-dim">{t("coverageTickersTitle")}:</p>
        <p className="pev-tickers">{coverage.memberUniverseMissingPriceFiles.join(" · ")}</p>
        <div className="pev-table-scroll">
          <table className="pev-table">
            <thead>
              <tr>
                <th>{t("rbDecision")}</th><th>{t("rbExecution")}</th><th>{t("rbPitActive")}</th>
                <th>{t("rbNoPrice")}</th><th>{t("rbNoSector")}</th><th>{t("rbShort")}</th><th>{t("rbBelowMin")}</th>
                <th>{t("rbEligible")}</th><th>{t("rbC4")}</th><th>{t("rbC5")}</th><th>{t("rbC5Sectors")}</th>
              </tr>
            </thead>
            <tbody>
              {coverage.memberUniverseByRebalance.map(row => (
                <tr key={row.decision}>
                  <td>{fmtDate(row.decision)}</td>
                  <td>{fmtDate(row.execution)}</td>
                  <td className="pev-num">{fmtCount(row.pitActive)}</td>
                  <td className="pev-num">{fmtCount(row.noPriceFile)}</td>
                  <td className="pev-num">{fmtCount(row.noSector)}</td>
                  <td className="pev-num">{fmtCount(row.shortHistory)}</td>
                  <td className="pev-num">{fmtCount(row.priceBelowMin)}</td>
                  <td className="pev-num">{fmtCount(row.eligible)}</td>
                  <td className="pev-num">{fmtCount(row.c4Names)}</td>
                  <td className="pev-num">{fmtCount(row.c5Names)}</td>
                  <td className="pev-dim">{row.c5Sectors.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pev-dim">{t("splitTitle")}: {t("splitOutside")} {fmtCount(coverage.c7C6aSplit.outsideLeading)} · {t("splitInside")} {fmtCount(coverage.c7C6aSplit.insideLeading)} · {t("splitUnmapped")} {fmtCount(coverage.c7C6aSplit.unmapped)}</p>
        <p className="pev-dim">{t("sectorWeightsTitle")}: {coverage.c4SectorWeights.map(sw => `${sw.sector} ${fmtPercent(sw.weight)}`).join(" · ")}</p>
      </Section>
      <Section title={t("coverageNotEvaluableTitle")}>
        <ul className="pev-defs">
          <li>{t("coverageSleeves")}</li>
          <li>{fillTemplate(t("coveragePeers"), { status: coverage.issuerExcludedPeers.status, reason: coverage.issuerExcludedPeers.reason })}</li>
          <li>{t("coverageHoldings")}</li>
        </ul>
        {c6?.hitRateVsSpy && (
          <p>{fillTemplate(t("coverageHitRate"), {
            beat: fmtCount(c6.hitRateVsSpy.beatSpy), n: fmtCount(c6.hitRateVsSpy.n),
            benchmark: data.basis.benchmark, rate: fmtPercent(c6.hitRateVsSpy.rate),
            ci: fmtCi95(c6.hitRateVsSpy.ci95Wilson[0], c6.hitRateVsSpy.ci95Wilson[1], "%"),
          })}</p>
        )}
      </Section>
      <Section title={t("dropSensitivityTitle")}>
        <p className="pev-dim">
          {t("coverageEvaluated")}: {fmtCount(coverage.dropCorrectedSensitivity.positions)} — {coverage.dropCorrectedSensitivity.excluded.map(row => `${exclusionReasonLabel(lang, row.reason)} ${fmtCount(row.count)}`).join(" · ")}
        </p>
      </Section>
    </div>
  );
}

export function PortfolioPanel({ data, lang }: { data: BetaEvaluation; lang: Lang }) {
  const t = makeEvaluationT(lang);
  const participation = data.claims.find(c => c.key === "participation_attribution");
  return (
    <div className="pev-panel-body">
      <Section title={t("portfolioPanelTitle")}>
        <p>{t("portfolioPanelBody")}</p>
        {participation && (
          <Verbatim lang={lang}><p className="pev-dim">{participation.basis}</p></Verbatim>
        )}
        <Link className="pev-cta" href="/portfolio">{t("portfolioCta")}</Link>
      </Section>
    </div>
  );
}

export function panelBody(panel: PanelKey, data: BetaEvaluation, lang: Lang): React.ReactNode {
  switch (panel) {
    case "details": return <DetailsPanel data={data} lang={lang} />;
    case "attribution": return <AttributionPanel data={data} lang={lang} />;
    case "coverage": return <CoveragePanel data={data} lang={lang} />;
    case "portfolio": return <PortfolioPanel data={data} lang={lang} />;
  }
}
