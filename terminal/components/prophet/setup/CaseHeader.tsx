"use client";
/**
 * CaseHeader — the 3–4 second orientation (doctrine Law 1): who the company
 * is, what Prophet currently reports about it (served state, plain words), the
 * two labeled clocks, and the honest verdict state. T2-03: the stance line IS
 * the large heading (the case's answer leads); the ticker is demoted to the
 * eyebrow row. The written case verdict itself is not served by the wire, so
 * it renders as a designed unavailable state — never an invented headline (G8).
 *
 * The back control is an anchor once a post-hydration effect has computed the
 * population href, so "Back to population" is a real link that carries
 * prophetSymbol (fix order item 10 — the population row it came from keeps
 * its identity; highlight/scroll there is the population surface's own work).
 * Before hydration, and wherever no href was computed, it falls back to the
 * onBack button, preserving the sector lane's props contract.
 */
import type { Lang } from "@/lib/i18n";
import type { SectorMemberProphet } from "@/lib/prophetSectorMembers";
import { makeProphetSectorT, prophetSectorFill } from "../sector/prophetSectorStrings";
import { makeSetupT, stanceKey } from "./setupStrings";
import styles from "./setup.module.css";

export function CaseHeader({ symbol, name, prophet, assessmentAsof, windowSessions, groupCount, onBack, backHref, backLabel, lang }: {
  symbol: string;
  name: string | null;
  prophet: SectorMemberProphet;
  /** Best served assessment date: the observation's, else the plan's own. */
  assessmentAsof: string | null;
  windowSessions: number | null;
  groupCount: number;
  onBack: () => void;
  /** Population href computed post-hydration (keeps prophetSymbol); null →
   * render the onBack button fallback (server render + first client render). */
  backHref: string | null;
  backLabel: string;
  lang: Lang;
}) {
  const t = makeSetupT(lang);
  const sectorT = makeProphetSectorT(lang);
  const stance = t(stanceKey(prophet.state));

  return (
    <header className={styles.caseHead} data-testid="case-header">
      {backHref !== null ? (
        <a className={styles.backButton} data-testid="prophet-sector-setup-back" href={backHref}>
          ← {backLabel}
        </a>
      ) : (
        <button type="button" className={styles.backButton} data-testid="prophet-sector-setup-back" onClick={onBack}>
          ← {backLabel}
        </button>
      )}
      <p className={styles.caseKicker}>{t("caseKicker")}</p>
      {/* T2-03 eyebrow: the ticker identifies, it does not lead. */}
      <p className={styles.caseCompany}>
        <b>{symbol}</b>{name ? <> · {name}</> : null}
      </p>
      <h3 className={styles.caseTitle} data-testid="case-stance">{stance}</h3>
      <div className={styles.caseChips}>
        <span className={styles.chip}>{sectorT(prophet.state === "open_plan" ? "stateOpenPlan"
          : prophet.state === "early_observation" ? "stateEarly"
          : prophet.state === "resolved_plan" ? "stateResolved"
          : prophet.state === "none" ? "stateNone" : "stateUnavailable")}</span>
        {windowSessions !== null ? (
          <span className={styles.chip}>{prophetSectorFill(sectorT("contextWindow"), { n: windowSessions })}</span>
        ) : null}
        {groupCount > 0 ? (
          <span className={styles.chip}>{prophetSectorFill(sectorT("setupInGroups"), { n: groupCount })}</span>
        ) : null}
      </div>

      {/* Two clocks, both labeled — assessment is served, the quote clock is
          not: this surface carries no live quote feed (T2-16 vocabulary). */}
      <div className={styles.clocks} data-testid="case-clocks">
        <div className={styles.clock} data-testid="case-clock-assessment">
          <span>{t("clockAssessmentLabel")}</span>
          <b>{assessmentAsof ?? t("clockAssessmentNone")}</b>
        </div>
        <div className={`${styles.clock} ${styles.clockMissing}`}>
          <span>{t("clockQuote")}</span>
          <b>{t("clockQuoteNote")}</b>
        </div>
      </div>

      {/* G8: the verdict headline is designed-but-unserved. */}
      <div className={styles.verdict} data-testid="case-verdict">
        <p className={styles.verdictLabel}>{t("verdictLabel")}</p>
        <p className={styles.verdictUnavailable}>{t("verdictUnavailable")}</p>
        <p className={styles.verdictBody}>{t("verdictBody")}</p>
      </div>
    </header>
  );
}
