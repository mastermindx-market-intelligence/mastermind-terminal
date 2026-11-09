"use client";

import { useId, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import MobileSheet from "@/components/ui/MobileSheet";
import { useLang, useT } from "@/lib/i18n";
import styles from "./TimeframePicker.module.css";

type Props = {
  id: string;
  open: boolean;
  mobile: boolean;
  timeframe: string;
  groups: readonly (readonly [string, readonly string[]])[];
  available: ReadonlySet<string>;
  favorites: readonly string[];
  disabledReason: (timeframe: string) => string;
  onSelect: (timeframe: string) => void;
  onFavorite: (timeframe: string) => void;
  onClose: () => void;
  launcherRef: RefObject<HTMLButtonElement | null>;
};

function revealWithin(panel: HTMLElement, control: HTMLElement) {
  const bounds = panel.getBoundingClientRect(), item = control.getBoundingClientRect();
  if (item.bottom > bounds.bottom - 6) panel.scrollTop += item.bottom - bounds.bottom + 6;
  else if (item.top < bounds.top + 6) panel.scrollTop -= bounds.top + 6 - item.top;
}

/** Native controls over the shell's existing timeframe and favorites owners. */
export default function TimeframePicker(props: Props) {
  const { id, open, mobile, timeframe, groups, available, favorites, disabledReason, onSelect, onFavorite, onClose, launcherRef } = props;
  const t = useT(); const { lang } = useLang(); const reasonId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const presentationRef = useRef(mobile);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    const changedPresentation = presentationRef.current !== mobile;
    presentationRef.current = mobile;
    if (changedPresentation && open) {
      closeRef.current();
      const launcher = launcherRef.current;
      if (launcher?.isConnected && launcher.getClientRects().length) launcher.focus({ preventScroll: true });
      return;
    }
    if (!open || mobile) return;
    const panel = panelRef.current;
    const selected = panel?.querySelector<HTMLButtonElement>('button[data-timeframe-action="select"][aria-pressed="true"]:not(:disabled)')
      ?? panel?.querySelector<HTMLButtonElement>('button[data-timeframe-action="select"]:not(:disabled)');
    if (panel && selected) { selected.focus({ preventScroll: true }); revealWithin(panel, selected); }
  }, [open, mobile, launcherRef]);

  const close = () => {
    onClose();
    // MobileSheet owns its opener restoration and keyboard boundary.
    if (mobile) return;
    const launcher = launcherRef.current;
    if (launcher?.isConnected && launcher.getClientRects().length) launcher.focus({ preventScroll: true });
  };

  const onKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") {
      if (!mobile) { event.preventDefault(); event.stopPropagation(); close(); }
      return;
    }
    const control = (event.target as Element).closest<HTMLButtonElement>("button[data-timeframe-action]");
    if (!control || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(`button[data-timeframe-action="${control.dataset.timeframeAction}"]:not(:disabled)`));
    const index = controls.indexOf(control);
    if (index < 0) return;
    const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
    event.preventDefault(); event.stopPropagation();
    controls[next].focus({ preventScroll: !mobile });
    if (!mobile && panelRef.current) revealWithin(panelRef.current, controls[next]);
  };

  const choices = open ? <div className={`${styles.rows}${mobile ? ` ${styles.touch}` : ""}`} onKeyDown={onKeys}
    onFocus={(event) => {
      const scroller = mobile ? event.currentTarget.closest<HTMLElement>(".msheet-body") : null;
      if (scroller && event.target instanceof HTMLElement) revealWithin(scroller, event.target);
    }}>
    {groups.map(([label, items]) => <div key={label} role="group" aria-label={label}>
      <div className={mobile ? "msheet-ghd" : "g"}>{label}</div>
      {items.map((value) => {
        const enabled = available.has(value), favorite = favorites.includes(value);
        const favoriteLabel = favorite
          ? (lang === "zh" ? `从收藏中移除 ${value}` : `Remove ${value} from favorites`)
          : (lang === "zh" ? `收藏 ${value}` : `Add ${value} to favorites`);
        return <div key={value} data-timeframe-row={value} className={`${mobile ? "msheet-row " : ""}it ${styles.row}${timeframe === value ? " on" : ""}`}>
          <button type="button" className={styles.select} data-timeframe-action="select" disabled={!enabled}
            data-autofocus={mobile && enabled && timeframe === value ? true : undefined}
            aria-pressed={timeframe === value} aria-describedby={enabled ? undefined : `${reasonId}-${value}`}
            onClick={(event) => { event.stopPropagation(); onSelect(value); close(); }}>
            <span>{value}</span>{!enabled && <span id={`${reasonId}-${value}`} className={styles.reason}>{disabledReason(value)}</span>}
          </button>
          <button type="button" className={`fav${favorite ? " on" : ""} ${styles.favorite}`} data-timeframe-action="favorite"
            aria-label={favoriteLabel} title={favoriteLabel} aria-pressed={favorite}
            onClick={(event) => { event.stopPropagation(); onFavorite(value); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>
          </button>
        </div>;
      })}
    </div>)}
  </div> : null;

  if (mobile) return <MobileSheet open={open} onClose={onClose} title={t("tfSheetTitle")}>{choices}</MobileSheet>;
  if (!open) return null;
  return <div ref={panelRef} id={id} role="dialog" aria-label={t("tfSheetTitle")} className={`tfgrid show ${styles.panel}`}
    onClick={(event) => event.stopPropagation()}
    onBlur={(event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !event.currentTarget.contains(next) && !launcherRef.current?.contains(next)) onClose();
    }}>{choices}</div>;
}
