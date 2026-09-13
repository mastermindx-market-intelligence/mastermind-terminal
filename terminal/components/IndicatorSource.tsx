"use client";
// Read-only "Source code" view for a built-in indicator (the legend's source action). Custom Pine
// scripts open the full Pine editor instead — this dialog is only for the bundled built-ins, whose
// Pine-style definition lives in the indicator registry.

import { useEffect } from "react";
import { IND_DEFS, isIndKey } from "@/lib/indicators";
import { tPlain } from "@/lib/i18n";

export default function IndicatorSource({ indKey, onClose }: { indKey: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!isIndKey(indKey)) return null;
  const def = IND_DEFS[indKey];
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ind-src" onClick={(e) => e.stopPropagation()}>
        <div className="is-head">
          <b>{def.label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.pine</b>
          <span className="badge" style={{ marginLeft: 8 }}>{tPlain("peBuiltIn", "PINE v6 · built-in")}</span>
          <span className="x" onClick={onClose} aria-label={tPlain("smClose", "Close")}>✕</span>
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
