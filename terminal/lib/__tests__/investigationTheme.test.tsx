// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { AccountIdentity } from "@/lib/accountIdentity";
import type { MetaPrefs } from "@/lib/accountPrefs";

let identity: AccountIdentity;
let prefs: { owner: string; ready: boolean; metaPrefs: MetaPrefs; appearanceRevision: number };
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => identity }));
vi.mock("@/lib/useMarketPrefs", () => ({ useAccountPrefs: () => prefs }));
import { useInvestigationTheme } from "@/lib/useInvestigationTheme";

const A = "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22";
const B = "0b6d1f57-3c84-4a11-8e29-6d40cc1b7f93";
let renders: string[];
let clock: ReturnType<typeof vi.spyOn>;
function Surface({ owner = A, ended = false }: { owner?: string; ended?: boolean }) {
  const theme = useInvestigationTheme(owner, ended);
  renders.push(theme);
  return <main className="main2 ws-shell" data-investigation-theme={theme} />;
}
beforeEach(() => {
  identity = { kind: "account", userId: A, email: "old@example.test" };
  prefs = { owner: `account:${A}`, ready: true, metaPrefs: { theme: "light" }, appearanceRevision: 0 };
  renders = [];
  clock = vi.spyOn(Date.prototype, "getHours").mockReturnValue(12);
  document.documentElement.setAttribute("data-theme", "dark");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const theme = (container: HTMLElement) => container.querySelector("main")?.getAttribute("data-investigation-theme");

describe("Saved research local appearance", () => {
  it("SSR and first client paint stay dark without reading the server clock", () => {
    expect(renderToString(<Surface />)).toContain('data-investigation-theme="dark"');
    expect(clock).not.toHaveBeenCalled();
    renders = [];
    const view = render(<Surface />);
    expect(renders[0]).toBe("dark");
    expect(theme(view.container)).toBe("light");
  });
  it.each(["dark", "light"] as const)("uses the explicit %s choice", (value) => {
    prefs.metaPrefs = { theme: value, themeAuto: "0" };
    expect(theme(render(<Surface />).container)).toBe(value);
  });
  it.each([{}, { theme: "bad" }, { theme: "light", themeAuto: "bad" }])("defaults absent or malformed values dark: %j", (value) => {
    prefs.metaPrefs = value as MetaPrefs;
    expect(theme(render(<Surface />).container)).toBe("dark");
  });
  it("rejects not-ready and delayed outgoing-owner snapshots before effects", () => {
    prefs.ready = false;
    const view = render(<Surface />);
    expect(renders.every((value) => value === "dark")).toBe(true);
    prefs.ready = true;
    view.rerender(<Surface />);
    expect(theme(view.container)).toBe("light");
    identity = { kind: "account", userId: B, email: "b@example.test" };
    renders = [];
    view.rerender(<Surface owner={B} />);
    expect(renders.every((value) => value === "dark")).toBe(true);
    // Even ready=true is insufficient if the owner-bound snapshot still belongs to A.
    view.rerender(<Surface owner={B} />);
    expect(theme(view.container)).toBe("dark");
    prefs = { ...prefs, owner: `account:${B}`, metaPrefs: { theme: "dark" } };
    view.rerender(<Surface owner={B} />);
    expect(theme(view.container)).toBe("dark");
  });
  it("rejects a raw Workspace UUID mismatch even when store and shell agree", () => {
    expect(theme(render(<Surface owner={B} />).container)).toBe("dark");
    expect(clock).not.toHaveBeenCalled();
  });
  it("does not resample on same UUID email changes", () => {
    prefs.metaPrefs = { themeAuto: "1" };
    const view = render(<Surface />);
    const calls = clock.mock.calls.length;
    clock.mockReturnValue(22);
    identity = { kind: "account", userId: A, email: "new@example.test" };
    view.rerender(<Surface />);
    expect(theme(view.container)).toBe("light");
    expect(clock).toHaveBeenCalledTimes(calls);
  });
  it("keeps guest and local-preview dark without fabricating readiness", () => {
    identity = { kind: "guest" };
    prefs.owner = "guest";
    const view = render(<Surface owner="local-preview" />);
    expect(theme(view.container)).toBe("dark");
    identity = { kind: "account", userId: A, email: "a@example.test" };
    prefs.owner = `account:${A}`;
    view.rerender(<Surface owner="local-preview" />);
    expect(theme(view.container)).toBe("dark");
    expect(clock).not.toHaveBeenCalled();
  });
  it("auth-ended falls dark synchronously and cannot inherit account light", () => {
    const view = render(<Surface />);
    renders = [];
    view.rerender(<Surface ended />);
    expect(renders.every((value) => value === "dark")).toBe(true);
  });
  it.each([[6,59,"dark"],[7,0,"light"],[18,59,"light"],[19,0,"dark"]] as const)("Auto uses local %i:%i and overrides cached theme", (hour, minute, wanted) => {
    clock.mockReturnValue(hour);
    const minutes = vi.spyOn(Date.prototype, "getMinutes").mockReturnValue(minute);
    prefs.metaPrefs = { themeAuto: "1", theme: wanted === "light" ? "dark" : "light" };
    expect(theme(render(<Surface />).container)).toBe(wanted);
    // Hour boundaries intentionally need no UTC/timezone conversion or minute rounding.
    expect(minutes).not.toHaveBeenCalled();
  });
  it("repeated Auto resamples; unrelated language/object/sync publications do not", () => {
    prefs.metaPrefs = { themeAuto: "1", lang: "en" };
    const view = render(<Surface />);
    expect(theme(view.container)).toBe("light");
    const calls = clock.mock.calls.length;
    clock.mockReturnValue(22);
    prefs = { ...prefs, metaPrefs: { ...prefs.metaPrefs, lang: "zh" } };
    view.rerender(<Surface />);
    prefs = { ...prefs, metaPrefs: { ...prefs.metaPrefs } };
    view.rerender(<Surface />);
    expect(theme(view.container)).toBe("light");
    expect(clock).toHaveBeenCalledTimes(calls);
    prefs = { ...prefs, appearanceRevision: prefs.appearanceRevision + 1 };
    view.rerender(<Surface />);
    expect(theme(view.container)).toBe("dark");
    expect(clock).toHaveBeenCalledTimes(calls + 1);
  });
  it("hydrated appearance values and re-entering ready each resample Auto", () => {
    const view = render(<Surface />);
    clock.mockReturnValue(23);
    prefs.metaPrefs = { themeAuto: "1" };
    view.rerender(<Surface />);
    expect(theme(view.container)).toBe("dark");
    prefs.ready = false;
    view.rerender(<Surface />);
    clock.mockReturnValue(8);
    prefs.ready = true;
    view.rerender(<Surface />);
    expect(theme(view.container)).toBe("light");
  });
  it("samples again on mount and leaves HTML, sibling chrome, storage and timers untouched", () => {
    prefs.metaPrefs = { themeAuto: "1" };
    const html = document.documentElement.outerHTML;
    const write = vi.spyOn(Storage.prototype, "setItem");
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");
    const view = render(<><header data-testid="chrome" /><Surface /></>);
    expect(theme(view.container)).toBe("light");
    expect(view.getByTestId("chrome").attributes).toHaveLength(1);
    view.unmount();
    clock.mockReturnValue(23);
    const next = render(<Surface />);
    expect(theme(next.container)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(html).toContain('data-theme="dark"');
    expect(write).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
  });
});
