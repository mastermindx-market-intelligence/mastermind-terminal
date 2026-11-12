"use client";
/**
 * ObservationCard — the developing-observation state (T2-22): an observation
 * can be useful before any dated setup or entry assessment exists. "What is
 * known" is served by the early-observation API (trigger names, session
 * dates); "what is missing" and "next useful check" are the designed
 * unavailable states — an observation carries no entry assessment and schedules
 * no next check (G13).
 */
import { useShellIdentity } from "@/components/chrome/AppShell";
import { identityUserId } from "@/lib/accountIdentity";
import { useLang } from "@/lib/i18n";
import { TRIGGER_NAMES } from "@/lib/prophetObservations";
import { useProphetObservation } from "@/lib/useProphetObservation";
import { makeProphetSectorT, prophetSectorFill } from "../sector/prophetSectorStrings";
import { makeSetupT } from "./setupStrings";
import styles from "./setup.module.css";

export function ObservationCard({ symbol, observationAsof }: { symbol: string; observationAsof: string | null }) {
  const { lang } = useLang();
  const t = makeSetupT(lang);
  const sectorT = makeProphetSectorT(lang);
  const identity = useShellIdentity();
  const account = identityUserId(identity) || null;
  const read = useProphetObservation(symbol, account);
  const zh = lang === "zh";
  const rows = read.status === "ready" ? read.data?.rows ?? [] : [];

  return (
    <section className={styles.card} data-testid="observation-card">
      {observationAsof !== null ? (
        <p className={styles.unavailableBody} data-testid="prophet-sector-setup-observation">
          {prophetSectorFill(sectorT("setupObservation"), { asof: observationAsof })}
        </p>
      ) : null}
      <span className={styles.badge}>{t("obsBadge")}</span>

      <div>
        <p className={styles.railItemLabel}>{t("obsFirstTitle")}</p>
        <div className={styles.obsKnown}>
        {read.status === "loading" ? (
          <div>
            <span className={styles.a11yLabel}>{t("caseLoading")}</span>
            <div className={styles.skeleton} aria-hidden="true">
              <div className={styles.skeletonBar} />
              <div className={styles.skeletonBar} />
              <div className={styles.skeletonBar} />
            </div>
          </div>
        ) : rows.length > 0 ? (
          rows.slice(0, 3).map((row) => (
            <div key={row.source_event_id}>
              <ul className={styles.obsTriggerList} data-testid="observation-triggers">
                {row.triggers_fired.map((id) => (
                  <li key={id}>{TRIGGER_NAMES[id]?.[zh ? 1 : 0] ?? id}</li>
                ))}
              </ul>
              <p className={styles.cardFootnote}>{row.source_session}</p>
            </div>
          ))
        ) : (
          <p className={styles.unavailableBody}>
            {read.status === "unauthenticated" || read.status === "unavailable" || read.status === "forbidden" || read.status === "unsupported"
              ? t("obsReadUnavailable")
              : t("obsNoneBody")}
          </p>
        )}
        </div>
      </div>

      <ul className={styles.obsRows}>
        <li className={styles.obsRow}>
          <span className={styles.obsRowLabel}>{t("obsMissingTitle")}</span>
          <span>{t("obsMissingBody")}</span>
        </li>
        <li className={styles.obsRow}>
          <span className={styles.obsRowLabel}>{t("obsNextTitle")}</span>
          <span>{t("obsNextBody")}</span>
        </li>
      </ul>
    </section>
  );
}
