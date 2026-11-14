"use client";
/**
 * useProphetUrlState — the Prophet surface's address-carried state.
 *
 * The URL is the single source of truth for lane/tab, sector view, group,
 * symbol, compare selection, plan, search, state filter, page offset and the
 * return carrier (lib/prophetUrlState.ts). Deep links, refresh and
 * back/forward all restore the same investigation; invalid values degrade to
 * defaults, never to an error page. Mirrors SectorIntelligenceWorkspace's
 * window.history + popstate pattern (no useSearchParams, so no Suspense
 * boundary is needed).
 *
 * WHICH key family carries the state depends on the mount: canonical `/prophet`
 * writes the Lane A contract (`tab`/`sector`/`symbol`/repeatable `sel`), while
 * the legacy `/options?tab=prophet` mount keeps the `prophet*` family so the
 * hub's own `tab` is never clobbered. The mount is inferred from the live
 * address on every read and write — this surface rides one route for its whole
 * life, so the inference cannot flip underneath it.
 *
 * First render uses defaults so server and client markup match; the mount
 * effect adopts whatever the address carries. Every update is a history push —
 * callers only fire it on committed actions (lane pick, group pick, submit),
 * never per keystroke.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_PROPHET_STATE, parseProphetState, prophetMountForPathname, writeProphetState,
  type ProphetUrlState, type ProphetMount,
} from "@/lib/prophetUrlState";

export function useProphetUrlState(): {
  state: ProphetUrlState;
  update: (patch: Partial<ProphetUrlState>) => void;
  mount: ProphetMount | null;
} {
  const [state, setState] = useState<ProphetUrlState>(DEFAULT_PROPHET_STATE);
  const [mount, setMount] = useState<ProphetMount | null>(null);
  const ref = useRef(state);

  const adopt = useCallback((next: ProphetUrlState) => {
    ref.current = next;
    setState(next);
  }, []);

  const sync = useCallback(() => {
    const mount = prophetMountForPathname(window.location.pathname);
    setMount(mount);
    adopt(parseProphetState(new URLSearchParams(window.location.search), mount));
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
    // writeProphetState mutates `url` — capture the pre-write address first,
    // or the no-op comparison always compares equal and nothing is pushed.
    const before = url.pathname + url.search + url.hash;
    const href = writeProphetState(url, next, prophetMountForPathname(url.pathname));
    if (href !== before) {
      window.history.pushState({}, "", href);
    }
  }, [adopt]);

  return { state, update, mount };
}
