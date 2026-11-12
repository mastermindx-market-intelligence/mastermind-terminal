"use client";
/**
 * ResearchCaseCard (T2-01 / SX06) — ONE member's Prophet case, reported.
 *
 * Laws:
 *   - A member's state is REPORTED, never recommended: no buy/enter/qualified
 *     language, no confidence theater, no invented verdict.
 *   - Only wire fields render. The fields the wire does not carry for this
 *     member render their designed quiet absence ("not stated"), and the card
 *     says plainly that no entry assessment is published — an honest blank,
 *     not a guessed number.
 *   - Two actions only: open the company's setup (the depth lives in the
 *     journey), and add/remove the member from the compare selection (`sel`).
 */
import { useLang } from "@/lib/i18n";
import type { SectorMember } from "@/lib/prophetSectorMembers";
import { makeProphetT } from "../prophetStrings";
import {
  makeProphetSectorT, PROPHET_STATE_LABEL_KEY, prophetSectorFill,
} from "../sector/prophetSectorStrings";
import styles from "./today.module.css";

export function ResearchCaseCard({ member, selected, selectionFull, onToggleCompare, onOpenSetup }: {
  member: SectorMember;
  selected: boolean;
  selectionFull: boolean;
  onToggleCompare: (symbol: string) => void;
  onOpenSetup: (symbol: string) => void;
}) {
  const { lang } = useLang();
  const t = makeProphetT(lang);
  const sectorT = makeProphetSectorT(lang);
  const prophet = member.prophet;
  const stateKey = PROPHET_STATE_LABEL_KEY[prophet.state] ?? "stateUnavailable";

  const direction = prophet.plan?.direction === "long"
    ? t("dirLong")
    : prophet.plan?.direction === "short"
      ? t("dirShort")
      : null;

  return (
    <article
      className={`${styles.caseCard}${selected ? ` ${styles.selected}` : ""}`}
      data-testid="prophet-today-case"
      data-symbol={member.symbol}
    >
      <header className={styles.caseHead}>
        <span className={styles.caseSymbol}>{member.symbol}</span>
        <span
          className={`${styles.stateChip} ${prophet.state === "open_plan" ? styles.openPlan : prophet.state === "early_observation" ? styles.early : ""}`}
        >
          {sectorT(stateKey)}
        </span>
      </header>
      <p className={styles.caseName}>
        {member.name ?? member.industry ?? member.symbol}
      </p>

      <dl className={styles.caseFacts}>
        {prophet.plan !== null ? (
          <>
            {direction !== null ? (
              <div>{direction}{prophet.plan.strategy !== null ? ` · ${prophet.plan.strategy}` : ""}</div>
            ) : prophet.plan.strategy !== null ? (
              <div>{prophet.plan.strategy}</div>
            ) : null}
            {prophet.plan.openedOn !== null ? (
              <div>{prophetSectorFill(t("todayOpenedOn"), { date: prophet.plan.openedOn })}</div>
            ) : null}
          </>
        ) : prophet.observation !== null ? (
          <div>{prophetSectorFill(t("todayObservedSince"), { asof: prophet.observation.asof })}</div>
        ) : null}
        {member.memberSince !== null ? (
          <div>{prophetSectorFill(t("todayMemberSince"), { date: member.memberSince })}</div>
        ) : null}
        {prophet.openPlanCount > 1 ? (
          <div>{prophetSectorFill(t("todayPlansCount"), { n: prophet.openPlanCount })}</div>
        ) : null}
      </dl>

      <p className={styles.caseNote}>{t("todayEntryUnavailable")}</p>

      <div className={styles.caseActions}>
        <button
          type="button"
          className={styles.caseButton}
          data-testid="prophet-today-case-setup"
          onClick={() => onOpenSetup(member.symbol)}
        >
          {t("todayCaseOpenSetup")}
        </button>
        <button
          type="button"
          className={`${styles.caseButton}${selected ? ` ${styles.compareOn}` : ""}`}
          data-testid="prophet-today-case-compare"
          aria-pressed={selected}
          disabled={!selected && selectionFull}
          aria-label={selected
            ? prophetSectorFill(t("todayCaseCompareRemove"), { symbol: member.symbol })
            : prophetSectorFill(t("todayCaseCompareAria"), { symbol: member.symbol })}
          onClick={() => onToggleCompare(member.symbol)}
        >
          {selected ? t("todayCaseCompareRemoveShort") : t("todayCaseCompare")}
        </button>
      </div>
    </article>
  );
}
