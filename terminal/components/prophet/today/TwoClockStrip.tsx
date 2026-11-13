"use client";
/**
 * TwoClockStrip (T2-01 basis line, P1-4) — ONE as-of line for both sessions,
 * plus the compatibility verdict in the same line.
 *
 * Laws (DESIGN_DOCTRINE Law 4, and the sector lane's same-grammar rule):
 *   - ONE as-of line per panel: the sector reading's session and the Prophet
 *     index's as-of are stated ONCE, together with the caveat when the two
 *     reads do not cover the same session. The page previously printed the
 *     dates in one line and repeated them in a second caveat; that repetition
 *     is gone — the verdict never restates the dates.
 *   - The mixed-basis caveat is warn ink; a compatible read states the shared
 *     session quietly.
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
      // The dates live in the one as-of line beside this verdict (P1-4).
      verdict = t("verdictMixedBasis");
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
      {/* ONE line (P1-4). Compatible: the verdict already names the shared
          session. Different sessions: the two clocks are stated once here, and
          the caveat follows without repeating them. */}
      <p
        className={compatible ? styles.clocks : styles.verdict}
        data-testid="prophet-today-clocks"
        role={compatible ? undefined : "status"}
      >
        {compatible ? null : (
          <>
            {prophetSectorFill(t("contextClocks"), { sector: sectorClock, prophet: prophetClock })}
            {" · "}
          </>
        )}
        <span data-testid="prophet-today-verdict">{verdict}</span>
      </p>
    </div>
  );
}
