"use client";
import { useLang } from "@/lib/i18n";
import { useSectorCycleT } from "@/lib/sectorCycleLex";
import { formatValue } from "@/lib/sectorIntelligence";
import type { CycleGrader } from "@/lib/sectorCycleRecord";
import { parityQualification } from "@/lib/sectorCycleHazard";
import s from "../SectorCycleLens.module.css";

/* Methods & limits (lazy DNA: exact source facts, each with its own valid/
 * absent state) and the conviction grader — conditional hit rate with its
 * denominator, abstention, and accruing states. Never a win rate. */

export interface CycleMethodsGraderProps {
  record: unknown;
  meta: unknown;
  grader: CycleGrader;
  structureBasis: string | null;
  membership: string | null;
  historyMode: string | null;
  seriesVerified: boolean;
  publicationId: string | null;
  classifier: string | null;
  sourcesOpen: boolean;
  onSourcesOpen: (open: boolean) => void;
}

const basisKey = (b: string | null) =>
  b === "price"
    ? "scBasisPillPrice"
    : b === "tr"
      ? "scBasisPillTr"
      : b === "tr_fallback"
        ? "scFallbackBasis"
        : null;

export default function CycleMethodsGrader(props: CycleMethodsGraderProps) {
  const t = useSectorCycleT();
  const zh = useLang().lang === "zh";
  const parity = parityQualification(props.record, props.meta);
  const now =
    props.record && typeof props.record === "object" && "now" in (props.record as object)
      ? ((props.record as { now?: Record<string, unknown> }).now ?? {})
      : {};

  return (
    <section className={s.methods} data-testid="cycle-methods-grader">
      <div>
        <h3>{t("scDna")}</h3>
        <ul className={s.dnaList}>
          <li>
            <b>{t("scSizingInert")}</b>
          </li>
          <li>{t("scRhythmKindBody")}</li>
          <li>{t("scRailLeadLag")}</li>
          <li>{t(parity === "parity_failed" ? "scParityFailed" : parity === "parity_holds" ? "scParityHolds" : "scParityNotEstablished")}</li>
        </ul>
        <details
          className={s.sources}
          open={props.sourcesOpen}
          onToggle={(e) => props.onSourcesOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>{t("scSourceDetails")}</summary>
          <dl className={s.sourceList}>
            <div>
              <dt>{t("scPublication")}</dt>
              <dd>{props.publicationId ?? t("scUnverifiedPublication")}</dd>
            </div>
            <div>
              <dt>{t("scClassifier")}</dt>
              <dd>{props.classifier ?? t("scUnknown")}</dd>
            </div>
            <div>
              <dt>{t("scHistoryBasis")}</dt>
              <dd>
                {basisKey(props.structureBasis)
                  ? t(basisKey(props.structureBasis)!)
                  : t("scUnknown")}
              </dd>
            </div>
            <div>
              <dt>{t("scMembership")}</dt>
              <dd>
                {props.membership === "single_instrument"
                  ? t("scSingleInstrument")
                  : props.membership === "current_membership"
                    ? t("scCurrentMembers")
                    : t("scUnknown")}
              </dd>
            </div>
            <div>
              <dt>{t("scHistoryMode")}</dt>
              <dd>
                {props.historyMode === "reconstructed_price_history"
                  ? t("scCurrentReconstruction")
                  : t("scUnknown")}
              </dd>
            </div>
            <div>
              <dt>{t("scSeriesStatus")}</dt>
              <dd>{props.seriesVerified ? t("scVerifiedBy") : t("scUnverifiedPublication")}</dd>
            </div>
            <div>
              <dt>{t("scTrend")}</dt>
              <dd>{typeof now.above200d === "boolean" ? (now.above200d ? t("scAbove") : t("scBelow")) : "—"}</dd>
            </div>
          </dl>
        </details>
      </div>

      <div>
        <p className={s.eyebrow}>{t("scGraderEyebrow")}</p>
        <h3>{t("scGraderTitle")}</h3>
        <p className={s.note}>{t("scGraderCaption")}</p>
        <p className={s.note}>{t("scGraderBody")}</p>
        {!props.grader.available ? (
          <p className={s.note}>
            {t("scGraderUnavailable")}
            {props.grader.note ? ` · ${props.grader.note}` : ""}
          </p>
        ) : (
          <div className={s.grades}>
            {props.grader.horizons.map((h) => (
              <div key={h.horizon} className={s.grade} data-horizon={h.horizon}>
                <span className={s.gradeH}>
                  {h.horizon.replace(/d$/, zh ? "日" : "d")}
                </span>
                {h.accruing ? (
                  <p>
                    {h.n !== null
                      ? t("scGraderAccruing", { n: h.n })
                      : t("scGraderUnavailable")}
                  </p>
                ) : (
                  <dl>
                    <div data-metric="conditional_directional_hit_rate">
                      <dt>{t("scGraderHitRate")}</dt>
                      <dd>
                        {h.hitRate !== null ? `${(h.hitRate * 100).toFixed(1)}%` : "—"}
                        {h.nCorrectDirectional !== null && h.nDirectional !== null
                          ? ` · ${h.nCorrectDirectional}/${h.nDirectional}`
                          : ""}
                      </dd>
                    </div>
                    <div data-metric="abstention">
                      <dt>{t("scGraderAbstained")}</dt>
                      <dd>
                        {h.nNeutral !== null && h.n !== null && h.n > 0
                          ? `${h.nNeutral}/${h.n}`
                          : "—"}
                      </dd>
                    </div>
                    {h.rankIc !== null && (
                      <div data-metric="rank_ic">
                        <dt>{t("scGraderRankIc")}</dt>
                        <dd>{formatValue(h.rankIc, 3)}</dd>
                      </div>
                    )}
                    {h.meanExcessVsBench !== null && (
                      <div data-metric="mean_excess_vs_bench">
                        <dt>{t("scGraderExcess")}</dt>
                        <dd>{formatValue(h.meanExcessVsBench * 100, 1, "%", true)}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
