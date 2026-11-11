// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import LegacyPageHost from "@/components/chrome/shared-shell/LegacyPageHost";
import {
  SHARED_SHELL_BRIDGE_VERSION, SHARED_SHELL_BUILD, SHARED_SHELL_DOCUMENT_VERSION,
  SHARED_SHELL_PROTOCOL, type ShellParentMessage,
} from "@/lib/sharedShellContracts";
import { sharedShellSource } from "@/lib/sharedShellRoutes";

const navigation = vi.hoisted(() => ({
  path: "/macro.html", params: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn() },
}));
const owners = vi.hoisted(() => ({
  onboarding: { open: vi.fn() }, settings: { open: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.path, useSearchParams: () => navigation.params,
  useRouter: () => navigation.router,
}));
vi.mock("@/components/onboarding/OnboardingProvider", () => ({ useOnboarding: () => owners.onboarding }));
vi.mock("@/components/settings/SettingsProvider", () => ({ useSettings: () => owners.settings }));
vi.mock("@/lib/sharedShellCopy", () => ({ useSharedShellT: () => (key: string) => key }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LEGACY = "https://www.mastermind-x.com";
const HREF = "/macro.html?filter=a%20b&filter=a+b#risk";
const context = { theme: "dark" as const, locale: "en" as const, contextRevision: 0 };
const onTitle = vi.fn();
const onContextRequest = vi.fn();
const replaceFrame = vi.fn<(href: string) => void>();
const postToFrame = vi.fn<(message: ShellParentMessage, origin: string) => void>();
const childWindow = { location: { replace: replaceFrame }, postMessage: postToFrame } as unknown as Window;
const healthyGate = {
  enabled: true, buildId: SHARED_SHELL_BUILD, protocol: SHARED_SHELL_PROTOCOL,
  bridgeVersion: SHARED_SHELL_BRIDGE_VERSION, documentVersion: SHARED_SHELL_DOCUMENT_VERSION,
  registrySha256: sharedShellSource.registrySha256,
};
type GateRequest = { resolve: (overrides?: Partial<typeof healthyGate>) => void };
let requests: GateRequest[];
let container: HTMLDivElement;
let root: Root;

async function renderHost(presentation = context) {
  await act(async () => {
    root.render(<LegacyPageHost legacyOrigin={LEGACY} identityKey="guest" context={presentation}
      onContextRequest={onContextRequest} onTitle={onTitle} />);
  });
}
async function gate(index = requests.length - 1, overrides: Partial<typeof healthyGate> = {}) {
  await act(async () => { requests[index].resolve(overrides); });
}
function iframe() { return container.querySelector<HTMLIFrameElement>("iframe")!; }
function generation() { return new URL(replaceFrame.mock.calls.at(-1)![0]).searchParams.get("mmx_generation")!; }
function ready(responseKind = "content", overrides: Record<string, unknown> = {}) {
  return {
    type: "READY", href: LEGACY + HREF, title: "Macro", contextRevision: 0,
    bridgeVersion: SHARED_SHELL_BRIDGE_VERSION, documentVersion: SHARED_SHELL_DOCUMENT_VERSION,
    responseKind, ...overrides,
  };
}
async function packet(body: Record<string, unknown>, frameGeneration = generation()) {
  const event = new MessageEvent("message", {
    origin: LEGACY, data: { protocol: SHARED_SHELL_PROTOCOL, frameGeneration, ...body },
  });
  Object.defineProperty(event, "source", { value: childWindow });
  await act(async () => { window.dispatchEvent(event); });
}
async function start(responseKind = "content") {
  await renderHost();
  await gate();
  await act(async () => { iframe().dispatchEvent(new Event("load")); });
  await packet(ready(responseKind));
}
function hidden() {
  expect(iframe().style.visibility).toBe("hidden");
  expect(iframe().getAttribute("aria-hidden")).toBe("true");
  expect(iframe().hasAttribute("inert")).toBe(true);
  expect(iframe().tabIndex).toBe(-1);
}
async function assertRetired(oldGeneration = generation()) {
  const titleCount = onTitle.mock.calls.length;
  const postCount = postToFrame.mock.calls.length;
  const requestCount = requests.length;
  await packet(ready(), oldGeneration);
  await packet({ type: "CONTEXT_REQUEST", theme: "light" }, oldGeneration);
  await packet({ type: "AUTH_REQUEST", intent: "settings" }, oldGeneration);
  await packet({ type: "NAVIGATE", href: "/about.html", mode: "push", sameDocument: false, requestId: "late" }, oldGeneration);
  await act(async () => {
    iframe().dispatchEvent(new Event("load"));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(1000);
  });
  hidden();
  expect(onTitle).toHaveBeenCalledTimes(titleCount);
  expect(onContextRequest).not.toHaveBeenCalled();
  expect(owners.settings.open).not.toHaveBeenCalled();
  expect(navigation.router.push).not.toHaveBeenCalled();
  expect(postToFrame).toHaveBeenCalledTimes(postCount);
  expect(requests).toHaveLength(requestCount);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  requests = [];
  navigation.path = "/macro.html";
  navigation.params = new URLSearchParams("filter=a%20b&filter=a+b");
  window.history.replaceState({}, "", HREF);
  vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockReturnValue(childWindow);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => {
    requests.push({ resolve: (overrides = {}) => resolve({
      ok: true, json: async () => ({ ...healthyGate, ...overrides }),
    } as Response) });
  })));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Shared Shell stable workspace recovery", () => {
  it("keeps a visibility mismatch terminal even when valid old READY and actions arrive later", async () => {
    await start();
    iframe().focus();
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await gate(1, { enabled: false });
    expect(container.querySelector("h1")?.textContent).toBe("shellRefreshTitle");
    await assertRetired();
    expect(container.querySelector("h1")?.textContent).toBe("shellRefreshTitle");
  });

  it("does not revive an expired admitted document; only an explicit retry admits a new generation", async () => {
    await renderHost();
    await gate();
    const expiredGeneration = generation();
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(container.querySelector("main")?.dataset.sharedShellFailure).toBe("deadline");
    await assertRetired(expiredGeneration);
    const retry = container.querySelector<HTMLButtonElement>(".shared-shell-boundary-actions button")!;
    retry.focus();
    await act(async () => { retry.click(); });
    expect(requests).toHaveLength(2);
    expect(document.activeElement).toBe(container.querySelector("h1"));
    await gate();
    expect(generation()).not.toBe(expiredGeneration);
    await packet(ready(), expiredGeneration);
    hidden();
    await packet(ready());
    expect(iframe().style.visibility).toBe("visible");
    expect(document.activeElement).toBe(iframe());
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(HREF);
  });

  it.each([
    ["child error", { type: "ERROR", code: "initialization_failed" }, "failed"],
    ["wrong page", ready("content", { href: LEGACY + "/about.html" }), "failed"],
    ["old version", ready("content", { bridgeVersion: "obsolete" }), "changed"],
    ["invalid navigation", { type: "NAVIGATE", href: "https://untrusted.invalid/", mode: "push", sameDocument: false, requestId: "invalid" }, "failed"],
  ])("keeps %s recovery stable against the same generation's late messages", async (_name, message, state) => {
    await start();
    await packet(message);
    expect(container.querySelector("h1")?.textContent).toBe(state === "changed" ? "shellRefreshTitle" : "shellUnavailableTitle");
    await assertRetired();
  });

  it("does not let an older visibility response overwrite the first recovery reason", async () => {
    await start();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await packet({ type: "ERROR", code: "initialization_failed" });
    await gate(1, { enabled: false });
    await gate(2, { buildId: "older-build" });
    expect(container.querySelector("h1")?.textContent).toBe("shellUnavailableTitle");
    expect(container.querySelector("main")?.dataset.sharedShellFailure).toBe("child-error");
  });

  it("keeps accepted restricted content interactive and preserves its current generation", async () => {
    await start("coming_soon");
    const acceptedGeneration = generation();
    expect(iframe().style.visibility).toBe("visible");
    expect(iframe().dataset.responseKind).toBe("coming_soon");
    await packet({ type: "AUTH_REQUEST", intent: "settings" });
    expect(owners.settings.open).toHaveBeenCalledWith("account");
    await packet({ type: "CONTEXT_REQUEST", theme: "light" });
    expect(onContextRequest).toHaveBeenCalled();
    await act(async () => { iframe().dispatchEvent(new Event("load")); });
    expect(iframe().style.visibility).toBe("visible");
    expect(generation()).toBe(acceptedGeneration);
    expect(requests).toHaveLength(1);
  });

  it("does not move focus from another shell control when a pending retry completes", async () => {
    await start();
    await packet({ type: "ERROR", code: "initialization_failed" });
    const retry = container.querySelector<HTMLButtonElement>(".shared-shell-boundary-actions button")!;
    retry.focus();
    await act(async () => { retry.click(); });
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    await gate();
    await packet(ready());
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
