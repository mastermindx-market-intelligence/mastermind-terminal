import { useState } from "react";

/** True when both lists hold the very same element objects, in the same order. */
export function sameElements<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Hands back the array from an earlier render for as long as `next` holds the very same element
 * objects in the same order, and `next` itself as soon as an element is added, removed, replaced
 * or moved.
 *
 * A parent that spreads a fresh array on every render (TerminalShell does, for each symbol's
 * drawings) otherwise gives its child a new identity on every unrelated state change. ChartPanel
 * tears down and redraws every drawing node when that identity changes, so a save starting or
 * finishing used to swap out the very object a user was hovering, measuring or about to grab.
 * Committed drawings are replaced, never edited in place, so element identity is a complete
 * change signal.
 *
 * The comparison runs during render through React's "adjust state while rendering" pattern
 * (one extra pass only when the content really changed), so no ref is read during render.
 */
export function useElementStableList<T>(next: T[]): T[] {
  const [held, setHeld] = useState(next);
  if (held !== next && !sameElements(held, next)) {
    setHeld(next);
    return next;
  }
  return held;
}
