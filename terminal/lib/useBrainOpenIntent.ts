"use client";
import { useCallback, useEffect, useRef } from "react";

/** Keep an explicit opening request only for this mounted shell. The existing
 * document singleton owns loading, readiness, auth and the panel itself. */
export function useBrainOpenIntent(setBrainIncluded: (included: boolean) => void) {
  const alive = useRef(false);
  const pendingOpen = useRef(false);
  const initialQueryConsumed = useRef(false);

  const cancelPendingBrainOpen = useCallback(() => {
    pendingOpen.current = false;
    initialQueryConsumed.current = true;
  }, []);

  const request = useCallback((action: "open" | "toggle") => {
    if (!alive.current) return;
    const host = (window as unknown as {
      MMBrain?: { open?: () => void; toggle?: () => void };
    }).MMBrain;
    const apply = host?.[action];
    if (typeof apply === "function") {
      // Consume before invoking the singleton: a later ready notification must
      // not replay this action after the user has closed the panel.
      pendingOpen.current = false;
      initialQueryConsumed.current = true;
      setBrainIncluded(true);
      apply.call(host);
      return;
    }
    if (action === "toggle" && pendingOpen.current) {
      cancelPendingBrainOpen();
      return;
    }
    pendingOpen.current = true;
    setBrainIncluded(true);
  }, [cancelPendingBrainOpen, setBrainIncluded]);

  const openBrain = useCallback(() => request("open"), [request]);
  const toggleBrain = useCallback(() => request("toggle"), [request]);

  useEffect(() => {
    alive.current = true;
    const onReady = () => { if (pendingOpen.current) openBrain(); };
    window.addEventListener("mm-brain-ready", onReady);
    window.addEventListener("mm:copilot", openBrain);
    try {
      if (!initialQueryConsumed.current && new URLSearchParams(window.location.search).get("ai") === "1") openBrain();
    } catch { /* An unusable query creates no opening request. */ }
    return () => {
      alive.current = false;
      pendingOpen.current = false;
      window.removeEventListener("mm-brain-ready", onReady);
      window.removeEventListener("mm:copilot", openBrain);
    };
  }, [openBrain]);

  return { openBrain, toggleBrain, cancelPendingBrainOpen };
}
