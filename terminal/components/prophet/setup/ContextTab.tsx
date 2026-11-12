"use client";
/**
 * ContextTab (T2-17) — the relationships behind the name. Group membership is
 * served by the sector contract; its dated membership line stays on the Setup
 * destination only (fix order item 15 — said once, where the study lives), so
 * the rows here carry the group and its cross-listings. Economic exposure,
 * theme membership, the dated peer comparison, Foresight and Winner health
 * are not served: designed unavailable states that name the block instead of
 * hiding it (G13; fix order item 8).
 */
import type { Lang } from "@/lib/i18n";
import type { SectorMembersPayload } from "@/lib/prophetSectorMembers";
import { makeProphetSectorT, prophetSectorFill } from "../sector/prophetSectorStrings";
import { makeSetupT } from "./setupStrings";
import styles from "./setup.module.css";

type SymbolPayload = Extract<SectorMembersPayload, { mode: "symbol" }>;

export function ContextTab({ payload, lang }: { payload: SymbolPayload; lang: Lang }) {
  const t = makeSetupT(lang);
  const sectorT = makeProphetSectorT(lang);

  return (
    <div className={styles.caseMain} data-testid="context-tab" role="tabpanel" id="case-panel-context" aria-labelledby="case-tab-context">
      <p className={styles.cardIntro} style={{ padding: "0 2px" }}>{t("contextIntro")}</p>

      <section className={styles.card} data-testid="context-membership">
        <h4 className={styles.cardTitle}>{t("membershipTitle")}</h4>
        <ul className={styles.groupList}>
          {payload.memberOf.map(({ group, member }) => {
            const groupName = lang === "zh"
              ? (group.nameZh || group.name || group.id)
              : (group.name || group.id);
            return (
              <li key={group.id} className={styles.groupRow}>
                <span className={styles.groupName}>{groupName}</span>
                {member.alsoInGroups.length > 0 ? (
                  <span className={styles.groupMeta}>
                    {prophetSectorFill(sectorT("alsoIn"), { groups: member.alsoInGroups.join(", ") })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className={styles.card} data-testid="context-relationships">
        <h4 className={styles.cardTitle}>{t("relationshipsTitle")}</h4>
        <ul className={styles.obsRows}>
          <li className={styles.obsRow}>
            <span className={styles.obsRowLabel}>{t("relPeer")}</span>
            <span>{t("relPeerBody")}</span>
          </li>
          <li className={styles.obsRow}>
            <span className={styles.obsRowLabel}>{t("relEconomic")}</span>
            <span>{t("relEconomicBody")}</span>
          </li>
          <li className={styles.obsRow}>
            <span className={styles.obsRowLabel}>{t("relTheme")}</span>
            <span>{t("relThemeBody")}</span>
          </li>
        </ul>
      </section>

      <section className={styles.card} data-testid="context-peer">
        <h4 className={styles.cardTitle}>{t("peerTitle")}</h4>
        <span className={`${styles.badge} ${styles.badgeWarn}`}>{t("contextStateUnavailable")}</span>
        <p className={styles.unavailableBody}>{t("peerBody")}</p>
      </section>

      <section className={styles.card} data-testid="context-foresight">
        <h4 className={styles.cardTitle}>{t("foresightTitle")}</h4>
        <span className={`${styles.badge} ${styles.badgeWarn}`}>{t("contextStateUnavailable")}</span>
        <p className={styles.unavailableBody}>{t("contextStateBody")}</p>
      </section>

      <section className={styles.card} data-testid="context-winner">
        <h4 className={styles.cardTitle}>{t("winnerTitle")}</h4>
        <span className={`${styles.badge} ${styles.badgeWarn}`}>{t("contextStateUnavailable")}</span>
        <p className={styles.unavailableBody}>{t("contextStateBody")}</p>
      </section>
    </div>
  );
}
