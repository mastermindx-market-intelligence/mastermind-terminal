import { useEffect, useState } from "react";
import { ANALYSIS_DEFAULT_SYMBOL, normalizeAnalysisSymbol } from "./analysisSymbol";

/**
 * The Analysis workspace's own fallback symbol when nothing else resolves. Re-exported from
 * `lib/analysisSymbol.ts`'s `ANALYSIS_DEFAULT_SYMBOL` — the same constant
 * `components/workspaces/AnalysisWorkspace.tsx` seeds its `DEFAULT_SYMBOL` from — rather than
 * a second `"NVDA"` literal, so the two can never silently drift apart (review ruling, PR #490
 * MINOR: default symbol).
 */
export const SHELL_DEFAULT_BRAIN_SYMBOL = ANALYSIS_DEFAULT_SYMBOL;

interface ShellWorkspaceStore {
  panes?: unknown;
  activePane?: unknown;
}

/**
 * The minimal host shape this resolver needs — deliberately narrower than `Window` (just
 * `location.href` and a `getItem`-capable store) so tests can pass a plain in-memory stub
 * instead of depending on a real `window.localStorage` (unavailable under this repo's vitest
 * jsdom environment — see lib/__tests__/shellBrainSymbol.test.ts). The real `window` object
 * satisfies this structurally with no cast needed.
 */
export interface ShellBrainSymbolHost {
  location: { href: string };
  localStorage: { getItem(key: string): string | null };
}

/**
 * Resolve the symbol AppShell hands the Brain widget on `/analysis` mount, so it is
 * NEVER mounted with an empty active symbol (review ruling, PR #490 MAJOR 2):
 * `handoffMastermindBrainSymbol("")` returns `false` WITHOUT writing the document-level
 * `__MM_BRAIN_ACTIVE_SYMBOL__`, so a cold `/analysis?symbol=NVDA` load opened through the
 * external floating launcher (which never calls the in-app "attach exact source" affordance
 * that would otherwise hand off a real symbol) left `cfg.symbol()` returning `""` forever.
 *
 * Precedence: the route's own `?symbol=` query param → the chart workspace's last active
 * pane (localStorage `"mm.ws"`, written by `components/TerminalShell.tsx`) → the shell
 * default. Every candidate is run through the same identifier grammar
 * (`lib/analysisSymbol.ts`) AnalysisWorkspace itself uses, so this can never resolve to a
 * value AnalysisWorkspace's own seeding would have rejected.
 */
export function resolveShellBrainSymbol(
  win: ShellBrainSymbolHost | undefined = typeof window === "undefined" ? undefined : window,
): string {
  if (!win) return SHELL_DEFAULT_BRAIN_SYMBOL;

  try {
    const url = new URL(win.location.href);
    const fromRoute = normalizeAnalysisSymbol(url.searchParams.get("symbol") ?? undefined);
    if (fromRoute) return fromRoute;
  } catch {
    // malformed location — fall through to the store/default candidates
  }

  try {
    const raw = win.localStorage.getItem("mm.ws");
    const ws = raw ? (JSON.parse(raw) as ShellWorkspaceStore) : null;
    const panes = Array.isArray(ws?.panes) ? (ws!.panes as unknown[]) : null;
    if (panes && panes.length) {
      const idx = Number.isInteger(ws!.activePane) && (ws!.activePane as number) >= 0 && (ws!.activePane as number) < panes.length
        ? (ws!.activePane as number)
        : 0;
      const candidate = panes[idx];
      const fromStore = normalizeAnalysisSymbol(typeof candidate === "string" ? candidate : undefined);
      if (fromStore) return fromStore;
    }
  } catch {
    // corrupt/unavailable localStorage — fall through to the default
  }

  return SHELL_DEFAULT_BRAIN_SYMBOL;
}

/** The custom DOM event `announceShellBrainSymbol` dispatches and `subscribeShellBrainSymbol` listens for. */
export const SHELL_BRAIN_SYMBOL_EVENT = "mm:shell-brain-symbol";

/** The minimal event-target shape `announceShellBrainSymbol` needs — real `window` satisfies it. */
export interface ShellBrainSymbolBroadcastHost {
  dispatchEvent(event: Event): boolean;
}

/**
 * Tell the shell's resolved Brain symbol changed (review round-4, MAJOR 1). `AnalysisWorkspace`
 * calls this every time its own `sym` state changes — the SAME moment it rewrites `?symbol=`
 * via `window.history.replaceState` (`writeParam`). `replaceState` fires no Next.js navigation
 * and no native DOM event, so `usePathname()` alone can never see a same-route symbol switch;
 * this is the one channel that tells `AppShell` (via `useShellBrainSymbol` below) to re-resolve
 * and re-hand-off to the mounted `BrainWidget`. A value that fails the analysis-symbol grammar
 * is dropped silently — the same rule every other candidate in `resolveShellBrainSymbol` obeys.
 */
export function announceShellBrainSymbol(
  symbol: string,
  host: ShellBrainSymbolBroadcastHost | undefined = typeof window === "undefined" ? undefined : window,
): void {
  const normalized = normalizeAnalysisSymbol(symbol);
  if (!normalized || !host) return;
  host.dispatchEvent(new CustomEvent<string>(SHELL_BRAIN_SYMBOL_EVENT, { detail: normalized }));
}

/** The minimal event-target shape `subscribeShellBrainSymbol` needs — real `window` satisfies it. */
export interface ShellBrainSymbolListenHost {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

/**
 * Subscribe to `announceShellBrainSymbol` broadcasts. Returns an unsubscribe function so a
 * caller can wire this straight into a `useEffect` cleanup.
 */
export function subscribeShellBrainSymbol(
  onChange: (symbol: string) => void,
  host: ShellBrainSymbolListenHost | undefined = typeof window === "undefined" ? undefined : window,
): () => void {
  if (!host) return () => undefined;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail;
    if (typeof detail === "string" && detail) onChange(detail);
  };
  host.addEventListener(SHELL_BRAIN_SYMBOL_EVENT, listener);
  return () => host.removeEventListener(SHELL_BRAIN_SYMBOL_EVENT, listener);
}

/**
 * `AppShell`'s own hook for the live Brain symbol on `/analysis` (review round-4, MAJOR 1's
 * fix): resolved once whenever `active` turns true (a fresh `/analysis` entry, mirroring the
 * old `useMemo(..., [path])` this replaces), and kept current afterward via
 * `subscribeShellBrainSymbol` — the only way `AppShell` learns about a same-route symbol
 * switch, because `AnalysisWorkspace` changes the URL with `history.replaceState`, which the
 * component tree never observes on its own. `active=false` (every non-`/analysis` route)
 * always returns `""` and holds no subscription — `AppShell` does not even mount `BrainWidget`
 * there, matching the router-real gate in `components/chrome/AppShell.tsx`.
 */
export function useShellBrainSymbol(active: boolean): string {
  const [symbol, setSymbol] = useState<string>(() => (active ? resolveShellBrainSymbol() : ""));
  useEffect(() => {
    if (!active) {
      setSymbol("");
      return;
    }
    setSymbol(resolveShellBrainSymbol());
    return subscribeShellBrainSymbol(setSymbol);
  }, [active]);
  return symbol;
}
