"use client";

import { useId, useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useT } from "@/lib/i18n";
import type { WatchlistSettings } from "@/lib/watchlistSettings";
import styles from "./WatchlistDisplaySettings.module.css";

type Props = {
  id: string;
  open: boolean;
  settings: WatchlistSettings;
  onChange: Dispatch<SetStateAction<WatchlistSettings>>;
  launcherRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
};

/** Presentation only: TerminalShell remains the owner of settings and persistence. */
export default function WatchlistDisplaySettings({ id, open, settings, onChange, launcherRef, onClose }: Props) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const radioName = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rail = panel.closest<HTMLElement>(".rail-body");
    const fit = () => {
      const bottom = Math.min(window.innerHeight, rail?.getBoundingClientRect().bottom ?? window.innerHeight);
      // Let CSS react to a viewport resize before focus can scroll an oversized
      // popup's clipping ancestors. JS only measures the anchored edge/inset.
      const offset = panel.getBoundingClientRect().top + window.innerHeight - bottom + 8;
      panel.style.setProperty("--watchlist-display-offset", `${Math.ceil(offset)}px`);
    };
    fit();
    panel.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    window.addEventListener("resize", fit);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    if (rail) observer?.observe(rail);
    return () => { window.removeEventListener("resize", fit); observer?.disconnect(); };
  }, [open]);

  if (!open) return null;

  const column = (key: keyof WatchlistSettings["cols"], label: string) => (
    <label key={key} data-watchlist-setting={key} className={`set-row${settings.cols[key] ? " on" : ""} ${styles.row}`}>
      <input type="checkbox" checked={settings.cols[key]} onChange={(event) => {
        const checked = event.currentTarget.checked;
        onChange((current) => ({ ...current, cols: { ...current.cols, [key]: checked } }));
      }} />
      <span>{label}</span>
    </label>
  );

  return (
    <div ref={panelRef} id={id} role="dialog" aria-label={`${t("watchlists")}: ${t("settings")}`}
      className={`pop show ${styles.panel}`} onClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next) && !launcherRef.current?.contains(next)) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault(); event.stopPropagation(); onClose();
        const launcher = launcherRef.current;
        if (launcher?.isConnected && launcher.getClientRects().length) launcher.focus({ preventScroll: true });
      }}>
      <label className={`${styles.row} ${styles.tableRow}`}>
        <strong>{t("tableViewLabel")}</strong>
        <input className={styles.switch} type="checkbox" role="switch" checked={settings.tableView}
          onChange={(event) => { const checked = event.currentTarget.checked; onChange((current) => ({ ...current, tableView: checked })); }} />
      </label>
      <fieldset className={styles.group}>
        <legend>{t("columns")}</legend>
        {column("last", t("colLast"))}
        {column("change", t("colChange"))}
        {column("changePct", t("colChangePct"))}
        {column("volume", t("colVolume"))}
      </fieldset>
      <fieldset className={styles.group}>
        <legend>{t("extColumns")}</legend>
        {column("ext", t("colExt"))}
        {column("extPct", t("colExtPct"))}
      </fieldset>
      <fieldset className={styles.group}>
        <legend>{t("symbolDisplay")}</legend>
        <label data-watchlist-setting="logo" className={`set-row${settings.logo ? " on" : ""} ${styles.row}`}>
          <input type="checkbox" checked={settings.logo}
            onChange={(event) => { const checked = event.currentTarget.checked; onChange((current) => ({ ...current, logo: checked })); }} />
          <span>{t("logo")}</span>
        </label>
        <div role="radiogroup" aria-label={t("symbolDisplay")}>
          {([["symbol", t("dispSymbol")], ["name", t("dispName")], ["both", t("dispBoth")]] as const).map(([value, label]) => (
            <label key={value} className={`set-row${settings.disp === value ? " on" : ""} ${styles.row}`}>
              <input type="radio" name={radioName} value={value} checked={settings.disp === value}
                onChange={() => onChange((current) => ({ ...current, disp: value }))} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
