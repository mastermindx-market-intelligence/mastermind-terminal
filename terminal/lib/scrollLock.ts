/**
 * One page scroll lock, shared by every surface that needs the page behind it to hold still.
 *
 * Why there is exactly one lock: the chart-hosted research pane (MegaPane) and the transcript
 * drawer it opens can be mounted at the same time, and the pane holds its lock only while it
 * presents as an overlay, which turns on and off when the viewport crosses 860px. When each kept
 * its own saved copy of `overflow`, a resize across 860px with the drawer open made the two
 * releases run out of order: the second release wrote back a value the first had already set to
 * "hidden", and the page stayed locked after both had closed (or unlocked while one was still
 * open). Here the first acquire saves the original values once, every holder only counts, and the
 * original values come back when the last holder releases, in whatever order they release.
 */

let holders = 0;
let saved: { body: string; root: string } | null = null;

/**
 * Lock page scrolling (inline `overflow: hidden` on <body> and <html>) until the returned release
 * is called. The release is idempotent: calling it again does nothing, so it cannot drop another
 * holder's lock. Without a document (server render) this is a no-op.
 */
export function acquireScrollLock(): () => void {
  if (typeof document === "undefined") return () => {};
  const body = document.body;
  const root = document.documentElement;
  if (holders === 0) {
    saved = { body: body.style.overflow, root: root.style.overflow };
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
  }
  holders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders > 0) return;
    holders = 0;
    if (saved) {
      body.style.overflow = saved.body;
      root.style.overflow = saved.root;
    }
    saved = null;
  };
}

/** Test-only: forget every holder without touching the document. */
export function __resetScrollLockForTests(): void {
  holders = 0;
  saved = null;
}
