"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { useSettings } from "@/components/settings/SettingsProvider";
import { useT } from "@/lib/i18n";
import {
  isPresentationHref, readShellChildMessage, SHARED_SHELL_BRIDGE_VERSION, SHARED_SHELL_BUILD,
  SHARED_SHELL_DOCUMENT_VERSION, SHARED_SHELL_PROTOCOL,
  type ShellContext, type ShellParentMessage, type ShellTheme, type ShellLocale, type ShellViewState,
} from "@/lib/sharedShellContracts";
import {
  isLegacyShellPath, legacyFrameHref, resolveSharedShellLink, sharedShellCatalog,
  sharedShellSource, shellPageLabel,
} from "@/lib/sharedShellRoutes";

type LiveFrame = {
  generation: string; canonical: string; entry: string; restore: ShellViewState | null;
  initialized: boolean; admitted: boolean; requests: Set<string>;
};
const ENTRY_KEY = "mmxSharedShellEntry";
const LOCATION_EVENT = "mmx:shell-location";

/** One document at a time. The AppShell layout, not the route page, owns this host. */
export default function LegacyPageHost({
  legacyOrigin, identityKey, context, onContextRequest, onTitle,
}: {
  legacyOrigin: string; identityKey: string; context: ShellContext;
  onContextRequest: (value: { theme?: ShellTheme; locale?: ShellLocale }) => void;
  onTitle: (value: string) => void;
}) {
  const path = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const t = useT();
  const onboarding = useOnboarding();
  const settings = useSettings();
  const [revision, setRevision] = useState(0);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "restricted" | "failed" | "changed">("loading");
  const frame = useRef<HTMLIFrameElement>(null);
  const live = useRef<LiveFrame | null>(null);
  const contextRef = useRef(context);
  const timeout = useRef<number | null>(null);
  const views = useRef(new Map<string, ShellViewState>());
  const previousEntry = useRef<{ key: string; canonical: string } | null>(null);
  const traversal = useRef(false);
  const sameDocument = useRef<string | null>(null);
  const active = isLegacyShellPath(path);
  const canonical = useMemo(() => typeof window === "undefined" ? path
    : window.location.pathname + window.location.search + window.location.hash, [path, params, revision]);

  const clearDeadline = useCallback(() => {
    if (timeout.current !== null) window.clearTimeout(timeout.current);
    timeout.current = null;
  }, []);
  const post = useCallback((message: ShellParentMessage) => {
    frame.current?.contentWindow?.postMessage(message, legacyOrigin);
  }, [legacyOrigin]);
  const initialize = useCallback(() => {
    const current = live.current;
    if (!current?.admitted) return;
    current.initialized = true;
    post({ protocol: SHARED_SHELL_PROTOCOL, frameGeneration: current.generation,
      type: "INIT", ...contextRef.current, canonicalPath: current.canonical,
      catalog: sharedShellCatalog, restore: current.restore });
  }, [post, clearDeadline]);

  useEffect(() => {
    contextRef.current = context;
    const current = live.current;
    if (current?.initialized) {
      post({ protocol: SHARED_SHELL_PROTOCOL, frameGeneration: current.generation,
        type: "CONTEXT", ...context });
    }
  }, [context, post]);

  useEffect(() => {
    const changed = () => setRevision(value => value + 1);
    const back = () => { traversal.current = true; changed(); };
    window.addEventListener("popstate", back);
    window.addEventListener("hashchange", changed);
    window.addEventListener(LOCATION_EVENT, changed);
    return () => {
      window.removeEventListener("popstate", back);
      window.removeEventListener("hashchange", changed);
      window.removeEventListener(LOCATION_EVENT, changed);
    };
  }, []);

  useEffect(() => {
    views.current.clear();
    previousEntry.current = null;
    sameDocument.current = null;
    // An account boundary always creates a fresh browsing context and drops view snapshots.
    live.current = null;
  }, [identityKey]);

  useEffect(() => {
    clearDeadline();
    if (!active || !isPresentationHref(canonical)) {
      live.current = null;
      onTitle("");
      setStatus(active ? "failed" : "loading");
      return;
    }
    const state = window.history.state;
    let key = state && typeof state[ENTRY_KEY] === "string" ? state[ENTRY_KEY] : "";
    const previous = previousEntry.current;
    if (!key || (!traversal.current && previous && previous.canonical !== canonical && previous.key === key)) {
      key = crypto.randomUUID();
      window.history.replaceState({ ...(state || {}), [ENTRY_KEY]: key }, "", window.location.href);
    }
    const restoring = traversal.current;
    traversal.current = false;
    previousEntry.current = { key, canonical };
    if (sameDocument.current === canonical && live.current) {
      sameDocument.current = null;
      live.current.canonical = canonical;
      live.current.entry = key;
      return;
    }
    sameDocument.current = null;
    const current: LiveFrame = {
      generation: crypto.randomUUID(), canonical, entry: key,
      restore: restoring ? views.current.get(key) || null : null,
      initialized: false, admitted: false, requests: new Set(),
    };
    live.current = current;
    setStatus("loading");
    onTitle(shellPageLabel(path, contextRef.current.locale));
    const abort = new AbortController();
    timeout.current = window.setTimeout(() => {
      if (live.current === current) setStatus("failed");
    }, 15000);

    // Check the actual running sibling service on every document navigation.
    // A stale client cannot treat a rollback/disabled server as a successful integration.
    fetch("/api/shared-shell/status", { cache: "no-store", credentials: "same-origin", signal: abort.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Shared Shell unavailable");
        const gate = await response.json();
        if (gate.buildId !== SHARED_SHELL_BUILD || gate.protocol !== SHARED_SHELL_PROTOCOL || gate.bridgeVersion !== SHARED_SHELL_BRIDGE_VERSION
          || gate.documentVersion !== SHARED_SHELL_DOCUMENT_VERSION
          || gate.registrySha256 !== sharedShellSource.registrySha256 || gate.enabled !== true) {
          if (live.current === current) { clearDeadline(); setStatus("changed"); }
          return;
        }
        if (live.current !== current || !frame.current?.contentWindow) return;
        current.admitted = true;
        // Cross-origin Location.replace is the browser-supported write operation.
        // Keeping the one WindowProxy avoids adding child-only history entries via iframe.src.
        frame.current.contentWindow.location.replace(legacyFrameHref(canonical, current.generation, legacyOrigin));
      })
      .catch(error => {
        if (error?.name !== "AbortError" && live.current === current) setStatus("failed");
      });
    return () => { abort.abort(); clearDeadline(); };
  }, [active, canonical, retry, identityKey, legacyOrigin, path, onTitle, clearDeadline]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const current = live.current;
      const source = frame.current?.contentWindow;
      if (!current || !source) return;
      const message = readShellChildMessage(event, {
        origin: legacyOrigin, source, frameGeneration: current.generation,
      });
      if (!message || !current.admitted) return;
      if (message.type === "READY") {
        const target = resolveSharedShellLink(message.href, current.canonical, window.location.origin, legacyOrigin);
        if (message.bridgeVersion !== SHARED_SHELL_BRIDGE_VERSION
          || message.documentVersion !== SHARED_SHELL_DOCUMENT_VERSION) {
          clearDeadline(); setStatus("changed"); return;
        }
        if (target.kind !== "legacy" || target.href !== current.canonical) {
          clearDeadline(); setStatus("failed"); return;
        }
        if (message.contextRevision !== contextRef.current.contextRevision) { initialize(); return; }
        clearDeadline();
        onTitle(message.title || shellPageLabel(path, contextRef.current.locale));
        setStatus(message.responseKind === "content" ? "ready" : "restricted");
      } else if (message.type === "VIEW_STATE") {
        views.current.set(current.entry, message.view);
        if (views.current.size > 64) views.current.delete(views.current.keys().next().value!);
      } else if (message.type === "NAVIGATE") {
        if (current.requests.has(message.requestId)) return;
        current.requests.add(message.requestId);
        if (current.requests.size > 128) current.requests.delete(current.requests.values().next().value!);
        const target = resolveSharedShellLink(message.href, current.canonical, window.location.origin, legacyOrigin);
        if (target.kind !== "legacy" && target.kind !== "native") { setStatus("failed"); return; }
        if (message.sameDocument) {
          if (target.kind !== "legacy" || new URL(target.href, legacyOrigin).pathname !== path) {
            setStatus("failed"); return;
          }
          sameDocument.current = target.href;
          const key = message.mode === "push" ? crypto.randomUUID() : current.entry;
          // Next's supported native History integration preserves its internal router state.
          window.history[message.mode === "push" ? "pushState" : "replaceState"](
            { ...(window.history.state || {}), [ENTRY_KEY]: key }, "", target.href);
          current.canonical = target.href;
          current.entry = key;
          previousEntry.current = { key, canonical: target.href };
          post({ protocol: SHARED_SHELL_PROTOCOL, frameGeneration: current.generation,
            type: "LOCATION_ACCEPTED", requestId: message.requestId, canonicalPath: target.href });
          window.dispatchEvent(new Event(LOCATION_EVENT));
        } else {
          if (message.mode === "replace") router.replace(target.href, { scroll: false });
          else router.push(target.href, { scroll: false });
        }
      } else if (message.type === "CONTEXT_REQUEST") {
        onContextRequest(message);
      } else if (message.type === "AUTH_REQUEST") {
        if (message.intent === "settings" || message.intent === "billing")
          settings.open(message.intent === "billing" ? "billing" : "account");
        else onboarding.open(message.intent);
      } else if (message.type === "ERROR") {
        clearDeadline(); setStatus("failed");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [legacyOrigin, path, router, post, clearDeadline, initialize, onTitle, onContextRequest, settings, onboarding]);

  useEffect(() => {
    const visibility = () => {
      const current = live.current;
      if (!current?.initialized) return;
      post({ protocol: SHARED_SHELL_PROTOCOL, frameGeneration: current.generation,
        type: "VISIBILITY", visible: document.visibilityState === "visible" });
      if (document.visibilityState === "visible") {
        fetch("/api/shared-shell/status", { cache: "no-store", credentials: "same-origin" })
          .then(async r => r.ok ? r.json() : null)
          .then(gate => {
            if (live.current === current && (!gate?.enabled || gate.buildId !== SHARED_SHELL_BUILD || gate.registrySha256 !== sharedShellSource.registrySha256
              || gate.protocol !== SHARED_SHELL_PROTOCOL || gate.bridgeVersion !== SHARED_SHELL_BRIDGE_VERSION
              || gate.documentVersion !== SHARED_SHELL_DOCUMENT_VERSION)) { clearDeadline(); setStatus("changed"); }
          }).catch(() => { /* The next navigation performs the required admission check. */ });
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [post, clearDeadline]);

  if (!active) return null;
  const title = shellPageLabel(path, context.locale);
  const failed = status === "failed" || status === "changed";
  const visible = status === "ready" || status === "restricted";
  return (
    <main className="main2 shared-shell-content" id="shared-shell-content" aria-label={title}>
      {!visible && (
        <section className="shared-shell-boundary" role={failed ? "alert" : "status"} aria-live="polite">
          <span className="shared-shell-boundary-mark" aria-hidden="true">{failed ? "↗" : "M"}</span>
          <h1>{status === "changed" ? t("shellRefreshTitle") : failed ? t("shellUnavailableTitle") : t("shellOpening")}</h1>
          <p>{status === "changed" ? t("shellRefreshBody") : failed ? t("shellUnavailableBody") : title}</p>
          {failed ? (
            <div className="shared-shell-boundary-actions">
              <button type="button" onClick={() => status === "changed" ? window.location.reload() : setRetry(v => v + 1)}>
                {status === "changed" ? t("shellRefresh") : t("retry")}
              </button>
              <a href={legacyOrigin + (isPresentationHref(canonical) ? canonical : path)} target="_blank" rel="noopener noreferrer">{t("shellOpenOriginal")}</a>
            </div>
          ) : <span className="shared-shell-progress" aria-hidden="true" />}
        </section>
      )}
      <iframe
        key={identityKey}
        ref={frame}
        src="about:blank"
        title={title}
        className="shared-shell-frame"
        data-shared-shell-frame=""
        data-response-kind={status === "restricted" ? "coming_soon" : status === "ready" ? "content" : undefined}
        style={{ visibility: visible ? "visible" : "hidden" }}
        aria-hidden={!visible}
        inert={!visible}
        tabIndex={visible ? 0 : -1}
        onLoad={initialize}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-top-navigation-by-user-activation"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="clipboard-write; fullscreen"
      />
    </main>
  );
}
