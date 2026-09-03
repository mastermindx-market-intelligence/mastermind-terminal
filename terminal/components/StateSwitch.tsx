// Lifted verbatim from IndicatorsModal.tsx (W2A_WORKSPACE_UX_SPEC.md §1.3) so the workspace menu's
// Brain-dock toggle (`.ws-dock`) can reuse the exact same on/off affordance instead of growing a
// second one. No CSS change, no visual change — `.im-state-switch`/`.im-state-lock` are already
// global (app/globals.css:868-876).

export function LockMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export default function StateSwitch({ on, locked = false }: { on: boolean; locked?: boolean }) {
  if (locked) {
    return (
      <span className="im-state-lock" aria-hidden="true">
        <LockMark />
      </span>
    );
  }
  return (
    <span className={`im-state-switch${on ? " on" : ""}`} aria-hidden="true">
      <span className="im-state-switch-glow" />
      <span className="im-state-switch-knob">
        <span />
      </span>
    </span>
  );
}
