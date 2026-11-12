"use client";
/**
 * SectorLeadershipHero (SX01) — the market-to-sector assessment that opens the
 * Today board: the focus group's read against the market, in plain words.
 *
 * Laws:
 *   - Every measure nullable; a null renders its owner's reason in the shared
 *     not-stated vocabulary (contextNullKey), never a zero and never an
 *     invented number.
 *   - The owner's own descriptive state label renders verbatim when present.
 *   - Coverage counts are REPORTED facts (open plans, early observations,
 *     served members) — never a quality score or a rank.
 *   - One action per hero: open the group's member population. The numbers
 *     stay context; the journey carries the depth.
 *   - No colored container edges; status is text in semantic ink (2026-10-18).
 */
import { useLang } from "@/lib/i18n";
import type {
  SectorGroupContext, SectorGroupSummary, SectorMembersCompatibility,
} from "@/lib/prophetSectorMembers";
import { makeProphetT } from "../prophetStrings";
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

function Stat({ label, value, tone, nullValue }: {
  label: string; value: string; tone?: "up" | "down"; nullValue?: boolean;
}) {
  return (
    <div className={styles.stat}>
      <span>{label}</span>
      <b
        className={nullValue ? styles.nullValue : undefined}
        style={tone === "up" ? { color: "var(--up)" } : tone === "down" ? { color: "var(--down)" } : undefined}
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

  return (
    <section className={styles.hero} data-testid="prophet-today-hero" aria-labelledby="prophet-today-hero-title">
      <header className={styles.heroHead}>
        <div>
          <p className={styles.heroKicker}>{t("todayFocusLabel")}</p>
          <div className={styles.heroTitle}>
            <h3 id="prophet-today-hero-title">{localName}</h3>
            <span className={styles.heroWindow}>{windowLabel}</span>
          </div>
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

      {ctx.stateLabel ? (
        <p className={styles.ownerLabel} data-testid="prophet-today-owner-label" aria-label={sectorT("contextOwnerLabelAria")}>
          {ctx.stateLabel}
        </p>
      ) : null}

      <div className={styles.heroStats}>
        <Stat
          label={sectorT("contextGroupReturn")}
          value={ctx.groupReturnPct !== null ? pctSigned(ctx.groupReturnPct) : sectorT(contextNullKey(ctx.reasons.group_return_pct))}
          tone={ctx.groupReturnPct === null ? undefined : ctx.groupReturnPct > 0 ? "up" : "down"}
          nullValue={ctx.groupReturnPct === null}
        />
        <Stat
          label={sectorT("contextMarketReturn")}
          value={ctx.marketReturnPct !== null ? pctSigned(ctx.marketReturnPct) : sectorT(contextNullKey(ctx.reasons.market_return_pct))}
          nullValue={ctx.marketReturnPct === null}
        />
        <Stat
          label={sectorT("contextRelative")}
          value={ctx.relativePp !== null ? ppSigned(ctx.relativePp) : sectorT(contextNullKey(ctx.reasons.relative_pp))}
          nullValue={ctx.relativePp === null}
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
