// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AppShell from "@/components/chrome/AppShell";
import { applyLang, LangProvider, tPlain } from "@/lib/i18n";
import { __marketPrefsSnapshot, __resetMarketPrefsStore, persistLang, persistMetaPrefs } from "@/lib/useMarketPrefs";
import {
  SHARED_SHELL_BRIDGE_VERSION, SHARED_SHELL_BUILD, SHARED_SHELL_DOCUMENT_VERSION,
  SHARED_SHELL_PROTOCOL, type ShellParentMessage,
} from "@/lib/sharedShellContracts";
import { sharedShellSource } from "@/lib/sharedShellRoutes";

// Import only incumbent entry points, so this file also runs on the unmodified
// source. AppShell, both toolbars, SettingsButton, Runtime, LegacyPageHost, the
// language owner and the account preference store all execute for real.
const navigation = vi.hoisted(() => ({
  path: "/macro.html", params: new URLSearchParams("filter=a%20b&filter=a+b"),
  router: { push: vi.fn(), replace: vi.fn() },
}));
const edges = vi.hoisted(() => ({
  onboarding: { open: vi.fn() }, getUser: vi.fn(), updateUser: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.path, useSearchParams: () => navigation.params,
  useRouter: () => navigation.router,
}));
vi.mock("next/dynamic", async () => {
  const { createElement, lazy, Suspense } = await import("react");
  return { default: (loader: Parameters<typeof lazy>[0]) => {
    const Component = lazy(loader);
    return function DynamicFixture(props: Record<string, unknown>) {
      return createElement(Suspense, { fallback: null }, createElement(Component, props));
    };
  } };
});
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/components/onboarding/OnboardingProvider", () => ({
  OnboardingProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useOnboarding: () => edges.onboarding,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: edges.getUser, updateUser: edges.updateUser } }),
}));
// Unrelated chart/search destinations are excluded, not the controls under test.
vi.mock("@/components/chrome/AnalysisBrainHost", () => ({ default: () => null }));
vi.mock("@/components/chrome/shared-shell/ShellSearch", () => ({ default: () => <button type="button">Company search fixture</button> }));
vi.mock("@/components/AppNav", () => ({ AppNav: () => <nav className="appnav" />, TOP: [], Glyph: () => null }));
vi.mock("@/components/BrandMark", () => ({ BrandMark: () => <svg />, BrandLockup: () => <span>Mastermind</span> }));
vi.mock("@/lib/shellBrainSymbol", () => ({ useShellBrainSymbol: () => "NVDA" }));
vi.mock("@/lib/activeSymbol", () => ({ useActiveSymbol: () => "NVDA" }));
vi.mock("@/lib/originNav", () => ({ useFromMacro: () => ({ fromMacro: false, macroHref: "" }), backToMacro: vi.fn() }));

// Keep the actual SettingsProvider -> portal panel -> Preferences path. Only
// unrelated section bodies and entitlement/usage reads are excluded here.
vi.mock("@/components/settings/SectionAccount", () => ({ default: () => null }));
vi.mock("@/components/settings/SectionAccuracy", () => ({ default: () => null }));
vi.mock("@/components/settings/SectionBilling", () => ({ default: () => null }));
vi.mock("@/components/settings/SectionUsage", () => ({ default: () => null }));
vi.mock("@/components/settings/SectionAlertDelivery", () => ({ default: () => null }));
vi.mock("@/components/settings/SectionTerminal", () => ({ default: () => null }));
vi.mock("@/components/settings/SectionSync", () => ({ default: () => null }));
vi.mock("@/components/settings/SectionTeam", () => ({ default: () => null }));
vi.mock("@/components/settings/SectionWebhooks", () => ({ default: () => null }));
vi.mock("@/components/settings/SectionDeveloper", () => ({ default: () => null }));
vi.mock("@/components/settings/SectionSharing", () => ({ default: () => null }));
vi.mock("@/components/settings/SectionPortfolioTargets", () => ({ default: () => null }));
vi.mock("@/lib/entitlementStore", () => ({
  entitlementAgeMs: () => 0,
  useDisplayEntitlement: () => ({ plan: null, unavailable: true, stale: false, refresh: vi.fn() }),
}));
vi.mock("@/lib/usageStore", () => ({
  useUsage: () => ({ quotas: null, tier: null, unavailable: true, stale: false }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const LEGACY = "https://www.mastermind-x.com";
const INITIAL = "/macro.html?filter=a%20b&filter=a+b#risk";
const A = "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22";
const B = "0b6d1f57-3c84-4a11-8e29-6d40cc1b7f93";
const postToFrame = vi.fn<(frame: HTMLIFrameElement, message: ShellParentMessage, origin: string) => void>();
const replaceFrame = vi.fn<(frame: HTMLIFrameElement, href: string) => void>();
const healthyGate = {
  enabled: true, buildId: SHARED_SHELL_BUILD, protocol: SHARED_SHELL_PROTOCOL,
  bridgeVersion: SHARED_SHELL_BRIDGE_VERSION, documentVersion: SHARED_SHELL_DOCUMENT_VERSION,
  registrySha256: sharedShellSource.registrySha256,
};
let container: HTMLDivElement;
let root: Root;
let childWindows: WeakMap<HTMLIFrameElement, Window>;
type Surface = ".topbar" | ".mobilebar";

async function renderShell(props: Partial<ComponentProps<typeof AppShell>> = {}) {
  await act(async () => {
    root.render(<LangProvider><AppShell sharedShell sharedShellLegacyOrigin={LEGACY} {...props}>{null}</AppShell></LangProvider>);
  });
  await act(async () => { await vi.dynamicImportSettled(); });
}
function iframe() {
  const frames = container.querySelectorAll<HTMLIFrameElement>("iframe[data-shared-shell-frame]");
  expect(frames).toHaveLength(1);
  return frames[0];
}
function latestInit() {
  const frame = iframe();
  const message = postToFrame.mock.calls.filter(([target, data]) => target === frame && data.type === "INIT").at(-1)?.[1];
  if (!message || message.type !== "INIT") throw new Error("The real host did not send INIT");
  return message;
}
async function childMessage(body: Record<string, unknown>, origin = LEGACY, source = iframe().contentWindow, generation = latestInit().frameGeneration) {
  const event = new MessageEvent("message", { origin, data: {
    protocol: SHARED_SHELL_PROTOCOL, frameGeneration: generation, ...body,
  } });
  Object.defineProperty(event, "source", { value: source });
  await act(async () => { window.dispatchEvent(event); });
}
async function admitFrame() {
  const frame = iframe();
  const navigation = replaceFrame.mock.calls.filter(([target]) => target === frame).at(-1)?.[1];
  expect(navigation).toContain("mmx_shell=1");
  await act(async () => { frame.dispatchEvent(new Event("load")); });
  const init = latestInit();
  expect(init.canonicalPath).toBe(INITIAL);
  await childMessage({
    type: "READY", href: LEGACY + INITIAL, title: "Retained Macro page", responseKind: "content",
    contextRevision: init.contextRevision, bridgeVersion: SHARED_SHELL_BRIDGE_VERSION,
    documentVersion: SHARED_SHELL_DOCUMENT_VERSION,
  });
  expect(frame.style.visibility).toBe("visible");
  return {
    frame, proxy: frame.contentWindow, generation: init.frameGeneration,
    history: JSON.stringify(window.history.state), length: window.history.length,
    replacements: replaceFrame.mock.calls.length,
  };
}
async function start(props: Partial<ComponentProps<typeof AppShell>> = {}) {
  await renderShell(props);
  return admitFrame();
}
function control(surface: Surface, kind: "theme" | "language") {
  const zh = document.documentElement.dataset.lang === "zh";
  const label = kind === "theme" ? (zh ? "浅色主题" : "Light theme") : (zh ? "中文界面" : "Chinese language");
  const scope = container.querySelector(surface);
  expect(scope, `Missing actual ${surface}`).not.toBeNull();
  const buttons = scope!.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(buttons, `Missing unique public ${kind} control in ${surface}`).toHaveLength(1);
  expect(buttons[0].type).toBe("button");
  expect(buttons[0].disabled).toBe(false);
  return buttons[0];
}
async function click(surface: Surface, kind: "theme" | "language") {
  const button = control(surface, kind);
  button.focus();
  await act(async () => { button.click(); });
  expect(document.activeElement).toBe(button);
}
function expectPresentation(theme: "dark" | "light", locale: "en" | "zh") {
  expect(document.documentElement.dataset.theme).toBe(theme);
  expect(document.documentElement.dataset.lang).toBe(locale);
  expect(document.documentElement.lang).toBe(locale === "zh" ? "zh-CN" : "en");
  for (const surface of [".topbar", ".mobilebar"] as const) {
    expect(control(surface, "theme").getAttribute("aria-pressed")).toBe(String(theme === "light"));
    expect(control(surface, "language").getAttribute("aria-pressed")).toBe(String(locale === "zh"));
  }
  const message = postToFrame.mock.calls.filter(([target, data]) => target === iframe() && (data.type === "CONTEXT" || data.type === "INIT")).at(-1);
  expect(message?.[1]).toMatchObject({ theme, locale, frameGeneration: latestInit().frameGeneration });
  expect(message?.[2]).toBe(LEGACY);
}
function expectPersistent(owned: Awaited<ReturnType<typeof start>>) {
  expect(iframe()).toBe(owned.frame);
  expect(iframe().contentWindow).toBe(owned.proxy);
  expect(latestInit().frameGeneration).toBe(owned.generation);
  expect(iframe().getAttribute("src")).toBe("about:blank");
  expect(iframe().style.visibility).toBe("visible");
  expect(container.querySelector("#shared-shell-content")?.getAttribute("aria-busy")).toBe("false");
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(INITIAL);
  expect(JSON.stringify(window.history.state)).toBe(owned.history);
  expect(window.history.length).toBe(owned.length);
  expect(replaceFrame).toHaveBeenCalledTimes(owned.replacements);
  expect(navigation.router.push).not.toHaveBeenCalled();
  expect(navigation.router.replace).not.toHaveBeenCalled();
}
function noAccountAction() {
  expect(edges.onboarding.open).not.toHaveBeenCalled();
  expect(edges.updateUser).not.toHaveBeenCalled();
}
const userWith = (id: string, user_metadata: Record<string, unknown>) => ({ data: { user: { id, user_metadata } }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.dataset.theme = "dark";
  document.documentElement.dataset.lang = "en";
  document.documentElement.lang = "en";
  __resetMarketPrefsStore();
  navigation.path = "/macro.html";
  navigation.params = new URLSearchParams("filter=a%20b&filter=a+b");
  window.history.replaceState({}, "", INITIAL);
  edges.getUser.mockResolvedValue({ data: { user: null }, error: null });
  edges.updateUser.mockResolvedValue({ error: null });
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    media, matches: false, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  childWindows = new WeakMap();
  vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockImplementation(function (this: HTMLIFrameElement) {
    let proxy = childWindows.get(this);
    if (!proxy) {
      const target = this;
      proxy = {
        location: { replace: (href: string) => replaceFrame(target, href) },
        postMessage: (message: ShellParentMessage, origin: string) => postToFrame(target, message, origin),
      } as unknown as Window;
      childWindows.set(this, proxy);
    }
    return proxy;
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // The real SettingsPanel's existing read-only membership request on open.
    if (String(input) === "/api/teams") {
      expect(init?.method ?? "GET").toBe("GET");
      return { ok: true, json: async () => ({ teams: [], truncated: false }) } as Response;
    }
    expect(String(input)).toBe("/api/shared-shell/status");
    expect(init?.cache).toBe("no-store");
    expect(init?.credentials).toBe("same-origin");
    return { ok: true, json: async () => healthyGate } as Response;
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  __resetMarketPrefsStore();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("public Shared Shell presentation", () => {
  it.each([".topbar", ".mobilebar"] as const)("real %s guest controls update both owners without navigation or signup", async surface => {
    const owned = await start();
    expectPresentation("dark", "en");
    const revision = latestInit().contextRevision;
    await click(surface, "theme");
    expectPresentation("light", "en");
    await click(surface, "language");
    expectPresentation("light", "zh");
    expect(localStorage.getItem("mmx.shell.theme")).toBe("light");
    expect(localStorage.getItem("mm.lang")).toBe("zh");
    const contexts = postToFrame.mock.calls.map(([, data]) => data).filter(data => data.type === "CONTEXT");
    expect(contexts.at(-1)?.contextRevision).toBeGreaterThan(revision);
    await click(surface, "theme");
    await click(surface, "language");
    expectPresentation("dark", "en");
    expectPersistent(owned);
    expect(edges.getUser).not.toHaveBeenCalled();
    noAccountAction();
  });

  it("restores guest choices on a fresh shell using the real document language bootstrap", async () => {
    await start();
    await click(".topbar", "theme");
    await click(".topbar", "language");
    await act(async () => { root.unmount(); });
    __resetMarketPrefsStore();
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.lang = "en";
    const layout = readFileSync(resolve(process.cwd(), "app/layout.tsx"), "utf8");
    const bootstrap = layout.match(/const LOCALE_INIT = `([\s\S]*?)`;/)?.[1];
    if (!bootstrap) throw new Error("The actual root language bootstrap must be reviewed if it changes");
    new Function(bootstrap)();
    root = createRoot(container);
    await start();
    expectPresentation("light", "zh");
    noAccountAction();
  });

  it("continues applying account Auto and explicit Settings metadata through the incumbent store", async () => {
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(12);
    edges.getUser.mockResolvedValue(userWith(A, { theme: "dark", theme_auto: "1", lang: "zh" }));
    const owned = await start({ userId: A, email: "person@example.test" });
    expectPresentation("light", "zh");
    expect(edges.getUser).toHaveBeenCalledTimes(1);
    noAccountAction();
    // These are the same account delivery/local application functions used by
    // SectionPreferences. Unlike the public controls, this explicit edit writes.
    await act(async () => { persistMetaPrefs({ theme: "dark", themeAuto: "0" }); });
    await act(async () => { applyLang("en"); persistLang("en"); });
    expectPresentation("dark", "en");
    expect(edges.updateUser).toHaveBeenCalled();
    const writes = edges.updateUser.mock.calls.length;
    await click(".mobilebar", "theme");
    await click(".mobilebar", "language");
    expectPresentation("light", "zh");
    expect(__marketPrefsSnapshot().metaPrefs).toMatchObject({ theme: "dark", themeAuto: "0", lang: "en" });
    expect(edges.updateUser).toHaveBeenCalledTimes(writes);
    expect(edges.onboarding.open).not.toHaveBeenCalled();
    expectPersistent(owned);
  });

  it("retains UUID ownership, ignores an outgoing account read and keeps a public override local", async () => {
    let resolveA!: (value: ReturnType<typeof userWith>) => void;
    edges.getUser.mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve; }));
    await renderShell({ userId: A, email: "shared@example.test" });
    const outgoing = await admitFrame();
    edges.getUser.mockResolvedValue(userWith(B, { theme: "dark", theme_auto: "0", lang: "zh" }));
    await renderShell({ userId: B, email: "shared@example.test" });
    const current = await admitFrame();
    expect(current.frame).not.toBe(outgoing.frame);
    expect(current.proxy).not.toBe(outgoing.proxy);
    expect(current.generation).not.toBe(outgoing.generation);
    expectPresentation("dark", "zh");
    await click(".topbar", "theme");
    await act(async () => { resolveA(userWith(A, { theme: "dark", theme_auto: "0", lang: "en" })); });
    expectPresentation("light", "zh");
    expect(__marketPrefsSnapshot().owner).toBe(`account:${B}`);
    expect(__marketPrefsSnapshot().metaPrefs).toMatchObject({ theme: "dark", lang: "zh" });
    await renderShell({ userId: B, email: "changed@example.test" });
    expect(edges.getUser).toHaveBeenCalledTimes(2);
    expectPersistent(current);
    noAccountAction();
    await renderShell();
    const guest = await admitFrame();
    expect(guest.frame).not.toBe(current.frame);
    expect(__marketPrefsSnapshot().owner).toBe("guest");
    expect(__marketPrefsSnapshot().metaPrefs).toEqual({});
    expectPresentation("light", "zh");
    noAccountAction();
  });

  it("keeps child presentation requests on the same owner and rejects unqualified sources", async () => {
    const owned = await start();
    await childMessage({ type: "CONTEXT_REQUEST", theme: "light", locale: "zh" }, "https://untrusted.example");
    await childMessage({ type: "CONTEXT_REQUEST", theme: "light", locale: "zh" }, LEGACY, window);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.lang).toBe("en");
    await childMessage({ type: "CONTEXT_REQUEST", theme: "light", locale: "zh" });
    expectPresentation("light", "zh");
    expectPersistent(owned);
    noAccountAction();
  });

  it("still applies public choices when browser storage is blocked", async () => {
    const owned = await start();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("fixture: storage denied"); });
    await click(".mobilebar", "theme");
    await click(".mobilebar", "language");
    expectPresentation("light", "zh");
    expectPersistent(owned);
    noAccountAction();
  });

  it("adds no presentation controls or presentation owner in the ordinary shell", async () => {
    await renderShell({ sharedShell: false });
    expect(container.querySelector(".shared-shell-presentation")).toBeNull();
    expect(container.querySelector("iframe[data-shared-shell-frame]")).toBeNull();
    expect(document.documentElement.dataset.mmxSharedShell).toBeUndefined();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(edges.getUser).not.toHaveBeenCalled();
    noAccountAction();
  });
});

async function openPreferences() {
  const avatar = container.querySelector<HTMLButtonElement>(".topbar button.avatar");
  expect(avatar, "The actual SettingsButton must open the actual panel").not.toBeNull();
  await act(async () => { avatar!.click(); });
  await act(async () => { await vi.dynamicImportSettled(); });
  const panels = document.querySelectorAll<HTMLElement>(".acs-overlay.open .acs-card[role=dialog]");
  expect(panels).toHaveLength(1);
  const tab = Array.from(panels[0].querySelectorAll<HTMLButtonElement>("button[role=tab]"))
    .filter(button => button.textContent?.trim() === tPlain("acsPrefs"));
  expect(tab, "Use the real Preferences rail tab").toHaveLength(1);
  await act(async () => { tab[0].click(); });
  expect(tab[0].getAttribute("aria-selected")).toBe("true");
  expect(panels[0].getAttribute("aria-label")).toBe(tPlain("acsPrefs"));
  return panels[0];
}
function settingsGroup(panel: HTMLElement, key: string) {
  const groups = Array.from(panel.querySelectorAll<HTMLElement>('[role="group"]'))
    .filter(group => group.getAttribute("aria-label") === tPlain(key));
  expect(groups, `Missing actual Settings group ${key}`).toHaveLength(1);
  return groups[0];
}
function settingsTheme(panel: HTMLElement, choice: "light" | "auto" | "dark") {
  const key = choice === "light" ? "acsThemeLight" : choice === "dark" ? "acsThemeDark" : "acsThemeAuto";
  const buttons = Array.from(settingsGroup(panel, "acsAppearance").querySelectorAll<HTMLButtonElement>("button"))
    .filter(button => button.textContent?.trim() === tPlain(key));
  expect(buttons).toHaveLength(1);
  return buttons[0];
}

describe("explicit Settings presentation intent after a public override", () => {
  it.each([
    { choice: "dark" as const, hour: 12, expected: "dark" as const },
    { choice: "light" as const, hour: 12, expected: "light" as const },
    { choice: "auto" as const, hour: 6, expected: "dark" as const },
    { choice: "auto" as const, hour: 7, expected: "light" as const },
    { choice: "auto" as const, hour: 18, expected: "light" as const },
    { choice: "auto" as const, hour: 19, expected: "dark" as const },
  ])("reapplies the same saved $choice choice at hour $hour through the real Settings UI", async ({ choice, hour, expected }) => {
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(hour);
    const saved = { theme: choice === "auto" ? "dark" : choice, theme_auto: choice === "auto" ? "1" : "0", lang: "en" };
    edges.getUser.mockResolvedValue(userWith(A, saved));
    const owned = await start({ userId: A, email: "person@example.test" });
    expectPresentation(expected, "en");
    await click(".topbar", "theme");
    const override = expected === "dark" ? "light" : "dark";
    expectPresentation(override, "en");
    noAccountAction();
    const panel = await openPreferences();
    // Opening the actual panel / reading its profile is not a theme intent.
    expectPresentation(override, "en");
    const before = { ...__marketPrefsSnapshot().metaPrefs };
    const button = settingsTheme(panel, choice);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await act(async () => { button.click(); });
    // This unchanged metadata pair is the original missing-effect trigger.
    expect(__marketPrefsSnapshot().metaPrefs).toEqual(before);
    expectPresentation(expected, "en");
    expect(edges.updateUser).toHaveBeenCalled();
    expect(edges.onboarding.open).not.toHaveBeenCalled();
    // Account application retains the existing device-cache policy; it does
    // not turn the saved account choice into a new public/guest local override.
    expect(localStorage.getItem("mmx.shell.theme")).toBe(override);
    expectPersistent(owned);
  });

  it.each(["language", "trade", "follow"] as const)("does not reapply a saved theme on a real Settings %s edit", async item => {
    edges.getUser.mockResolvedValue(userWith(A, { theme: "dark", theme_auto: "0", lang: "en", trade_types: [] }));
    const owned = await start({ userId: A, email: "person@example.test" });
    await click(".topbar", "theme");
    expectPresentation("light", "en");
    noAccountAction();
    const panel = await openPreferences();
    expectPresentation("light", "en");
    if (item === "language") {
      const chinese = Array.from(settingsGroup(panel, "language").querySelectorAll<HTMLButtonElement>("button"))
        .filter(button => button.textContent?.trim() === "中文");
      expect(chinese).toHaveLength(1);
      await act(async () => { chinese[0].click(); });
      expect(__marketPrefsSnapshot().metaPrefs.lang).toBe("zh");
      expectPresentation("light", "zh");
    } else {
      const group = settingsGroup(panel, item === "trade" ? "acsTrades" : "acsMarkets");
      const chip = group.querySelector<HTMLButtonElement>("button[aria-pressed]");
      expect(chip).not.toBeNull();
      const before = chip!.getAttribute("aria-pressed");
      const follows = [...__marketPrefsSnapshot().prefs.followed];
      await act(async () => { chip!.click(); });
      expect(chip!.getAttribute("aria-pressed")).toBe(before === "true" ? "false" : "true");
      if (item === "trade") {
        // Let the incumbent 500ms owner-fenced trade delivery actually execute.
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 510)); });
        expect(edges.updateUser.mock.calls.some(([request]) => Array.isArray(request.data.trade_types))).toBe(true);
      } else {
        expect(__marketPrefsSnapshot().prefs.followed).not.toEqual(follows);
      }
      expectPresentation("light", "en");
    }
    expect(__marketPrefsSnapshot().metaPrefs).toMatchObject({ theme: "dark", themeAuto: "0" });
    expect(edges.updateUser).toHaveBeenCalled();
    expect(edges.onboarding.open).not.toHaveBeenCalled();
    expect(localStorage.getItem("mmx.shell.theme")).toBe("light");
    expectPersistent(owned);
  });

  it("keeps ordinary Settings functional outside a Shared Shell presentation provider", async () => {
    edges.getUser.mockResolvedValue(userWith(A, { theme: "dark", theme_auto: "0", lang: "en" }));
    await renderShell({ sharedShell: false, userId: A, email: "person@example.test" });
    const panel = await openPreferences();
    await act(async () => { settingsTheme(panel, "light").click(); });
    expect(__marketPrefsSnapshot().metaPrefs).toMatchObject({ theme: "light", themeAuto: "0" });
    expect(edges.updateUser).toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.mmxSharedShell).toBeUndefined();
    expect(container.querySelector(".shared-shell-presentation")).toBeNull();
    expect(container.querySelector("iframe[data-shared-shell-frame]")).toBeNull();
    expect(edges.onboarding.open).not.toHaveBeenCalled();
  });
});