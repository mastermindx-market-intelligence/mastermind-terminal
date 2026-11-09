// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { accountIdentity, type AccountIdentity } from "../accountIdentity";
import { LangProvider } from "../i18n";
import { SharedShellPresentation, useOptionalSharedShellPresentation } from "@/components/chrome/shared-shell/SharedShellPresentation";

const prefs = vi.hoisted(() => ({ values: {} as Record<string, { theme?: string; themeAuto?: string }>, identities: [] as unknown[] }));
vi.mock("@/lib/useMarketPrefs", () => ({ useAccountPrefs: (identity: AccountIdentity) => {
  prefs.identities.push(identity);
  return { metaPrefs: identity.kind === "account" ? prefs.values[identity.userId] ?? {} : {} };
} }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A = accountIdentity("owner-a", "a@example.test"), B = accountIdentity("owner-b", "b@example.test");
let root: Root, host: HTMLDivElement, systemDark: boolean;
let listeners: Set<() => void>;
function Controls() {
  const presentation = useOptionalSharedShellPresentation();
  return <>{(["light", "auto", "dark"] as const).map(choice => <button key={choice} onClick={() => presentation?.applyThemeChoice(choice)}>{choice}</button>)}</>;
}
async function render(identity = A, appearanceOnly = true, children: ReactNode = <Controls />) {
  await act(async () => { root.render(<LangProvider><SharedShellPresentation enabled identity={identity} appearanceOnly={appearanceOnly}>{children}</SharedShellPresentation></LangProvider>); });
}
async function click(choice: string) { await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === choice)!.click(); }); }
beforeEach(() => {
  localStorage.clear(); prefs.values = { "owner-a": { theme: "dark" }, "owner-b": { theme: "dark" } }; prefs.identities = [];
  document.documentElement.dataset.theme = "dark"; delete document.documentElement.dataset.mmxSharedShell; delete document.documentElement.dataset.terminalAppearance;
  systemDark = false; listeners = new Set();
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, get matches() { return systemDark; },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Terminal adopts the incumbent account presentation owner", () => {
  it("applies explicit Light for the same identity without Shared Shell marker or bridge", async () => {
    await render(); await click("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.terminalAppearance).toBe("1");
    expect(document.documentElement.hasAttribute("data-mmx-shared-shell")).toBe(false);
    expect(prefs.identities.every(identity => identity === A)).toBe(true);
  });
  it("honors saved Light and reapplies identical explicit intent after an external visual change", async () => {
    prefs.values["owner-a"] = { theme: "light" }; await render();
    expect(document.documentElement.dataset.theme).toBe("light");
    document.documentElement.dataset.theme = "dark";
    await click("light"); expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("reuses Auto media subscription and explicit choices stop Auto following", async () => {
    await render(); await click("auto"); expect(document.documentElement.dataset.theme).toBe("light");
    await act(async () => { systemDark = true; listeners.forEach(fn => fn()); });
    expect(document.documentElement.dataset.theme).toBe("dark");
    await click("light");
    await act(async () => { systemDark = false; listeners.forEach(fn => fn()); systemDark = true; listeners.forEach(fn => fn()); });
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("switches account preference authority without carrying the old account theme", async () => {
    prefs.values["owner-a"] = { theme: "light" }; await render(A);
    expect(document.documentElement.dataset.theme).toBe("light");
    await render(B); expect(document.documentElement.dataset.theme).toBe("dark");
    expect(prefs.identities.at(-1)).toBe(B);
  });
  it("does not create a second owner or subscription inside an existing owner", async () => {
    await render(A, false, <SharedShellPresentation enabled identity={A} appearanceOnly><Controls /></SharedShellPresentation>);
    expect(listeners.size).toBe(1); expect(document.documentElement.dataset.mmxSharedShell).toBe("1");
    expect(document.documentElement.hasAttribute("data-terminal-appearance")).toBe(false);
    await click("light"); expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("chart cleanup removes only its marker and subscription", async () => {
    await render(); await click("light");
    await act(async () => root.render(<p>next route</p>));
    expect(document.documentElement.hasAttribute("data-terminal-appearance")).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light"); expect(listeners.size).toBe(0);
  });
  it("retains the existing standalone Shared Shell light-to-dark cleanup", async () => {
    prefs.values["owner-a"] = { theme: "light" }; await render(A, false);
    expect(document.documentElement.dataset.theme).toBe("light");
    await act(async () => root.render(<p>replacement/error boundary</p>));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.hasAttribute("data-mmx-shared-shell")).toBe(false); expect(listeners.size).toBe(0);
  });
});
