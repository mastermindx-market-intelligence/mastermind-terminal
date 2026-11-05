/**
 * Bounded delayed opener for the existing Analysis Brain document singleton.
 *
 * The native /analysis?view=theses AI entry currently redirects to
 * /terminal?ai=1 and loses typed thesis context. This helper owns only the
 * timing of opening the already-mounted singleton: the caller supplies the
 * accessor for the existing open function plus the timer lifecycle, so this
 * module stays browser-independent. It never touches window, document,
 * storage, network, navigation or auth, and creates no widget or provider.
 *
 * When the singleton is not mounted yet, open() schedules exactly one retry
 * after 800ms, matching the existing native TerminalShell practice of waiting
 * once for a late-mounted singleton instead of navigating away. The retry
 * re-reads the accessor and never schedules a further retry.
 */

const RETRY_DELAY_MS = 800;

export function createAnalysisBrainOpener(
  getOpen: () => (() => void) | undefined,
  schedule: (fn: () => void, ms: number) => unknown,
  cancel: (handle: unknown) => void,
): { open: () => void; dispose: () => void } {
  // All mutable state is per-instance closure state; there is no module-level
  // mutable state, so independent openers never interfere.
  let disposed = false;
  let generation = 0;
  let pendingGeneration = 0;
  let pendingHandle: unknown = undefined;

  const runRetry = (scheduledGeneration: number): void => {
    // A scheduler can still deliver a callback it can no longer cancel (it
    // was already dequeued). Such a stale callback belongs to a request that
    // was superseded by a newer open() or followed by dispose(), so it must
    // stay inert instead of opening the singleton late.
    if (disposed || scheduledGeneration !== pendingGeneration) {
      return;
    }
    pendingGeneration = 0;
    pendingHandle = undefined;
    const openFn = getOpen();
    if (typeof openFn === 'function') {
      openFn();
    }
  };

  const cancelPending = (): void => {
    if (pendingGeneration === 0) {
      return;
    }
    // Invalidate the generation before cancelling so an unstoppable
    // already-delivered callback is recognised as stale.
    pendingGeneration = 0;
    const handle = pendingHandle;
    pendingHandle = undefined;
    cancel(handle);
  };

  const open = (): void => {
    if (disposed) {
      return;
    }
    // Cancel any earlier pending retry before opening immediately or before
    // scheduling the single replacement retry.
    cancelPending();
    const openFn = getOpen();
    if (typeof openFn === 'function') {
      openFn();
      return;
    }
    generation += 1;
    const scheduledGeneration = generation;
    pendingGeneration = scheduledGeneration;
    pendingHandle = schedule(() => runRetry(scheduledGeneration), RETRY_DELAY_MS);
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    cancelPending();
  };

  return { open, dispose };
}
