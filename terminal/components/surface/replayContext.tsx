"use client";
/**
 * replayContext — shared replay state for the surface pane group.
 *
 * A single ReplayProvider owns the replay reducer (lib/replayEngine) and exposes:
 *   - state (stamps, frame, playing, speed)
 *   - dispatch (the reducer actions)
 *   - asOfStamp: the "HHMM" the group is time-traveled to (null = no data)
 *   - atHead: at the newest frame of the LOADED session
 *   - live: at the newest frame of the LIVE session (atHead AND not an archived session)
 *   - sessionDate / archived: which session is loaded (null / false = today)
 *
 * SurfacePane consumes asOfStamp + sessionDate to fetch the right frame; ReplayBar drives
 * dispatch. The `atHead` / `live` split is what keeps point-in-time honesty working for
 * multi-day replay: the last frame of an ARCHIVED session is at the head of that session but
 * is not the present, so anything that can only describe the present (the head-of-day expiry
 * matrix, today's tide) must key off `live`, never `atHead`.
 *
 * The position is also published to replayBus so sibling hub tabs — which are kept alive but
 * live outside this provider's subtree — can react to the scrubber.
 *
 * The play clock lives here (one interval per provider) so every consumer advances in
 * lockstep. Keyboard Home/End/Space/←/→ are bound while the group is hovered/focused.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  replayReducer,
  initReplay,
  stampAt,
  isAtHead,
  keyToAction,
  tickIntervalMs,
  createEngagementTracker,
  type ReplayState,
  type ReplayAction,
} from "@/lib/replayEngine";
import { publishWorkspaceReplay, releaseWorkspaceReplay } from "./replayBus";
import { flowGet } from "@/lib/flowClientCache";
import { isSurfaceIndexForContext } from "@/lib/surfaceContract";

interface ReplayCtx {
  state: ReplayState;
  dispatch: (a: ReplayAction) => void;
  asOfStamp: string | null;
  /** Newest frame of the LOADED session. */
  atHead: boolean;
  /** Newest frame of the LIVE session — false for every frame of an archived one. */
  live: boolean;
  /** The loaded session date ("YYYY-MM-DD"), or null while on today. */
  sessionDate: string | null;
  /** A past session is loaded. */
  archived: boolean;
  /** Session actually advertised by the accepted source index. */
  indexDate: string | null;
  /** Failed refreshes retain stored observations, not a live-health claim. */
  indexError: boolean;
  /** Current-head revision, even when its HHMM filename is unchanged. */
  frameRevision: number;
  /** Successful index refresh counter, independent of the selected frame. */
  sourceRevision: number;
  /** Attach to the pane-group root so keybinds only fire while it's engaged. */
  bindGroupRef: (el: HTMLElement | null) => void;
}

const Ctx = createContext<ReplayCtx | null>(null);

export function ReplayProvider({
  children,
  root,
  sessionDate = null,
}: {
  children: ReactNode;
  /** Instrument whose index this existing shared replay owner admits. */
  root?: string;
  /** A past session to replay ("YYYY-MM-DD"); null = today's live session. */
  sessionDate?: string | null;
}) {
  const [state, dispatch] = useReducer(replayReducer, [], () => initReplay([]));
  // ONE tracker for the provider's life. Its handler set is created once, so every
  // removeEventListener matches its addEventListener and nothing accumulates (B5).
  const trackerRef = useRef(createEngagementTracker());
  // Identity for the workspace bus, so a remounting provider can't clear a newer one.
  const busIdRef = useRef(Symbol("replay-provider"));

  const [indexError, setIndexError] = useState(false);
  const [indexDate, setIndexDate] = useState<string | null>(null);
  const [indexRevision, setIndexRevision] = useState(0);

  // Own the index once for the whole group, not once per chart. Await fresh
  // bytes through the existing deduplicating cache; layout changes do not
  // recreate this provider. A failed refresh retains usable observations.
  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let acceptedDate: string | null = null;
    const read = async () => {
      const data = await flowGet(
        sessionDate ? `surface_idx_at:${root}:${sessionDate}` : `surface_idx:${root}`,
        { refresh: true },
      );
      if (cancelled) return;
      if (isSurfaceIndexForContext(data, root, sessionDate)) {
        const changedSession = acceptedDate != null && acceptedDate !== data.date;
        acceptedDate = data.date;
        setIndexDate(data.date);
        setIndexRevision(value => value + 1);
        dispatch({ type: "setStamps", stamps: data.stamps, keepHead: changedSession });
        setIndexError(false);
      } else {
        setIndexError(true);
      }
      if (!sessionDate) timer = setTimeout(() => { void read(); }, 60_000);
    };
    void read();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [root, sessionDate]);

  const archived = sessionDate != null;
  const atHead = isAtHead(state);
  const followingHead = atHead && state.followHead !== false;
  const live = followingHead && !archived && !indexError;
  const frameRevision = followingHead && !archived ? indexRevision : 0;
  const asOfStamp = stampAt(state);

  // Play clock: one interval, retimed when speed or playing changes.
  useEffect(() => {
    if (!state.playing) return;
    const id = setInterval(() => dispatch({ type: "tick" }), tickIntervalMs(state.speed));
    return () => clearInterval(id);
  }, [state.playing, state.speed]);

  // Keyboard: only when the group is hovered/focused and not typing in a field.
  useEffect(() => {
    const tracker = trackerRef.current;
    function onKey(e: KeyboardEvent) {
      if (!tracker.engaged()) return;
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tgt?.isContentEditable) return;
      const action = keyToAction(e.key);
      if (!action) return;
      e.preventDefault();
      dispatch(action);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Broadcast the position to sibling tabs (Session Flow, GEX ladder, expiry drawer).
  useEffect(() => {
    publishWorkspaceReplay(busIdRef.current, { asOfStamp, atHead, live, archived, sessionDate });
  }, [asOfStamp, atHead, live, archived, sessionDate]);

  useEffect(() => {
    const id = busIdRef.current;
    return () => releaseWorkspaceReplay(id);
  }, []);

  // Detach on unmount so a torn-down group leaves no listeners behind.
  useEffect(() => {
    const tracker = trackerRef.current;
    return () => tracker.bind(null);
  }, []);

  const bindGroupRef = useCallback((el: HTMLElement | null) => {
    trackerRef.current.bind(el);
  }, []);

  const value = useMemo<ReplayCtx>(
    () => ({ state, dispatch, asOfStamp, atHead, live, sessionDate, archived, indexDate, indexError, frameRevision, sourceRevision: indexRevision, bindGroupRef }),
    [state, asOfStamp, atHead, live, sessionDate, archived, indexDate, indexError, frameRevision, indexRevision, bindGroupRef],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReplay(): ReplayCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useReplay must be used within a ReplayProvider");
  return ctx;
}
