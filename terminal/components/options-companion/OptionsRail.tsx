"use client";
import dynamic from "next/dynamic";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import MobileSheet from "@/components/ui/MobileSheet";
import { useLang } from "@/lib/i18n";
import { PHONE_QUERY } from "@/lib/useMediaQuery";
import { type OptionsChartLevel } from "@/lib/optionsCompanion";
import { visualText } from "@/lib/visualIntelligenceCopy";
import { optionsT } from "./optionsStrings";
import styles from "./OptionsCompanion.module.css";

// The initial chart/Overview bundle does not fetch or mount options data.
const OptionsCompanion = dynamic(() => import("./OptionsCompanion"), { ssr: false });
const ExposureChartReference = dynamic(() => import("../exposure-map/ExposureChartReference"), { ssr: false });
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
  contextOpen?: boolean; contextAvailable?: boolean; onContextChange?: (open: boolean, launcher?: HTMLElement | null) => void; contextHostRef?: (node: HTMLDivElement | null) => void;
  pinned: OptionsChartLevel | null; onPin: (level: OptionsChartLevel | null) => void; replayActive: boolean;
}

/** Preserves the existing Overview subtree, focus/scroll state and source custody.
 *  On a small viewport, "Show on chart" parks the sheet (keeps the companion mounted but
 *  hidden) so a newer build that arrives while the chart is visible queues and re-presents
 *  onto the held map. The parked chip returns to the same held state.
 *  Reference: PP2-UI-b / accepted Paper contract #723 falsifiers 4, 5, 9, 10. */
const OptionsRail = forwardRef<OptionsRailHandle, Props>(function OptionsRail({ children, symbol, enabled, access, pinned, onPin, replayActive, contextOpen = false, contextAvailable = true, onContextChange, contextHostRef }, ref) {
  const { lang } = useLang(); const t = optionsT(lang);
  const small = useSyncExternalStore(subscribeViewport, smallSnapshot, serverSnapshot);
  const [open, setOpen] = useState(false);
  const [hasExposureLink, setHasExposureLink] = useState(false);
  useEffect(() => {
    const read = () => setHasExposureLink(window.location.hash.startsWith("#exposure="));
    read(); window.addEventListener("hashchange", read); window.addEventListener("popstate", read);
    return () => { window.removeEventListener("hashchange", read); window.removeEventListener("popstate", read); };
  }, []);
  // Parked while `open` was true and the user pressed "Show on chart" — the panel stays
  // mounted (and so do its selection, pin, queued build and scroll offsets) but the sheet
  // is hidden so the user can reach the chart underneath. Returns false if `small` ever
  // flips off so the desktop rail never advertises the park.
  const [parked, setParked] = useState(false);
  const parkedSymbol = useRef<string>(symbol);
  // Track the symbol at the moment the user parked so a silent upstream switch (root
  // change, entitlement change, replay start) cleanly ends the park and clears the pin.
  const launcher = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    setOpen(false); setParked(false); onPin(null);
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => {
        const target = returnFocus.current?.getClientRects().length ? returnFocus.current : launcher.current;
        target?.focus({ preventScroll: true });
      });
    }
  }, [onPin]);
  useImperativeHandle(ref, () => ({ open: () => {
    if (enabled) { onContextChange?.(false); returnFocus.current = document.querySelector<HTMLElement>(small && window.matchMedia(PHONE_QUERY).matches ? "[data-testid=roller-more]" : "[data-testid=toolbar-more]"); setOpen(true); }
  } }), [enabled, small, onContextChange]);
  // Data consumers cannot survive a hidden/disabled shell, even if a prior open bit survives.
  // While parked, signal changes END the park AND clear the pin through the existing paths.
  useEffect(() => { if (!enabled || access !== "allowed" || replayActive) onPin(null); }, [enabled, access, replayActive, onPin]);
  useEffect(() => {
    if (!parked) return;
    if (symbol !== parkedSymbol.current || access !== "allowed" || !enabled || replayActive) close();
  }, [parked, symbol, access, enabled, replayActive, close]);
  // Small turning false resets parked only — the rail on desktop covers Overview content,
  // not the chart, so there is nothing to scroll the user back to.
  useEffect(() => { if (!small && parked) setParked(false); }, [small, parked]);
  const showing = enabled && open;
  // The companion stays mounted while parked so its selection, pin, queued build and
  // scroll offsets are preserved as live state — not a copy.
  const panel = <OptionsCompanion symbol={symbol} access={access} onClose={close}
    pinned={pinned} onPin={onPin}
    onShowChart={small ? () => {
      setParked(true);
      parkedSymbol.current = symbol;
      // Bring the chart under the parked sheet into view so the user lands on it.
      const chart = typeof document !== "undefined" ? document.querySelector<HTMLElement>(".chart-wrap") : null;
      if (chart) {
        const rect = chart.getBoundingClientRect();
        const insideViewport = rect.top < window.innerHeight && rect.bottom > 0;
        if (!insideViewport) chart.scrollIntoView({ block: "nearest" });
      }
      // Move focus to the chip in the next frame so it's discoverable.
      if (typeof window !== "undefined") {
        requestAnimationFrame(() => {
          document.querySelector<HTMLButtonElement>('[data-testid="options-chart-return"]')?.focus({ preventScroll: true });
        });
      }
    } : undefined}
    replayActive={replayActive} />;
  const sheetOpen = showing && small && !parked && !contextOpen;
  const sheetKeepMounted = showing && small && (parked || contextOpen);
  return <>
    {enabled && hasExposureLink && <ExposureChartReference symbol={symbol} active={access === "allowed" && !replayActive} pinned={pinned} onPin={onPin} />}
    <aside className="rail" data-options-rail={showing && !small && !contextOpen ? "open" : "closed"}>
      {enabled && <div className={styles.railSwitch} role="group" aria-label={t("perspectives")}>
        <button type="button" aria-pressed={!showing && !contextOpen} onClick={() => { onContextChange?.(false); close(); }}>{t("overview")}</button>
        {onContextChange && <button type="button" data-context-launcher disabled={!contextAvailable} aria-pressed={contextOpen}
          onClick={(event) => onContextChange(!contextOpen, event.currentTarget)}>{visualText("tab", lang)}</button>}
        <button type="button" ref={launcher} data-testid="options-rail-toggle" aria-pressed={showing && !contextOpen} aria-label={t("open")} onClick={() => { onContextChange?.(false); if (showing && !contextOpen) close(); else { returnFocus.current = launcher.current; setOpen(true); } }}>
          <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 2h14v14H2zM2 7h14M2 12h14M7 2v14M12 2v14" /></svg>{t("options")}
        </button>
      </div>}
      <div className={styles.overview} hidden={(showing || contextOpen) && !small}>{children}</div>
      {showing && !small && <div className={styles.contextPreservedOptions} hidden={contextOpen}>{panel}</div>}
      <div ref={contextHostRef} className={styles.contextHost} data-context-dock="rail" hidden={!contextOpen || small} />
    </aside>
    {enabled && <MobileSheet open={sheetOpen} keepMounted={sheetKeepMounted} onClose={close} title={<span className={styles.sheetTitle}><span>{t("options")} · {symbol}</span><button type="button" className={styles.close} onClick={close} aria-label={t("close")}>×</button></span>} ariaLabel={t("open")}
      detents={[60, 94]} maxHeight="94svh" initialFocus="sheet" escapeKey="bubble" className={styles.sheet}>
      {small && panel}
    </MobileSheet>}
    {enabled && parked && !contextOpen && typeof document !== "undefined" && createPortal(
      <button type="button" className={styles.chartReturn} data-testid="options-chart-return"
        onClick={() => { setParked(false); }}>{t("chartReturn")}</button>,
      document.body,
    )}
  </>;
});
export default OptionsRail;
