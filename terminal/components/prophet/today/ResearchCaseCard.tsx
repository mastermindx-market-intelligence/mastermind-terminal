"use client";
/**
 * ResearchCaseCard (T2-01 / SX06) — ONE member's Prophet case, reported.
 *
 * Laws:
 *   - P0-1: a case card is NOT a position. It carries no trade direction, no
 *     open date and no "Open plan" badge — under a "the sector is ahead"
 *     headline those three read as trading permission drawn from descriptive
 *     sector strength. Plan membership stays visible only as ONE neutral line
 *     ("Also in Model plans →") that goes to the Plans lane, where direction
 *     and open dates belong.
 *   - A member's state is REPORTED, never recommended: no buy/enter/qualified
 *     language, no confidence theater, no invented verdict.
 *   - Only wire fields render. The fields the wire does not carry for this
 *     member render their designed quiet absence ("not published"), and the
 *     card says plainly that no entry assessment is published — an honest
 *     blank, not a guessed number.
 *   - "Return vs sector" is carried by the wire for GROUPS only; for a member
 *     the card shows its designed unavailable label. The research question is
 *     likewise shown only when the read serves one — nothing is invented in
 *     its place (M2).
 *   - Two actions only: open the company's setup (the depth lives in the
 *     journey), and add/remove the member from the compare selection (`sel`);
 *     plus the one muted plans pointer when a plan exists.
 */
import { useLang } from "@/lib/i18n";
import type { SectorMember } from "@/lib/prophetSectorMembers";
import { makeProphetT } from "../prophetStrings";
import { prophetSectorFill } from "../sector/prophetSectorStrings";
import styles from "./today.module.css";

export function ResearchCaseCard({ member, selected, selectionFull, onToggleCompare, onOpenSetup, onOpenPlans }: {
  member: SectorMember;
  selected: boolean;
  selectionFull: boolean;
  onToggleCompare: (symbol: string) => void;
  onOpenSetup: (symbol: string) => void;
  onOpenPlans: () => void;
}) {
  const { lang } = useLang();
  const t = makeProphetT(lang);
  const prophet = member.prophet;

  return (
    <article
      className={`${styles.caseCard}${selected ? ` ${styles.selected}` : ""}`}
      data-testid="prophet-today-case"
      data-symbol={member.symbol}
    >
      <header className={styles.caseHead}>
        <span className={styles.caseSymbol}>{member.symbol}</span>
      </header>
      <p className={styles.caseName}>
        {member.name ?? member.industry ?? member.symbol}
      </p>

      <dl className={styles.caseFacts}>
        {prophet.observation !== null ? (
          <div>{prophetSectorFill(t("todayObservedSince"), { asof: prophet.observation.asof })}</div>
        ) : null}
        {member.memberSince !== null ? (
          <div>{prophetSectorFill(t("todayMemberSince"), { date: member.memberSince })}</div>
        ) : null}
      </dl>

      <dl className={styles.caseMeasures}>
        <div>
          <dt>{t("todayReturnVsSector")}</dt>
          <dd data-testid="prophet-today-case-vs-sector" className={styles.caseUnavailable}>
            {t("todayNotPublished")}
          </dd>
        </div>
      </dl>

      <p className={styles.caseNote}>{t("todayEntryUnavailable")}</p>

      {/* P0-1: the one neutral plan pointer. No direction, no date, no pill. */}
      {prophet.plan !== null ? (
        <button
          type="button"
          className={styles.casePlansLink}
          data-testid="prophet-today-case-plans"
          aria-label={t("todayAlsoInPlansAria")}
          onClick={onOpenPlans}
        >
          {t("todayAlsoInPlans")} →
        </button>
      ) : null}

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
