"use client";

import { useEffect, useMemo, useState } from "react";
import { flowGetResult, type FlowOutcome } from "@/lib/flowClientCache";
import { isGexDates } from "@/lib/gexSessions";
import { selectReplaySessions } from "@/lib/exposureReplayFrames";
import { qualifiedExposureProjection, type QualifiedProjection } from "@/lib/exposureMapProjection";

export type PriorProjectionStatus = "loading" | "ready" | "none" | "unavailable";

/** The newest stored session strictly before the current one, or null when the index holds none. */
export function priorStoredSession(dates: readonly string[], currentSession: string | null): string | null {
  return selectReplaySessions(dates, currentSession, 2)[0] ?? null;
}

interface PriorState { key: string; status: PriorProjectionStatus; session: string | null; raw: unknown }

/**
 * The prior session's projection from the dated plane: the `gex_dates` index, then that session's
 * stored book, qualified by the same strict consumer the live book goes through. Nothing is
 * synthesized: no index, no stored book or an unqualified book all yield null and the surface says so.
 */
export function usePriorProjection({ root, session, now }: { root: string; session: string | null; now: number }):
  { status: PriorProjectionStatus; prior: QualifiedProjection | null; priorSession: string | null } {
  const key = `${root}|${session ?? ""}`;
  const [state, setState] = useState<PriorState>({ key: "", status: "loading", session: null, raw: null });

  useEffect(() => {
    let live = true;
    void (async () => {
      const index = await flowGetResult("gex_dates:" + root)
        .catch((): FlowOutcome => ({ status: "unavailable", reason: "network" }));
      if (!live) return;
      if (index.status !== "data" || !isGexDates(index.data)) {
        setState({ key, status: index.status === "unavailable" ? "unavailable" : "none", session: null, raw: null });
        return;
      }
      const prior = priorStoredSession(index.data.dates, session);
      if (!prior) { setState({ key, status: "none", session: null, raw: null }); return; }
      const book = await flowGetResult(`gex_at:${root}:${prior}`)
        .catch((): FlowOutcome => ({ status: "unavailable", reason: "network" }));
      if (!live) return;
      setState(book.status === "data"
        ? { key, status: "ready", session: prior, raw: book.data }
        : { key, status: book.status === "unavailable" ? "unavailable" : "none", session: prior, raw: null });
    })();
    return () => { live = false; };
  }, [key, root, session]);

  const current = useMemo<PriorState>(() => (state.key === key ? state : { key, status: "loading", session: null, raw: null }), [state, key]);
  const prior = useMemo(() => {
    if (current.status !== "ready" || !current.session) return null;
    const raw = current.raw;
    const receipt = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { exposure_projection?: unknown }).exposure_projection ?? null : null;
    return receipt ? qualifiedExposureProjection(receipt, root, current.session, now) : null;
  }, [current, root, now]);
  return { status: current.status, prior, priorSession: current.session };
}
