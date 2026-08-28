"use client";
import { useT } from "@/lib/i18n";

// The generic-widget-graph fallback (W2A_WORKSPACE_UX_SPEC.md §6; freeze §2/§9). A loaded workspace
// envelope's widgets are exactly two things this build knows how to place today — the primary chart
// (the existing multi-pane chart surface, unchanged) and the dock Brain — plus, potentially, MORE:
// a widget of a type this build does not implement, or one placed in a lane (`secondary`/`rail`)
// this build does not yet consume (freeze §9: "accepted, rendered after primary… never dropped
// silently"). Either shape is a widget the specialized renderers (pane-grid, BrainWidget) have no
// slot for; this tile is the ONE deterministic fallback for both, so nothing in a validly-loaded
// workspace is ever silently dropped. Text-safe by construction: React escapes rendered text, never
// `dangerouslySetInnerHTML` (freeze §3 — no strings interpreted as markup).
//
// `type` is typed `WidgetType` upstream, but the ACTUAL runtime value for a tolerant-migrated row
// (reviewer ruling M5) is never re-validated after the `as WorkspaceEnvelope` cast — a hostile or
// corrupted stored row can carry any JSON value there at all, including an object or a multi-KB
// string. Reviewer ruling N17: accept `unknown`, and never render anything but a bounded string —
// a non-string value (object, number, null, ...) becomes the plain word "unknown" rather than
// React's `[object Object]`/`String()` coercion, and any string is capped at 32 chars so a hostile
// payload cannot turn this tile into a wall of text.
export function displayType(type: unknown): string {
  return (typeof type === "string" ? type : "unknown").slice(0, 32);
}

export default function WorkspaceTile({ type }: { type: unknown }) {
  const t = useT();
  const label = displayType(type);
  return (
    <div className="ws-tile-missing" role="note" data-ws-missing-widget={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z" /><path d="M9 12h6" /></svg>
      <b>{t("wsPanelUnavailable")}</b>
      <span className="ws-tile-type">
        <span>{t("wsPanelType")}</span>
        {label}
      </span>
      <p>{t("wsPanelUnavailableSub")}</p>
    </div>
  );
}
