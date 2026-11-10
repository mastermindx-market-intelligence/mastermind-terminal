"use client";
import { useLang } from "@/lib/i18n";
import { useSectorCycleT } from "@/lib/sectorCycleLex";
import type { CycleRead } from "@/lib/sectorCycleRecord";
import type { BoundEpisodes } from "@/lib/sectorCycleRecord";
import s from "../SectorCycleLens.module.css";

/* The read (engine output, family-match gated, bilingual) and the rotation
 * event record — a capability-local generation with its own event identity,
 * where unavailable is never the same state as "no events" (C20). */

export interface CycleReadRecordProps {
  read: CycleRead;
  events: BoundEpisodes;
}

export default function CycleReadRecord(props: CycleReadRecordProps) {
  const t = useSectorCycleT();
  const zh = useLang().lang === "zh";
  return (
    <section className={s.readRecord} data-testid="cycle-read-record">
      <div>
        <h3>{t("scTheRead")}</h3>
        {props.read.state === "valid" ? (
          <blockquote className={s.story}>
            <p>{props.read.en}</p>
            {props.read.zh && <p lang="zh-Hans">{props.read.zh}</p>}
          </blockquote>
        ) : props.read.state === "withheld" ? (
          <p className={s.note}>{t("scReadWithheld")}</p>
        ) : (
          <p className={s.note}>{t("scReadAbsent")}</p>
        )}
      </div>
      <div>
        <h3>{t("scEvents")}</h3>
        {props.events.state === "absent" ? (
          <p className={s.note}>{t("scEventsNone")}</p>
        ) : props.events.state === "wrong_epoch" ? (
          <p className={s.note}>{t("scEventsWrongEpoch")}</p>
        ) : (
          <>
            {props.events.episodes?.coldstart && (
              <p className={s.note}>{t("scEventsColdstart")}</p>
            )}
            <ul className={s.events}>
              {props.events.episodes?.closedRecent.map((e) => (
                <li key={e.pairId}>
                  <span>
                    {zh ? e.toNameZh : e.toNameEn} · {t("scEventClosed")} {e.closedAsOf} ·{" "}
                    {t("scEventDays", { n: e.dayN })}
                  </span>
                  <small>
                    {e.started} → {e.closedAsOf}
                  </small>
                </li>
              ))}
              {(props.events.episodes?.closedRecent.length ?? 0) === 0 && (
                <li className={s.note}>{t("scEventsNone")}</li>
              )}
            </ul>
            {props.events.episodes &&
              (props.events.episodes.closedRecentExcluded.crossPair > 0 ||
                props.events.episodes.closedRecentExcluded.invalid > 0) && (
                <p className={s.note}>
                  {t("scEventsExcluded", {
                    cross: props.events.episodes.closedRecentExcluded.crossPair,
                    invalid: props.events.episodes.closedRecentExcluded.invalid,
                  })}
                </p>
              )}
          </>
        )}
      </div>
    </section>
  );
}
