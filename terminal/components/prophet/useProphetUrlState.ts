"use client";
/**
 * useProphetUrlState — the Prophet surface's address-carried state.
 *
 * The `prophet*` query family (lib/prophetUrlState.ts) is the single source of
 * truth for lane, sector view, group, symbol, plan, search, state filter, page
 * offset and the return carrier. Deep links, refresh and back/forward all
 * restore the same investigation; invalid values degrade to defaults, never to
 * an error page. Mirrors SectorIntelligenceWorkspace's window.history +
 * popstate pattern (no useSearchParams, so no Suspense boundary is needed).
 *
 * First render uses defaults so server and client markup match; the mount
 * effect adopts whatever the address carries. Every update is a history push —
 * callers only fire it on committed actions (lane pick, group pick, submit),
 * never per keystroke.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_PROPHET_STATE, parseProphetState, writeProphetState, type ProphetUrlState,
} from "@/lib/prophetUrlState";

export function useProphetUrlState(): {
  state: ProphetUrlState;
  update: (patch: Partial<ProphetUrlState>) => void;
} {
  const [state, setState] = useState<ProphetUrlState>(DEFAULT_PROPHET_STATE);
  const ref = useRef(state);

  const adopt = useCallback((next: ProphetUrlState) => {
    ref.current = next;
    setState(next);
  }, []);

  const sync = useCallback(() => {
    adopt(parseProphetState(new URLSearchParams(window.location.search)));
  }, [adopt]);

  useEffect(() => {
    // The address is the external system this hook subscribes to: the mount
    // read adopts what the URL carries (SSR rendered defaults), and popstate
    // re-reads it on back/forward. Synchronous by necessity — one adopt, once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [sync]);

  const update = useCallback((patch: Partial<ProphetUrlState>) => {
    const next = { ...ref.current, ...patch };
    adopt(next);
    const url = new URL(window.location.href);
    const href = writeProphetState(url, next);
    if (href !== url.pathname + url.search + url.hash) {
      window.history.pushState({}, "", href);
    }
  }, [adopt]);

  return { state, update };
}
