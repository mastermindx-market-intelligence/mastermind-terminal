"use client";
/**
 * DiagnosisSection — "Why the stock picks trailed their sectors" (D7/D8).
 *
 * Sits directly after the verdict card, before the evidence panels. The three
 * parts of the CEO contract, per cited horizon (21 and 42 sessions today):
 *   (a) the yardstick gap — equal-weight member basket vs cap-weighted fund;
 *   (b) the picks against that member basket;
 *   (c) the placebo range and where the picks landed relative to it.
 *
 * LAWS
 *  - Every figure is interpolated from the decoded artifact; formatting only.
 *  - The horizons rendered are exactly those the verdict itself cites
 *    (memberYardstickMarks applies the same qualification as the verdict
 *    sentence) — no qualifying horizon, no panel body.
 *  - NO skill claim in either direction: the artifact's own wording is that
 *    the remainder is not distinguishable after multiplicity correction; the
 *    placebo sentence reports inside/outside, which is the artifact's
 *    statement, never ours.
 *  - Off-index picks and the audit are after-the-fact material: the engine's
 *    own label rides with them verbatim, and the chip repeats it every time.
 *  - Engine prose (why, identity, definitions, notes) renders verbatim; in ZH
 *    the adjacent note explains those are the engine's own words.
 */
import type { Lang } from "@/lib/i18n";
import {
  fillTemplate, humanizeEngineText, makeEvaluationT,
} from "@/lib/prophetEvaluationStrings";
import { fmtCi95, fmtCount, fmtSignedPp } from "@/lib/prophetBetaEvaluationFormat";
import {
  memberYardstickMarks, perPlanHorizonMarks,
  type BetaEvaluation, type MemberYardstickMark,
} from "@/lib/prophetBetaEvaluation";
import { PlaceboRangeChart, type PlaceboRangeRow } from "./evaluationCharts";

export function DiagnosisUnavailable({ lang }: { lang: Lang }) {
  const t = makeEvaluationT(lang);
  return (
    <section className="pev-card pev-diagnosis" data-testid="pev-diagnosis">
      <h2>{t("diagnosisTitle")}</h2>
      <p className="pev-dim" data-testid="pev-diagnosis-unavailable">{t("diagnosisUnavailable")}</p>
    </section>
  );
}

export function DiagnosisSection({ data, lang }: { data: BetaEvaluation; lang: Lang }) {
  const t = makeEvaluationT(lang);
  const mb = data.eventStudy.memberBenchmark;
  const marks = mb
    ? memberYardstickMarks(mb.horizons, perPlanHorizonMarks(data.eventStudy.horizons))
    : [];
  const offIndex = data.sensitivity?.offIndexPicks ?? null;
  const audit = data.independentAudit;
  if (marks.length === 0 && !offIndex && !audit) return <DiagnosisUnavailable lang={lang} />;

  const relation = (m: MemberYardstickMark): string => {
    if (!m.placebo.observedOutsidePlaceboRange) return t("placeboWithin");
    return t(m.frozen.mean < m.placebo.lo ? "placeboBelow" : "placeboAbove");
  };

  const chartRows: PlaceboRangeRow[] = marks.map(m => ({
    key: m.horizon,
    label: fillTemplate(t("diagnosisSessionsLabel"), {
      h: fmtCount(Number(m.horizon)), n: fmtCount(m.n),
    }),
    bandLo: m.placebo.lo,
    bandHi: m.placebo.hi,
    point: m.frozen.mean,
  }));

  return (
    <section className="pev-card pev-diagnosis" data-testid="pev-diagnosis">
      <h2>{t("diagnosisTitle")}</h2>
      {mb !== null && marks.length > 0 && (
        <>
          <p className="pev-kicker">{t("diagnosisKicker")}</p>
          <PlaceboRangeChart rows={chartRows} ariaLabel={t("diagnosisTitle")} />
          <p className="pev-dim">{t("diagnosisLegend")}</p>
          {marks.map(m => (
            <div className="pev-horizon" key={m.horizon} data-testid={`pev-diagnosis-h${m.horizon}`}>
              <h3>{fillTemplate(t("diagnosisSessionsLabel"), {
                h: fmtCount(Number(m.horizon)), n: fmtCount(m.n),
              })}</h3>
              <p>{fillTemplate(t("diagnosisYardstickRow"), {
                value: fmtSignedPp(m.yardstick.mean),
                ci: fmtCi95(m.yardstick.ci95DateCluster[0], m.yardstick.ci95DateCluster[1], "pp"),
              })}</p>
              <p>{fillTemplate(t("diagnosisPicksRow"), {
                value: fmtSignedPp(m.picks.mean),
                ci: fmtCi95(m.picks.ci95DateCluster[0], m.picks.ci95DateCluster[1], "pp"),
              })}</p>
              <p>{fillTemplate(t("diagnosisPlaceboRow"), {
                frozen: fmtSignedPp(m.frozen.mean),
                draws: fmtCount(m.placebo.draws),
                lo: fmtSignedPp(m.placebo.lo),
                hi: fmtSignedPp(m.placebo.hi),
                relation: relation(m),
              })}</p>
            </div>
          ))}
          {mb.why && (
            <p className="pev-dim">
              <b>{t("engineReadingLabel")}</b> {humanizeEngineText(mb.why)}
              {lang === "zh" ? `（${t("zhVerbatimNote")}）` : null}
            </p>
          )}
        </>
      )}

      {/* D8 — after-the-fact sensitivity; the engine's own label rides with
          it, and the chip repeats after-the-fact every time it renders. */}
      {offIndex && (
        <details className="pev-sens" data-testid="pev-off-index">
          <summary>
            {t("offIndexTitle")}
            <span className="pev-chip is-unknown">{t("afterTheFactChip")}</span>
          </summary>
          <p className="pev-dim">{humanizeEngineText(offIndex.label)}</p>
          <p>{fillTemplate(t("offIndexCounts"), {
            off: fmtCount(offIndex.publishedPlansOffIndex),
            total: fmtCount(offIndex.publishedPlansTotal),
            entered: fmtCount(offIndex.enteredPositionsOffIndex),
          })}</p>
          <p className="pev-dim">{humanizeEngineText(offIndex.definition)}</p>
          <div className="pev-table-scroll">
            <table className="pev-table">
              <thead>
                <tr>
                  <th>{t("colHorizon")}</th>
                  <th>{t("colComparator")}</th>
                  <th>{t("colMeanGap")}</th>
                  <th>n</th>
                  <th>{t("colDates")}</th>
                </tr>
              </thead>
              <tbody>
                {offIndex.horizons.flatMap(h => ([
                  { key: `${h.horizon}-all`, label: t("offIndexAllRow"), row: h.allPlans },
                  { key: `${h.horizon}-off`, label: t("offIndexOffRow"), row: h.offIndexPicks },
                  { key: `${h.horizon}-member`, label: t("offIndexMemberRow"), row: h.sp1500MemberPicks },
                ]).map((entry, i) => (
                  <tr key={entry.key}>
                    <td className="pev-num">{i % 3 === 0 ? fmtCount(Number(h.horizon)) : ""}</td>
                    <td>{entry.label}</td>
                    <td className="pev-num">
                      {fmtSignedPp(entry.row.mean)}
                      {" "}
                      {fmtCi95(entry.row.ci95[0], entry.row.ci95[1], "pp")}
                    </td>
                    <td className="pev-num">{fmtCount(entry.row.n)}</td>
                    <td className="pev-num pev-dim">{fmtCount(entry.row.nDates)}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          {offIndex.horizons.map(h => (
            <p className="pev-dim" key={h.horizon}>
              {fillTemplate(t("offIndexContribution"), {
                h: fmtCount(Number(h.horizon)),
                all: fmtSignedPp(h.allPlans.mean),
                member: fmtSignedPp(h.sp1500MemberPicks.mean),
                shift: fmtSignedPp(h.contributionToMeanGap),
              })}
            </p>
          ))}
          <p className="pev-dim">
            <b>{t("offIndexLimitsLabel")}</b> {humanizeEngineText(offIndex.membershipFileLimits)}
          </p>
        </details>
      )}

      {/* RUN-D — the post-publication audit summary, after-the-fact by the
          artifact's own label. */}
      {audit && (
        <details className="pev-sens" data-testid="pev-audit">
          <summary>
            {t("auditTitle")}
            <span className="pev-chip is-unknown">{t("afterTheFactChip")}</span>
          </summary>
          <p className="pev-dim">{humanizeEngineText(audit.label)}</p>
          {mb?.decompositionIdentity && (
            <p className="pev-dim" data-testid="pev-decomposition-identity">{humanizeEngineText(mb.decompositionIdentity)}</p>
          )}
          <h3>{t("auditRunsTitle")}</h3>
          <ul className="pev-defs">
            {audit.runs.map(run => (
              <li key={run.name}>
                <b>{run.name}</b>
                <span>{humanizeEngineText(run.scope)}</span>
                <span className="pev-mono pev-dim">{run.report}</span>
              </li>
            ))}
          </ul>
          <h3>{t("auditAgreedTitle")}</h3>
          <ul className="pev-defs">
            {audit.whatAgreed.map((s, i) => <li key={i}><span>{humanizeEngineText(s)}</span></li>)}
          </ul>
          <h3>{t("auditChangedTitle")}</h3>
          <ul className="pev-defs">
            {audit.whatChanged.map((s, i) => <li key={i}><span>{humanizeEngineText(s)}</span></li>)}
          </ul>
          <h3>{t("auditAddedTitle")}</h3>
          <ul className="pev-defs">
            {audit.addedSensitivities.map((s, i) => <li key={i}><span>{humanizeEngineText(s)}</span></li>)}
          </ul>
          <p className="pev-dim">
            <b>{t("auditAdjudicationLabel")}</b> <span className="pev-mono">{audit.adjudication}</span>
          </p>
        </details>
      )}
    </section>
  );
}
