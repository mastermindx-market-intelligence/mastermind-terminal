"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * The native host's existing gesture policy, applied after React has adopted its
 * viewport metadata. Ordinary web pages retain the route's zoomable viewport.
 * No pre-hydration mutation: that can leave an orphan meta and a second React meta.
 */
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverNotHydrated = () => false;

/** URL hooks run only after the matching null server/hydration render. */
export default function NativeViewportPolicy() {
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverNotHydrated);
  return hydrated ? <ApplyNativeViewportPolicy /> : null;
}

function ApplyNativeViewportPolicy() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  useEffect(() => {
    const mm = (window as Window & {
      webkit?: { messageHandlers?: { mm?: { postMessage?: unknown } } };
    }).webkit?.messageHandlers?.mm;
    if (new URLSearchParams(query).get("shell") !== "app" && typeof mm?.postMessage !== "function") return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.content;
    const parts = original.split(",").filter(value => !/^\s*(maximum-scale|user-scalable)\s*=/i.test(value));
    const applied = [...parts, "maximum-scale=1", "user-scalable=no"].join(", ");
    meta.content = applied;
    return () => {
      // A route may have installed different metadata before this cleanup.
      if (meta.content === applied) meta.content = original;
    };
  }, [pathname, query]);
  return null;
}
