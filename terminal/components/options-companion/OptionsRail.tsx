"use client";
import dynamic from "next/dynamic";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import MobileSheet from "@/components/ui/MobileSheet";
import { useLang } from "@/lib/i18n";
import { PHONE_QUERY } from "@/lib/useMediaQuery";
import { type OptionsChartLevel } from "@/lib/optionsCompanion";
import { optionsT } from "./optionsStrings";
import styles from "./OptionsCompanion.module.css";

// The initial chart/Overview bundle does not fetch or mount options data.
const OptionsCompanion = dynamic(() => import("./OptionsCompanion"), { ssr: false });
const QUERY = "(max-width: 860px)"; // Terminal's canonical single-column breakpoint.
const subscribeViewport = (callback: () => void) => {
  const query = window.matchMedia(QUERY); query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};
const smallSnapshot = () => window.matchMedia(QUERY).matches;
const serverSnapshot = () => false;
export interface OptionsRailHandle { open: () => void }
interface Props {
  children: ReactNode; symbol: string; enabled: boolean; access: "loading" | "allowed" | "locked";
  pinned: OptionsChartLevel | null; onPin: (level: OptionsChartLevel | null) => void; replayActive: boolean;
}

/** Preserves the existing Overview subtree, focus/scroll state and source custody. */
const OptionsRail = forwardRef<OptionsRailHandle, Props>(function OptionsRail({ children, symbol, enabled, access, pinned, onPin, replayActive }, ref) {
  const { lang } = useLang(); const t = optionsT(lang);
  const small = useSyncExternalStore(subscribeViewport, smallSnapshot, serverSnapshot);
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    setOpen(false); onPin(null);
    requestAnimationFrame(() => {
      const target = returnFocus.current?.getClientRects().length ? returnFocus.current : launcher.current;
      target?.focus({ preventScroll: true });
    });
  }, [onPin]);
  useImperativeHandle(ref, () => ({ open: () => {
    if (enabled) { returnFocus.current = document.querySelector<HTMLElement>(small && window.matchMedia(PHONE_QUERY).matches ? "[data-testid=roller-more]" : "[data-testid=toolbar-more]"); setOpen(true); }
  } }), [enabled, small]);
  useEffect(() => { if (!enabled || access !== "allowed" || replayActive) onPin(null); }, [enabled, access, replayActive, onPin]);
  // Data consumers cannot survive a hidden/disabled shell, even if a prior open bit survives.
  const showing = enabled && open;
  const panel = showing ? <OptionsCompanion symbol={symbol} access={access} onClose={close} pinned={pinned} onPin={onPin} replayActive={replayActive} /> : null;
  return <>
    <aside className="rail" data-options-rail={showing && !small ? "open" : "closed"}>
      {enabled && <div className={styles.railSwitch} hidden={showing && !small} role="group" aria-label={t("perspectives")}>
        <button type="button" aria-pressed={!showing} onClick={close}>{t("overview")}</button>
        <button type="button" ref={launcher} data-testid="options-rail-toggle" aria-pressed={showing} aria-label={t("open")} onClick={() => { if (showing) close(); else { returnFocus.current = launcher.current; setOpen(true); } }}>
          <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 2h14v14H2zM2 7h14M2 12h14M7 2v14M12 2v14" /></svg>{t("options")}
        </button>
      </div>}
      <div className={styles.overview} hidden={showing && !small}>{children}</div>
      {showing && !small && panel}
    </aside>
    {enabled && <MobileSheet open={showing && small} onClose={close} title={<span className={styles.sheetTitle}><span>{t("options")} · {symbol}</span><button type="button" className={styles.close} onClick={close} aria-label={t("close")}>×</button></span>} ariaLabel={t("open")}
      detents={[60, 94]} maxHeight="94svh" initialFocus="sheet" escapeKey="bubble" className={styles.sheet}>
      {small && panel}
    </MobileSheet>}
  </>;
});
export default OptionsRail;
