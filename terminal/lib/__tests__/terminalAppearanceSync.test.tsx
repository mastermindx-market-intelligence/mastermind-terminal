// @vitest-environment jsdom
// Removing the real provider's application or the controls' local application
// must fail these consumer-visible tests. Only the remote auth edge is doubled.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/components/settings/SettingsProvider";
import SectionPreferences from "@/components/settings/SectionPreferences";
import { LangProvider, useT } from "@/lib/i18n";
import { accountIdentity, GUEST_IDENTITY, type AccountIdentity } from "@/lib/accountIdentity";
import { applyTerminalAppearance } from "@/lib/terminalAppearance";
import { __loadOwner, __resetMarketPrefsStore } from "@/lib/useMarketPrefs";

type Result = { data: { user: { id: string; user_metadata: Record<string, unknown> } | null }; error: unknown };
let read: () => Promise<Result>;
let reads = 0;
const writes: Record<string, unknown>[] = [];
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: {
    getUser: () => { reads++; return read(); },
    updateUser: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { error: null }; },
  } }),
}));
// The asynchronously loaded sheet is closed in these tests. Its actual section
// is mounted below, without replacing the provider or preference store.
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const A = accountIdentity("appearance-a", "same@example.test");
const B = accountIdentity("appearance-b", "same@example.test");
const answer = (id: string, meta: Record<string, unknown>): Result => ({
  data: { user: { id, user_metadata: meta } }, error: null,
});
function deferred() {
  let resolve!: (result: Result) => void;
  const promise = new Promise<Result>((r) => { resolve = r; });
  return { promise, resolve };
}
function Controls({ identity }: { identity: AccountIdentity }) {
  const t = useT();
  return <SectionPreferences identity={identity} t={t} lang="en" email="same@example.test"
    user={null} onClose={() => {}} onPatchMeta={() => {}} onRefreshUser={async () => {}} />;
}
let root: Root;
let host: HTMLDivElement;
async function mount(identity: AccountIdentity, controls = false) {
  await act(async () => {
    root.render(<LangProvider><SettingsProvider identity={identity}>
      {controls ? <Controls identity={identity} /> : <div>Terminal</div>}
    </SettingsProvider></LangProvider>);
  });
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  expect(button, label).toBeDefined();
  await act(async () => { button!.click(); });
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  __resetMarketPrefsStore(); localStorage.clear();
  document.documentElement.dataset.theme = "dark";
  document.documentElement.dataset.lang = "en";
  reads = 0; writes.length = 0;
  read = async () => answer("appearance-a", {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove(); __resetMarketPrefsStore(); vi.useRealTimers();
});

describe("canonical appearance through the real provider and controls", () => {
  it("device intent arms same-route Auto even when resolved mode stays light, replaces timers and unsubscribes", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const expectTimers = (count: number) => {
      vi.advanceTimersByTime(1); // fake clock nests jsdom zero-delay storage tasks one tick later
      expect(vi.getTimerCount()).toBe(count);
    };
    vi.setSystemTime(new Date(2026, 7, 1, 18, 59, 59));
    await mount(GUEST_IDENTITY);
    vi.advanceTimersByTime(0); // drain React async-act bookkeeping; measure only the device clock
    act(() => { applyTerminalAppearance("light"); });
    expectTimers(0);
    act(() => { applyTerminalAppearance("auto"); });
    expect(document.documentElement.dataset.theme).toBe("light");
    expectTimers(1);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expectTimers(1);
    act(() => { applyTerminalAppearance("auto"); applyTerminalAppearance("auto"); });
    expectTimers(1);
    act(() => { applyTerminalAppearance("light"); });
    expectTimers(0);
    act(() => { applyTerminalAppearance("auto"); root.render(null); });
    expectTimers(0);
    act(() => { applyTerminalAppearance("auto"); });
    expectTimers(0);
    expect(reads).toBe(0); expect(writes).toEqual([]);
  });

  it("same-route device Auto intent still ages and cancels when storage is blocked", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const expectTimers = (count: number) => {
      vi.advanceTimersByTime(1); // fake clock nests jsdom zero-delay storage tasks one tick later
      expect(vi.getTimerCount()).toBe(count);
    };
    vi.setSystemTime(new Date(2026, 7, 1, 18, 59, 59));
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      await mount(GUEST_IDENTITY);
    vi.advanceTimersByTime(0); // drain React async-act bookkeeping; measure only the device clock
      act(() => { applyTerminalAppearance("auto"); });
      expect(document.documentElement.dataset.theme).toBe("light");
      act(() => { vi.advanceTimersByTime(1000); });
      expect(document.documentElement.dataset.theme).toBe("dark");
      expectTimers(1);
      act(() => { applyTerminalAppearance("light"); });
      expect(document.documentElement.dataset.theme).toBe("light");
      expectTimers(0);
      expect(reads).toBe(0); expect(writes).toEqual([]);
    } finally { get.mockRestore(); set.mockRestore(); }
  });

  it("volatile device intent outranks a readable stale cache when only writes fail", async () => {
    localStorage.setItem("theme", "dark");
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 7, 1, 18, 59, 59));
    await mount(GUEST_IDENTITY);
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    try {
      act(() => { applyTerminalAppearance("light"); });
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(localStorage.getItem("theme")).toBe("dark");
      act(() => { applyTerminalAppearance("auto"); });
      expect(document.documentElement.dataset.theme).toBe("light");
      act(() => { vi.advanceTimersByTime(1000); });
      expect(document.documentElement.dataset.theme).toBe("dark");
      vi.advanceTimersByTime(1);
      expect(vi.getTimerCount()).toBe(1);
      act(() => { applyTerminalAppearance("light"); });
      expect(document.documentElement.dataset.theme).toBe("light");
      vi.advanceTimersByTime(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(localStorage.getItem("theme")).toBe("dark");
      expect(localStorage.getItem("themeAuto")).toBeNull();
      expect(reads).toBe(0); expect(writes).toEqual([]);
    } finally { set.mockRestore(); }
  });

  it("applies the current account's saved light preference without opening Settings", async () => {
    read = async () => answer("appearance-a", { theme: "light", theme_auto: "0" });
    await mount(A);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(reads).toBe(1); // incumbent hydration, no second appearance auth reader
    expect(writes).toEqual([]);
  });

  it("an actual light click survives an older hydration answer and uses the incumbent delivery", async () => {
    const pending = deferred(); read = () => pending.promise;
    await mount(A, true);
    await click("Light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
    await act(async () => { pending.resolve(answer("appearance-a", { theme: "dark", theme_auto: "0" })); });
    expect(document.documentElement.dataset.theme).toBe("light");
    const light = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Light");
    expect(light?.getAttribute("aria-pressed")).toBe("true");
    expect(reads).toBe(1);
    expect(writes.some((w) => w.theme === "light")).toBe(true);
    expect(writes.every((w) => !("appearance" in w))).toBe(true);
  });

  it("does not apply a late prior account at the same email after switching UUID", async () => {
    const old = deferred(), next = deferred();
    read = () => old.promise; await mount(A);
    read = () => next.promise; await mount(B);
    await act(async () => { next.resolve(answer("appearance-b", { theme: "light", theme_auto: "0" })); });
    expect(document.documentElement.dataset.theme).toBe("light");
    await act(async () => { old.resolve(answer("appearance-a", { theme: "dark", theme_auto: "0" })); });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(writes).toEqual([]);
  });

  it("rejects mismatched store snapshots and stale controls instead of writing another owner", async () => {
    read = async () => answer("appearance-a", { theme: "dark", theme_auto: "0" });
    await mount(A, true);
    read = async () => answer("appearance-b", { theme: "light", theme_auto: "0" });
    await act(async () => { __loadOwner("account:appearance-b"); });
    expect(document.documentElement.dataset.theme).toBe("dark");
    await click("Light");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(writes).toEqual([]);
  });

  it("preserves the effective device display on signout and does not subscribe a guest account reader", async () => {
    read = async () => answer("appearance-a", { theme: "light", theme_auto: "0" });
    await mount(A); await mount(GUEST_IDENTITY);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(reads).toBe(1);
    expect(writes).toEqual([]);
  });

  it("the device auto choice keeps following local time after signout without a guest account reader", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 1, 18, 59, 59));
    read = async () => answer("appearance-a", { theme: "dark", theme_auto: "1" });
    await mount(A); await mount(GUEST_IDENTITY);
    expect(document.documentElement.dataset.theme).toBe("light");
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(reads).toBe(1); expect(writes).toEqual([]);
  });

  it("a new explicit choice cancels the prior auto boundary and visibility resume respects it", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 1, 18, 59, 59));
    read = async () => answer("appearance-a", { theme: "dark", theme_auto: "1" });
    await mount(A, true); await click("Light");
    await act(async () => { vi.advanceTimersByTime(1000); document.dispatchEvent(new Event("visibilitychange")); });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("themeAuto")).toBeNull();
  });

  it("an unmounted provider cancels auto timer and resume listeners", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 1, 18, 59, 59));
    read = async () => answer("appearance-a", { theme: "dark", theme_auto: "1" });
    await mount(A); await act(async () => { root.render(null); });
    await act(async () => { vi.advanceTimersByTime(1000); window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("recomputes auto after local-time boundary and focus resume without another auth read", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 1, 18, 59, 59));
    read = async () => answer("appearance-a", { theme: "dark", theme_auto: "1" });
    await mount(A);
    expect(document.documentElement.dataset.theme).toBe("light");
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(document.documentElement.dataset.theme).toBe("dark");
    vi.setSystemTime(new Date(2026, 7, 2, 8));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(reads).toBe(1);
  });
});
