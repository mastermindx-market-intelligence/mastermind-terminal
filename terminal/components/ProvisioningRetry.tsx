"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tPlain } from "@/lib/i18n";

// Auto-recovery for the workspace-provisioning fallback in app/terminal/page.tsx.
// A refresh preserves mounted client state when the server returns this fallback
// again. Keep the attempt budget in React as well as sessionStorage, and wait for
// each refresh transition to settle before scheduling another bounded attempt.
const SS_KEY = "mm.provRetry";
const MAX_AUTO = 4;
const DELAY_MS = 1200;

export default function ProvisioningRetry() {
  const router = useRouter();
  const [attempts, setAttempts] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let n = 0;
    try {
      const stored = parseInt(sessionStorage.getItem(SS_KEY) || "0", 10);
      if (Number.isFinite(stored)) n = Math.max(0, Math.min(MAX_AUTO, stored));
    } catch { /* keep an in-memory budget when storage is unavailable */ }
    setAttempts(n);
  }, []);

  useEffect(() => {
    if (attempts === null || attempts >= MAX_AUTO || pending) return;
    const id = setTimeout(() => {
      const next = attempts + 1;
      try { sessionStorage.setItem(SS_KEY, String(next)); } catch { /* ignore */ }
      setAttempts(next);
      startTransition(() => router.refresh());
    }, DELAY_MS);
    return () => clearTimeout(id);
  }, [router, attempts, pending]);

  // Success unmounts this component. Persistent unavailability exposes a manual
  // retry after the final response, without overlapping a slow refresh request.
  if (attempts === null || attempts < MAX_AUTO || pending) return null;
  return (
    <button
      className="ob-btn"
      style={{ marginTop: 16 }}
      onClick={() => {
        try { sessionStorage.removeItem(SS_KEY); } catch { /* ignore */ }
        window.location.reload();
      }}
    >
      {tPlain("obProvRetry", "Retry")}
    </button>
  );
}
