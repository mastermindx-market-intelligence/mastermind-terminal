"use client";
/**
 * MemberCompare (T2-07 / T2-13 · G7) — the selected names' evidence side by
 * side, one card per name, at up to three names.
 *
 * Laws:
 *   - No combined score, rank or winner is ever assigned (banner states it);
 *     the reader compares, the surface does not judge.
 *   - Each case keeps its OWN clock — the two owners' clocks render per card,
 *     and when the reads do not share a session the different-clocks line
 *     (SX09 #08) says so and combined arithmetic stays out.
 *   - Served facts only: Prophet state (reported), the plan's own direction/
 *     phase/opened date, membership lower bound, industry. The per-name
 *     window series and the entry state are NOT on this wire — each card
 *     carries its own designed unavailable line/chip (SX09 vocabulary), never
 *     an invented number and never a shared pretense.
 *   - Back returns to the population with the selection and filters intact
 *     (selection lives above, in the lane's state).
 *   - Cards stack to one column at phone width (T2-13); no horizontal
 *     overflow at 320px.
 */
import type { ReactNode } from "react";
import { useLang } from "@/lib/i18n";
import type { SectorMembersPayload } from "@/lib/prophetSectorMembers";
import { PROPHET_COMPARE_CAP } from "./SectorMemberPopulation";
import {
  makeProphetSectorT, PROPHET_STATE_LABEL_KEY, prophetReasonKey,
  prophetSectorFill,
} from "./prophetSectorStrings";
import styles from "./prophetSector.module.css";

type SymbolPayload = Extract<SectorMembersPayload, { mode: "symbol" }>;

export function MemberCompare({ symbols, payloadOf, stateBlock, onBack, onOpenMember }: {
  /** The lane's selection, in picking order; two minimum, three maximum. */
  symbols: string[];
  /** The decoded symbol read when ready, else null (same order as symbols). */
  payloadOf: (symbol: string) => SymbolPayload | null;
  /** The container's honest fetch-state block for a not-ready card, by the
   * card's index — the container owns one bounded fetch per selected name. */
  stateBlock: (index: number) => ReactNode;
  onBack: () => void;
  onOpenMember: (symbol: string, planId: string | null) => void;
}) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);

  const cards = symbols.map(symbol => ({ symbol, payload: payloadOf(symbol) }));
  const ready = cards.filter(card => card.payload !== null) as { symbol: string; payload: SymbolPayload }[];
  // SX09 #08: the views use different clocks whenever any card's read spans a
  // different session (the date-mismatch family, not a down read — a down
  // read says unavailable, which its own clocks line already carries).
  const mixedClocks = ready.some(card =>
    card.payload.compatibility.status === "stale_sector"
    || card.payload.compatibility.status === "stale_prophet"
    || card.payload.compatibility.status === "mixed_basis");

  return (
    <section className={styles.compare} data-testid="prophet-sector-compare">
      <div className={styles.crumbs}>
        <button type="button" className={styles.backButton} data-testid="prophet-sector-compare-back" onClick={onBack}>
          {t("compareBack")}
        </button>
      </div>

      <header className={styles.compareHead}>
        <h3 className={styles.compareTitle}>{t("compareTitle")}</h3>
        <p className={styles.compareIntro}>{t("compareIntro")}</p>
      </header>

      <div className={styles.selectionChips} data-testid="prophet-sector-compare-chips">
        {symbols.map(symbol => (
          <span key={symbol} className={styles.selectionChip}>{symbol}</span>
        ))}
        {symbols.length < PROPHET_COMPARE_CAP ? (
          <button type="button" className={styles.smallButton} data-testid="prophet-sector-compare-add" onClick={onBack}>
            {t("compareAddName")}
          </button>
        ) : null}
      </div>

      <p className={styles.compareBanner} data-testid="prophet-sector-compare-banner">
        {t("compareNoScore")}
        {mixedClocks ? ` ${t("compareMixedClocks")}` : ""}
      </p>

      <div className={styles.compareGrid}>
        {cards.map(({ symbol, payload }, index) => payload === null ? (
          <div key={symbol}>{stateBlock(index)}</div>
        ) : (
          <CompareCard key={symbol} payload={payload} onOpenMember={onOpenMember} />
        ))}
      </div>

      <p className={styles.compareFooter}>{t("compareFooter")}</p>
    </section>
  );
}

function CompareCard({ payload, onOpenMember }: {
  payload: SymbolPayload;
  onOpenMember: (symbol: string, planId: string | null) => void;
}) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);
  const { symbol, memberOf, prophet, compatibility } = payload;
  const membership = memberOf[0];
  const member = membership?.member ?? null;
  const plan = prophet.plan;
  const planId = plan?.id ?? null;

  const sectorClock = compatibility.sectorSession ?? t("contextUnknown");
  const prophetClock = compatibility.prophetAsof ?? t("contextUnknown");

  const direction = plan !== null
    ? plan.direction === "long" ? t("directionLong")
      : plan.direction === "short" ? t("directionShort")
      : t("contextNotStated")
    : null;

  return (
    <article className={styles.compareCard} data-testid={`prophet-sector-compare-card-${symbol}`}>
      <div className={styles.compareCardHead}>
        <button
          type="button"
          className={styles.compareSymbol}
          aria-label={prophetSectorFill(t("setupAria"), { symbol })}
          data-testid={`prophet-sector-compare-open-${symbol}`}
          onClick={() => onOpenMember(symbol, planId)}
        >
          {symbol}
        </button>
        <span className={styles.compareName}>
          {member?.name ?? symbol}{member?.industry !== null && member?.industry !== undefined ? ` · ${member.industry}` : ""}
        </span>
      </div>
      <p className={styles.compareClocks} data-testid={`prophet-sector-compare-clocks-${symbol}`}>
        {prophetSectorFill(t("contextClocks"), { sector: sectorClock, prophet: prophetClock })}
      </p>

      <dl className={styles.compareDetails}>
        <dt className={styles.compareDetailLabel}>{t("columnState")}</dt>
        <dd className={styles.compareDetailValue}>
          <span className={prophet.state === "unavailable" ? styles.compareUnavailable : undefined}>
            {t(PROPHET_STATE_LABEL_KEY[prophet.state])}
          </span>
          {prophet.state === "none" || prophet.state === "unavailable" ? (
            <span className={styles.stateReason}> · {t(prophetReasonKey(prophet.reason))}</span>
          ) : prophet.observation !== null ? (
            <span className={styles.stateReason}> · {prophetSectorFill(t("setupObservation"), { asof: prophet.observation.asof })}</span>
          ) : null}
        </dd>

        <dt className={styles.compareDetailLabel}>{t("compareDirection")}</dt>
        <dd className={styles.compareDetailValue}>
          {plan !== null ? direction ?? t("contextNotStated") : t("comparePlanNone")}
        </dd>

        <dt className={styles.compareDetailLabel}>{t("comparePhase")}</dt>
        <dd className={styles.compareDetailValue}>
          {plan?.phase ?? t("contextNotStated")}
        </dd>

        <dt className={styles.compareDetailLabel}>{t("compareOpened")}</dt>
        <dd className={styles.compareDetailValue}>
          {plan?.openedOn ?? t("contextNotStated")}
        </dd>

        <dt className={styles.compareDetailLabel}>{t("columnSince")}</dt>
        <dd className={styles.compareDetailValue}>
          {member?.firstKnown !== null && member?.firstKnown !== undefined
            ? prophetSectorFill(t("sinceAtLeast"), { date: member.firstKnown })
            : t("contextNotStated")}
        </dd>

        <dt className={styles.compareDetailLabel}>{t("compareStrategy")}</dt>
        <dd className={styles.compareDetailValue}>
          {plan?.strategy ?? t("contextNotStated")}
        </dd>
      </dl>

      <div className={styles.compareChartBlock}>
        <p className={styles.focusPanelNote}>{prophetSectorFill(t("compareChartUnavailable"), { symbol })}</p>
      </div>
      <span className={styles.compareEntryChip}>{t("compareEntryUnavailable")}</span>
    </article>
  );
}
