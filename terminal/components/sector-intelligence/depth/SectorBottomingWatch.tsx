"use client";

import { useState, type Ref } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorDepthT } from "@/lib/sectorDepthLex";
import {
  BOTTOMING_CAP,
  bottomingWatchFromCarried,
  hasRecovering,
  watchDisclosure,
  watchModel,
  type BottomingWatchData,
  type WatchModelEntry,
} from "@/lib/sectorDepthCalls";
import { DepthUnavailable } from "./DepthUnavailable";
import styles from "./SectorBottomingWatch.module.css";

/**
 * The Bottoming Watch strip — display-only. A visually separate strip, never a
 * lane of the calls board: it shows what tonight's cycle read says, as-is,
 * with the Display-only badge (the payload's authority tier is "display" and
 * every may_* stays false) and the owner's null disclosure when the authority
 * carries one, falling back to the standing lexicon disclosure. Names render
 * as PLAIN TEXT — the href is carried by the payload but never actionable.
 * There is deliberately NO navigation out of the watch (no `onNavigate` prop
 * at all) and no buy/enter/sell verb anywhere in its copy. Dual-read and
 * recovering chips read the payload's id membership sets; the gate-conflict
 * chip reads the row's own flag. signal/cycle_signal/timing_state stay
 * payload-only. A null payload is the ONLY unavailable path; an empty entry
 * list is a measured empty state.
 */
export function SectorBottomingWatch({
  watch,
  captureRef,
}: {
  watch: BottomingWatchData | null;
  captureRef?: Ref<HTMLElement>;
}) {
  const t = useSectorDepthT();
  const { lang } = useLang();
  // v1.1 full-population continuation: the pre-expansion slice is a display
  // budget, not a cap — every entry stays reachable (R6-09 member coverage).
  const [expanded, setExpanded] = useState(false);

  // S2 closed-shape boundary: a malformed or incomplete payload (missing
  // entries array, bad id sets, wrong authority shape) renders the shared
  // unavailable state — no input can throw here.
  const parsed = watch === null ? null : bottomingWatchFromCarried(watch);

  if (parsed === null) {
    return (
      <DepthUnavailable
        field="bottoming_watch"
        owner="macro_sector_generation"
        title={t("siWatchTitle")}
      />
    );
  }

  const entries = watchModel(parsed, expanded);
  const total = parsed.bottoming_watch.length;
  const hidden = Math.max(0, total - BOTTOMING_CAP);
  const disclosure = watchDisclosure(parsed, lang) ?? t("siWatchDisclosure");

  return (
    <section
      ref={captureRef}
      className={styles.root}
      aria-label={t("siWatchTitle")}
      data-depth-bottoming-watch
    >
      <header className={styles.head}>
        <div className={styles.headRow}>
          <h3 className={styles.title}>
            {t("siWatchTitle")}
            <span className={styles.count} data-count> · {parsed.bottoming_watch.length}</span>
          </h3>
          {parsed.bottoming_authority.tier === "display" && (
            <span className={styles.badge}>{t("siDepthDisplayOnly")}</span>
          )}
        </div>
        <p className={styles.sub}>{t("siWatchSub")}</p>
        <p className={styles.disclosure}>{disclosure}</p>
      </header>

      {entries.length === 0 ? (
        <p className={styles.empty} data-empty="true">
          {t("siWatchEmpty")}
        </p>
      ) : (
        <>
          <ul className={styles.entries} data-expanded={expanded ? "true" : "false"}>
            {entries.map((entry) => (
              <WatchRow key={entry.id} entry={entry} lang={lang} />
            ))}
          </ul>
          {total > BOTTOMING_CAP && (
            <button
              type="button"
              className={styles.more}
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded
                ? t("siWatchShowLess")
                : t("siWatchShowMore", { n: hidden })}
            </button>
          )}
        </>
      )}

      {hasRecovering(parsed) && (
        <p className={styles.recoveringNote}>{t("siWatchRecoveringDisclosure")}</p>
      )}
    </section>
  );
}

/** One watch entry: plain-text localized name, cycle-position readout, and
 * the chip set from the display model — cycle-turn base chip, dual-read chip,
 * recovering chip, gate-conflict chip, 200-day chip (above or below, always
 * exactly one). Tooltips on the disagreement chips explain the dual read in
 * place. */
function WatchRow({ entry, lang }: { entry: WatchModelEntry; lang: string }) {
  const t = useSectorDepthT();
  const name = lang === "zh" && entry.name_zh ? entry.name_zh : entry.name;

  return (
    <li className={styles.entry} data-above200d={entry.above200d ? "true" : "false"}>
      <div className={styles.entryTop}>
        <span className={styles.entryName}>{name}</span>
        <span className={styles.pos}>{t("siWatchPos", { pos: entry.pos })}</span>
      </div>
      <p className={styles.chips}>
        <span className={styles.chip}>{t("siWatchCycleTurn")}</span>
        {entry.dualRead && (
          <span className={styles.chip} title={t("siWatchDualReadTip")}>
            {t("siWatchDualRead")}
          </span>
        )}
        {entry.recovering && (
          <span className={styles.chipRecovering} title={t("siWatchRecoveringTip")}>
            {t("siWatchRecovering")}
          </span>
        )}
        {entry.gateConflict && (
          <span className={styles.chip}>{t("siWatchGateConflict")}</span>
        )}
        <span className={styles.chip}>
          {t(entry.above200d ? "siWatchAbove200" : "siWatchBelow200")}
        </span>
      </p>
    </li>
  );
}
