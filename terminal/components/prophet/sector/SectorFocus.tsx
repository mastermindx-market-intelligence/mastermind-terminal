"use client";
/**
 * SectorFocus (SX02 · G4) — the group's own page inside Prophet: the market
 * comparison first, then the road to the members. The panels the wire does not
 * carry are collapsed to ONE plain line (P1-4), never four refusal panels:
 * breadth, concentration, industries and history keep their honest limitation
 * in one sentence, and Sector Intelligence stays a link, never a copy.
 *
 * Reading order follows SX02-C1/C3 on phones (P1-6): heading and chips, then
 * the group's numbers, then the members action. At desktop the numbers own the
 * left column and the action rail sits top-right (SX02/1FLQ); the grid areas
 * make both orders one DOM.
 *
 * Fail-closed group read (A1-9/A2-4): when the group read says `group: null`,
 * the lead line, context numbers and member count are NOT served — the page
 * drops them and states the not-served block (PROV-26O4), handing the reader to
 * the full population with no count.
 *
 * Fence: the industry table, window series, concentration and rotation
 * timeline are Sector Intelligence's to produce.
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

/** SX02's breadcrumb destination. Lane A's `/prophet` Today route arrives with
 * #1480; until the ordered merge lands, Today is the Prophet board, so the
 * breadcrumb and the return control keep a real destination. */
const TODAY_HREF = "/options?tab=prophet";

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
        <Link
          className={styles.crumbLink}
          href={TODAY_HREF}
          data-testid="prophet-sector-focus-breadcrumb"
        >
          {t("focusBreadcrumbToday")} · {t("focusBreadcrumbMarket")}
        </Link>
      </div>

      {/* One DOM for both compositions. Desktop areas: numbers left, action
          rail top-right, the single limitation line right. Phones keep the DOM
          order — heading/chips, numbers, then the action. */}
      <div className={styles.focusFlow} data-testid="prophet-sector-focus-grid">
        <header className={styles.focusHeadMain}>
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
        </header>

        <div className={styles.focusNumbers}>
          {/* SX02: the read's own numbers — or, when the group read failed
              closed, the designed not-served block in their place. */}
          {groupUnavailable ? (
            <div className={styles.focusNotServed} data-testid="prophet-sector-focus-not-served" role="status">
              <h4 className={styles.focusNotServedTitle}>{t("focusNotServedTitle")}</h4>
              <p className={styles.focusPanelBody}>{t("focusNotServedBody")}</p>
            </div>
          ) : (
            <SectorContextStrip group={group} compatibility={compatibility} />
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
          <Link
            className={styles.focusReturnToday}
            href={TODAY_HREF}
            data-testid="prophet-sector-focus-return-today"
          >
            {t("focusReturnToday")}
          </Link>
        </div>

        <section className={styles.focusUnavailable} data-testid="prophet-sector-focus-unavailable">
          <p className={styles.focusPanelNote}>{t("focusUnavailableLine")}</p>
          <Link
            className={styles.siLink}
            href={`/sectors?group=${encodeURIComponent(group.id)}`}
            data-testid="prophet-sector-focus-si"
            aria-label={t("siLinkAria")}
          >
            {t("siLink")}
          </Link>
        </section>
      </div>

      <p className={styles.focusDisclaimer} data-testid="prophet-sector-focus-disclaimer">
        {t("focusDisclaimer")}
      </p>
    </section>
  );
}
