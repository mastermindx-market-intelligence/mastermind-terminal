"use client";
/**
 * SectorLeadershipHero (SX01 / SX06 / SX08) — the market-to-sector assessment
 * that opens the Today board: the LEADING sector's read against the market.
 *
 * The headline states the assessment in one sentence built only from the
 * published relative measure ("X is ahead of / behind / in line with the
 * market"); a group whose relative measure is null gets the designed
 * unavailable sentence, never an invented breadth or participation trend the
 * wire does not carry.
 *
 * Laws:
 *   - Every measure nullable; a null renders its owner's reason in the shared
 *     not-stated vocabulary (contextNullKey), never a zero and never an
 *     invented number.
 *   - The owner's descriptive state label is mapped through the closed
 *     phase-vocabulary table (P4) — an unknown term renders verbatim.
 *   - Negative and positive measures carry semantic ink (--up / --down), by
 *     meaning, not by container color (P1).
 *   - Coverage counts are REPORTED facts, never a quality score or a rank.
 *   - One action per hero: open the group's member population. The numbers
 *     stay context; the journey carries the depth.
 *   - No colored container edges; status is text in semantic ink (2026-10-18).
 */
import { useLang } from "@/lib/i18n";
import type {
  SectorGroupContext, SectorGroupSummary, SectorMembersCompatibility,
} from "@/lib/prophetSectorMembers";
import { makeProphetT, ownerStateLabel } from "../prophetStrings";
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

export function SectorLeadershipHero({ group, compatibility, onOpenGroup }: {
  group: SectorGroupSummary;
  compatibility: SectorMembersCompatibility;
  onOpenGroup: (groupId: string) => void;
}) {
  const { lang } = useLang();
  const t = makeProphetT(lang);
  const sectorT = makeProphetSectorT(lang);
  const ctx: SectorGroupContext = group.context;
  const localName = (lang === "zh" ? group.nameZh || group.name : group.name) || group.id;

  const breadth = ctx.breadth !== null
    ? `${ctx.breadth.aboveTrend}/${ctx.breadth.measured}`
    : sectorT(contextNullKey(ctx.reasons.breadth));
  const windowLabel = ctx.windowSessions !== null
    ? prophetSectorFill(sectorT("contextWindow"), { n: ctx.windowSessions })
    : sectorT(contextNullKey(ctx.reasons.window_sessions));

  // The assessment: one plain sentence from the published relative measure.
  // Null → the designed unavailable sentence; the wire publishes no breadth
  // trend for this reading, so no "gaining participation" claim is invented.
  const relative = ctx.relativePp;
  const assessment = relative === null
    ? t("todayHeroUnavailable")
    : prophetSectorFill(
      t(relative > RELATIVE_FLAT ? "todayHeroAhead" : relative < -RELATIVE_FLAT ? "todayHeroBehind" : "todayHeroEven"),
      { group: localName },
    );

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
        </div>
        <button
          type="button"
          className={styles.linkButton}
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
        <Stat
          label={sectorT("contextBreadth")}
          value={breadth}
          nullValue={ctx.breadth === null}
        />
      </div>

      <div className={styles.coverage}>
        <span className={styles.coverageChip}>
          {t("todayOpenPlans")} <b data-testid="prophet-today-open-plans">{group.counts.openPlan}</b>
        </span>
        <span className={styles.coverageChip}>
          {t("todayEarlyObs")} <b>{group.counts.earlyObservation}</b>
        </span>
        <span className={styles.coverageChip}>
          {prophetSectorFill(t("todayServedMembers"), { n: group.counts.served })}
        </span>
      </div>

      <TwoClockStrip compatibility={compatibility} />
    </section>
  );
}
