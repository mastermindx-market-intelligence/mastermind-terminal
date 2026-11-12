"use client";
/**
 * SectorLeadershipHero (SX01 / SX06 / SX08) — the market-to-sector assessment
 * that opens the Today board: the LEADING sector's read against the market.
 *
 * The headline states the assessment in one sentence built only from the
 * published relative measure ("X is/are ahead of / behind / in line with the
 * market"); the English verb follows the group noun (P2-3). A group whose
 * relative measure is null gets the designed unavailable sentence, never an
 * invented breadth or participation trend the wire does not carry.
 *
 * Laws:
 *   - Every measure nullable; a null renders its owner's reason in the shared
 *     not-available vocabulary (contextNullKey), never a zero and never an
 *     invented number.
 *   - The owner's descriptive state label is mapped through the closed
 *     phase-vocabulary table (P4) — an unknown term renders verbatim.
 *   - Negative and positive measures carry semantic ink (--up / --down), by
 *     meaning, not by container color (P1).
 *   - P1-2: one plain line says WHY this group carries the hero (highest
 *     ranked group with published members) and which group leads overall when
 *     that is a different one, so the hero and the table below cannot read as
 *     a contradiction.
 *   - P1-5: breadth is unavailable for every group in this reading; the hero
 *     states that once in muted words instead of a full stat tile.
 *   - P1-3: plan counts are the Plans lane's; the hero carries no plan pill.
 *   - P1-4: one as-of line for both sessions (TwoClockStrip), in warn ink when
 *     they differ; there is no second, repeated caveat.
 *   - P1-7: the one action is "Inspect sector →" — the group's member
 *     population; full-width on a phone. No invented "next change to watch".
 *   - No colored container edges; status is text in semantic ink (2026-10-18).
 */
import { useLang } from "@/lib/i18n";
import type {
  SectorGroupContext, SectorGroupSummary, SectorMembersCompatibility,
} from "@/lib/prophetSectorMembers";
import { groupNameTakesPlural, makeProphetT, ownerStateLabel } from "../prophetStrings";
import {
  contextNullKey, makeProphetSectorT, prophetSectorFill,
} from "../sector/prophetSectorStrings";
import { TwoClockStrip } from "./TwoClockStrip";
import styles from "./today.module.css";

function pctSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
function ppSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
}

/** +0.0 pp is neither ahead nor behind; a hair of tolerance keeps the sentence
 * from flipping on a rounded zero. */
const RELATIVE_FLAT = 0.05;

function Stat({ label, value, tone, nullValue, testId }: {
  label: string; value: string; tone?: "up" | "down"; nullValue?: boolean; testId?: string;
}) {
  return (
    <div className={styles.stat}>
      <span>{label}</span>
      <b
        className={nullValue ? styles.nullValue : tone === "up" ? styles.numUp : tone === "down" ? styles.numDown : undefined}
        data-testid={testId}
      >
        {value}
      </b>
    </div>
  );
}

export function SectorLeadershipHero({ group, compatibility, onOpenGroup, derivedFocus = false, leadGroup = null, leadUnpublished = false }: {
  group: SectorGroupSummary;
  compatibility: SectorMembersCompatibility;
  onOpenGroup: (groupId: string) => void;
  /** The hero is the derived focus (top-return group with published members),
   * not a deep link — only then does the rank line apply. */
  derivedFocus?: boolean;
  /** The highest-ranked group overall, when different from the hero. */
  leadGroup?: string | null;
  /** The overall leader's members were observed absent from this reading. */
  leadUnpublished?: boolean;
}) {
  const { lang } = useLang();
  const t = makeProphetT(lang);
  const sectorT = makeProphetSectorT(lang);
  const ctx: SectorGroupContext = group.context;
  const localName = (lang === "zh" ? group.nameZh || group.name : group.name) || group.id;

  const windowLabel = ctx.windowSessions !== null
    ? prophetSectorFill(sectorT("contextWindow"), { n: ctx.windowSessions })
    : sectorT(contextNullKey(ctx.reasons.window_sessions));

  // The assessment: one plain sentence from the published relative measure.
  // Null → the designed unavailable sentence; the wire publishes no breadth
  // trend for this reading, so no "gaining participation" claim is invented.
  const relative = ctx.relativePp;
  const plural = groupNameTakesPlural(localName);
  const verbKey = relative === null
    ? "todayHeroUnavailable"
    : relative > RELATIVE_FLAT
      ? (plural ? "todayHeroAheadPlural" : "todayHeroAhead")
      : relative < -RELATIVE_FLAT
        ? (plural ? "todayHeroBehindPlural" : "todayHeroBehind")
        : (plural ? "todayHeroEvenPlural" : "todayHeroEven");
  const assessment = prophetSectorFill(t(verbKey), { group: localName });

  const groupReturnTone = ctx.groupReturnPct === null ? undefined : ctx.groupReturnPct > 0 ? "up" : ctx.groupReturnPct < 0 ? "down" : undefined;
  const marketReturnTone = ctx.marketReturnPct === null ? undefined : ctx.marketReturnPct > 0 ? "up" : ctx.marketReturnPct < 0 ? "down" : undefined;
  const relativeTone = relative === null ? undefined : relative > 0 ? "up" : relative < 0 ? "down" : undefined;

  return (
    <section className={styles.hero} data-testid="prophet-today-hero" aria-labelledby="prophet-today-hero-title">
      <header className={styles.heroHead}>
        <div className={styles.heroLead}>
          <p className={styles.heroKicker}>{t("todayHeroKicker")}</p>
          <h3 id="prophet-today-hero-title" className={styles.heroHeadline}>{assessment}</h3>
          <p className={styles.heroMeta}>
            <span className={styles.heroGroup}>{localName}</span>
            <span>{windowLabel}</span>
            {ctx.stateLabel !== null ? (
              <span className={styles.ownerLabel} data-testid="prophet-today-owner-label" aria-label={sectorT("contextOwnerLabelAria")}>
                {ownerStateLabel(lang, ctx.stateLabel)}
              </span>
            ) : null}
          </p>
          {derivedFocus ? (
            <p className={styles.heroRank} data-testid="prophet-today-rank">
              {t("todayHeroRankLine")}
              {leadGroup !== null ? ` · ${prophetSectorFill(
                leadUnpublished ? t("todayHeroRankLeadUnpublished") : t("todayHeroRankLead"),
                { group: leadGroup },
              )}` : ""}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className={`${styles.linkButton} ${styles.heroAction}`}
          data-testid="prophet-today-open-group"
          aria-label={prophetSectorFill(t("todayOpenGroupAria"), { group: localName })}
          onClick={() => onOpenGroup(group.id)}
        >
          {t("todayOpenGroup")} →
        </button>
      </header>

      <div className={styles.heroStats}>
        <Stat
          label={sectorT("contextGroupReturn")}
          value={ctx.groupReturnPct !== null ? pctSigned(ctx.groupReturnPct) : sectorT(contextNullKey(ctx.reasons.group_return_pct))}
          tone={groupReturnTone}
          nullValue={ctx.groupReturnPct === null}
        />
        <Stat
          label={sectorT("contextMarketReturn")}
          value={ctx.marketReturnPct !== null ? pctSigned(ctx.marketReturnPct) : sectorT(contextNullKey(ctx.reasons.market_return_pct))}
          tone={marketReturnTone}
          nullValue={ctx.marketReturnPct === null}
        />
        <Stat
          label={sectorT("contextRelative")}
          value={relative !== null ? ppSigned(relative) : sectorT(contextNullKey(ctx.reasons.relative_pp))}
          tone={relativeTone}
          nullValue={relative === null}
        />
        {ctx.breadth !== null ? (
          <Stat
            label={sectorT("contextBreadth")}
            value={`${ctx.breadth.aboveTrend}/${ctx.breadth.measured}`}
          />
        ) : null}
      </div>

      {/* P1-5: one muted line instead of a full unavailable stat tile. */}
      {ctx.breadth === null ? (
        <p className={styles.heroBreadth} data-testid="prophet-today-breadth-unavailable">
          {t("todayHeroBreadthLine")}
        </p>
      ) : null}

      {/* P1-3: plan counts belong to the Plans lane; only the coverage fact
          this hero is about (how many members the read serves) stays. */}
      <div className={styles.coverage}>
        <span className={styles.coverageChip}>
          {prophetSectorFill(t("todayServedMembers"), { n: group.counts.served })}
        </span>
      </div>

      <TwoClockStrip compatibility={compatibility} />
    </section>
  );
}
