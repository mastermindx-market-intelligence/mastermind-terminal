"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { deviceFingerprint } from "@/lib/fingerprint";
import { track, flush, newSession, setFingerprint } from "@/lib/analytics";

// First-party analytics client for the Terminal. Mounted once in the root layout, so it runs on
// every route. Captures: pageview, in-app route changes (order + dwell), scroll depth, delegated
// clicks, the macro→terminal arrival, and ticker views (via the "mm:track" window event that
// TerminalShell dispatches when the active chart symbol changes — symbol is client state, not a
// route, so a route tracker never sees it). Everything is fail-silent.
//
// NOTE: uses usePathname only (not useSearchParams) so a layout-level client component doesn't
// force a Suspense boundary on statically-rendered routes; the query string is read from
// location.search at effect time instead.
export default function Tracker() {
  const pathname = usePathname();
  const enter = useRef<number>(Date.now());
  const prevPath = useRef<string>("");
  const maxScroll = useRef<number>(0);
  const started = useRef<boolean>(false);
  const fingerprinted = useRef(false);

  // Embedded chart widgets (/embed/*) are iframed onto external dossier pages — they are companion
  // widgets, not tracked Terminal pages. Skip ALL analytics there so iframe loads never emit
  // pageviews/fingerprints. (Guard both effects; hooks still run unconditionally above.)
  const isEmbed = pathname.startsWith("/embed");

  // Global listeners belong only to non-embed routes; the root survives client navigation.
  useEffect(() => {
    if (isEmbed) return;
    let active = true;
    const compute = () => {
      if (!active || fingerprinted.current) return;
      try { setFingerprint(deviceFingerprint()); fingerprinted.current = true; } catch {}
    };
    const idle = window as unknown as {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleJob: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (!fingerprinted.current) {
      if (idle.requestIdleCallback) idleJob = idle.requestIdleCallback(compute, { timeout: 2000 });
      else timer = setTimeout(compute, 300);
    }

    const onScroll = () => {
      try {
        const doc = document.documentElement;
        const denom = (doc.scrollHeight - doc.clientHeight) || 1;
        const pct = Math.round((doc.scrollTop / denom) * 100);
        if (pct > maxScroll.current) maxScroll.current = Math.max(0, Math.min(100, pct));
      } catch {}
    };
    const onClick = (e: MouseEvent) => {
      try {
        const el = (e.target as Element)?.closest?.("a,button,[data-track]") as HTMLElement | null;
        if (!el) return;
        const a = el.closest("a") as HTMLAnchorElement | null;
        track({
          type: "click",
          meta: {
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || "").trim().slice(0, 80) || undefined,
            href: a?.getAttribute("href") || undefined,
            id: el.id || undefined,
          },
        });
      } catch {}
    };
    const onHide = () => {
      try { track({ type: "exit", dwell_ms: Date.now() - enter.current, scroll: maxScroll.current || undefined }); } catch {}
      flush();
    };
    const onVis = () => { if (document.visibilityState === "hidden") onHide(); };
    const onBus = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.type) track(d); };

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("mm:track", onBus as EventListener);

    return () => {
      active = false;
      if (idleJob !== null) idle.cancelIdleCallback?.(idleJob);
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("mm:track", onBus as EventListener);
    };
  }, [isEmbed]);

  // Pageview + route changes (navigation order + dwell). Fires on first mount and each pathname change.
  useEffect(() => {
    if (isEmbed) return;
    const path = pathname + (typeof location !== "undefined" ? location.search : "");
    if (!started.current) {
      started.current = true;
      try { if (newSession()) track({ type: "session_start" }); } catch {}
      try {
        const fromMacro = new URLSearchParams(location.search).get("from") === "macro"
          || /(^|\.)mastermind-x\.com/.test(document.referrer);
        track({ type: "pageview", ref: document.referrer || undefined, meta: fromMacro ? { from: "macro" } : undefined });
        if (fromMacro) track({ type: "terminal_jump", meta: { from: "macro" } });
      } catch { track({ type: "pageview" }); }
    } else {
      track({ type: "route", path, ref: prevPath.current || undefined, dwell_ms: Date.now() - enter.current, scroll: maxScroll.current || undefined });
    }
    prevPath.current = path;
    enter.current = Date.now();
    maxScroll.current = 0;
  }, [pathname]);

  return null;
}
