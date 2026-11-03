"use client";
// Segment-level error boundary — wraps all routes except the root layout itself.
// LangProvider is available here (it lives in RootLayout above this boundary).
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n";
import { BrandMark } from "@/components/BrandMark";
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

// Stale-chunk-after-deploy self-heal (Wave-1 INFRA, options-crash audit). When an old shell served
// inside its SWR window resolves a lazy tab against a purged content-hashed chunk, Turbopack throws
// "module factory is not available" (or ChunkLoadError / "Loading chunk N failed"). A fresh full
// document load fixes it (deploymentId now stamps ?dpl on assets, deploy_terminal.sh keeps 3 chunk
// generations). tryChunkReload does ONE reload per chunk crash and can NEVER loop:
// - the one-shot sessionStorage flag records WHEN we last healed;
// - if the just-reloaded document throws a chunk error again within RELOAD_MIN_GAP_MS, we do NOT
//   reload (that's a real loop — e.g. the new build is itself broken) and fall through to the
//   manual retry UI instead;
// - a genuinely-later chunk crash (gap exceeded) heals again. The flag is never explicitly
//   cleared: the 30s window IS the whole guard. Known tradeoff: a different genuine chunk
//   error within 30s of a heal falls to the manual UI (conservative — no loop is possible).
// Non-chunk errors never touch the flag and always render the manual retry UI.
const CHUNK_RE = /module factory is not available|ChunkLoadError|Loading chunk .* failed/i;
const RELOAD_FLAG = "mm.chunkreload";
const RELOAD_MIN_GAP_MS = 30_000;

function isChunkError(err: Error): boolean {
  return CHUNK_RE.test(err?.message || "") || CHUNK_RE.test(err?.name || "");
}

// Returns true if a heal-reload was triggered (the document is about to navigate away).
// Safe under SSR / disabled storage.
export function tryChunkReload(error: Error): boolean {
  if (!isChunkError(error) || typeof window === "undefined") return false;
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
    <main className="center">
      <div className="hero">
        <div className="mk"><BrandMark size={48} /></div>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>{t("errTitle")}</h1>
        <p className="tag" style={{ marginBottom: 20 }}>
          {t("errBody")}
          {error.digest && (
            <span style={{ display: "block", marginTop: 8, color: "var(--muted)", fontSize: 11, fontFamily: "monospace" }}>
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
        <div className="cta">
          <button className="btn btn-primary" onClick={() => unstable_retry()}>
            {t("errRetry")}
          </button>
          <a href="/terminal" className="btn btn-ghost">{t("errGoChart")}</a>
        </div>
      </div>
    </main>
  );
}
