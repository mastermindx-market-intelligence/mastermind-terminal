"use client";
import { useEffect, useState } from "react";

// The Macro Dashboard (the research/marketing site that deep-links into the Terminal). The Terminal itself
// lives on app.mastermind-x.com, so we deliberately match only the apex/www (and the old GitHub-Pages host)
// — never the app subdomain, which would be the Terminal navigating within itself.
const MACRO_HOSTS = new Set(["mastermind-x.com", "www.mastermind-x.com"]);
const MACRO_ORIGIN = "https://mastermind-x.com";
const KEY = "mm.fromMacro";   // sessionStorage: "1" once detected (survives in-app SPA navigation)
const HREF = "mm.macroHref";  // sessionStorage: best-known dashboard URL to return to
const EMBED_KEY = "mm.embeddedDashboard"; // "1" while this tab is hosted by the dashboard iframe
const EMBED_ORIGIN_KEY = "mm.embeddedDashboardOrigin"; // exact validated parent origin for postMessage

function isMacroHost(host: string) {
  return MACRO_HOSTS.has(host) || host.endsWith(".github.io");
}

export function isAllowedMacroOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol === "https:" && MACRO_HOSTS.has(u.hostname)) return true;
    if (process.env.NODE_ENV !== "production"
        && u.protocol === "http:"
        && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
  } catch {}
  return false;
}

/** First valid candidate wins. Keep the exact apex/www origin instead of canonicalizing it. */
export function pickAllowedMacroOrigin(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const origin = new URL(candidate).origin;
      if (isAllowedMacroOrigin(origin)) return origin;
    } catch {}
  }
  return "";
}

/**
 * Persist the origin from a message that already passed the allowlist. This matters after
 * an in-frame navigation: document.referrer then points at app.mastermind-x.com, while the
 * parent can legitimately be either the apex or www dashboard. Reusing a stale return URL
 * as targetOrigin produced Chrome's "target origin does not match recipient" warning and
 * dropped lifecycle messages.
 */
export function rememberEmbeddedMacroOrigin(origin: string): boolean {
  if (!isAllowedMacroOrigin(origin) || typeof window === "undefined") return false;
  try {
    sessionStorage.setItem(EMBED_ORIGIN_KEY, new URL(origin).origin);
    return true;
  } catch {
    return false;
  }
}

/** Parse Next's deployment id from a preload Link header containing ?dpl=<id>. */
export function deploymentIdFromLinkHeader(link: string | null | undefined): string {
  if (!link) return "";
  const match = link.match(/[?&]dpl=([^>;,&\s]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function embeddedDeploymentChanged(
  documentDeploymentId: string | null | undefined,
  linkHeader: string | null | undefined,
): boolean {
  const current = (documentDeploymentId || "").trim();
  const latest = deploymentIdFromLinkHeader(linkHeader);
  return !!current && !!latest && current !== latest;
}

/**
 * Detect and remember the first-party embedded lifecycle. The referrer check is
 * intentionally mandatory: `?embed=dashboard` by itself must not turn an arbitrary
 * same-origin frame into a privileged dashboard bridge.
 */
export function ensureEmbeddedTerminalSession(): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  try {
    if (sessionStorage.getItem(EMBED_KEY) === "1") {
      // A fresh iframe may inherit this same-origin session after the dashboard
      // canonicalizes apex↔www. Refresh the exact parent from the new document
      // referrer when it is trustworthy instead of replying to yesterday's host.
      try {
        const referrerOrigin = document.referrer ? new URL(document.referrer).origin : "";
        if (
          referrerOrigin &&
          referrerOrigin !== window.location.origin &&
          isAllowedMacroOrigin(referrerOrigin)
        ) {
          rememberEmbeddedMacroOrigin(referrerOrigin);
        }
      } catch {}
      return true;
    }
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("embed") === "dashboard" || params.get("embed") === "1";
    let trustedParent = false;
    let parentOrigin = "";
    try {
      parentOrigin = document.referrer ? new URL(document.referrer).origin : "";
      trustedParent = !!parentOrigin && isAllowedMacroOrigin(parentOrigin);
    } catch {}
    if (requested && trustedParent) {
      sessionStorage.setItem(EMBED_KEY, "1");
      rememberEmbeddedMacroOrigin(parentOrigin);
    }
    return trustedParent && sessionStorage.getItem(EMBED_KEY) === "1";
  } catch {
    return false;
  }
}

export function postToMacroDashboard(type: string, payload: Record<string, unknown> = {}): boolean {
  if (!ensureEmbeddedTerminalSession()) return false;
  const origin = pickAllowedMacroOrigin(
    sessionStorage.getItem(EMBED_ORIGIN_KEY),
    document.referrer,
    sessionStorage.getItem(HREF),
  );
  if (!origin) return false;
  window.parent.postMessage({ source: "mastermind-terminal", type, ...payload }, origin);
  return true;
}

/**
 * Resolve a caller-supplied "where to return on the dashboard" URL to a SAFE absolute href, or "" if it
 * isn't a Macro Dashboard URL. This is the anti-open-redirect gate: the value ultimately drives
 * `window.location.assign`, so we only ever accept http(s) URLs whose host is a known macro host — never
 * an arbitrary attacker-controlled origin smuggled in via `?ret=`.
 */
function safeMacroHref(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const u = new URL(raw, MACRO_ORIGIN);   // tolerate absolute OR dashboard-relative ("/standout#AAPL")
    if ((u.protocol === "https:" || u.protocol === "http:") && isMacroHost(u.hostname)) return u.href;
  } catch {}
  return "";
}

/**
 * Detect — and remember for the browser session — that the user arrived at the Terminal *from* the Macro
 * Dashboard, and capture the EXACT dashboard page to return to. Used to show a prominent "back to the
 * dashboard" affordance and, crucially, to HIDE it for direct visitors (for whom a back button would dump
 * them onto whatever unrelated site they came from).
 *
 * The return target is resolved, in priority order:
 *   1. An explicit `?ret=<full-url>` (also accepts `?return=`) the dashboard stamps onto its deep-links.
 *      This is the ONLY source that preserves the full path + hash: the macro→terminal hop is cross-ORIGIN
 *      (apex → app subdomain), so the default `strict-origin-when-cross-origin` policy strips
 *      `document.referrer` down to the bare origin ("https://mastermind-x.com/") — which is why the button
 *      used to dump everyone on index.html. The `ret` param carries the real page (e.g. Standout Stocks)
 *      plus any anchor, so Back lands the user right where they left.
 *   2. `document.referrer`, if it's a macro host — full path when policy allows / same-site, origin-only
 *      otherwise. A useful fallback but never better than the origin for the cross-origin hop.
 *   3. The dashboard origin (index) as a last resort.
 *
 * A fresh arrival signal on the CURRENT load always wins over the cached session value, so re-entering the
 * Terminal from a *different* dashboard page updates the return target. Absent any fresh signal we fall
 * back to the cached value, which persists as the user navigates between Terminal routes (chart → analyst
 * → screener → options → …) where the referrer/param are no longer present.
 */
export function useFromMacro() {
  const [context, setContext] = useState({
    fromMacro: false,
    macroHref: MACRO_ORIGIN,
    embedded: false,
  });

  useEffect(() => {
    let nextContext: typeof context | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const flagged = params.get("from") === "macro" || params.get("ref") === "macro";
      const embeddedNow = ensureEmbeddedTerminalSession();
      const retHref = safeMacroHref(params.get("ret") || params.get("return"));
      let refHref = "";
      try {
        if (document.referrer) {
          const u = new URL(document.referrer);
          if (isMacroHost(u.hostname)) refHref = document.referrer;
        }
      } catch {}

      // Any of these means "this load came from the dashboard" — a fresh signal that refreshes the target.
      if (flagged || retHref || refHref || embeddedNow) {
        const href = retHref || refHref || MACRO_ORIGIN;
        sessionStorage.setItem(KEY, "1");
        sessionStorage.setItem(HREF, href);
        nextContext = { fromMacro: true, macroHref: href, embedded: embeddedNow };
      }

      // No fresh signal on this load — restore the remembered dashboard context (SPA in-app navigation).
      if (!nextContext && sessionStorage.getItem(KEY) === "1") {
        nextContext = {
          fromMacro: true,
          macroHref: safeMacroHref(sessionStorage.getItem(HREF)) || MACRO_ORIGIN,
          embedded: ensureEmbeddedTerminalSession(),
        };
      }
    } catch {}

    // Defer the client-only context update to the next task. This keeps the
    // server snapshot deterministic and avoids a synchronous effect cascade.
    if (!nextContext) return;
    const resolvedContext = nextContext;
    const timer = window.setTimeout(() => setContext(resolvedContext), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return context;
}

/**
 * Return to the Macro Dashboard. In the dominant flow (macro → terminal → back), the previous history
 * entry IS the dashboard, so a real back() restores the exact page + scroll instantly (bfcache). When
 * there's nothing to pop (opened in a fresh tab) we hard-navigate to the captured dashboard URL.
 */
export function backToMacro(macroHref: string) {
  // Embedded Terminal: the dashboard owns browser history + scroll state. Ask the
  // parent shell to close instead of navigating the iframe to another website.
  if (postToMacroDashboard("terminal:close")) return;

  // Always hard-navigate to the captured dashboard URL. A history.back() shortcut looked tempting
  // (bfcache-instant in the pure macro→terminal→back flow), but after ANY in-app navigation
  // (chart → analyst → options → screener → …) the previous history entry is another Terminal page,
  // so back() dumped the user on the last visited sub-page instead of the dashboard. assign() to the
  // remembered macroHref lands on the right dashboard page every time.
  window.location.assign(macroHref || MACRO_ORIGIN);
}
