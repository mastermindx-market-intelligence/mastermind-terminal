"use client";
import { useSectorCycleT } from "@/lib/sectorCycleLex";
import {
  HAZARD_HORIZONS,
  cellState,
  legFamily,
  parityQualification,
  type EstimateKinds,
} from "@/lib/sectorCycleHazard";
import s from "../SectorCycleLens.module.css";

/* The turn-estimate card of the R5 depth row (Y01): the hazard ladder where
 * MODEL and PRIOR stay explicit, a whole inverted curve is withheld rather
 * than partially drawn, and every cell is a historical qualification — never
 * a current claim while live parity is unproven. Extracted from CycleTiming
 * so the depth outcomes can sit in the R5 column grid without regrouping
 * the frozen-spec component contracts. */

export interface CycleHazardProps {
  record: unknown;
  meta: unknown;
}

export default function CycleHazard(props: CycleHazardProps) {
  const t = useSectorCycleT();
  const leg = legFamily(props.record);
  const hazard =
    props.record && typeof props.record === "object" && "now" in (props.record as object)
      ? (props.record as { now?: { hazard?: unknown } }).now
      : null;
  const hazardBlock = hazard && typeof hazard === "object" ? (hazard as { hazard?: unknown }).hazard : null;
  const estimateKinds =
    props.record && typeof props.record === "object" && "estimate_kinds" in (props.record as object)
      ? ((props.record as { estimate_kinds?: EstimateKinds }).estimate_kinds ?? null)
      : null;
  const hazardWithheld = leg.hazardAgrees === false;

  return (
    <section className={s.hazardCard} data-testid="cycle-hazard">
      <h3>{t("scTurnEstimate")}</h3>
      <div
        className={s.hazard}
        data-withheld={hazardWithheld ? "true" : undefined}
        role="group"
        aria-label={t("scHazardLabel")}
      >
        <h4>{t("scHazardLabel")}</h4>
        {hazardWithheld ? (
          <p className={s.note}>{t("scHazardWithheld")}</p>
        ) : (
          <>
            <div className={s.hzLadder}>
              <span />
              {HAZARD_HORIZONS.map((key) => (
                <span key={key} className={s.hzHead}>
                  {t(key === "1m" ? "scHz1m" : key === "3m" ? "scHz3m" : "scHz6m")}
                </span>
              ))}
              <span className={s.hzRowlab}>
                {leg.direction
                  ? t(leg.direction === "up" ? "scHazardRowUp" : "scHazardRowDown")
                  : ""}
                {leg.turn
                  ? ` · ${t(leg.turn === "peak" ? "scTurnWordPeak" : "scTurnWordTrough")}`
                  : ""}
              </span>
              {HAZARD_HORIZONS.map((key) => {
                const state = cellState(hazardBlock, estimateKinds, key);
                const cell =
                  hazardBlock && typeof hazardBlock === "object"
                    ? (hazardBlock as Record<string, { p?: number }>)[key]
                    : null;
                if (state === "gap" || !cell || typeof cell.p !== "number") {
                  return (
                    <span key={key} className={s.hzCell} data-state="gap">
                      <span className={s.hzVal} aria-label={t("scHazardUnavailable")}>
                        —
                      </span>
                    </span>
                  );
                }
                const pct = Math.round(cell.p * 100);
                return (
                  <span key={key} className={s.hzCell} data-state={state}>
                    <span className={s.hzVal}>{pct}%</span>
                    <span className={s.badge} data-source={state}>
                      {t(state === "prior" ? "scBadgePrior" : "scBadgeModel")}
                    </span>
                  </span>
                );
              })}
            </div>
            <p className={s.note}>
              {(() => {
                const q = parityQualification(props.record, props.meta);
                const notes: string[] = [];
                const hasMuted = HAZARD_HORIZONS.some(
                  (k) => cellState(hazardBlock, estimateKinds, k) === "muted",
                );
                const hasPrior = HAZARD_HORIZONS.some(
                  (k) => cellState(hazardBlock, estimateKinds, k) === "prior",
                );
                const hasGap = HAZARD_HORIZONS.some(
                  (k) => cellState(hazardBlock, estimateKinds, k) === "gap",
                );
                if (hasMuted) notes.push(t("scHazardFaceNote"));
                if (hasPrior) notes.push(t("scPriorGloss"));
                if (hasGap) notes.push(t("scHazardUnavailable"));
                if (q === "parity_failed") notes.push(t("scParityFailed"));
                return notes.join(" ") || t("scFootnotePattern");
              })()}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
