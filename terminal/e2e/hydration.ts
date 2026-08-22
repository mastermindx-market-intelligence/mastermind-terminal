/**
 * "The page is interactive", as a precondition for the suite's first interaction after a navigation.
 *
 * Not a spec file: Playwright's default testMatch only collects *.spec.ts, so this module is
 * imported, never run.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 *
 * Playwright's actionability checks — visible, stable, enabled, receives pointer events — are all
 * answered by the DOM. None of them means React has attached a handler. A server-rendered page
 * paints its full markup long before hydration reaches it, so `await expect(x).toBeVisible()`
 * followed by `await x.click()` is a race, and the click lands on a node with no listener behind
 * it. Nothing throws. The event is simply DROPPED.
 *
 * Measured on 2026-08-21 against /scripts at an 8x CPU throttle: the script rows and the editor
 * textarea were in the DOM at +333ms, and React attached the rows' onClick at +1929ms — a 1.6
 * second window in which every assertion the suite waits on already passes and every click is
 * discarded. Reproduced 6/6 by running pine-editor-integrity's D3a test verbatim under throttle:
 * the row click vanished, the editor stayed on the locked flagship, and the test failed at the
 * NEXT step ("unsaved changes" can never appear for a locked script) — which is why the reported
 * failure never pointed at the click that was actually lost. With this gate: 0/6.
 *
 * This is the shape of the CI flake this was written for: the victim is whichever spec's first
 * interaction lands inside its page's hydration window, which is why the failing set rotated
 * between attempts on the same commit and why retries failed too. It is NOT a timeout problem — a
 * dropped event never arrives, so no budget is large enough. That also makes waiting here the
 * opposite of weakening the gate: a click on a page that is not yet wired tests nothing.
 *
 * ── THE PREDICATE, AND WHY THE SNAPSHOT IS TAKEN WHEN IT IS ──────────────────────────────────
 *
 * React tags every host node it hydrates with `__reactFiber$<rand>`, so this asks the framework
 * directly rather than guessing with a sleep.
 *
 * The set it watches is the interactive markup THE SERVER SENT, captured at DOMContentLoaded. Both
 * halves of that are load-bearing, and both were learned by getting them wrong:
 *
 *   - Watching whatever is on the page "now" never settles. On /terminal the unhydrated count fell
 *     to 6 and then rose to 27 as later, client-built DOM appeared.
 *   - Capturing at `load` instead of DOMContentLoaded mixes in DOM that React never rendered and
 *     will never tag — ChartPanel builds its "Back to Daily" empty-state with `innerHTML`
 *     (components/ChartPanel.tsx), so `button.ce-btn` can never carry a fiber. Waiting for it
 *     stalled two specs for the full timeout. At DOMContentLoaded that node does not exist yet:
 *     it is created from an effect, which cannot run before hydration.
 *
 * Everything in the server's HTML is React's, so this set always converges. Measured across every
 * route the suite visits, at an 8x throttle: /portfolio +819ms, /scripts +1558ms, /discover
 * +2035ms, /alerts +2074ms, /options +3850ms, /terminal +8496ms — and `dropped: 0`, no
 * server-rendered node was ever discarded by a hydration mismatch.
 */

/**
 * Installed via addInitScript, so it runs before any page script on every new document. Captures
 * the server's interactive markup the moment the parser is done with it — before React has
 * hydrated it and before any effect has added DOM of its own.
 */
export const CAPTURE_SSR_NODES = `(() => {
  // Every element in the server's HTML is React-rendered, so any of these will be tagged; the list
  // stays narrow only to keep the poll below cheap. [draggable] is in it because a drag that starts
  // before its handler attaches is the same dropped-event bug, and the watchlist reorder specs live
  // on exactly that.
  const INTERACTIVE = 'button, a[href], input, textarea, select, summary, [draggable="true"], [role="button"], [role="tab"], [role="option"], [role="switch"], [role="menuitem"], [role="combobox"]';
  const take = () => { window.__mmSsrNodes = [...document.querySelectorAll(INTERACTIVE)]; };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', take, { once: true });
  else take();
})()`;

/** True once every captured node still in the document carries a React fiber. */
export const SSR_NODES_HYDRATED = `(() => {
  // No capture means no HTML document to gate on (a redirect stub, a non-HTML response). The next
  // navigation installs its own, so report done rather than stalling on nothing.
  if (!window.__mmSsrNodes) return true;
  return window.__mmSsrNodes.every((el) => !el.isConnected
    || Object.keys(el).some((k) => k.startsWith('__reactFiber$')));
})()`;

/** Whatever is still unwired, for a failure message that names the surface instead of timing out. */
export const UNHYDRATED_REPORT = `(() => {
  const all = window.__mmSsrNodes || [];
  const un = all.filter((el) => el.isConnected && !Object.keys(el).some((k) => k.startsWith('__reactFiber$')));
  return {
    captured: all.length,
    stragglers: un.slice(0, 8).map((el) => el.tagName.toLowerCase()
      + (el.className ? '.' + String(el.className).trim().split(/\\s+/).slice(0, 2).join('.') : '')),
  };
})()`;

/** Generous: /terminal needed 8.5s at an 8x throttle, and CI is slower than a warm laptop. This is
 *  a backstop for "this page never becomes interactive", not a budget the common case spends. */
export const HYDRATION_TIMEOUT_MS = 45_000;
