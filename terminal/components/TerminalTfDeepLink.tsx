"use client";
// Applies `/terminal?tf=` once (E01 chart handover). Rendered beside the page by
// app/terminal/layout.tsx so TerminalShell (a locked evidence surface) is not edited: the shell
// already listens for `mm:set-tf` and guards it on the active symbol's functional timeframes.
//
// Why wait for the first announced frame instead of dispatching on mount: the shell resolves its
// startup timeframe and binds its listener in its own effects, behind the route's loading boundary.
// A mount-time dispatch can land before the listener exists, or be overwritten by the startup
// timeframe. The first `mm:terminal-visual-ready` (or its render_not_ready diagnostic) proves the
// shell is mounted and settled on a timeframe, so the switch is deterministic.
import { useEffect } from "react";
import { TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT, TERMINAL_VISUAL_READY_EVENT } from "@/lib/terminalBoot";
import { readTfDeepLink, stripTfDeepLink, tfDeepLinkTarget } from "@/lib/terminalTfDeepLink";

export default function TerminalTfDeepLink() {
  useEffect(() => {
    const link = readTfDeepLink(window.location.search);
    if (!link) return;
    let done = false;
    const onFrame = (e: Event) => {
      if (done) return;
      const detail = (e as CustomEvent).detail ?? {};
      const target = tfDeepLinkTarget(link, detail);
      if (target === "wait") return;
      done = true;
      detach();
      if (target !== null) window.dispatchEvent(new CustomEvent("mm:set-tf", { detail: { tf: target } }));
      const next = stripTfDeepLink(window.location.href);
      if (next) { try { window.history.replaceState(window.history.state, "", next); } catch { /* history blocked */ } }
    };
    const detach = () => {
      window.removeEventListener(TERMINAL_VISUAL_READY_EVENT, onFrame);
      window.removeEventListener(TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT, onFrame);
    };
    window.addEventListener(TERMINAL_VISUAL_READY_EVENT, onFrame);
    window.addEventListener(TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT, onFrame);
    return detach;
  }, []);
  return null;
}
