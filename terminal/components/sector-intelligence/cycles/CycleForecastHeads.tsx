"use client";
import { useSectorCycleT } from "@/lib/sectorCycleLex";
import {
  type ForecastHead,
  type ForecastHeadKey,
  type ForecastHeadsReading,
} from "@/lib/sectorCycleForecastHeads";
import s from "../SectorCycleLens.module.css";

/* Per-head forecast capabilities (v1.1, lane 8 wire contract
 * `sector_cycles.forecast_heads.v1`). Every head is judged ALONE: one
 * withdrawn or withheld head never hides its siblings or the observed
 * Cycles facts elsewhere in the lens (SP10), and a withheld head NEVER
 * shows a number — only its status, the published reason, the horizon
 * window and evidence pointers. A head that was qualified and no longer
 * is renders withdrawn WITH its date, never a stale pass. */

const HEAD_NAME_KEY: Record<ForecastHeadKey, string> = {
  remaining_return_distribution: "scHeadRemainingReturn",
  adverse_tail: "scHeadAdverseTail",
  target_before_invalidation: "scHeadTargetBeforeInvalidation",
  transition_time: "scHeadTransitionTime",
};

/** Lane 8 wording law: H3/H4 are leg-direction facts, not cycle-timing edges. */
const DIRECTION_HEADS: ReadonlySet<ForecastHeadKey> = new Set([
  "target_before_invalidation",
  "transition_time",
]);

const REASON_KEY: Record<string, string> = {
  research_withheld_failed: "scReasonResearchWithheldFailed",
  live_state_not_protocol_epoch: "scReasonLiveStateNotProtocolEpoch",
  membership_not_point_in_time: "scReasonMembershipNotPointInTime",
  record_kind_not_evaluated: "scReasonRecordKindNotEvaluated",
  market_not_evaluated: "scReasonMarketNotEvaluated",
  research_withheld_underpowered: "scReasonResearchWithheldUnderpowered",
  research_not_evaluated: "scReasonResearchNotEvaluated",
  live_estimator_not_wired: "scReasonLiveEstimatorNotWired",
  payload_invalid: "scReasonPayloadInvalid",
};

export default function CycleForecastHeads(props: { reading: ForecastHeadsReading | null }) {
  const t = useSectorCycleT();
  const reading = props.reading;
  return (
    <section className={s.headsCard} data-testid="cycle-forecast-heads">
      <h3>{t("scForecastHeads")}</h3>
      {!reading || reading.state === "absent" ? (
        <p className={s.note}>{t("scForecastHeadsAbsent")}</p>
      ) : reading.state === "invalid" ? (
        <p className={s.note}>{t("scForecastHeadsInvalid")}</p>
      ) : (
        <>
          <ul className={s.headList}>
            {reading.heads.map((head: ForecastHead) => (
              <li key={head.key} className={s.headRow} data-head={head.key} data-status={head.status}>
                <span className={s.headName}>{t(HEAD_NAME_KEY[head.key])}</span>
                <span
                  className={head.status === "withdrawn" ? s.chipWarn : s.chipQuiet}
                  data-testid={`cycle-head-status-${head.key}`}
                >
                  {t(
                    head.status === "withdrawn"
                      ? "scHeadStatusWithdrawn"
                      : head.status === "qualified"
                        ? "scHeadStatusQualified"
                        : "scHeadStatusWithheld",
                  )}
                </span>
                {head.status === "withdrawn" && head.withdrawnAsOf !== null && (
                  <span className={s.headWithdrawn}>
                    {t("scHeadWithdrawn", { date: head.withdrawnAsOf })}
                  </span>
                )}
                {head.status !== "qualified" && (
                  <span className={s.headReason}>
                    {head.reasonCode
                      ? t(REASON_KEY[head.reasonCode] ?? "scReasonUnknown")
                      : t("scReasonUnknown")}
                  </span>
                )}
                {head.horizonSessions !== null && (
                  <span className={s.headMeta}>
                    {t("scHeadHorizon", { n: head.horizonSessions })}
                  </span>
                )}
                {DIRECTION_HEADS.has(head.key) && (
                  <span className={s.headMeta}>{t("scHeadDirectional")}</span>
                )}
                {(head.evidence.protocol !== null || head.evidence.reportRef !== null) && (
                  <details className={s.headEvidence}>
                    <summary>{t("scHeadEvidence")}</summary>
                    {head.evidence.protocol && <p className={s.note}>{head.evidence.protocol}</p>}
                    {head.evidence.reportRef && <p className={s.note}>{head.evidence.reportRef}</p>}
                    {head.evidence.resultsDoc && <p className={s.note}>{head.evidence.resultsDoc}</p>}
                  </details>
                )}
              </li>
            ))}
          </ul>
          <p className={s.note}>{t("scHeadWithheldNoNumber")}</p>
          <p className={s.note}>{t("scForecastHeadsFoot")}</p>
        </>
      )}
    </section>
  );
}
