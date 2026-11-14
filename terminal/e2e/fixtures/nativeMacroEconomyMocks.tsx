// Test-only identity and Next navigation boundaries for the real components.
// No server route, production admission or authenticated deployment is asserted.
import React, { useMemo, useSyncExternalStore } from "react";

export const SUBJECT = "11111111-1111-4111-8111-111111111111";
const LOCATION_EVENT = "native-economy-fixture:location";
const subscribe = (listener: () => void) => {
  window.addEventListener(LOCATION_EVENT, listener);
  window.addEventListener("popstate", listener);
  window.addEventListener("hashchange", listener);
  return () => {
    window.removeEventListener(LOCATION_EVENT, listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener("hashchange", listener);
  };
};
const snapshot = () => window.location.href;
const serverSnapshot = () => "http://fixture.invalid/";
function useLocation() { return useSyncExternalStore(subscribe, snapshot, serverSnapshot); }
export function usePathname() { return new URL(useLocation()).pathname; }
export function useSearchParams() {
  const href = useLocation();
  return useMemo(() => new URL(href).searchParams, [href]);
}
function navigate(href: string, replace = false, options?: { scroll?: boolean }) {
  window.history[replace ? "replaceState" : "pushState"]({}, "", href);
  window.dispatchEvent(new Event(LOCATION_EVENT));
  window.dispatchEvent(new Event("mmx:shell-location"));
  if (options?.scroll !== false) document.querySelector("main")?.scrollTo({ top: 0 });
}
const router = {
  push: (href: string, options?: { scroll?: boolean }) => navigate(href, false, options),
  replace: (href: string, options?: { scroll?: boolean }) => navigate(href, true, options),
  back: () => window.history.back(),
};
export function useRouter() { return router; }
export function useLang(): { lang: "en" | "zh" } { return { lang: document.documentElement.dataset.lang === "zh" ? "zh" : "en" }; }
const fallbackText = (key: string, fallback?: string) => fallback ?? key;
export function useT() { return fallbackText; }

export default function Link({ children, href, prefetch: _prefetch, onNavigate, onClick, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean; onNavigate?: () => void }) {
  return <a {...props} href={href} onClick={event => {
    onClick?.(event);
    if (!href || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = new URL(href, location.href);
    if (target.origin !== location.origin || !/^\/macro_[a-z_]+\.html$/.test(target.pathname)) return;
    event.preventDefault(); onNavigate?.(); navigate(target.pathname + target.search + target.hash);
  }}>{children}</a>;
}

type Session = { user: { id: string } } | null;
let user: Session = { user: { id: SUBJECT } };
const subscribers = new Set<(event: string, session: Session) => void>();
window.addEventListener("native-economy-fixture:signout", () => {
  user = null;
  for (const callback of subscribers) callback("SIGNED_OUT", null);
});
const auth = {
  getUser: async () => ({ data: { user: user?.user ?? null }, error: null }),
  onAuthStateChange: (callback: (event: string, session: Session) => void) => {
    subscribers.add(callback);
    return { data: { subscription: { unsubscribe: () => subscribers.delete(callback) } } };
  },
};
export const createClient = () => ({ auth });
