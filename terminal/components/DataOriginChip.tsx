"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { originPending, type DataOrigin, type DataOriginState } from "@/lib/dataOrigin";

// The popover's <dl> (basis/src/as-of/generation/open) is shown only for states that
// carried a labelled payload; pending/unavailable/composite have no payload to describe.
const SHOW_DL: ReadonlySet<DataOriginState> = new Set(["known", "partial", "unknown"]);

function srcLabel(src: string | null, t: ReturnType<typeof useT>): string {
  if (src === "deep") return t("originSrc_deep");
  if (src === "polygon") return t("originSrc_polygon");
  if (src === "yahoo") return t("originSrc_yahoo");
  if (src != null) return src;
  return t("originUnknown");
}

/**
 * Data OS U02 — the chart frame bar's data-origin chip. Its label and explanation are
 * DERIVED from the daily-OHLC file's view contract (lib/dataOrigin.ts), never static:
 * the old chip claimed "split & dividend adjusted" for every symbol with nothing behind it.
 * Request ownership (client half): an origin whose symbol does not match the mounted
 * chart is never shown — a late response for an old symbol cannot repaint this readout.
 */
export default function DataOriginChip({ symbol, origin }: { symbol?: string; origin: DataOrigin | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const effective = origin && symbol && origin.symbol === symbol ? origin : originPending(symbol ?? "");
  const state: DataOriginState = effective.state;

  // Closes on outside pointerdown and on Escape. Listeners live only while open.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = state === "known" || state === "partial" ? "TRADJ"
    : state === "pending" ? "—"
    : t("originChipUnknown");
  const stateKey = `originState${state.charAt(0).toUpperCase()}${state.slice(1)}`;
  const showDl = SHOW_DL.has(state);
  const showNotes = state !== "pending" && state !== "unavailable" && state !== "composite";
  const showFoot = state !== "pending";

  return (
    <div className="cfb-origin-host" ref={hostRef}>
      <button type="button"
        className={`cfb-chip cfb-chip-adj cfb-origin cfb-origin-${state}`}
        data-testid="cfb-origin" data-origin-state={state}
        aria-expanded={open} aria-haspopup="dialog" aria-label={t("originAria")}
        onClick={() => setOpen(o => !o)}>{label}</button>
      {open && (
        <div className="qsg-menu cfb-origin-pop" role="dialog" aria-label={t("originTitle")} data-testid="cfb-origin-pop"
             onClick={(e) => e.stopPropagation()}>
          <div className="cfb-origin-head">{t("originTitle")}</div>
          <div className="cfb-origin-state">{t(stateKey)}</div>
          {showDl && (
            <dl className="cfb-origin-dl">
              <dt>{t("originBasis")}</dt><dd>{effective.basis === "tradj" ? t("originBasisTradj") : t("originUnknown")}</dd>
              <dt>{t("originSource")}</dt><dd>{srcLabel(effective.src, t)}</dd>
              <dt>{t("originAsOf")}</dt><dd>{effective.asOf != null ? <code>{effective.asOf}</code> : t("originUnknown")}</dd>
              <dt>{t("originGeneration")}</dt><dd>{effective.generation != null ? <code>{effective.generation}</code> : t("originUnknown")}</dd>
              <dt>{t("originOpen")}</dt><dd>{effective.openReconstructed ? t("originOpenRecon") : t("originOpenTraded")}</dd>
            </dl>
          )}
          {showNotes && effective.refusals.map((code) => {
            const key = `originCode_${code}`;
            const text = t(key);
            return <p key={code} className="cfb-origin-note">{text === key ? code : text}</p>;
          })}
          {showNotes && effective.suspectedBreaks > 0 && (
            <p className="cfb-origin-note">{t("originBreaks").replace("{n}", String(effective.suspectedBreaks))}</p>
          )}
          {showFoot && <p className="cfb-origin-foot">{t("originNotPrinted")}</p>}
        </div>
      )}
    </div>
  );
}
