"use client";
/**
 * CaseHeader — the 3–4 second orientation on the T2-C5 case-unpublished
 * design: the arrival breadcrumb (group · members · symbol selected), who the
 * company is, the honest headline ("Case not published yet" — no written case
 * verdict is served by any wire, so none is invented), and the served Prophet
 * state as ONE chip. Paper T2-C5 puts no clocks, no quote line and no verdict
 * card in this header; the dates that matter live on the rows that own them
 * (the plan row says "Opened …", the card says "Latest observation …").
 *
 * P1-1: the largest type no longer says a plan is running — that was the only
 * stance a reader took away, and it paired with a trade ticket in the rail.
 * P1-4: no date is labeled "Assessment" unless it is a real assessment.
 * P1-5: no "group(s)" plural, no raw group ids.
 *
 * The back control is an anchor once a post-hydration effect has computed the
 * population href, so the return is a real link that carries prophetSymbol
 * (the population row it came from keeps its identity). Before hydration, and
 * wherever no href was computed, it falls back to the onBack button,
 * preserving the sector lane's props contract.
 */
import type { MouseEvent } from "react";
import type { Lang } from "@/lib/i18n";
import type { SectorMemberProphet } from "@/lib/prophetSectorMembers";
import { makeProphetSectorT } from "../sector/prophetSectorStrings";
import { makeSetupT } from "./setupStrings";
import styles from "./setup.module.css";

/** Preserve native link gestures while keeping ordinary returns in the lane,
 * where selection, scroll and heading focus are restored together. */
export function handleCaseBackClick(event: MouseEvent<HTMLAnchorElement>, onBack: () => void) {
  if (event.defaultPrevented || event.button !== 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onBack();
}

export function CaseHeader({ symbol, name, prophet, groupName, onBack, backHref, lang }: {
  symbol: string;
  name: string | null;
  prophet: SectorMemberProphet;
  /** The group the reader arrived from, by display name — names the
   * breadcrumb; null only when the wire carries no membership. */
  groupName: string | null;
  onBack: () => void;
  /** Population href computed post-hydration (keeps prophetSymbol); null →
   * render the onBack button fallback (server render + first client render). */
  backHref: string | null;
  lang: Lang;
}) {
  const t = makeSetupT(lang);
  const sectorT = makeProphetSectorT(lang);
  const stateLabel = sectorT(prophet.state === "open_plan" ? "stateOpenPlan"
    : prophet.state === "early_observation" ? "stateEarly"
    : prophet.state === "resolved_plan" ? "stateResolved"
    : prophet.state === "none" ? "stateNone" : "stateUnavailable");
  // The crumb names the group and the kept selection; the short form keeps
  // the same meaning at phone width, where the group name would wrap.
  const crumb = (group: string | null) => (
    <>
      <span className={styles.backLong}>
        ← {group ?? t("crumbsShort")} · {t("crumbsMembers")} · {symbol} {t("crumbsSelected")}
      </span>
      <span className={styles.backShort}>
        ← {t("crumbsShort")} · {symbol} {t("crumbsSelected")}
      </span>
    </>
  );

  return (
    <header className={styles.caseHead} data-testid="case-header">
      {backHref !== null ? (
        <a className={styles.backButton} data-testid="prophet-sector-setup-back" href={backHref} onClick={event => handleCaseBackClick(event, onBack)}>
          {crumb(groupName)}
        </a>
      ) : (
        <button type="button" className={styles.backButton} data-testid="prophet-sector-setup-back" onClick={onBack}>
          {crumb(groupName)}
        </button>
      )}
      {/* T2-03 eyebrow: the ticker identifies, it does not lead. */}
      <p className={styles.caseCompany}>
        <b>{symbol}</b>{name ? <> · {name}</> : null}
      </p>
      <h3 className={styles.caseTitle} data-testid="case-stance">{t("caseUnpublished")}</h3>
      <div className={styles.caseChips}>
        <span className={styles.chip} data-testid="case-state-chip">{stateLabel}</span>
      </div>
    </header>
  );
}
