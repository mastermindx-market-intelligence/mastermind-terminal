"use client";
/**
 * SectorFocus (SX02 · G4) — the group's own page inside Prophet: the market
 * comparison first, then what would test the move, then the road to the
 * members. New surface; the panels the wire does not carry yet render their
 * DESIGNED unavailable states (amber uncertainty vocabulary, SX09 #05), never
 * invented numbers and never an empty-looking gap.
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

export function SectorFocus({ group, compatibility, memberCount, onOpenPopulation, onBack }: {
  group: SectorGroupDescriptor;
  compatibility: SectorMembersCompatibility;
  /** configured members when the group read carries counts; served as the
   * fallback; null only when no count is known — then no number is shown. */
  memberCount: number | null;
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

  return (
    <section className={styles.focus} data-testid="prophet-sector-focus">
      <div className={styles.crumbs}>
        <button type="button" className={styles.backButton} data-testid="prophet-sector-focus-back" onClick={onBack}>
          ← {t("backToGroups")}
        </button>
      </div>

      <header className={styles.focusHead}>
        <h3 className={styles.focusTitle}>{localName}</h3>
        <p className={styles.focusIntro}>{intro}</p>
        <div className={styles.focusChips}>
          <span className={styles.focusChip}>{windowChip}</span>
          {group.benchmark !== null ? (
            <span className={styles.focusChip}>{prophetSectorFill(t("focusBenchmarkChip"), { ticker: group.benchmark })}</span>
          ) : null}
          {closeChip !== null ? <span className={styles.focusChip}>{closeChip}</span> : null}
        </div>
        <div className={styles.focusActions}>
          <button
            type="button"
            className={styles.smallButton}
            data-testid="prophet-sector-focus-members"
            onClick={onOpenPopulation}
          >
            {memberCount !== null
              ? prophetSectorFill(t("focusViewMembers"), { n: memberCount })
              : t("focusResearchNames")}
          </button>
        </div>
      </header>

      {/* The read's own numbers, both clocks and the compatibility verdict —
          plus the G22 relative-leader line when the numbers say so. */}
      <SectorContextStrip group={group} compatibility={compatibility} />

      <section className={styles.focusPanel} data-testid="prophet-sector-focus-participation">
        <h4 className={styles.focusPanelTitle}>{t("focusParticipationTitle")}</h4>
        <p className={styles.focusPanelNote}>{t("focusChartUnavailable")}</p>
      </section>

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

      <section className={styles.focusPanel} data-testid="prophet-sector-focus-industry">
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

      <section className={styles.focusPanel} data-testid="prophet-sector-focus-timeline">
        <h4 className={styles.focusPanelTitle}>{t("focusTimelineTitle")}</h4>
        <p className={styles.focusPanelBody}>{t("focusTimelineUnavailable")}</p>
      </section>

      <section className={styles.focusPanel} data-testid="prophet-sector-focus-outlook">
        <h4 className={styles.focusPanelTitle}>{t("focusOutlookTitle")}</h4>
        <span className={styles.outlookChip}>{t("focusOutlookChip")}</span>
        <p className={styles.focusPanelBody}>{t("focusOutlookBody")}</p>
        <p className={styles.focusPanelNote}>{t("focusAgeUnavailable")}</p>
      </section>
    </section>
  );
}
