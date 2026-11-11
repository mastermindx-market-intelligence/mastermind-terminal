"use client";
// Read-only "Source code" view for a built-in indicator (the legend's source action). Custom Pine
// scripts open the full Pine editor instead — this dialog is only for the bundled built-ins, whose
// Pine-style definition lives in the indicator registry.

import { useEffect, useRef } from "react";
import { IND_DEFS, isIndKey } from "@/lib/indicators";
import { tPlain } from "@/lib/i18n";

// Hand focus back to the opener. The legend ⚙ is revealed only by :hover, so while the scrim covers its row
// it is display:none and refuses focus; the browser re-reveals it a frame after the scrim goes. Retry for a
// few frames, and only while focus is still unclaimed (on <body>), so nothing the user reached is taken.
function returnFocus(el: HTMLElement | null, frames = 3) {
  if (!el?.isConnected) return;
  el.focus({ preventScroll: true });
  if (document.activeElement === el || frames <= 0) return;
  window.requestAnimationFrame(() => {
    if (!document.activeElement || document.activeElement === document.body) returnFocus(el, frames - 1);
  });
}

export default function IndicatorSource({ indKey, onClose }: { indKey: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !dialogRef.current?.contains(active)) returnFocusRef.current = active;
    dialogRef.current?.focus({ preventScroll: true });
    return () => returnFocus(returnFocusRef.current);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!isIndKey(indKey)) return null;
  const def = IND_DEFS[indKey];
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="ind-src" role="dialog" aria-modal="true" aria-labelledby="indicator-source-title" tabIndex={-1}
        onClick={(e) => e.stopPropagation()}>
        <div className="is-head">
          <b id="indicator-source-title">{def.label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.pine</b>
          <span className="badge" style={{ marginLeft: 8 }}>{tPlain("peBuiltIn", "PINE v6 · built-in")}</span>
          <span className="x" onClick={onClose} role="button" tabIndex={0} aria-label={tPlain("smClose", "Close")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClose(); } }}>✕</span>
        </div>
        <pre className="src-code">{def.source}</pre>
        <div className="is-foot">
          <span style={{ color: "var(--text-2)", fontSize: 12 }}>{tPlain("isReadOnly")}</span>
          <div className="spacer" />
          <button className="ai" onClick={onClose}>{tPlain("smClose", "Close")}</button>
        </div>
      </div>
    </div>
  );
}
