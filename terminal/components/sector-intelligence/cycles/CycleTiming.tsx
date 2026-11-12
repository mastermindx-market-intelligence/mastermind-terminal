"use client";
import { useLang } from "@/lib/i18n";
import { useSectorCycleT } from "@/lib/sectorCycleLex";
import { STATE_DISPLAY } from "@/lib/sectorCycleHazard";
import type { PhaseAgeReading } from "@/lib/sectorCyclePhaseAge";
import type { RhythmReading } from "@/lib/sectorCycleRhythm";
import s from "../SectorCycleLens.module.css";

/* Timing & projection: the phase age (measured / lower bound / unavailable),
 * the trend line, the timing ladder chip, and the FIXED rhythm window with its
 * position state. The turn-estimate hazard ladder lives in its own card
 * (CycleHazard) since the R5 depth row. */

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface CycleTimingProps {
  record: unknown;
  phaseAge: PhaseAgeReading;
  above200: boolean | null;
  timingState: string | null;
  rhythm: RhythmReading;
  today: string;
  kindLabel: string;
}

export default function CycleTiming(props: CycleTimingProps) {
  const t = useSectorCycleT();
  const zh = useLang().lang === "zh";
  const fmtMonth = (m: string | null) => {
    if (!m) return "—";
    const [y, mo] = m.split("-").map(Number);
    return zh ? `${y}年${mo}月` : `${MONTHS_EN[mo - 1]} ’${String(y).slice(2)}`;
  };

  const ladder = props.timingState && STATE_DISPLAY[props.timingState];

  const rhythmReady = props.rhythm.window.state === "ready";
  const nextTurnLabel = props.rhythm.window.nextTurn === "peak"
    ? t("scNextPeak")
    : props.rhythm.window.nextTurn === "trough"
      ? t("scNextTrough")
      : null;

  return (
    <section className={s.timing} data-testid="cycle-timing">
      <h3>{t("scTiming")}</h3>
      <p className={s.age} data-age={props.phaseAge.status}>
        <span aria-hidden="true">◷</span>
        {props.phaseAge.status === "measured"
          ? t("scAgeMeasured", { n: props.phaseAge.value ?? 0 })
          : props.phaseAge.status === "lower_bound"
            ? t("scAgeLowerBound", {
                n: props.phaseAge.value ?? 0,
                date: props.phaseAge.observedFrom ?? "",
              })
            : t("scAgeUnknown")}
      </p>
      <p className={s.trendRow}>
        {t("scTrend")}{" "}
        <b>{props.above200 === null ? "—" : t(props.above200 ? "scAbove" : "scBelow")}</b>
        {ladder && (
          <span className={s.ladderChip}>{zh ? ladder[1] : ladder[0]}</span>
        )}
      </p>

      <div className={s.rhythmBlock} data-state={props.rhythm.state}>
        <div className={s.rhythmRow}>
          {props.rhythm.kind && <span className={s.chip}>{t("scRhythmKind")}</span>}
          {props.rhythm.overdue && rhythmReady && (
            <span className={s.chipWarn}>{t("scOverdueChip")}</span>
          )}
          {props.rhythm.state === "expired" && (
            <span className={s.note}>{t("scRhythmExpired")}</span>
          )}
          {rhythmReady && props.rhythm.position && (
            <span className={s.chipQuiet}>
              {t(
                props.rhythm.position === "before"
                  ? "scWindowBefore"
                  : props.rhythm.position === "inside"
                    ? "scWindowInside"
                    : "scWindowPast",
              )}
            </span>
          )}
        </div>
        {rhythmReady ? (
          <>
            {nextTurnLabel && (
              <p className={s.rhythmNext}>
                {nextTurnLabel} ≈ {fmtMonth(props.rhythm.window.central)}
              </p>
            )}
            <dl className={s.winGrid}>
              <div>
                <dt>{t("scWinLow")}</dt>
                <dd>{fmtMonth(props.rhythm.window.low)}</dd>
              </div>
              <div data-central="true">
                <dt>{t("scWinCentral")}</dt>
                <dd>{fmtMonth(props.rhythm.window.central)}</dd>
              </div>
              <div>
                <dt>{t("scWinHigh")}</dt>
                <dd>{fmtMonth(props.rhythm.window.high)}</dd>
              </div>
            </dl>
            {props.rhythm.window.nextTurn && (
              <p className={s.note}>
                {t("scForecastFootnote", {
                  turn: t(
                    props.rhythm.window.nextTurn === "peak"
                      ? "scTurnWordPeak"
                      : "scTurnWordTrough",
                  ),
                  month: fmtMonth(props.rhythm.window.central),
                  low: fmtMonth(props.rhythm.window.low),
                  high: fmtMonth(props.rhythm.window.high),
                  unit: props.kindLabel,
                })}
              </p>
            )}
          </>
        ) : (
          <p className={s.note}>{t("scWindowUnavailable")}</p>
        )}
      </div>
    </section>
  );
}
