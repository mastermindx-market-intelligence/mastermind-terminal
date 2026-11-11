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
 * withdrawn head never hides its siblings or the observed Cycles facts
 * elsewhere in the lens (SP10), and a withheld head NEVER shows a number —
 * only its status, the published reason, the horizon window and evidence
 * pointers. On the wire a withdrawal arrives as `withheld` plus its own
 * reason code (the producer's `withdraw()` writes no other status), so the
 * card renders exactly that: the head's own reason, a generic line for a
 * code outside the published set — never a bare code dump, and never an
 * implied qualified forecast. */

const HEAD_NAME_KEY: Record<ForecastHeadKey, string> = {
  remaining_return_distribution: "scHeadRemainingReturn",
  adverse_tail: "scHeadAdverseTail",
  target_before_invalidation: "scHeadTargetBeforeInvalidation",
  transition_time: "scHeadTransitionTime",
};

/** Lane 8 wording law, per the producer's own TARGETS text: the
 * target-before-invalidation head measures where the current leg tends to
 * reach (+1× before −1× trailing volatility) — a leg-direction fact, not a
 * cycle-timing edge. The transition-time head measures when the next turn
 * becomes first-known — a timing quantity, so it carries no such note.
 * The note describes the head's own TARGET, so a payload_invalid head —
 * whose target could not be read — never shows it (NEW-2, r2 review). */
const DIRECTION_HEADS: ReadonlySet<ForecastHeadKey> = new Set([
  "target_before_invalidation",
]);

/** A Map, not an object literal: inherited keys ("__proto__", "constructor",
 * "toString") can never answer, and any code outside the published set —
 * including one a future `withdraw()` supplies — falls to the generic line. */
const REASON_KEY = new Map<string, string>([
  ["research_withheld_failed", "scReasonResearchWithheldFailed"],
  ["live_state_not_protocol_epoch", "scReasonLiveStateNotProtocolEpoch"],
  ["membership_not_point_in_time", "scReasonMembershipNotPointInTime"],
  ["record_kind_not_evaluated", "scReasonRecordKindNotEvaluated"],
  ["market_not_evaluated", "scReasonMarketNotEvaluated"],
  ["research_withheld_underpowered", "scReasonResearchWithheldUnderpowered"],
  ["research_not_evaluated", "scReasonResearchNotEvaluated"],
  ["live_estimator_not_wired", "scReasonLiveEstimatorNotWired"],
  ["payload_invalid", "scReasonPayloadInvalid"],
]);

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
            {reading.heads.map((head: ForecastHead) => {
              const reasonKey =
                head.reasonCode !== null
                  ? REASON_KEY.get(head.reasonCode) ?? "scReasonUnknown"
                  : "scReasonUnknown";
              return (
                <li key={head.key} className={s.headRow} data-head={head.key} data-status={head.status}>
                  <span className={s.headName}>{t(HEAD_NAME_KEY[head.key])}</span>
                  <span className={s.chipQuiet} data-testid={`cycle-head-status-${head.key}`}>
                    {t("scHeadStatusWithheld")}
                  </span>
                  <span className={s.headReason}>{t(reasonKey)}</span>
                  {head.horizonSessions !== null && (
                    <span className={s.headMeta}>
                      {t("scHeadHorizon", { n: head.horizonSessions })}
                    </span>
                  )}
                  {DIRECTION_HEADS.has(head.key) && head.reasonCode !== "payload_invalid" && (
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
              );
            })}
          </ul>
          <p className={s.note}>{t("scHeadWithheldNoNumber")}</p>
          <p className={s.note}>{t("scForecastHeadsFoot")}</p>
        </>
      )}
    </section>
  );
}
