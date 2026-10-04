"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  embeddedDeploymentChanged,
  ensureEmbeddedTerminalSession,
  isAllowedMacroOrigin,
  postToMacroDashboard,
  rememberEmbeddedMacroOrigin,
} from "@/lib/originNav";
import {
  TERMINAL_VISUAL_READY_EVENT,
  type TerminalVisualReadyDetail,
} from "@/lib/terminalBoot";

const SYMBOL_RE = /^[A-Za-z0-9][A-Za-z0-9._=^:/+\-]{0,63}$/;

function safeSymbol(value: unknown): string {
  if (typeof value !== "string") return "";
  const symbol = value.trim().toUpperCase();
  return SYMBOL_RE.test(symbol) ? symbol : "";
}

/**
 * The dashboard deliberately keeps the desktop iframe warm between opens. That is fast, but it
 * also means an already-mounted Analysis shell can survive a production deploy indefinitely and
 * keep old CSS/JS geometry. On the next parent interaction, compare the document's baked Next
 * deployment id with a no-body HEAD response. A mismatch gets one native reload before we apply
 * the symbol handoff; matching generations stay warm.
 */
async function reloadIfEmbeddedDeploymentChanged(): Promise<boolean> {
  const documentDeploymentId = document.documentElement.getAttribute("data-dpl-id");
  if (!documentDeploymentId) return false; // local dev / ad-hoc builds intentionally have no id
  try {
    const response = await fetch(window.location.href, {
      method: "HEAD",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok || !embeddedDeploymentChanged(documentDeploymentId, response.headers.get("link"))) {
      return false;
    }
    window.location.reload();
    return true;
  } catch {
    return false; // lifecycle messaging must remain usable during a transient network failure
  }
}

/**
 * Cross-origin lifecycle bridge for the first-party Macro Dashboard iframe.
 *
 * The bridge deliberately knows nothing about chart internals. On the chart route it emits a
 * local event that TerminalShell consumes; from any other workspace it returns to /terminal with
 * the requested symbol. Close/ready messages are restricted to the exact dashboard origins.
 */
export default function EmbeddedTerminalBridge() {
  const pathname = usePathname();

  useEffect(() => {
    if (!ensureEmbeddedTerminalSession()) return;

    document.documentElement.dataset.mmEmbedded = "dashboard";

    const announceReady = () => {
      postToMacroDashboard("terminal:ready", {
        path: window.location.pathname,
        symbol: new URLSearchParams(window.location.search).get("symbol")
          || new URLSearchParams(window.location.search).get("sym")
          || "",
      });
    };

    const onVisualReady = (event: Event) => {
      const detail = (event as CustomEvent<TerminalVisualReadyDetail>).detail;
      postToMacroDashboard("terminal:visual-ready", {
        path: window.location.pathname,
        symbol: detail?.symbol || "",
        state: detail?.state || "data",
      });
    };

    const onMessage = async (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!isAllowedMacroOrigin(event.origin)) return;
      const data = event.data;
      if (!data || data.source !== "mastermind-dashboard") return;

      // event.origin is the browser-verified origin of the actual parent window.
      // Persist that exact apex/www host before replying; a stale return URL is not
      // authoritative enough to be a postMessage target.
      rememberEmbeddedMacroOrigin(event.origin);

      if (data.type === "terminal:close") {
        postToMacroDashboard("terminal:close");
        return;
      }

      if (data.type !== "terminal:set-symbol") return;

      // The parent sends set-symbol whenever it reuses a warm desktop iframe. Check
      // deployment generation before doing anything else so an old Analysis shell
      // cannot remain mounted across a production deploy and preserve broken geometry.
      if (await reloadIfEmbeddedDeploymentChanged()) return;

      const symbol = safeSymbol(data.symbol);
      if (!symbol) return;

      if (window.location.pathname === "/terminal") {
        const url = new URL(window.location.href);
        url.searchParams.set("symbol", symbol);
        url.searchParams.delete("sym");
        window.history.replaceState(window.history.state, "", url.toString());
        window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol } }));
        postToMacroDashboard("terminal:symbol-ready", { symbol });
        return;
      }

      const ret = sessionStorage.getItem("mm.macroHref") || document.referrer || "https://www.mastermind-x.com/";
      const url = new URL("/terminal", window.location.origin);
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("embed", "dashboard");
      url.searchParams.set("from", "macro");
      url.searchParams.set("ret", ret);
      window.location.assign(url.toString());
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      postToMacroDashboard("terminal:close");
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener(TERMINAL_VISUAL_READY_EVENT, onVisualReady);
    const readyTimer = window.setTimeout(announceReady, 0);

    return () => {
      window.clearTimeout(readyTimer);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener(TERMINAL_VISUAL_READY_EVENT, onVisualReady);
      delete document.documentElement.dataset.mmEmbedded;
    };
  }, []);

  useEffect(() => {
    if (!ensureEmbeddedTerminalSession()) return;
    postToMacroDashboard("terminal:route", { path: pathname });
  }, [pathname]);

  return null;
}
