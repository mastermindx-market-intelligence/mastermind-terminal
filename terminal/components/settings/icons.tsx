// Inline icons + tiny shared primitives for the account settings dashboard.
// Ported from the Macro Dashboard's SD_ICON table so both products' settings
// dashboards carry the same glyphs.

import type { ReactNode } from "react";

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconAccount() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...S}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
export function IconBilling() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...S}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 10h18M6.5 15H11" />
    </svg>
  );
}
export function IconUsage() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...S}>
      <path d="M4.5 19a8 8 0 1 1 15 0" />
      <path d="m12 14.5 3.5-3.5" />
      <circle cx="12" cy="19" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function IconPrefs() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...S}>
      <path d="M4 8h10M18 8h2M4 16h2M10 16h10" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="8" cy="16" r="2" />
    </svg>
  );
}
/** Terminal section — a chart glyph, the Terminal's own idiom in this rail. */
export function IconTerminal() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...S}>
      <path d="M3 4.5h18v13H3z" />
      <path d="M6.5 14l3.5-4 2.6 2.6L17.5 8" />
      <path d="M9 21h6" />
    </svg>
  );
}
export function IconSync() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...S}>
      <path d="M17.5 18.5a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.4 1.6A3.8 3.8 0 0 0 6.5 18.5z" />
      <path d="m10 14 2 2 2-2M12 16v-5" />
    </svg>
  );
}
export function IconSignOut() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...S} strokeWidth={1.8}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </svg>
  );
}
export function IconX() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...S} strokeWidth={2}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
export function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...S} strokeWidth={2.4}>
      <path d="m5 12.5 4.5 4.5L19 6.5" />
    </svg>
  );
}
export function IconExtLink() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...S} strokeWidth={2}>
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}
/** Official 4-colour Google "G" — same mark the onboarding sheet uses. */
export function IconGoogle() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
/** X (formerly Twitter) — currentColor, per the macro chip treatment. */
export function IconTwitterX() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.11z" />
    </svg>
  );
}

/** Section header: title + one-line subtitle + the desktop close button.
 *  (Upstream bug fixed here: macro's `.sd-x` has no click handler at all.) */
export function SectionHead({
  title,
  sub,
  closeLabel,
  onClose,
}: {
  title: string;
  sub: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <header className="acs-head">
      <div className="acs-head-main">
        <h2>{title}</h2>
        <p className="acs-sub">{sub}</p>
      </div>
      <button type="button" className="acs-x" aria-label={closeLabel} onClick={onClose}>
        <IconX />
      </button>
    </header>
  );
}

/** A labelled group of rows. */
export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="acs-group">
      {title ? <span className="acs-group-t">{title}</span> : null}
      {children}
    </div>
  );
}

/** A settings row: label (+ optional description) on the left, value/control on
 *  the right, and an optional expanded body underneath (the inline edit form). */
export function Row({
  label,
  desc,
  value,
  valueStrong,
  control,
  editing,
  children,
}: {
  label?: ReactNode;
  desc?: ReactNode;
  value?: ReactNode;
  valueStrong?: boolean;
  control?: ReactNode;
  editing?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`acs-row${editing ? " editing" : ""}`}>
      <div className="acs-row-line">
        <span className="acs-row-main">
          {label != null ? <span className="acs-row-lbl">{label}</span> : null}
          {desc != null ? <span className="acs-row-desc">{desc}</span> : null}
        </span>
        {value != null ? (
          <span className={`acs-row-val${valueStrong ? " strong" : ""}`}>{value}</span>
        ) : null}
        {control}
      </div>
      {children}
    </div>
  );
}

/** Inline status line under a control. `kind` drives the colour; empty hides it. */
export function Msg({ text, kind }: { text: string; kind: MsgKind }) {
  return (
    <div className={`acs-msg${text ? ` show ${kind}` : ""}`} role="alert">
      {text}
    </div>
  );
}

export type MsgKind = "ok" | "err" | "wait";

/**
 * The delivery state of an account preference, reported honestly (E2).
 *
 * The distinction this component exists to draw: the LOCAL change already applied when the user
 * clicked — that is why the control repaints instantly — but "Saved" is a claim about the
 * AUTHORITY. The pane used to make that claim the moment it fired an un-awaited `updateUser`,
 * which meant a rejected request, and the Supabase shape that RESOLVES with `{ error }`, both
 * read as success.
 *
 *   guest    → saved on this device (there is no authority to be out of sync with)
 *   syncing  → in flight, or queued behind a write that is
 *   saved    → the authority acknowledged every edit made so far
 *   failed   → the pump is retrying on its own; the button jumps the backoff
 *
 * `show` is per-row: a control the user has not touched this session says nothing at all.
 */
export function DeliveryNote({
  phase, guest, show, t, onRetry,
}: {
  phase: "idle" | "local" | "syncing" | "saved" | "failed";
  guest: boolean;
  show: boolean;
  t: (key: string, fallback?: string) => string;
  onRetry: () => void;
}) {
  if (!show) return <Msg text="" kind="ok" />;
  if (guest) return <Msg text={t("acsPrefLocal")} kind="ok" />;
  if (phase === "failed") {
    return (
      <div className="acs-msg show err" role="alert">
        {t("acsPrefSyncFail")}
        <button type="button" className="acs-msg-retry" onClick={onRetry}>{t("acsPrefRetry")}</button>
      </div>
    );
  }
  if (phase === "syncing") return <Msg text={t("acsPrefSyncing")} kind="wait" />;
  if (phase === "saved") return <Msg text={t("acsPrefSaved")} kind="ok" />;
  return <Msg text="" kind="ok" />;
}
