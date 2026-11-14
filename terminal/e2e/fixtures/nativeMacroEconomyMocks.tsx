// Test-only adapters for the existing native Economy component specimen.
// URL/history, account and language seams are replaced; readers and decoders are real.
import React, { useSyncExternalStore, type AnchorHTMLAttributes } from "react";

const NAVIGATION = "native-economy-fixture-navigation";
const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATION, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(NAVIGATION, listener); };
};
const snapshot = () => window.location.href;
function useLocation() { return useSyncExternalStore(subscribe, snapshot, () => "http://fixture.invalid/"); }
export function usePathname() { return new URL(useLocation()).pathname; }
export function useSearchParams() { return new URL(useLocation()).searchParams; }
function navigate(href: string, replace: boolean) {
  const target = new URL(href, window.location.href);
  if (target.origin !== window.location.origin) throw Error("Fixture router accepts only same-origin application URLs");
  if (replace) window.history.replaceState({}, "", target);
  else window.history.pushState({}, "", target);
  window.dispatchEvent(new Event(NAVIGATION));
}
const router = { push: (href: string) => navigate(href, false), replace: (href: string) => navigate(href, true) };
export function useRouter() { return router; }
export default function Link({ href, children, prefetch: _prefetch, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) {
  return <a {...props} href={href} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target === "_blank") return;
    if (new URL(href, location.href).origin !== location.origin) return;
    event.preventDefault(); navigate(href, false);
  }}>{children}</a>;
}
const language = { lang: document.documentElement.lang === "zh" ? "zh" as const : "en" as const };
const translate = (key: string, fallback?: string) => fallback ?? key;
export function useLang() { return language; }
export function useT() { return translate; }
const client = { auth: {
  getUser: async () => ({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
} };
export function createClient() { return client; }

