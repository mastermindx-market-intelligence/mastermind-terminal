"use client";
/**
 * SectorFocus (SX02 · G4) — the group's own page inside Prophet: the market
 * comparison first, then what would test the move, then the road to the
 * members. New surface; the panels the wire does not carry yet render their
 * DESIGNED unavailable states (amber uncertainty vocabulary, SX09 #05), never
 * invented numbers and never an empty-looking gap.
 *
 * At desktop width the composition follows SX02/1FLQ: the numbers and the
 * participation panel own the left column, the challenge and outlook cards the
 * right, and the industry and timeline sections span both. Below that the same
 * blocks stack in reading order.
 *
 * Fail-closed group read (A1-9/A2-4): when the group read says `group: null`,
 * the lead line, context numbers and member count are NOT served — the page
 * drops them and states the not-served block (PROV-26O4), handing the reader to
 * the full population with no count.
 *
 * Fence: the industry table, window series, concentration and rotation
 * timeline are Sector Intelligence's to produce. Their panels name what is
 * missing in plain words and hand the reader to Sector Intelligence by link
 * only — no second implementation here.
 */
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import type {
  SectorGroupDescriptor, SectorMembersCompatibility,
} from "@/lib/prophetSectorMembers";
import { SectorContextStrip } from "./SectorContextStrip";
import {
  contextNullKey, makeProphetSectorT, prophetSectorFill,
} from "./prophetSectorStrings";
import styles from "./prophetSector.module.css";

export function SectorFocus({ group, compatibility, memberCount, groupUnavailable,
  onOpenPopulation, onBack }: {
  group: SectorGroupDescriptor;
  compatibility: SectorMembersCompatibility;
  /** configured members when the group read carries counts; served as the
   * fallback; null only when no count is known — then no number is shown. */
  memberCount: number | null;
  /** The group read failed closed (group null): no served measures exist for
   * this group, so the numbers, count and lead line must not render. */
  groupUnavailable: boolean;
  onOpenPopulation: () => void;
  onBack: () => void;
}) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);
  const ctx = group.context;
  const localName = (lang === "zh" ? group.nameZh || group.name : group.name) || group.id;

  // The hero line follows the read, not the mockup's illustrative case: the
  // same designed voice, chosen by what the numbers actually say.
  const intro = ctx.relativePp !== null && ctx.relativePp > 0 ? t("focusLeadIntro")
    : ctx.relativePp !== null && ctx.relativePp < 0 ? t("focusLagIntro")
    : t("focusFlatIntro");

  const windowChip = ctx.windowSessions !== null
    ? prophetSectorFill(t("contextWindow"), { n: ctx.windowSessions })
    : t(contextNullKey(ctx.reasons.window_sessions));
  const closeChip = compatibility.sectorSession !== null
    ? prophetSectorFill(t("focusCloseChip"), { session: compatibility.sectorSession })
    : null;

  // The primary action names the real destination (SX02). Without a served
  // member count — or after a fail-closed group read — it uses the count-free
  // full-population wording instead (PROV-26O4).
  const membersLabel = groupUnavailable || memberCount === null
    ? t("focusOpenPopulation")
    : t("focusViewMembers");

  return (
    <section className={styles.focus} data-testid="prophet-sector-focus">
      <div className={styles.crumbs}>
        <button type="button" className={styles.backButton} data-testid="prophet-sector-focus-back" onClick={onBack}>
          ← {t("backToGroups")}
        </button>
      </div>

      <header className={styles.focusHead}>
        <div className={styles.focusHeadMain}>
          <h3 className={styles.focusTitle} data-view-heading tabIndex={-1}>{localName}</h3>
          {groupUnavailable ? null : <p className={styles.focusIntro}>{intro}</p>}
          {groupUnavailable ? null : (
            <div className={styles.focusChips}>
              <span className={styles.focusChip}>{windowChip}</span>
              {group.benchmark !== null ? (
                <span className={styles.focusChip}>{prophetSectorFill(t("focusBenchmarkChip"), { ticker: group.benchmark })}</span>
              ) : null}
              {closeChip !== null ? <span className={styles.focusChip}>{closeChip}</span> : null}
            </div>
          )}
        </div>
        <div className={styles.focusActions}>
          <button
            type="button"
            className={styles.focusPrimary}
            data-testid="prophet-sector-focus-members"
            onClick={onOpenPopulation}
          >
            {membersLabel}
          </button>
        </div>
      </header>

      <div className={styles.focusGrid} data-testid="prophet-sector-focus-grid">
        <div className={styles.focusCol}>
          {/* SX02: the read's own numbers own the left column, above the
              participation panel — or, when the group read failed closed, the
              designed not-served block in their place (PROV-26XZ). */}
          {groupUnavailable ? (
            <div className={styles.focusNotServed} data-testid="prophet-sector-focus-not-served" role="status">
              <h4 className={styles.focusNotServedTitle}>{t("focusNotServedTitle")}</h4>
              <p className={styles.focusPanelBody}>{t("focusNotServedBody")}</p>
            </div>
          ) : (
            <SectorContextStrip group={group} compatibility={compatibility} />
          )}
          <section className={styles.focusPanel} data-testid="prophet-sector-focus-participation">
            <h4 className={styles.focusPanelTitle}>{t("focusParticipationTitle")}</h4>
            <p className={styles.focusPanelNote}>
              {t(groupUnavailable ? "focusChartUnavailableNoRead" : "focusChartUnavailable")}
            </p>
          </section>
        </div>

        <div className={styles.focusColSide}>
          <section className={styles.focusPanel} data-testid="prophet-sector-focus-challenge">
            <h4 className={styles.focusPanelTitle}>{t("focusChallengeTitle")}</h4>
            <p className={styles.focusPanelBody}>{t("focusChallengeUnavailable")}</p>
            <p className={styles.focusPanelNote}>{t("focusChallengeNote")}</p>
            <Link
              className={styles.siLink}
              href={`/sectors?group=${encodeURIComponent(group.id)}`}
              data-testid="prophet-sector-focus-si"
              aria-label={t("siLinkAria")}
            >
              {t("siLink")}
            </Link>
          </section>

          <section className={styles.focusPanel} data-testid="prophet-sector-focus-outlook">
            <h4 className={styles.focusPanelTitle}>{t("focusOutlookTitle")}</h4>
            <span className={styles.outlookChip}>{t("focusOutlookChip")}</span>
            <p className={styles.focusPanelBody}>{t("focusOutlookBody")}</p>
            <p className={styles.focusPanelNote}>{t("focusAgeUnavailable")}</p>
          </section>
        </div>

        <section className={`${styles.focusPanel} ${styles.focusPanelWide}`} data-testid="prophet-sector-focus-industry">
          <h4 className={styles.focusPanelTitle}>{t("focusIndustryTitle")}</h4>
          <p className={styles.focusPanelBody}>{t("focusIndustryUnavailable")}</p>
          <Link
            className={styles.siLink}
            href={`/sectors?group=${encodeURIComponent(group.id)}`}
            aria-label={t("siLinkAria")}
          >
            {t("siLink")}
          </Link>
        </section>

        <section className={`${styles.focusPanel} ${styles.focusPanelWide}`} data-testid="prophet-sector-focus-timeline">
          <h4 className={styles.focusPanelTitle}>{t("focusTimelineTitle")}</h4>
          <p className={styles.focusPanelBody}>{t("focusTimelineUnavailable")}</p>
        </section>
      </div>

      <p className={styles.focusDisclaimer} data-testid="prophet-sector-focus-disclaimer">
        {t("focusDisclaimer")}
      </p>
    </section>
  );
}
