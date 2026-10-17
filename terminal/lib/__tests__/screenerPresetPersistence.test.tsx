// @vitest-environment jsdom
// These regressions mount the real view and fault only the device storage boundary.
// Restoring optimistic Save/Delete or treating an unread baseline as [] breaks them.
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScreenerView from "@/components/ScreenerView";

const locale = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/i18n", () => ({
  useLang: () => locale,
  useT: () => (key: string) => (({
    scr2Save: ["+ Save", "+ 保存"], scr2PresetName: ["Preset name…", "预设名称…"],
    scr2DeletePreset: ["Delete preset", "删除预设"], scr2Retry: ["Retry", "重试"],
  } as Record<string, [string, string]>)[key]?.[locale.lang === "zh" ? 1 : 0] ?? key),
}));
vi.mock("@/lib/useMarketPrefs", () => ({ useMarketPrefs: () => ({ prefs: { enabled: [] }, ready: false }) }));
vi.mock("@/lib/dataCache", () => ({ getJSONResult: async () => ({ status: "data", data: { symbols: {} } }), invalidate: vi.fn() }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: vi.fn() }));
vi.mock("@/lib/signalVerdict", () => ({ verdictIsStale: () => false }));
vi.mock("@/lib/flowClientCache", () => ({ flowGet: async () => null }));
vi.mock("@/lib/mscGlance", () => ({ parseGlanceIndex: () => null, REGIME_COLORS: {}, REGIME_RANK: {} }));
vi.mock("@/components/gexdesk/gexStrings", () => ({ makeGexT: () => (key: string) => key }));
vi.mock("@/lib/plainLabels", () => ({ notClassified: () => "", verdictLabel: (v: string) => v }));
vi.mock("@/components/AssetLogo", () => ({ default: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const KEY = "mm.scrPresets";
const defaults = { market: "all", asset: "all", sector: "all", signal: "any", uptrend: false, liq: 0, mcap: 0, w52: "any", move: "any", unpriced: false };
const preset = (name: string, f = {}) => ({ id: name, name, f: { ...defaults, ...f } });
let host: HTMLDivElement;
let root: Root | null;
let readDenied: boolean;
let writeDenied: boolean;
let writes: string[];
let nativeGet: typeof Storage.prototype.getItem;
let nativeSet: typeof Storage.prototype.setItem;

beforeEach(() => {
  locale.lang = "en";
  localStorage.clear();
  readDenied = false;
  writeDenied = false;
  writes = [];
  nativeGet = Storage.prototype.getItem;
  nativeSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
    if (key === KEY && readDenied) throw new DOMException("blocked", "SecurityError");
    return nativeGet.call(this, key);
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === KEY) {
      writes.push(value);
      if (writeDenied) throw new DOMException("full", "QuotaExceededError");
    }
    return nativeSet.call(this, key, value);
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const raw = () => nativeGet.call(localStorage, KEY);
const seed = (items: ReturnType<typeof preset>[]) => nativeSet.call(localStorage, KEY, JSON.stringify({ v: 1, items }));
const names = () => Array.from(host.querySelectorAll(".scr2-preset-wrap .fin-tab")).map(el => el.textContent);
const alert = () => host.querySelector('[role="alert"]');
const button = (text: string) => {
  const el = Array.from(host.querySelectorAll("button")).find(el => el.textContent === text);
  expect(el, `button ${text}`).toBeTruthy();
  return el!;
};
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const key = (el: Element, value: string) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })); });
const input = () => host.querySelector<HTMLInputElement>(".scr2-preset-name")!;
const type = (value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
  input().dispatchEvent(new Event("input", { bubbles: true }));
});
const changeFilter = (value: string) => act(() => {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="scr2Move"]')!;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
const beginSave = (name: string) => { click(button(locale.lang === "zh" ? "+ 保存" : "+ Save")); type(name); };
const save = (name: string) => { beginSave(name); key(input(), "Enter"); };
const remove = (name: string) => click(host.querySelector(`[aria-label="${locale.lang === "zh" ? "删除预设" : "Delete preset"}: ${name}"]`)!);
async function mount() {
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<StrictMode><ScreenerView identity={{ kind: "guest" }} /></StrictMode>); });
}
async function remount() { act(() => root!.unmount()); host.remove(); root = null; await mount(); }

describe("Screener device-local preset acknowledgements", () => {
  it("keeps A and B's draft on denied Save, then retries exactly once and survives remount", async () => {
    seed([preset("A")]); const original = raw(); await mount(); writeDenied = true;
    save("B");
    expect(raw()).toBe(original); expect(names()).toEqual(["A"]);
    expect(input()?.value).toBe("B"); expect(alert()).not.toBeNull(); expect(writes).toHaveLength(1);
    writeDenied = false; click(button("Retry"));
    expect(writes).toHaveLength(2); expect(names()).toEqual(["A", "B"]); expect(alert()).toBeNull();
    await remount(); expect(names()).toEqual(["A", "B"]); expect(writes).toHaveLength(2);
  });

  it("keeps a rejected Delete's list, highlight and filters, and retries once without resetting filters", async () => {
    seed([preset("A", { move: "up3" })]); const original = raw(); await mount(); click(button("A"));
    writeDenied = true; remove("A");
    expect(raw()).toBe(original); expect(names()).toEqual(["A"]); expect(button("A").classList.contains("on")).toBe(true);
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="scr2Move"]')!.value).toBe("up3");
    expect(alert()).not.toBeNull(); expect(writes).toHaveLength(1);
    writeDenied = false; click(button("Retry"));
    expect(writes).toHaveLength(2); expect(names()).toEqual([]);
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="scr2Move"]')!.value).toBe("up3");
    await remount(); expect(names()).toEqual([]); expect(writes).toHaveLength(2);
  });

  it("never writes an unread baseline, even when writes work and StrictMode repeats hydration", async () => {
    seed([preset("A")]); const original = raw(); readDenied = true; await mount(); save("B");
    expect(writes).toHaveLength(0); expect(raw()).toBe(original); expect(input()?.value).toBe("B");
    click(button("Retry")); expect(writes).toHaveLength(0); expect(raw()).toBe(original);
    readDenied = false; click(button("Retry"));
    expect(writes).toHaveLength(1); expect(names()).toEqual(["A", "B"]);
    await remount(); expect(names()).toEqual(["A", "B"]); expect(writes).toHaveLength(1);
  });

  it.each(["{", "", '{"v":2,"items":[]}', '{"v":1,"items":[null]}', '{"v":1,"items":[{"id":"A","name":"A","f":[]}]}', '{"v":1,"items":[{"id":"A","name":"A","f":{"move":"unknown"}}]}'])
  ("preserves malformed/unsupported bytes %s through Save and manual retry", async original => {
    nativeSet.call(localStorage, KEY, original); await mount(); save("B"); click(button("Retry"));
    expect(raw()).toBe(original); expect(writes).toHaveLength(0); expect(input()?.value).toBe("B"); expect(alert()).not.toBeNull();
    seed([preset("A")]); click(button("Retry")); expect(names()).toEqual(["A", "B"]); expect(writes).toHaveLength(1);
  });

  it("treats a genuinely absent key as an acknowledged empty list", async () => {
    await mount(); save("A"); expect(names()).toEqual(["A"]); expect(writes).toHaveLength(1);
  });

  it("retains failed name and captured filter intent across blur and later filter changes", async () => {
    seed([preset("A")]); await mount(); changeFilter("up3"); writeDenied = true; save("B");
    act(() => input().blur()); changeFilter("down3");
    expect(input()?.value).toBe("B"); act(() => input().focus());
    writeDenied = false; click(button("Retry"));
    expect(JSON.parse(raw()!).items.find((p: { name: string }) => p.name === "B").f.move).toBe("up3");
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="scr2Move"]')!.value).toBe("down3");
    expect(writes).toHaveLength(2);
  });

  it.each(["Cancel", "Escape"])("%s discards a blocked draft without clearing the unresolved read condition", async method => {
    seed([preset("A")]); const original = raw(); readDenied = true; await mount(); save("B");
    if (method === "Escape") key(input(), "Escape"); else click(button("Cancel"));
    expect(input()).toBeNull(); expect(raw()).toBe(original); expect(writes).toHaveLength(0);
    save("C"); expect(writes).toHaveLength(0); expect(alert()).not.toBeNull();
    readDenied = false; click(button("Retry")); expect(names()).toEqual(["A", "C"]); expect(writes).toHaveLength(1);
  });

  it("does not evict a preset at cap12 until persistence succeeds", async () => {
    seed(Array.from({ length: 12 }, (_, i) => preset(`A${i}`))); const original = raw(); await mount();
    writeDenied = true; save("B"); expect(raw()).toBe(original); expect(names()).toHaveLength(12); expect(names()[0]).toBe("A0");
    writeDenied = false; click(button("Retry")); expect(names()).toEqual([...Array.from({ length: 11 }, (_, i) => `A${i + 1}`), "B"]);
    expect(writes).toHaveLength(2);
  });

  it("computes a pending Save from the latest acknowledged list after an intervening Delete", async () => {
    seed([preset("A"), preset("C")]); await mount(); writeDenied = true; save("B");
    writeDenied = false; remove("A"); expect(names()).toEqual(["C"]); expect(input()?.value).toBe("B");
    click(button("Retry")); expect(names()).toEqual(["C", "B"]); expect(writes).toHaveLength(3);
    await remount(); expect(names()).toEqual(["C", "B"]);
  });

  it("serializes sequential successful operations without updater-replay writes", async () => {
    seed([preset("A")]); await mount(); save("B"); save("C"); remove("A");
    expect(names()).toEqual(["B", "C"]); expect(writes).toHaveLength(3);
    expect(new Set(JSON.parse(raw()!).items.map((p: { id: string }) => p.id)).size).toBe(2);
    await remount(); expect(names()).toEqual(["B", "C"]);
  });

  it.each(["save", "delete"])("retains both failures when the %s retry succeeds first", async first => {
    seed([preset("A", { move: "up3" }), preset("C")]); await mount(); click(button("A"));
    writeDenied = true; save("B"); remove("A");
    expect(names()).toEqual(["A", "C"]); expect(input()?.value).toBe("B"); expect(writes).toHaveLength(2);
    const retries = () => Array.from(alert()!.querySelectorAll("button")).filter(el => el.textContent === "Retry");
    expect(retries()).toHaveLength(2); writeDenied = false;
    click(retries()[first === "save" ? 0 : 1]);
    expect(retries()).toHaveLength(1);
    if (first === "save") { expect(names()).toEqual(["A", "C", "B"]); expect(button("A").classList.contains("on")).toBe(true); }
    else { expect(names()).toEqual(["C"]); expect(input()?.value).toBe("B"); }
    click(retries()[0]); expect(names()).toEqual(["C", "B"]); expect(writes).toHaveLength(4); expect(alert()).toBeNull();
    await remount(); expect(names()).toEqual(["C", "B"]);
  });

  it("does not leave a failed Delete pending after a successful capped Save removes its target", async () => {
    seed(Array.from({ length: 12 }, (_, i) => preset(`A${i}`))); await mount(); writeDenied = true; remove("A0");
    writeDenied = false; save("B");
    expect(names()).not.toContain("A0"); expect(names()).toHaveLength(12); expect(alert()).toBeNull(); expect(writes).toHaveLength(2);
  });

  it("does not clear another active preset's highlight on successful Delete", async () => {
    seed([preset("A"), preset("B", { move: "up3" })]); await mount(); click(button("B")); remove("A");
    expect(button("B").classList.contains("on")).toBe(true);
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="scr2Move"]')!.value).toBe("up3");
  });

  it("does not replace a known baseline with a failed StrictMode hydration replay", async () => {
    seed([preset("A")]); let reads = 0;
    vi.mocked(Storage.prototype.getItem).mockImplementation(function (this: Storage, key) {
      if (key === KEY && ++reads > 1) throw new DOMException("blocked", "SecurityError");
      return nativeGet.call(this, key);
    });
    await mount(); save("B"); save("C");
    expect(names()).toEqual(["A", "B", "C"]); expect(writes).toHaveLength(2); expect(reads).toBe(1);
  });

  it("commits one draft once even when Enter is delivered twice before React renders", async () => {
    seed([preset("A")]); await mount(); beginSave("B"); const editor = input();
    act(() => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(names()).toEqual(["A", "B"]); expect(writes).toHaveLength(1);
  });

  it.each(["save", "delete"])("Escape cancels only the focused %s failure", async kind => {
    seed([preset("A")]); await mount(); writeDenied = true; save("B"); remove("A");
    if (kind === "save") key(input(), "Escape");
    else key(host.querySelector('[aria-label="Retry deleting: A"]')!, "Escape");
    expect(writes).toHaveLength(2);
    expect(alert()!.querySelectorAll("button")).toHaveLength(2);
    writeDenied = false; click(button("Retry"));
    expect(names()).toEqual(kind === "save" ? [] : ["A", "B"]); expect(writes).toHaveLength(3);
  });

  it("a restored failed draft retries once for two Enter events in one React batch", async () => {
    seed([preset("A")]); await mount(); writeDenied = true; save("B"); writeDenied = false; const editor = input();
    act(() => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(names()).toEqual(["A", "B"]); expect(writes).toHaveLength(2);
  });

  it("checks a pending Save id against the recovered baseline", async () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    seed([{ ...preset("A"), id: "sp16-1" }]); readDenied = true; await mount(); save("B");
    readDenied = false; click(button("Retry"));
    const items = JSON.parse(raw()!).items as { id: string; name: string }[];
    expect(items.map(p => p.name)).toEqual(["A", "B"]); expect(new Set(items.map(p => p.id)).size).toBe(2);
    expect(writes).toHaveLength(1); await remount(); expect(names()).toEqual(["A", "B"]);
  });

  it.each(["en", "zh"] as const)("offers keyboard retry/cancel and local failure copy in %s", async lang => {
    locale.lang = lang; seed([preset("A")]); await mount(); writeDenied = true; save("B");
    expect(alert()?.textContent).toContain(lang === "zh" ? "未保存" : "not saved");
    const retry = button(lang === "zh" ? "重试" : "Retry");
    act(() => retry.focus()); expect(document.activeElement).toBe(retry);
    expect(button(lang === "zh" ? "取消" : "Cancel").tagName).toBe("BUTTON");
    key(retry, "Escape"); expect(alert()).toBeNull(); expect(input()).toBeNull(); expect(writes).toHaveLength(1);
  });
});
