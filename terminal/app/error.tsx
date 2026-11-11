"use client";
// Segment-level error boundary — wraps all routes except the root layout itself.
// LangProvider is available here (it lives in RootLayout above this boundary).
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useT } from "@/lib/i18n";
import { BrandMark } from "@/components/BrandMark";
import { shouldAutoRecoverNavigationError } from "@/lib/navigationRecovery";
import DashboardBackButton from "@/components/DashboardBackButton";
import { backToMacro, safeMacroHref } from "@/lib/originNav";
import styles from "./error-return.module.css";

// An error can replace the chart's own chrome before its Back control mounts.
// Only this load's explicit, validated return is authoritative here; a cached
// dashboard visit must not turn an unrelated failure into a return handoff.
function currentErrorReturn(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return safeMacroHref(params.get("ret") || params.get("return"));
}
const serverErrorReturn = () => "";
function subscribeErrorReturn(onChange: () => void) {
  const events = ["popstate", "hashchange", "mmx:shell-location"];
  for (const event of events) window.addEventListener(event, onChange);
  return () => {
    for (const event of events) window.removeEventListener(event, onChange);
  };
}

// The failed subtree's presentation owner is still reflected in the document
// during fallback render. Its cleanup then restores native dark. Retain only
// that already-rendered public presentation on this fallback's own element;
// never reconstruct account preferences or change the document/owner lifecycle.
const ERROR_PRESENTATION_VARS = [
  "--bg", "--panel", "--panel-2", "--panel-3", "--line", "--line-3",
  "--text", "--text-2", "--muted", "--brand", "--brand-2", "--brand-hov",
  "--link", "--shadow-card", "--font-ui",
] as const;
type ErrorPresentation = { theme: "dark" | "light"; tokens: CSSProperties };
function readErrorPresentation(): ErrorPresentation | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  try {
    const root = document.documentElement;
    const theme = root.dataset.theme;
    if (theme !== "light" && theme !== "dark") return null;
    const computed = window.getComputedStyle(root);
    const values: Record<string, string> = {};
    for (const name of ERROR_PRESENTATION_VARS) {
      const value = computed.getPropertyValue(name).trim();
      if (value) values[name] = value;
    }
    if (!values["--bg"] || !values["--text"]) return null;
    return { theme, tokens: values as CSSProperties };
  } catch {
    return null; // Missing presentation remains the incumbent native fallback.
  }
}
const subscribeClientReady = () => () => {};
const clientReady = () => true;
const serverNotReady = () => false;

// Existing one-shot route recovery (Wave-1 INFRA, options-crash audit).
// A stale chunk after deploy or a transient Options RSC/HTTP2 navigation failure
// may recover with one fresh document request. Only the exact Options network
// patterns receive this new behavior; other programming errors keep manual retry.
// tryChunkReload uses the SAME persisted cooldown and can NEVER loop:
// - the one-shot sessionStorage flag records WHEN we last healed;
// - if the just-reloaded document throws a chunk error again within RELOAD_MIN_GAP_MS, we do NOT
//   reload (that's a real loop — e.g. the new build is itself broken) and fall through to the
//   manual retry UI instead;
// - a genuinely-later chunk crash (gap exceeded) heals again. The flag is never explicitly
//   cleared: the 30s window IS the whole guard. Known tradeoff: a different genuine chunk
//   error within 30s of a heal falls to the manual UI (conservative — no loop is possible).
// All other errors never touch the flag and keep the manual retry UI.
const RELOAD_FLAG = "mm.chunkreload";
const RELOAD_MIN_GAP_MS = 30_000;

// Returns true if a heal-reload was triggered (the document is about to navigate away).
// Safe under SSR / disabled storage.
export function tryChunkReload(error: Error): boolean {
  if (typeof window === "undefined" || !shouldAutoRecoverNavigationError(error, window.location.pathname)) return false;
  try {
    const prev = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (prev && Date.now() - prev < RELOAD_MIN_GAP_MS) {
      // reloaded moments ago and still crashing → stop looping, show manual UI.
      return false;
    }
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false; // storage unavailable (private mode) — skip auto-heal, keep manual UI.
  }
}

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const t = useT();
  const [presentation] = useState(readErrorPresentation);
  const hydrated = useSyncExternalStore(subscribeClientReady, clientReady, serverNotReady);
  const returnHref = useSyncExternalStore(subscribeErrorReturn, currentErrorReturn, serverErrorReturn);
  const returnRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    console.error("[ErrorBoundary]", error);
    tryChunkReload(error);
  }, [error]);
  useEffect(() => {
    if (returnHref && currentErrorReturn() === returnHref) {
      returnRow.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    }
  }, [returnHref]);

  return (
    <main className={`center ${styles.recovery}`} data-error-theme={hydrated ? presentation?.theme : undefined} style={hydrated ? presentation?.tokens : undefined}>
      <div className={`hero ${styles.surface}`}>
        <div className="mk"><BrandMark size={48} /></div>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>{t("errTitle")}</h1>
        <p className="tag" style={{ marginBottom: 20 }}>
          {t("errBody")}
          {error.digest && (
            <span className={styles.reference}>
              ref: {error.digest}
            </span>
          )}
        </p>
        {returnHref && <div className={styles.returnRow} ref={returnRow}>
          <DashboardBackButton variant="mobile" returnHref={returnHref} onClick={() => {
            // URL replacement may precede the next subscribed render. Never
            // activate the previous target under the previous button label.
            if (currentErrorReturn() === returnHref) backToMacro(returnHref);
          }} />
        </div>}
        <div className={`cta ${styles.actions}`}>
          <button className="btn btn-primary" onClick={() => unstable_retry()}>
            {t("errRetry")}
          </button>
          <a href="/terminal" className="btn btn-ghost">{t("errGoChart")}</a>
        </div>
      </div>
    </main>
  );
}
