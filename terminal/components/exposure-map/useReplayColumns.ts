"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { flowGetResult, type FlowOutcome } from "@/lib/flowClientCache";
import { gexSessionOf, isGexDates } from "@/lib/gexSessions";
import { reduceReplayFrame, selectReplaySessions, REPLAY_MAX_FRAMES, type ReplayColumn } from "@/lib/exposureReplayFrames";
import type { ExposureLens } from "@/lib/exposureMapProjection";
import type { ExposureMapMetric } from "@/lib/exposureMap";
import type { ReviewFrameInput } from "@/lib/exposureSessionReview";

export type ReplayColumnsStatus = "loading" | "ready" | "no-index" | "unavailable";

const isSource = (v: unknown): v is { asof: unknown } =>
  v != null && typeof v === "object" && !Array.isArray(v) && "asof" in v;

/**
 * One read plane for the stored-session frames: the `gex_dates` index, then the newest stored
 * books before the live session, reduced per column with the live book last. Shared by the
 * replay scrubber and the session review so both measure the same stored frames.
 */
export function useReplayColumns({ root, source, metric, lens, today, now }: {
  root: string; source: unknown; metric: ExposureMapMetric; lens: ExposureLens; today: string; now: number;
}): { status: ReplayColumnsStatus; columns: ReplayColumn[] | null; retry: () => void } {
  const [status, setStatus] = useState<ReplayColumnsStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  const [books, setBooks] = useState<Array<{ session: string; outcome: FlowOutcome }> | null>(null);

  // One read per mount/root/retry: a stale response never lands.
  useEffect(() => {
    let live = true;
    void (async () => {
      const indexOutcome = await flowGetResult("gex_dates:" + root)
        .catch((): FlowOutcome => ({ status: "unavailable", reason: "network" }));
      if (!live) return;
      setStatus("loading");
      setBooks(null);
      if (indexOutcome.status !== "data" || !isGexDates(indexOutcome.data)) {
        setStatus(indexOutcome.status === "unavailable" ? "unavailable" : "no-index");
        return;
      }
      const currentSession = gexSessionOf(isSource(source) ? source.asof : null);
      const picked = selectReplaySessions(indexOutcome.data.dates, currentSession, REPLAY_MAX_FRAMES);
      if (picked.length === 0) { setStatus("no-index"); return; }
      const settled = await Promise.all(picked.map(async (session) =>
        ({ session, outcome: await flowGetResult(`gex_at:${root}:${session}`)
          .catch((): FlowOutcome => ({ status: "unavailable", reason: "network" })) })));
      if (!live) return;
      setBooks(settled);
      setStatus("ready");
    })();
    return () => { live = false; };
  }, [root, source, attempt]);

  const currentSession = isSource(source) ? gexSessionOf(source.asof) ?? "" : "";
  const columns = useMemo<ReplayColumn[] | null>(() => {
    if (books == null) return null;
    const stored = books.map((book) => reduceReplayFrame(book.outcome.status === "data" ? book.outcome.data : null,
      root, book.session, metric, lens, today, now));
    return [...stored, reduceReplayFrame(source, root, currentSession, metric, lens, today, now, true)];
  }, [books, root, metric, lens, today, now, source, currentSession]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { status, columns, retry };
}

/**
 * The session review measures touches around each frame's STORED dominant level. A gap column has
 * no stored level, so it yields no row (never a zero-touch row); a frame without a dominant keeps
 * its row with a null level so the review can say so.
 */
export function reviewFramesFromColumns(columns: readonly ReplayColumn[] | null): ReviewFrameInput[] {
  if (!columns) return [];
  const frames: ReviewFrameInput[] = [];
  for (const column of columns) {
    if (column.kind !== "frame") continue;
    const { frame } = column;
    const level = frame.dominant;
    frames.push({
      session: frame.session,
      kind: frame.current ? "current" : frame.kind,
      level,
      levelNetMn: level == null ? null : frame.values.get(level) ?? null,
    });
  }
  return frames;
}
