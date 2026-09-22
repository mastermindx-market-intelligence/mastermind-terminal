"use client";
// One management view over TerminalShell's existing indicators and visibility state.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import styles from "./ChartObjectTree.module.css";

export type OTEntry = {
  key: string;
  label: string;
  tag?: string;
  kind: "overlay" | "pane";
  hidden: boolean;
  color?: string;
  noRemove?: boolean;
};
type Props = { symbol: string; entries: OTEntry[]; onEye: (key: string) => void; onRemove: (key: string) => void; onClose: () => void };
const CLOSE = "M6 6l12 12M18 6L6 18";
const EYE = "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0";
const HIDDEN = "M3 3l18 18M9.4 5.2A10.6 10.6 0 0 1 12 5c7 0 10 7 10 7a18 18 0 0 1-3 4M6 6A18 18 0 0 0 2 12s3 7 10 7a11 11 0 0 0 3-.4";
const LAYER = "M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0";
function Icon({ path }: { path: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}><path d={path} /></svg>;
}
export default function ChartObjectTree({ symbol, entries, onEye, onRemove, onClose }: Props) {
  const t = useT();
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<{ removed: string; next: string | null } | null>(null);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return entries.filter((entry) => `${entry.label} ${entry.tag ?? ""}`.toLocaleLowerCase().includes(term));
  }, [entries, query]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = root.current;
    // A fixed child is still clipped by the chart's containing/stacking contexts. Native
    // top-layer ownership escapes them without a second React tree or a z-index arms race.
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 860px)") : null;
    const syncLayer = () => {
      if (!element || typeof element.showPopover !== "function") return;
      if (media?.matches) {
        element.setAttribute("popover", "manual");
        if (!element.matches(":popover-open")) element.showPopover();
      } else {
        if (element.matches(":popover-open")) element.hidePopover();
        element.removeAttribute("popover");
      }
    };
    syncLayer(); media?.addEventListener("change", syncLayer);
    search.current?.focus({ preventScroll: true });
    return () => {
      media?.removeEventListener("change", syncLayer);
      if (element && typeof element.hidePopover === "function" && element.matches(":popover-open")) element.hidePopover();
      element?.removeAttribute("popover");
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || entries.some((entry) => entry.key === pending.removed)) return;
    pendingFocus.current = null;
    const target = [...(root.current?.querySelectorAll<HTMLButtonElement>("[data-layer-eye]") ?? [])]
      .find((button) => button.dataset.layerEye === pending.next);
    (target ?? search.current)?.focus({ preventScroll: true });
  }, [entries]);
  function remove(key: string) {
    const index = filtered.findIndex((entry) => entry.key === key);
    pendingFocus.current = { removed: key, next: (filtered[index + 1] ?? filtered[index - 1])?.key ?? null };
    onRemove(key);
  }
  function clear() { setQuery(""); search.current?.focus(); }
  const visible = entries.filter((entry) => !entry.hidden).length;
  return <section ref={root} className={`ot-root ${styles.root}`} aria-labelledby={`${id}-title`} onKeyDown={(event) => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation();
    if (query) clear(); else onClose();
  }}>
    <header className={styles.header}>
      <div><h2 id={`${id}-title`}>{t("objectTree")}</h2>
        <p>{symbol}<span aria-hidden="true"> · </span>{entries.length} {t("smIndicators")}</p></div>
      <button type="button" className={styles.action} aria-label={t("smClose")} title={t("smClose")} onClick={onClose}><Icon path={CLOSE} /></button>
    </header>
    <div className={styles.search}>
      <Icon path="M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M16 16l5 5" />
      <input ref={search} type="search" value={query} aria-label={`${t("drawSearch")} ${t("smIndicators")}`}
        placeholder={`${t("drawSearch")} ${t("smIndicators")}`} onChange={(event) => setQuery(event.target.value)} />
      {query && <button type="button" className={styles.action} aria-label={t("clearFilter")} title={t("clearFilter")} onClick={clear}><Icon path={CLOSE} /></button>}
    </div>
    <div className={`ot-body ${styles.body}`}>
      <div className={styles.mainSeries}>
        <Icon path="M8 3v18M5 7h6v9H5zM17 3v18M14 8h6v6h-6z" />
        <div><small>{t("ctvMainSeries")}</small><strong>{symbol}</strong></div>
        <span className={styles.count} aria-label={`${t("isTabVisibility")}: ${visible}/${entries.length}`}>{visible}/{entries.length}</span>
      </div>
      {(["overlay", "pane"] as const).map((kind) => {
        const rows = filtered.filter((entry) => entry.kind === kind);
        if (!rows.length) return null;
        return <section className={styles.group} key={kind} aria-labelledby={`${id}-${kind}`}>
          <h3 id={`${id}-${kind}`}>{t(kind === "overlay" ? "ctvOverlays" : "ctvSubPanes")}<span>{rows.length}</span></h3>
          <ul>{rows.map((entry) => <li key={entry.key} className={`ot-row ${styles.row}`} data-layer-key={entry.key} data-hidden={entry.hidden}>
            <span className={styles.studyIcon} style={entry.color ? { color: entry.color } : undefined}><Icon path={LAYER} /></span>
            <span className={`ot-name ${styles.name}`} title={entry.label}>{entry.label}
              {entry.tag && entry.tag !== entry.label && <small>{entry.tag}</small>}
            </span>
            <button type="button" className={`ot-eye ${styles.action}`} data-layer-eye={entry.key}
              aria-label={`${t(entry.hidden ? "lgShow" : "lgHide")} ${entry.label}`}
              title={`${t(entry.hidden ? "lgShow" : "lgHide")} ${entry.label}`}
              onClick={() => onEye(entry.key)}><Icon path={entry.hidden ? HIDDEN : EYE} /></button>
            {!entry.noRemove && <button type="button" className={`ot-remove ${styles.action} ${styles.remove}`}
              aria-label={`${t("remove")} ${entry.label}`} title={`${t("remove")} ${entry.label}`}
              onClick={() => remove(entry.key)}><Icon path={CLOSE} /></button>}
          </li>)}</ul>
        </section>;
      })}
      {!filtered.length && <div className={styles.empty} role="status">
        <p>{t(entries.length ? "scr2EmptyTitle" : "ctvNoIndicators")}</p>
        {query && <button type="button" className={styles.clear} aria-label={t("clearFilter")} onClick={clear}>{t("clearFilter")}</button>}
      </div>}
    </div>
  </section>;
}
