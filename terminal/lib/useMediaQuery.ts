"use client";
import { useCallback, useSyncExternalStore } from "react";

// SSR-safe media query hook (server snapshot = false to avoid hydration mismatch).
export function useMediaQuery(query: string): boolean {
  // useSyncExternalStore is React 18+; this app targets React 19. Stable callbacks keyed on
  // `query` so React doesn't resubscribe a fresh MediaQueryList every render.
  const subscribe = useCallback((cb: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener("change", cb);
    return () => mql.removeEventListener("change", cb);
  }, [query]);
  const getSnapshot = useCallback(() => (typeof window === "undefined" ? false : window.matchMedia?.(query).matches ?? false), [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 860px)");
}

/**
 * PHONE breakpoint — deliberately narrower than the ≤860px responsive-shell breakpoint above.
 * The 820×1180 tablet contract viewport is inside `useIsMobile` but must stay pixel-identical to
 * the desktop-era chrome, so every phone-only surface (roller strip, Drawings sheet, Analysis hub)
 * keys off this one instead. Mirrored in app/globals.css — change both together.
 */
export const PHONE_QUERY = "(max-width: 640px)";

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
