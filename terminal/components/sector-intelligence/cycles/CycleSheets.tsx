"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useSectorCycleT } from "@/lib/sectorCycleLex";
import { formatValue } from "@/lib/sectorIntelligence";
import s from "../SectorCycleLens.module.css";

/* Mobile surfaces (Paper R3 2V5-0, upgraded to the R5-Y02 picker): the
 * half-sheet series picker with the 2×2 family control, phase filter chips,
 * search, phase+position rows, subject selection and same-basis comparison
 * rules, committed through Cancel/Apply; the full-height leg sheet with
 * detents and an Open-fullscreen action. Both are real dialogs: focus moves
 * in, Escape closes, focus returns to the opener, and drag-to-dismiss is a
 * pointer gesture layered on top, never the only way out. */

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
        // Stacked dialogs: only the one HOLDING focus (the topmost) closes;
        // stopPropagation alone cannot stop a sibling document listener.
        if (!ref.current?.contains(document.activeElement)) return;
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
  /** Current cycle phase ("Trough" | … | null when unmeasured). */
  phase: string | null;
  /** Ontology position 0–100, shown beside the phase (R5-Y02 rows). */
  position: number | null;
  /** True for the row that is the current primary subject. */
  isSubject: boolean;
  selected: boolean;
  disabled?: boolean;
  refusal?: string | null;
}

export interface CycleSeriesSheetProps {
  open: boolean;
  onClose: () => void;
  series: PickerSeries[];
  onToggle: (id: string) => void;
  /** Families present, labelled — the 2×2 control (R5-Y02). */
  families: { key: string; label: string }[];
  family: string;
  onFamily: (key: string) => void;
  /** Current primary subject; a row tap drafts a new one until Apply. */
  subjectId: string | null;
  onSelectSubject: (id: string) => void;
}

const SHEET_PHASE_LABELS: Record<string, string> = {
  Trough: "scPhaseTroughFull",
  Recovery: "scPhaseRecoveryFull",
  Expansion: "scPhaseExpansionFull",
  Peak: "scPhasePeakFull",
  Downturn: "scPhaseDownturnFull",
};

export function CycleSeriesSheet(props: CycleSeriesSheetProps) {
  const t = useSectorCycleT();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [phaseFilter, setPhaseFilter] = useState<string | null>(null);
  const [draftSubject, setDraftSubject] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(props.open);
  const ref = useDialog(props.open, props.onClose);
  const drag = useDragToClose(props.onClose);
  const titleId = useId();
  if (wasOpen !== props.open) {
    setWasOpen(props.open);
    if (!props.open) {
      // Every close — Apply, Cancel, Escape, scrim tap, drag — resets the
      // draft so the next open starts from the committed view (the React
      // adjust-state-during-render pattern; no effect cascade).
      setDraft({});
      setQuery("");
      setPhaseFilter(null);
      setDraftSubject(null);
    }
  }
  if (!props.open) return null;
  const needle = query.trim().toLowerCase();
  const rows = props.series.filter(
    (x) =>
      (!needle ||
        x.label.toLowerCase().includes(needle) ||
        x.ticker.toLowerCase().includes(needle)) &&
      (phaseFilter === null || x.phase === phaseFilter),
  );
  const isSelected = (x: PickerSeries) => draft[x.id] ?? x.selected;
  const phasesPresent = ["Trough", "Recovery", "Expansion", "Peak", "Downturn"].filter(
    (p) => props.series.some((x) => x.phase === p),
  );
  const subjectPick = draftSubject ?? props.subjectId;
  const subjectRow = props.series.find((x) => x.id === subjectPick) ?? null;
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
          <span className={s.chipQuiet}>{t("scSeriesCount", { n: props.series.length })}</span>
          <button type="button" className={s.sheetX} onClick={props.onClose} aria-label={t("scSeriesSheetCancel")}>
            ✕
          </button>
        </div>
        <div className={s.sheetFamilies} role="group" aria-label={t("scSeriesSheetTitle")}>
          {props.families.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={props.family === f.key}
              onClick={() => props.onFamily(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className={s.phaseChips} role="group" aria-label={t("scPhaseFilterAll")}>
          <button
            type="button"
            aria-pressed={phaseFilter === null}
            onClick={() => setPhaseFilter(null)}
          >
            {t("scPhaseFilterAll")}
          </button>
          {phasesPresent.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={phaseFilter === p}
              onClick={() => setPhaseFilter(phaseFilter === p ? null : p)}
            >
              {t(SHEET_PHASE_LABELS[p])}
            </button>
          ))}
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
            <li key={x.id} className={x.disabled ? s.sheetRowDisabled : undefined}>
              <div className={s.sheetRow}>
                <button
                  type="button"
                  className={s.sheetSubject}
                  aria-pressed={subjectPick === x.id}
                  onClick={() => setDraftSubject(x.id)}
                >
                  <span>
                    {x.label} <b>{x.ticker}</b>
                  </span>
                  <small>
                    {x.phase !== null ? t(SHEET_PHASE_LABELS[x.phase] ?? "") : t("scPositionUnavailable")}
                    {x.position !== null ? ` ${formatValue(x.position, 0)}` : ""}
                  </small>
                </button>
                <label className={s.sheetCompare}>
                  <input
                    type="checkbox"
                    checked={isSelected(x)}
                    disabled={x.disabled}
                    aria-label={`${t("scCompareTitle")}: ${x.label}`}
                    onChange={() => setDraft((d) => ({ ...d, [x.id]: !isSelected(x) }))}
                  />
                  {x.basis && (
                    <small>{t(x.basis === "price" ? "scBasisPillPrice" : "scBasisPillTr")}</small>
                  )}
                </label>
              </div>
              {x.refusal && <em className={s.refusal}>{x.refusal}</em>}
            </li>
          ))}
          {rows.length === 0 && (
            <li className={s.note}>
              {t("scRailEmptyGroup", {
                phase: phaseFilter !== null ? t(SHEET_PHASE_LABELS[phaseFilter] ?? "") : "",
              })}
            </li>
          )}
        </ul>
        <div className={s.selectedFoot}>
          <span>{t("scSelectedSeries")}</span>
          {subjectRow ? (
            <span className={s.chipQuiet}>
              {subjectRow.label} <b>{subjectRow.ticker}</b>
            </span>
          ) : (
            <span className={s.chipQuiet}>—</span>
          )}
          <span className={s.note}>{t("scBasisRule")}</span>
        </div>
        <div className={s.sheetActions}>
          <button type="button" onClick={props.onClose}>
            {t("scSeriesSheetCancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              const subjectChanged =
                draftSubject !== null && draftSubject !== props.subjectId;
              if (subjectChanged) props.onSelectSubject(draftSubject);
              // Comparison drafts were judged against the OLD subject's basis
              // rules; when the subject changes they are dropped with it (the
              // donor's fresh-mount-per-subject semantics) so a mixed-basis
              // overlay can never be committed blind (C08).
              if (!subjectChanged) {
                for (const x of props.series) {
                  const next = draft[x.id] ?? x.selected;
                  if (next !== x.selected) props.onToggle(x.id);
                }
              }
              props.onClose();
            }}
          >
            {t("scSeriesSheetApply")}
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
