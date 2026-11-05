// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useInsertionEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import LegacyPageHost from "@/components/chrome/shared-shell/LegacyPageHost";
import {
  SHARED_SHELL_BRIDGE_VERSION, SHARED_SHELL_BUILD, SHARED_SHELL_DOCUMENT_VERSION,
  SHARED_SHELL_PROTOCOL, type ShellParentMessage,
} from "@/lib/sharedShellContracts";
import { sharedShellSource } from "@/lib/sharedShellRoutes";

const navigation = vi.hoisted(() => ({
  path: "/macro.html",
  params: new URLSearchParams(),
  renders: [] as Array<{ path: string; browserHref: string }>,
  router: { push: vi.fn(), replace: vi.fn() },
}));
const owners = vi.hoisted(() => ({
  onboarding: { open: vi.fn() },
  settings: { open: vi.fn() },
  translate: (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => {
    navigation.renders.push({
      path: navigation.path,
      browserHref: window.location.pathname + window.location.search + window.location.hash,
    });
    return navigation.path;
  },
  useSearchParams: () => navigation.params,
  useRouter: () => navigation.router,
}));
vi.mock("@/components/onboarding/OnboardingProvider", () => ({
  useOnboarding: () => owners.onboarding,
}));
vi.mock("@/components/settings/SettingsProvider", () => ({
  useSettings: () => owners.settings,
}));
vi.mock("@/lib/sharedShellCopy", () => ({
  useSharedShellT: () => owners.translate,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LEGACY = "https://www.mastermind-x.com";
const INITIAL = "/macro.html?filter=a%20b&filter=a+b&slash=%2f#risk";
const context = { theme: "dark" as const, locale: "en" as const, contextRevision: 0 };
const onTitle = vi.fn();
const onContextRequest = vi.fn();
const replaceFrame = vi.fn<(href: string) => void>();
const postToFrame = vi.fn<(message: ShellParentMessage, origin: string) => void>();
// Only browser I/O is doubled. The mounted host, finite route projection,
// URL classifier, envelope validator, generation checks and effects are real.
const childWindow = {
  location: { replace: replaceFrame }, postMessage: postToFrame,
} as unknown as Window;
const healthyGate = {
  enabled: true, buildId: SHARED_SHELL_BUILD, protocol: SHARED_SHELL_PROTOCOL,
  bridgeVersion: SHARED_SHELL_BRIDGE_VERSION, documentVersion: SHARED_SHELL_DOCUMENT_VERSION,
  registrySha256: sharedShellSource.registrySha256,
};
type GateRequest = {
  signal: AbortSignal;
  resolve: (overrides?: Partial<typeof healthyGate>) => void;
};
let requests: GateRequest[];
let container: HTMLDivElement;
let root: Root;
let serial: number;

function browserHref() {
  return window.location.pathname + window.location.search + window.location.hash;
}
type CommitMode = "push" | "replace" | "traverse";

/**
 * Next 16.2.9 app-router.tsx exposes new pathname/search context during render,
 * then HistoryUpdater writes canonicalUrl in useInsertionEffect (lines 59–101).
 * Updating window.history BEFORE root.render would hide the observed defect.
 */
function HistoryCommit({ href, mode, commit }: { href: string; mode: CommitMode; commit: number }) {
  useInsertionEffect(() => {
    if (mode === "traverse") return; // popstate has already moved the real history entry.
    window.history[mode === "push" ? "pushState" : "replaceState"](
      { ...(window.history.state || {}), __NA: true }, "", href,
    );
  }, [href, mode, commit]);
  return null;
}

function renderRouteTree(href: string, mode: CommitMode) {
  const url = new URL(href, window.location.origin);
  navigation.path = url.pathname;
  navigation.params = new URLSearchParams(url.search);
  root.render(<>
    <HistoryCommit href={href} mode={mode} commit={++serial} />
    <LegacyPageHost legacyOrigin={LEGACY} identityKey="guest" context={context}
      onContextRequest={onContextRequest} onTitle={onTitle} />
  </>);
}
async function renderCommittedRoute(href: string, mode: CommitMode = "push") {
  await act(async () => { renderRouteTree(href, mode); });
}

function iframe() {
  const frames = container.querySelectorAll<HTMLIFrameElement>("iframe[data-shared-shell-frame]");
  expect(frames).toHaveLength(1);
  return frames[0];
}
function latestFrameNavigation() {
  const href = replaceFrame.mock.calls.at(-1)?.[0];
  expect(href).toBeDefined();
  const url = new URL(href!);
  return { href: href!, url, generation: url.searchParams.get("mmx_generation")! };
}
async function resolveGate(request = requests.at(-1)!, overrides: Partial<typeof healthyGate> = {}) {
  await act(async () => { request.resolve(overrides); });
}
async function loadFrame() {
  await act(async () => { iframe().dispatchEvent(new Event("load")); });
  const init = postToFrame.mock.calls.map(([message]) => message).filter(message => message.type === "INIT").at(-1);
  if (!init || init.type !== "INIT") throw new Error("Host did not send INIT");
  expect(postToFrame.mock.calls.at(-1)?.[1]).toBe(LEGACY);
  return init;
}
async function childMessage(
  body: Record<string, unknown>,
  generation = latestFrameNavigation().generation,
  origin = LEGACY,
  source: unknown = childWindow,
) {
  const event = new MessageEvent("message", {
    origin, data: { protocol: SHARED_SHELL_PROTOCOL, frameGeneration: generation, ...body },
  });
  Object.defineProperty(event, "source", { value: source });
  await act(async () => { window.dispatchEvent(event); });
}
function readyBody(href: string) {
  return {
    type: "READY", href: LEGACY + href, title: "Retained page", contextRevision: 0,
    bridgeVersion: SHARED_SHELL_BRIDGE_VERSION, documentVersion: SHARED_SHELL_DOCUMENT_VERSION,
    responseKind: "content",
  };
}
function expectVisible(value: boolean) {
  expect(iframe().style.visibility).toBe(value ? "visible" : "hidden");
}
async function start() {
  await renderCommittedRoute(INITIAL, "replace");
  await resolveGate();
  const init = await loadFrame();
  expect(init.canonicalPath).toBe(INITIAL);
  await childMessage(readyBody(INITIAL));
  expectVisible(true);
  return { frame: iframe(), proxy: iframe().contentWindow, document: window.document };
}
async function navigate(href: string, mode: "push" | "replace" = "push") {
  await childMessage({ type: "NAVIGATE", href, mode, sameDocument: false, requestId: "route-" + serial });
  expect(navigation.router[mode]).toHaveBeenLastCalledWith(href, { scroll: false });
  await renderCommittedRoute(href, mode);
}
async function traverse(delta: number, href: string) {
  await act(async () => {
    await new Promise<void>(resolve => {
      window.addEventListener("popstate", () => {
        // Next's router and the host observe the same event. Expose the selected
        // route before React flushes the host's traversal revision update.
        renderRouteTree(href, "traverse");
        resolve();
      }, { once: true });
      window.history.go(delta);
    });
  });
}
function expectPersistent(owned: Awaited<ReturnType<typeof start>>) {
  expect(iframe()).toBe(owned.frame);
  expect(iframe().contentWindow).toBe(owned.proxy);
  expect(window.document).toBe(owned.document);
  // A document navigation goes through Location.replace, never a changing src.
  expect(iframe().getAttribute("src")).toBe("about:blank");
}

beforeEach(() => {
  vi.clearAllMocks();
  requests = [];
  serial = 0;
  navigation.renders.length = 0;
  window.history.replaceState({}, "", INITIAL);
  vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockReturnValue(childWindow);
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("/api/shared-shell/status");
    expect(init?.cache).toBe("no-store");
    expect(init?.credentials).toBe("same-origin");
    return new Promise<Response>(resolve => {
      requests.push({
        signal: init?.signal as AbortSignal,
        resolve: (overrides = {}) => resolve({
          ok: true, json: async () => ({ ...healthyGate, ...overrides }),
        } as Response),
      });
    });
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Shared Shell committed navigation", () => {
  function diagnostic() {
    const el = container.querySelector("main")!;
    return { phase: el.getAttribute("data-shared-shell-phase"), failure: el.getAttribute("data-shared-shell-failure"),
      load: el.getAttribute("data-shared-shell-load"), childError: el.getAttribute("data-shared-shell-child-error") };
  }
  it("exposes only closed lifecycle values across gate, INIT, load and accepted READY", async () => {
    await renderCommittedRoute(INITIAL, "replace");
    expect(diagnostic()).toEqual({ phase: "gate-pending", failure: "none", load: "not-seen", childError: "none" });
    await resolveGate();
    expect(diagnostic().phase).toBe("frame-requested");
    await loadFrame();
    expect(diagnostic()).toEqual({ phase: "init-sent", failure: "none", load: "seen", childError: "none" });
    await childMessage(readyBody(INITIAL));
    expect(diagnostic().phase).toBe("ready");
    await loadFrame(); // a late load must not downgrade already-proved readiness.
    expect(diagnostic().phase).toBe("ready");
  });
  it("keeps the first gate HTTP failure distinguishable after the deadline without exposing response text", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
      await renderCommittedRoute(INITIAL, "replace");
      expect(diagnostic().failure).toBe("gate-http");
      await act(async () => { vi.advanceTimersByTime(15000); });
      expect(diagnostic().failure).toBe("gate-http");
      expect(replaceFrame).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("separates network and frame-navigation failures without exporting exception messages", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("https://private.invalid/?query=do-not-export"));
    await renderCommittedRoute(INITIAL, "replace");
    expect(diagnostic().failure).toBe("gate-network");
    replaceFrame.mockImplementationOnce(() => { throw new Error("frame-location-secret"); });
    await renderCommittedRoute("/about.html", "push");
    await resolveGate();
    expect(diagnostic().failure).toBe("frame-navigation");
    expect(JSON.stringify(diagnostic())).not.toMatch(/private|secret|https|query/);
  });
  it.each([
    { body: { ...readyBody(INITIAL), bridgeVersion: "old" }, reason: "ready-version" },
    { body: readyBody("/about.html"), reason: "ready-canonical" },
    { body: { type: "ERROR", code: "unsupported_context" }, reason: "child-error" },
  ])("retains the guarded child decision reason $reason", async ({ body, reason }) => {
    await renderCommittedRoute(INITIAL, "replace"); await resolveGate(); await loadFrame();
    await childMessage(body);
    expect(diagnostic().failure).toBe(reason);
    expect(diagnostic().childError).toBe(reason === "child-error" ? "unsupported_context" : "none");
    expectVisible(false);
  });
  it("distinguishes a tuple mismatch from a missing READY deadline", async () => {
    await renderCommittedRoute(INITIAL, "replace"); await resolveGate(requests.at(-1)!, { enabled: false });
    expect(diagnostic().failure).toBe("gate-mismatch");
    expect(replaceFrame).not.toHaveBeenCalled();
  });

  it("initializes a DOM-ready bridge before a noncritical asset permits iframe load, then stops after READY", async () => {
    vi.useFakeTimers();
    try {
      await renderCommittedRoute(INITIAL, "replace");
      await resolveGate();
      // No iframe load event: an image can hold window.onload after DOMContentLoaded.
      await act(async () => { vi.advanceTimersByTime(250); });
      const init = postToFrame.mock.calls.map(([message]) => message)
        .filter(message => message.type === "INIT").at(-1);
      expect(init).toMatchObject({ type: "INIT", canonicalPath: INITIAL,
        frameGeneration: latestFrameNavigation().generation });
      await childMessage(readyBody(INITIAL));
      expectVisible(true);
      const sends = postToFrame.mock.calls.length;
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(postToFrame).toHaveBeenCalledTimes(sends);
    } finally { vi.useRealTimers(); }
  });

  it("does not start navigation or bootstrap if a status response arrives after the deadline", async () => {
    vi.useFakeTimers();
    try {
      await renderCommittedRoute(INITIAL, "replace");
      await act(async () => { vi.advanceTimersByTime(15000); });
      await resolveGate();
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(replaceFrame).not.toHaveBeenCalled();
      expect(postToFrame).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("does not initialize before gate admission and stops bootstrap attempts at the unchanged deadline", async () => {
    vi.useFakeTimers();
    try {
      await renderCommittedRoute(INITIAL, "replace");
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(postToFrame).not.toHaveBeenCalled();
      await resolveGate();
      await act(async () => { vi.advanceTimersByTime(14500); });
      expect(diagnostic()).toEqual({ phase: "init-sent", failure: "deadline", load: "not-seen", childError: "none" });
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      const sends = postToFrame.mock.calls.length;
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(postToFrame).toHaveBeenCalledTimes(sends);
      expectVisible(false);
    } finally { vi.useRealTimers(); }
  });

  it.each([
    { target: "/about.html?filter=c%20d&filter=c+d&slash=%2f#intro", mode: "push" as const },
    { target: "/macro.html?filter=c%20d&filter=c+d&slash=%2f#next", mode: "replace" as const },
  ])("pairs $mode navigation with the committed exact URL: $target", async ({ target, mode }) => {
    const owned = await start();
    const oldGeneration = latestFrameNavigation().generation;
    const length = window.history.length;
    const beforeRender = navigation.renders.length;
    await navigate(target, mode);

    expect(navigation.renders.slice(beforeRender)).toContainEqual({
      path: new URL(target, LEGACY).pathname, browserHref: INITIAL,
    });
    expect(browserHref()).toBe(target);
    expect(window.history.length).toBe(length + (mode === "push" ? 1 : 0));
    expectVisible(false);
    await resolveGate();
    const next = latestFrameNavigation();
    expect(next.generation).not.toBe(oldGeneration);
    const [routeAndQuery, hash] = target.split("#");
    expect(next.href).toBe(LEGACY + routeAndQuery
      + "&mmx_shell=1&mmx_generation=" + next.generation + "#" + hash);
    const init = await loadFrame();
    expect(init.canonicalPath).toBe(target);
    expect(init.frameGeneration).toBe(next.generation);
    await childMessage(readyBody(INITIAL), oldGeneration);
    expectVisible(false);
    await childMessage(readyBody(target));
    expectVisible(true);
    expect(container.querySelector("main")?.getAttribute("aria-busy")).toBe("false");
    expect(replaceFrame).toHaveBeenCalledTimes(2);
    expectPersistent(owned);
  });

  it("accepts same-document query/hash navigation without replacing the child or adding a second entry", async () => {
    const owned = await start();
    const generation = latestFrameNavigation().generation;
    const length = window.history.length;
    const target = "/macro.html?filter=x%20y&filter=x+y#detail";
    await childMessage({ type: "NAVIGATE", href: target, mode: "push", sameDocument: true, requestId: "same-doc" });
    expect(browserHref()).toBe(target);
    expect(window.history.length).toBe(length + 1);
    expect(requests).toHaveLength(1);
    expect(replaceFrame).toHaveBeenCalledTimes(1);
    expect(navigation.router.push).not.toHaveBeenCalled();
    expect(navigation.router.replace).not.toHaveBeenCalled();
    expect(postToFrame).toHaveBeenCalledWith({
      protocol: SHARED_SHELL_PROTOCOL, frameGeneration: generation,
      type: "LOCATION_ACCEPTED", requestId: "same-doc", canonicalPath: target,
    }, LEGACY);
    await childMessage(readyBody(target), generation);
    expectVisible(true);
    // The native history integration may publish its search-param context after
    // the bridge's location event. It is still the same accepted URL/generation.
    await renderCommittedRoute(target, "replace");
    expect(requests).toHaveLength(1);
    expect(replaceFrame).toHaveBeenCalledTimes(1);
    expect(window.history.length).toBe(length + 1);
    expectVisible(true);
    expectPersistent(owned);
  });

  it("restores the selected parent history entry and view when traversing back and forward", async () => {
    const owned = await start();
    const macroView = { x: 4, y: 480, focusId: "risk-summary" };
    await childMessage({ type: "VIEW_STATE", view: macroView });
    const target = "/about.html?lang=en#mission";
    await navigate(target);
    await resolveGate();
    await loadFrame();
    await childMessage(readyBody(target));
    const aboutView = { x: 0, y: 260, focusId: "mission" };
    await childMessage({ type: "VIEW_STATE", view: aboutView });
    const length = window.history.length;

    await traverse(-1, INITIAL);
    await resolveGate();
    let init = await loadFrame();
    expect(browserHref()).toBe(INITIAL);
    expect(init.canonicalPath).toBe(INITIAL);
    expect(init.restore).toEqual(macroView);
    await childMessage(readyBody(INITIAL));
    await traverse(1, target);
    await resolveGate();
    init = await loadFrame();
    expect(browserHref()).toBe(target);
    expect(init.canonicalPath).toBe(target);
    expect(init.restore).toEqual(aboutView);
    await childMessage(readyBody(target));
    expect(window.history.length).toBe(length);
    expectPersistent(owned);
  });

  it("aborts an older admission and cannot install its frame after a faster later navigation", async () => {
    const owned = await start();
    await navigate("/about.html");
    const superseded = requests.at(-1)!;
    const target = "/macro.html?latest=a%20b&latest=a+b#final";
    await renderCommittedRoute(target);
    const current = requests.at(-1)!;
    expect(current).not.toBe(superseded);
    expect(superseded.signal.aborted).toBe(true);
    await resolveGate(current);
    const init = await loadFrame();
    expect(init.canonicalPath).toBe(target);
    expect(latestFrameNavigation().url.pathname).toBe("/macro.html");
    expect(latestFrameNavigation().url.hash).toBe("#final");
    const count = replaceFrame.mock.calls.length;
    await resolveGate(superseded);
    expect(replaceFrame).toHaveBeenCalledTimes(count);
    expect(count).toBe(2);
    await childMessage(readyBody(target));
    expectVisible(true);
    expectPersistent(owned);
  });

  it("refuses a current-generation Macro READY when the committed parent route is About", async () => {
    await start();
    const staleGeneration = latestFrameNavigation().generation;
    await navigate("/about.html");
    await resolveGate();
    await loadFrame();
    const currentGeneration = latestFrameNavigation().generation;
    await childMessage(readyBody("/about.html"), currentGeneration, "https://untrusted.invalid");
    await childMessage(readyBody("/about.html"), currentGeneration, LEGACY, {});
    await childMessage(readyBody("/about.html"), staleGeneration);
    expectVisible(false);
    await childMessage(readyBody(INITIAL), currentGeneration);
    expect(browserHref()).toBe("/about.html");
    expectVisible(false);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("keeps runtime build admission ahead of every iframe navigation", async () => {
    await renderCommittedRoute(INITIAL, "replace");
    await resolveGate(requests[0], { buildId: "different-running-build" });
    expect(replaceFrame).not.toHaveBeenCalled();
    expect(postToFrame).not.toHaveBeenCalled();
    expectVisible(false);
    expect(container.textContent).toContain("shellRefreshTitle");
  });
});
