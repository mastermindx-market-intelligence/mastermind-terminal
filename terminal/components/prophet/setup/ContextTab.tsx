"use client";
/**
 * ContextTab (T2-17) — the relationships behind the name, collapsed to what
 * the wire actually serves (P1-2): group membership, with each group stated by
 * its DISPLAY NAME (never a raw id — P1-5), and ONE plain line for the rest.
 *
 * What was here — economic exposure, theme membership, a dated peer
 * comparison, Foresight and Winner health, each in its own "Not served" card —
 * filled a whole destination with five restatements of the same absence.
 * Every group the member belongs to already appears in `member_of`, so the
 * cross-listing ids carried by `also_in_groups` added nothing reader-facing
 * and are no longer printed.
 */
import type { Lang } from "@/lib/i18n";
import type { SectorMembersPayload } from "@/lib/prophetSectorMembers";
import { makeSetupT } from "./setupStrings";
import styles from "./setup.module.css";

type SymbolPayload = Extract<SectorMembersPayload, { mode: "symbol" }>;

export function ContextTab({ payload, lang }: { payload: SymbolPayload; lang: Lang }) {
  const t = makeSetupT(lang);

  return (
    <div className={styles.caseMain} data-testid="context-tab" role="tabpanel" id="case-panel-context" aria-labelledby="case-tab-context">
      <section className={styles.card} data-testid="context-membership">
        <h4 className={styles.cardTitle}>{t("membershipTitle")}</h4>
        <ul className={styles.groupList}>
          {payload.memberOf.map(({ group }) => (
            <li key={group.id} className={styles.groupRow}>
              <span className={styles.groupName}>
                {lang === "zh" ? (group.nameZh || group.name || group.id) : (group.name || group.id)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className={styles.emptyCopy} data-testid="context-unavailable">{t("contextUnavailable")}</p>
    </div>
  );
}
