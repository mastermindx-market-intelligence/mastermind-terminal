"use client";
/**
 * TwoClockStrip (T2-01 basis line) — both owners' clocks in one line, plus the
 * compatibility verdict when the two reads do not cover the same session.
 *
 * Laws (DESIGN_DOCTRINE, and the sector lane's same-grammar rule):
 *   - ONE clock line per panel: the sector reading's session and the Prophet
 *     index's as-of, stated together so the reader can weigh the basis before
 *     reading any number below it.
 *   - The verdict is plain words with the gap stated, no jargon; a compatible
 *     read states the shared session quietly.
 *   - Unknown stamps say "unknown" — never a guessed date.
 *
 * The verdict switch mirrors SectorContextStrip (sector lane) deliberately:
 * the words come from the SAME shared vocabulary (prophetSectorStrings), so
 * the two surfaces can never explain the same compatibility status two ways.
 */
import { useLang } from "@/lib/i18n";
import type { SectorMembersCompatibility } from "@/lib/prophetSectorMembers";
import {
  makeProphetSectorT, prophetSectorFill,
} from "../sector/prophetSectorStrings";
import styles from "./today.module.css";

export function TwoClockStrip({ compatibility }: { compatibility: SectorMembersCompatibility }) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);

  const sectorClock = compatibility.sectorSession ?? t("contextUnknown");
  const prophetClock = compatibility.prophetAsof ?? t("contextUnknown");

  let verdict: string;
  switch (compatibility.status) {
    case "compatible":
      verdict = prophetSectorFill(t("verdictCompatible"), { session: sectorClock });
      break;
    case "stale_sector":
      verdict = prophetSectorFill(t("verdictStaleSector"), { gap: String(compatibility.sessionGap ?? "several") });
      break;
    case "stale_prophet":
      verdict = prophetSectorFill(t("verdictStaleProphet"), { gap: String(compatibility.sessionGap ?? "several") });
      break;
    case "mixed_basis":
      verdict = prophetSectorFill(t("verdictMixedBasis"), { sector: sectorClock, prophet: prophetClock });
      break;
    case "sector_unavailable":
      verdict = t("verdictSectorDown");
      break;
    default:
      verdict = t("verdictProphetDown");
      break;
  }
  const compatible = compatibility.status === "compatible";

  return (
    <div>
      <p className={styles.clocks} data-testid="prophet-today-clocks">
        {prophetSectorFill(t("contextClocks"), { sector: sectorClock, prophet: prophetClock })}
      </p>
      <p
        className={compatible ? styles.verdictQuiet : styles.verdict}
        data-testid="prophet-today-verdict"
        role={compatible ? undefined : "status"}
      >
        {verdict}
      </p>
    </div>
  );
}
