"use client";
// Segment-level error boundary — wraps all routes except the root layout itself.
// LangProvider is available here (it lives in RootLayout above this boundary).
import { useEffect } from "react";
import { useT } from "@/lib/i18n";
import { BrandMark } from "@/components/BrandMark";
import { shouldAutoRecoverNavigationError } from "@/lib/navigationRecovery";

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
  useEffect(() => {
    console.error("[ErrorBoundary]", error);
    tryChunkReload(error);
  }, [error]);

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
