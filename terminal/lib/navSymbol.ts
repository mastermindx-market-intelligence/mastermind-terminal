/**
 * navSymbol.ts — which primary-nav destinations carry the active company, and how.
 *
 * A leaf module (zero imports) so the policy is unit-testable without mounting the nav, and so
 * both nav surfaces — the desktop rail (components/AppNav) and the mobile drawer
 * (components/MobileNav) — decorate their links through the SAME rule. They already share `TOP`
 * for exactly this reason; a second copy of the URL policy is how they would drift.
 */

/** The workspaces that resolve a company from `?symbol=`. Everything else ignores the param. */
export const SYMBOL_AWARE_NAV_KEYS: ReadonlySet<string> = new Set(["chart", "analysis"]);

/**
 * A primary-nav href, carrying the cross-route symbol cursor (lib/activeSymbol).
 *
 * Nothing used to travel with a nav click, so leaving the chart for Analysis dropped the company
 * on the floor and the workspace opened on its own literal default — a user charting SMR got a
 * full NVDA intelligence read. Naming the symbol in the URL, rather than letting the destination
 * read the cursor after it has already mounted, is what keeps the SERVER render right:
 * `/terminal` preloads that symbol's chart-blocking JSON at the route boundary, and `/analysis`
 * server-renders its context bar with the right ticker instead of correcting it after hydration.
 *
 * Two deliberate restrictions:
 *   • Only symbol-aware destinations are decorated. A param the destination ignores is a URL
 *     that lies about what it will show, and it would be copied and shared as one.
 *   • The workspace you are ALREADY ON is never decorated, and the test is the PATHNAME rather
 *     than the highlighted nav key (the chart shell reports `analyst` while its fundamentals pane
 *     is open, and would otherwise decorate its own Chart link). That URL already carries the
 *     symbol, and rewriting the address you are on turns a no-op nav click into a real
 *     navigation — on `/terminal`, a full chart remount fired by the button whose only job is to
 *     close the open pane.
 */
export function navHref(
  item: { k: string; href: string },
  activeSymbol: string | null | undefined,
  pathname: string,
): string {
  if (!activeSymbol) return item.href;
  if (!SYMBOL_AWARE_NAV_KEYS.has(item.k)) return item.href;
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return item.href;
  return `${item.href}?symbol=${encodeURIComponent(activeSymbol)}`;
}
