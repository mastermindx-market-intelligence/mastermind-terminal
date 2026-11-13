'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Closed set of hub-discovery states reported to TerminalShell.
 *
 * `hydration-pending` is the only initial state: storage is never read during
 * render, so SSR markup and the first client render agree and the "More" badge
 * cannot flash before the stored value is known.
 */
export type HubDiscoveryState =
  | 'hydration-pending'
  | 'seen'
  | 'unseen'
  | 'storage-error';

const HUB_SEEN_KEY = 'mm.hubSeen';
const HUB_SEEN_VALUE = '1';

export function useHubDiscovery(): {
  state: HubDiscoveryState;
  markSeen: () => void;
} {
  const [state, setState] = useState<HubDiscoveryState>('hydration-pending');

  // Set by the real user hub-open action. A hydration read that lands later
  // (deferred passive effect) must never overwrite that opening.
  const openedRef = useRef(false);

  // Post-mount classification intentionally updates the SSR-consistent pending
  // state from external storage. Reading it during render would break that contract.
  /* eslint-disable react-hooks/set-state-in-effect -- bounded external-storage hydration, covered by delayed-effect/commit fixtures */
  useEffect(() => {
    if (openedRef.current) {
      return;
    }
    let stored: string | null;
    try {
      stored = window.localStorage.getItem(HUB_SEEN_KEY);
    } catch {
      // Missing or throwing storage is never successful readiness.
      setState('storage-error');
      return;
    }
    setState(stored === HUB_SEEN_VALUE ? 'seen' : 'unseen');
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const markSeen = useCallback(() => {
    openedRef.current = true;
    setState('seen');
    try {
      window.localStorage.setItem(HUB_SEEN_KEY, HUB_SEEN_VALUE);
    } catch {
      // Best effort only. The opening is real and stays `seen` in memory;
      // failed persistence is never pretended to have succeeded.
    }
  }, []);

  return { state, markSeen };
}
