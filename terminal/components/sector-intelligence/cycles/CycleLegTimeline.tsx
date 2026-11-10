"use client";
import { useSectorCycleT } from "@/lib/sectorCycleLex";
import type { SectorRotationHistoryCycleTurn } from "@/lib/sectorIntelligence";
import type { CycleStory } from "@/lib/sectorCycleRecord";
import s from "../SectorCycleLens.module.css";

/* Dated legs between confirmed turns, with the open leg kept distinct (C11),
 * and the leg story quarantined by its own epoch/TTL (C12). A pivot is a
 * reconstruction, never a confirmation: provisional markers stay labelled. */

export interface CycleLeg {
  id: string;
  from: string | null;
  to: string | null;
  kind: "up" | "down" | null;
  open: boolean;
  provisionalEnd: boolean;
}

export function legsFromTurns(
  turns: SectorRotationHistoryCycleTurn[],
): CycleLeg[] {
  const sorted = [...turns].sort((a, b) => a.date.localeCompare(b.date));
  const legs: CycleLeg[] = [];
  let prev: { date: string; kind: "peak" | "trough"; provisional: boolean } | null =
    null;
  for (const turn of sorted) {
    if (prev) {
      legs.push({
        id: `${prev.date}->${turn.date}`,
        from: prev.date,
        to: turn.date,
        kind: prev.kind === "trough" ? "up" : "down",
        open: false,
        provisionalEnd: turn.provisional,
      });
    }
    prev = { date: turn.date, kind: turn.kind, provisional: turn.provisional };
  }
  if (prev) {
    legs.push({
      id: `${prev.date}->open`,
      from: prev.date,
      to: null,
      kind: prev.kind === "trough" ? "up" : "down",
      open: true,
      provisionalEnd: false,
    });
  }
  return legs;
}

export interface CycleLegTimelineProps {
  turns: SectorRotationHistoryCycleTurn[];
  selectedLegId: string | null;
  onSelectLeg: (legId: string | null) => void;
  /** Opens the mobile full-height leg sheet for the selected leg. */
  onOpenLegSheet?: (open: boolean) => void;
  story: CycleStory | null;
  openSessions: number | null;
  asOf: string;
}

export function LegStoryBlock({ story }: { story: CycleStory | null }) {
  const t = useSectorCycleT();
  if (!story || story.state === "absent") {
    return <p className={s.note}>{t("scStoryAbsent")}</p>;
  }
  if (story.state === "expired") {
    return <p className={s.note}>{t("scStoryExpired")}</p>;
  }
  if (story.state === "wrong_epoch") {
    return <p className={s.note}>{t("scStoryWrongEpoch")}</p>;
  }
  return (
    <blockquote className={s.story}>
      <p>{story.en}</p>
      {story.zh && <p lang="zh-Hans">{story.zh}</p>}
      <footer>{t("scStoryProvenance")}</footer>
    </blockquote>
  );
}

export default function CycleLegTimeline(props: CycleLegTimelineProps) {
  const t = useSectorCycleT();
  const legs = legsFromTurns(props.turns);
  const selected = legs.find((l) => l.id === props.selectedLegId) ?? null;
  return (
    <section className={s.legWrap} data-testid="cycle-leg-timeline">
      <h3>{t("scLegTimeline")}</h3>
      <div className={s.legBody}>
        <ol className={s.legStrip}>
          {legs.map((leg) => (
            <li key={leg.id}>
              <button
                type="button"
                aria-pressed={selected?.id === leg.id}
                className={[
                  leg.open ? s.legOpen : "",
                  leg.kind === "up" ? s.legUp : s.legDown,
                  leg.provisionalEnd ? s.legProv : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() =>
                  props.onSelectLeg(selected?.id === leg.id ? null : leg.id)
                }
              >
                <span>
                  {leg.from}
                  {leg.open
                    ? ` · ${t("scOpenLeg")}${props.openSessions !== null ? ` · ${t("scLegOpenSessions", { n: props.openSessions })}` : ""}`
                    : ` → ${leg.to}${leg.provisionalEnd ? ` · ${t("scProvisional")}` : ""}`}
                </span>
                <b aria-hidden="true">{leg.kind === "up" ? "▲" : "▼"}</b>
              </button>
            </li>
          ))}
          {legs.length === 0 && <li className={s.note}>{t("scNoTurns")}</li>}
        </ol>
        {selected && (
          <div className={s.legDetail} data-testid="cycle-leg-detail">
            <h4>
              {selected.open ? t("scLegOpenNoCount") : `${selected.from} → ${selected.to}`}
            </h4>
            <LegStoryBlock story={props.story} />
            {props.onOpenLegSheet && (
              <button
                type="button"
                className={s.legSheetButton}
                onClick={() => props.onOpenLegSheet?.(true)}
              >
                {t("scLegDetails")}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
