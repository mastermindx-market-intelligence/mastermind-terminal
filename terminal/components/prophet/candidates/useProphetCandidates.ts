"use client";
import { useCallback, useEffect, useState } from "react";
import { decodeProphetCandidates, type ProphetCandidatePool } from "@/lib/prophetCandidates";

type Read = { status: "loading" | "unavailable" | "unauthenticated" | "forbidden" | "limited"; pool: null }
  | { status: "ready"; pool: ProphetCandidatePool };

/** This read lives inside the existing account-keyed Intelligence workspace.
 * Unmount destroys its private state. No second session authority, storage,
 * background watcher, or shared cache is introduced. Refresh is deliberate. */
export function useProphetCandidates() {
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<Read>({ status: "loading", pool: null });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const finish = (next: Read) => { if (active) setRead(next); };
    // The timer settles the UI even if a transport ignores AbortSignal.
    const timer = setTimeout(() => {
      finish({ status: "unavailable", pool: null }); active = false; controller.abort();
    }, 12_000);
    void (async () => {
      finish({ status: "loading", pool: null });
      try {
        const response = await fetch("/api/prophet/candidates", { method: "GET", credentials: "same-origin",
          cache: "no-store", redirect: "error", signal: controller.signal, headers: { Accept: "application/json" } });
        if (!active) return;
        if (!response.ok) {
          const status = response.status === 401 ? "unauthenticated" : response.status === 403 ? "forbidden" : response.status === 429 ? "limited" : "unavailable";
          finish({ status, pool: null }); return;
        }
        if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) { finish({ status: "unavailable", pool: null }); return; }
        const pool = decodeProphetCandidates(await response.json());
        finish(pool ? { status: "ready", pool } : { status: "unavailable", pool: null });
      } catch { finish({ status: "unavailable", pool: null }); }
      finally { clearTimeout(timer); controller.abort(); }
    })();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [attempt]);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  return { ...read, refresh };
}
