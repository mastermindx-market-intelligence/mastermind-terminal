"use client";
// Per-pane link control (E09): a chip in the pane header that opens a small menu to put this chart
// in link group A/B/C (or none) and choose what that group shares — crosshair and/or visible dates.
//
// Presentation only. The choice lives in TerminalShell (one `ChartLinkState`), is resolved by
// `chartLinkView` and applied through paneSync's existing bus. This component never touches a chart,
// the pane registry or the active-security context, and pointer-downs inside it are excluded from
// pane activation (`data-chart-link`, ChartPane) so using it never changes which pane is active.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LINK_GROUPS, type ChartLinkView, type LinkDimension, type LinkGroupId } from "@/lib/chartLinkGroups";
import { useChartLinkT } from "@/lib/chartLinkGroupsLex";
import styles from "./ChartLinkControl.module.css";

const REFUSED = new Set(["mixed_timeframes", "timeframe_unknown"]);

export default function ChartLinkControl({ idx, view, labels, onAssign, onShare }: {
  idx: number;
  view: ChartLinkView;
  /** Display label per pane slot (its symbol) — used to say who this chart is linked with. */
  labels: readonly string[];
  onAssign: (idx: number, group: LinkGroupId | null) => void;
  onShare: (group: LinkGroupId, dim: LinkDimension, on: boolean) => void;
}) {
  const t = useChartLinkT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const pane = view.panes[idx];
  const group = pane?.group ?? null;
  const status = pane?.status ?? "independent";
  const groupView = group ? view.groups.find((g) => g.id === group) ?? null : null;
  const refused = REFUSED.has(status);
  const n = idx + 1;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) chipRef.current?.focus();
  }, []);

  // Outside pointer-down closes the menu (capture, so a chart that swallows the event still closes it).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const root = rootRef.current;
      const target = e.target as Node | null;
      if (!root || !target) return;
      if (chipRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  // Move focus into the menu when it opens: the pressed group choice is the natural landing.
  useEffect(() => {
    if (!open) return;
    const pressed = menuRef.current?.querySelector<HTMLButtonElement>("button[aria-pressed='true']");
    pressed?.focus();
  }, [open]);

  const statusText = (() => {
    switch (status) {
      case "independent": return t("clStatusIndependent");
      case "active": {
        const others = (groupView?.members ?? []).filter((m) => m !== idx).map((m) => labels[m] || t("clTitle", { n: m + 1 }));
        return t("clStatusActive", { list: others.join(t("clListJoin")) });
      }
      case "waiting": return t("clStatusWaiting");
      case "alone": return t("clStatusAlone", { g: group ?? "" });
      case "nothing_shared": return t("clStatusNothingShared", { g: group ?? "" });
      case "mixed_timeframes": return t("clStatusMixed", { g: group ?? "", tfs: (groupView?.timeframes ?? []).join(t("clListJoin")) });
      case "timeframe_unknown": return t("clStatusTfUnknown", { g: group ?? "" });
    }
  })();
  const tone = refused ? "refused" : status === "active" ? "live" : "quiet";
  const chipLabel = !group
    ? t("clChipOff", { n })
    : refused || status === "alone" || status === "nothing_shared"
      ? t("clChipRefused", { n, g: group })
      : t("clChipGroup", { n, g: group });

  const icon = (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.43" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.33-1.33" />
      {!group && <path d="M4 4l16 16" />}
    </svg>
  );

  return (
    <span
      ref={rootRef}
      className={styles.root}
      data-chart-link={idx}
      data-link-group={group ?? "off"}
      data-link-status={status}
    >
      <button
        ref={chipRef}
        type="button"
        className={styles.chip}
        data-chart-link-chip={idx}
        data-group={group ?? "off"}
        data-refused={refused ? "1" : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={chipLabel}
        title={chipLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.pill}>
          {icon}
          {group && <span>{group}</span>}
          {refused && <span className={styles.warn} aria-hidden="true" />}
        </span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="dialog"
          aria-label={t("clTitle", { n })}
          className={styles.menu}
          data-chart-link-menu={idx}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(true); }
          }}
        >
          <div className={styles.head}>
            <strong>{t("clTitle", { n })}</strong>
            <button type="button" className={styles.close} aria-label={t("clClose")} title={t("clClose")} onClick={() => close(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <fieldset className={styles.set}>
            <legend>{t("clGroupLegend")}</legend>
            <div className={styles.groups}>
              <button type="button" data-swatch="off" data-link-choice="off" aria-pressed={group === null} onClick={() => onAssign(idx, null)}>
                {t("clOff")}
              </button>
              {LINK_GROUPS.map((g) => (
                <button key={g} type="button" data-swatch={g} data-link-choice={g} aria-pressed={group === g} aria-label={t("clGroupName", { g })} onClick={() => onAssign(idx, g)}>
                  <span className={styles.dot} aria-hidden="true" />{g}
                </button>
              ))}
            </div>
          </fieldset>
          {group && groupView && (
            <fieldset className={styles.set}>
              <legend>{t("clShareLegend", { g: group })}</legend>
              <div className={styles.share}>
                <label>
                  <input type="checkbox" data-link-share="crosshair" checked={groupView.share.crosshair} onChange={(e) => onShare(group, "crosshair", e.currentTarget.checked)} />
                  {t("clShareCrosshair")}
                </label>
                <label>
                  <input type="checkbox" data-link-share="window" checked={groupView.share.window} onChange={(e) => onShare(group, "window", e.currentTarget.checked)} />
                  {t("clShareWindow")}
                </label>
              </div>
            </fieldset>
          )}
          <p
            className={styles.status} // plain-language-ok: CSS-module class name, never rendered as text
            data-tone={tone}
            data-link-status-text={status}
            role="status"
          >
            {statusText}
          </p>
          <p className={styles.foot}>{t("clFootnote")}</p>
        </div>
      )}
    </span>
  );
}
