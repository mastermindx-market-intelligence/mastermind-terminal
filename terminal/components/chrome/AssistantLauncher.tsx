"use client";
import { useT } from "@/lib/i18n";

/** B-PLAT-7: the floating assistant launcher. Styling and z-order only — it opens
 *  the same window.MMBrain the toolbar button at TerminalShell.tsx:4909 already
 *  opens. No behaviour or content change: no label, no badge, no count. */
export default function AssistantLauncher({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const label = t("launcherAsk", "Ask the assistant");
  return (
    <button
      type="button"
      className="mm-launcher"
      data-mm-launcher="1"
      aria-label={label}
      title={label}
      onClick={onOpen}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-5.2A8 8 0 0 1 13 4a8 8 0 0 1 8 8z" />
      </svg>
    </button>
  );
}
