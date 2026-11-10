"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useSectorCycleT } from "@/lib/sectorCycleLex";
import s from "../SectorCycleLens.module.css";

/* Mobile surfaces (Paper R3 2V5-0): the half-sheet series picker with search,
 * per-series toggles and Cancel/Apply; the full-height leg sheet with detents
 * and an Open-fullscreen action. Both are real dialogs: focus moves in, Escape
 * closes, focus returns to the opener, and drag-to-dismiss is a pointer
 * gesture layered on top, never the only way out. */

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const first = ref.current?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

function useDragToClose(onClose: () => void) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    start.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (start.current === null) return;
    setDrag(Math.max(0, e.clientY - start.current));
  };
  const onPointerUp = () => {
    if (drag > 80) onClose();
    setDrag(0);
    start.current = null;
  };
  return { drag, handle: { onPointerDown, onPointerMove, onPointerUp } };
}

export interface PickerSeries {
  id: string;
  label: string;
  ticker: string;
  basis: "price" | "tr" | null;
  selected: boolean;
  disabled?: boolean;
  refusal?: string | null;
}

export interface CycleSeriesSheetProps {
  open: boolean;
  onClose: () => void;
  series: PickerSeries[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}

export function CycleSeriesSheet(props: CycleSeriesSheetProps) {
  const t = useSectorCycleT();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const ref = useDialog(props.open, props.onClose);
  const drag = useDragToClose(props.onClose);
  const titleId = useId();
  if (!props.open) return null;
  const needle = query.trim().toLowerCase();
  const rows = props.series.filter(
    (x) =>
      !needle ||
      x.label.toLowerCase().includes(needle) ||
      x.ticker.toLowerCase().includes(needle),
  );
  const isSelected = (x: PickerSeries) => draft[x.id] ?? x.selected;
  const selectedCount = props.series.filter(isSelected).length;
  return (
    <div className={s.sheetScrim} onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div
        ref={ref}
        className={s.sheetHalf}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ transform: `translateY(${drag.drag}px)` }}
      >
        <button
          type="button"
          className={s.sheetHandle}
          aria-label={t("scSeriesSheetCancel")}
          {...drag.handle}
        />
        <div className={s.sheetHead}>
          <h3 id={titleId}>{t("scSeriesSheetTitle")}</h3>
          <span className={s.chipQuiet}>{t("scRailAll", { n: selectedCount })}</span>
          <button type="button" className={s.sheetX} onClick={props.onClose} aria-label={t("scSeriesSheetCancel")}>
            ✕
          </button>
        </div>
        <input
          type="search"
          className={s.sheetSearch}
          placeholder={t("scRailSearch")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className={s.sheetList}>
          {rows.map((x) => (
            <li key={x.id}>
              <label className={x.disabled ? s.sheetRowDisabled : undefined}>
                <input
                  type="checkbox"
                  checked={isSelected(x)}
                  disabled={x.disabled}
                  onChange={() => setDraft((d) => ({ ...d, [x.id]: !isSelected(x) }))}
                />
                <span>
                  {x.label}
                  {x.basis && (
                    <small>
                      {" "}
                      {t(x.basis === "price" ? "scBasisPillPrice" : "scBasisPillTr")}
                    </small>
                  )}
                </span>
                {x.refusal && <em className={s.refusal}>{x.refusal}</em>}
              </label>
            </li>
          ))}
          {rows.length === 0 && <li className={s.note}>{t("scNoHistory")}</li>}
        </ul>
        <div className={s.sheetActions}>
          <button
            type="button"
            onClick={() => {
              setDraft({});
              setQuery("");
              props.onClose();
            }}
          >
            {t("scSeriesSheetCancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              for (const x of props.series) {
                const next = draft[x.id] ?? x.selected;
                if (next !== x.selected) props.onToggle(x.id);
              }
              setDraft({});
              setQuery("");
              props.onClose();
            }}
          >
            {t("scSeriesSheetApply")}
          </button>
        </div>
        <div className={s.sheetChips}>
          <button
            type="button"
            onClick={() =>
              setDraft(Object.fromEntries(props.series.map((x) => [x.id, true])))
            }
          >
            {t("scRailAll", { n: props.series.length })}
          </button>
          <button
            type="button"
            onClick={() =>
              setDraft(Object.fromEntries(props.series.map((x) => [x.id, false])))
            }
          >
            {t("scSeriesSheetClear")}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface CycleLegSheetProps {
  open: boolean;
  onClose: () => void;
  leg: {
    title: string;
    sessions: number | null;
    pricePct: number | null;
    vsBenchPct: number | null;
    story: React.ReactNode;
  };
  onOpenFullscreen: () => void;
}

export function CycleLegSheet(props: CycleLegSheetProps) {
  const t = useSectorCycleT();
  const ref = useDialog(props.open, props.onClose);
  const drag = useDragToClose(props.onClose);
  const [tall, setTall] = useState(false);
  const titleId = useId();
  if (!props.open) return null;
  return (
    <div className={s.sheetScrim}>
      <div
        ref={ref}
        className={tall ? s.sheetFullTall : s.sheetFull}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ transform: `translateY(${drag.drag}px)` }}
      >
        <button
          type="button"
          className={s.sheetHandle}
          aria-label={t("scSeriesSheetCancel")}
          onClick={() => setTall((v) => !v)}
          {...drag.handle}
        />
        <div className={s.sheetHead}>
          <h3 id={titleId}>{props.leg.title}</h3>
          <button type="button" className={s.sheetX} onClick={props.onClose} aria-label={t("scSeriesSheetCancel")}>
            ✕
          </button>
        </div>
        <dl className={s.legFacts}>
          <div>
            <dt>{t("scLegTimeline")}</dt>
            <dd>
              {props.leg.sessions !== null
                ? t("scLegOpenSessions", { n: props.leg.sessions })
                : t("scLegOpenNoCount")}
            </dd>
          </div>
          {props.leg.pricePct !== null && (
            <div>
              <dt>{t("scPrice")}</dt>
              <dd>
                {(props.leg.pricePct > 0 ? "+" : "") + props.leg.pricePct.toFixed(1)}%
              </dd>
            </div>
          )}
          {props.leg.vsBenchPct !== null && (
            <div>
              <dt>vs SPY</dt>
              <dd>
                {(props.leg.vsBenchPct > 0 ? "+" : "") + props.leg.vsBenchPct.toFixed(1)}pp
              </dd>
            </div>
          )}
        </dl>
        {props.leg.story}
        <button type="button" className={s.fullscreenButton} onClick={props.onOpenFullscreen}>
          {t("scLegSheetFullscreen")}
        </button>
      </div>
    </div>
  );
}
