"use client";
/** Save is the incumbent watchlist owner's confirmed, account-scoped workflow.
 * Prophet does not implement another POST/retry protocol or claim a lost
 * response means absence. Follow remains distinct from saving a security. */
import { useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import CompanyWatchSave from "@/components/fin/CompanyWatchSave";
import { useLang } from "@/lib/i18n";
import { SHARED_SHELL_NAV } from "@/lib/sharedShellNavigation";
import { makeSetupT } from "./setupStrings";
import styles from "./setup.module.css";

export function SaveFollow({ symbol }: { symbol: string }) {
  const { lang } = useLang();
  const t = makeSetupT(lang), pathname = usePathname();
  const followButton = useRef<HTMLButtonElement | null>(null);
  const [followOpen, setFollowOpen] = useState(false), followId = useId();
  return <section className={`${styles.card} ${styles.saveFollow}`} data-testid="save-follow">
    {/* Legacy Options tabs outlive browser identity changes. The native
        account-keyed Prophet workspace owns this private write/read lifetime. */}
    {pathname === "/prophet" ? <CompanyWatchSave symbol={symbol} />
      : <Link className={styles.ghostButton} prefetch={false} href={`/prophet?tab=sector&symbol=${encodeURIComponent(symbol)}`}>
        {t("saveInNative")} →
      </Link>}
    <p className={styles.unavailableNote}>{t("saveSavedNote")}</p>
    <Link className={styles.ghostButton} prefetch={false}
      href={SHARED_SHELL_NAV.find(item => item.k === "shellMonitor")?.href ?? "/watchlist.html"}>
      {t("openMonitor")} →
    </Link>
    <button ref={followButton} type="button" className={styles.ghostButton} data-testid="follow-changes"
      onClick={() => setFollowOpen(open => !open)} aria-expanded={followOpen} aria-controls={followId}>
      {t("followAction")}
    </button>
    {followOpen && <div id={followId} className={styles.resultPanel} data-testid="follow-panel">
      <p className={styles.resultTitle}>{t("followTitle")}</p>
      <p className={styles.resultBody}>{t("followBody")}</p>
      <p className={styles.unavailableNote}>{t("followNote")}</p>
      <button type="button" className={styles.ghostButton} onClick={() => { setFollowOpen(false); followButton.current?.focus(); }}>{t("followBack")}</button>
    </div>}
  </section>;
}
