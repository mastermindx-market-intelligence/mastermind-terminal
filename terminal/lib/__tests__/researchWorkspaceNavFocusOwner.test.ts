import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual pre-render hooks/callbacks with controlled commit, focus and
// frame ports. The companion real-route E2E owns React/DOM/CSS and URL proof.
const source = readFileSync(join(__dirname, "../../components/fin/ResearchWorkspaceNav.tsx"), "utf8");
const families = readFileSync(join(__dirname, "../../components/fin/finPageFamilies.ts"), "utf8");
const start = source.indexOf("const FAMILY_LABELS");
const end = source.indexOf("\n  return (\n    <>", start);
assert.ok(start > 0 && end > start, "the existing navigation render boundary must be present");
const code = ts.transpileModule(
  families.replace(/^import type .*;\n/m, "").replace(/\bexport /g, "") + "\n" +
  source.slice(start, end).replace(/export default function ResearchWorkspaceNav/, "function mountNav").replace(/\bexport /g, "") +
  "\nreturn { familySheetOpen, setFamilySheetOpen, familyTriggerRef, navigationRef, sheetRef, chooseFamily, closeFamilySheet, moveFamilyFocus, moveLocalFocus, queueOwnedFocus }; }\n" +
  "globalThis.mountNav = mountNav; globalThis.pageLabel = researchPageLabel;",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

type FocusNode = { name: string; isConnected: boolean; visible: () => boolean; focus: () => void; getClientRects: () => unknown[] };
type Effect = { deps: unknown[]; cleanup?: () => void; next?: () => void | (() => void) };
function harness({ variant = "families", zh = false, initialPage = "earnings" } = {}) {
  let cursor = 0, page = initialPage, narrow = true, opened = false, nextFrame = 1;
  const slots: unknown[] = [], pending: number[] = [], frames = new Map<number, () => void>();
  const listeners = new Map<string, Set<(event: any) => void>>();
  const mediaListeners = new Set<() => void>();
  const document = { activeElement: null as FocusNode | null, body: null as unknown as FocusNode,
    getElementById: () => { throw new Error("focus must stay inside its navigation owner"); } };
  const node = (name: string, visible = () => true): FocusNode => {
    const value: FocusNode = { name, isConnected: true, visible,
      focus: () => { if (value.isConnected) document.activeElement = value; },
      getClientRects: () => value.isConnected && visible() ? [{}] : [] };
    return value;
  };
  document.body = node("body"); document.activeElement = document.body;
  const trigger = node("trigger", () => narrow);
  const familyNames = ["overview", "intelligence", "financials", "earnings", "market", "ownership", "lab"];
  const desktop = Object.fromEntries(familyNames.map(name => [name, node("family:" + name, () => !narrow)]));
  const localNames = ["earnings", "forecast", "transcripts"];
  const local = Object.fromEntries(localNames.map(name => [name, node("local:" + name, () => !narrow)]));
  const close = node("close", () => narrow && opened);
  const choices = Object.fromEntries(familyNames.map(name => [name, node("sheet:" + name, () => narrow && opened)]));
  const buttons = [close, ...Object.values(choices)];
  const navigation = { querySelector: (selector: string) => {
    const family = /data-fin-family="([^"]+)"/.exec(selector)?.[1];
    const view = /data-fin-local="([^"]+)"/.exec(selector)?.[1];
    return family ? desktop[family] : view ? local[view] : null;
  } };
  const sheet = { contains: (value: FocusNode) => buttons.includes(value),
    querySelectorAll: () => buttons,
    querySelector: (selector: string) => choices[/data-fin-family-sheet="([^"]+)"/.exec(selector)?.[1] ?? ""] ?? close };
  const media = { get matches() { return narrow; }, addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn) };
  const window = {
    requestAnimationFrame: (fn: () => void) => { const id = nextFrame++; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id: number) => frames.delete(id), matchMedia: () => media,
    addEventListener: (key: string, fn: (event: any) => void) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key)!.add(fn); },
    removeEventListener: (key: string, fn: (event: any) => void) => listeners.get(key)?.delete(fn),
  };
  const equal = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (make: () => unknown, deps: unknown[]) => {
    const i = cursor++, old = slots[i] as { deps: unknown[]; value: unknown } | undefined;
    if (!old || !equal(old.deps, deps)) slots[i] = { deps, value: make() };
    return (slots[i] as { value: unknown }).value;
  };
  const context = vm.createContext({ window, document,
    useState: (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value: unknown) => { slots[i] = value; }]; },
    useRef: (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo: memo, useCallback: (fn: unknown, deps: unknown[]) => memo(() => fn, deps),
    useEffect: (fn: Effect["next"], deps: unknown[]) => {
      const i = cursor++, old = slots[i] as Effect | undefined;
      if (!old || !equal(old.deps, deps)) { slots[i] = { deps, cleanup: old?.cleanup, next: fn }; pending.push(i); }
    },
  });
  vm.runInContext(code, context);
  let api: any;
  const onPage = (next: string) => { page = next; };
  const render = () => {
    cursor = 0; api = context.mountNav({ page, zh, variant, onPage }); opened = api.familySheetOpen;
    api.familyTriggerRef.current = variant === "local" ? null : trigger;
    api.navigationRef.current = navigation; api.sheetRef.current = opened ? sheet : null;
    for (const button of buttons) button.isConnected = opened;
    if (document.activeElement && !document.activeElement.isConnected) document.activeElement = document.body;
    for (const i of pending.splice(0)) {
      const effect = slots[i] as Effect; effect.cleanup?.(); effect.cleanup = effect.next?.() || undefined; effect.next = undefined;
    }
    return api;
  };
  const flush = () => { const current = [...frames.entries()]; frames.clear(); for (const [, fn] of current) fn(); };
  const open = () => { trigger.focus(); api.setFamilySheetOpen(true); render(); flush(); };
  const key = (key: string, shiftKey = false) => {
    const event = { key, shiftKey, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const fn of [...(listeners.get("keydown") ?? [])]) fn(event);
    return event;
  };
  const resize = (value: boolean) => { narrow = value; for (const fn of [...mediaListeners]) fn(); render(); flush(); };
  const unmount = () => { for (const slot of slots) (slot as Effect | undefined)?.cleanup?.(); };
  render();
  return { get api() { return api; }, get page() { return page; }, get active() { return document.activeElement; },
    trigger, close, choices, desktop, local, node, document, render, flush, open, key, resize, unmount,
    frames, mediaListeners, listeners, pageLabel: context.pageLabel };
}

describe("existing ResearchWorkspaceNav focus ownership", () => {
  for (const variant of ["families", "combined"]) for (const zh of [false, true]) {
    it(`enters the selected family inside the ${variant} sheet, zh=${zh}`, () => {
      const h = harness({ variant, zh }); h.open(); assert.equal(h.active, h.choices.earnings);
    });
  }
  it("wraps Tab and Shift+Tab within visible dialog controls and recovers outside focus", () => {
    const h = harness(); h.open();
    h.choices.lab.focus(); assert.equal(h.key("Tab").prevented, true); assert.equal(h.active, h.close);
    assert.equal(h.key("Tab", true).prevented, true); assert.equal(h.active, h.choices.lab);
    h.trigger.focus(); assert.equal(h.key("Tab").prevented, true); assert.equal(h.active, h.close);
  });
  it("leaves ordinary interior Tab movement to the browser", () => {
    const h = harness(); h.open(); assert.equal(h.key("Tab").prevented, false);
  });
  it("Escape retires the modal before returning focus and does not escape to the outer pane", () => {
    const h = harness(); h.open(); const event = h.key("Escape"); h.render(); h.flush();
    assert.equal(event.prevented, true); assert.equal(event.stopped, true);
    assert.equal(h.api.familySheetOpen, false); assert.equal(h.active, h.trigger);
    assert.equal(h.listeners.get("keydown")?.size, 0); assert.equal(h.mediaListeners.size, 0);
  });
  it("selection preserves the existing family default and hands off to the surviving trigger", () => {
    const h = harness(); h.open(); h.choices.market.focus(); h.api.chooseFamily("market"); h.render(); h.flush();
    assert.equal(h.page, "technicals"); assert.equal(h.api.familySheetOpen, false); assert.equal(h.active, h.trigger);
  });
  it("close and scrim use the same owned return path", () => {
    const h = harness(); h.open(); h.api.closeFamilySheet(); h.render(); h.flush(); assert.equal(h.active, h.trigger);
  });
  it("a desktop resize retires the hidden modal and returns to the visible family tab", () => {
    const h = harness(); h.open(); h.resize(false);
    assert.equal(h.api.familySheetOpen, false); assert.equal(h.active, h.desktop.earnings);
    assert.equal(h.listeners.get("keydown")?.size, 0); assert.equal(h.mediaListeners.size, 0);
  });
  it("entry cannot steal a later connected user focus choice", () => {
    const h = harness(); h.trigger.focus(); h.api.setFamilySheetOpen(true); h.render();
    const other = h.node("later choice"); other.focus(); h.flush(); assert.equal(h.active, other);
  });
  it("return cannot steal a later connected user focus choice", () => {
    const h = harness(); h.open(); h.api.closeFamilySheet(); h.render();
    const other = h.node("later choice"); other.focus(); h.flush(); assert.equal(h.active, other);
  });
  it("unmount cancels queued entry and removes both modal listeners", () => {
    const h = harness(); h.api.setFamilySheetOpen(true); h.render(); h.unmount(); h.flush();
    assert.equal(h.frames.size, 0); assert.equal(h.listeners.get("keydown")?.size, 0); assert.equal(h.mediaListeners.size, 0);
    assert.notEqual(h.active, h.choices.earnings);
  });
  it("unmount cancels a queued return without touching another navigation", () => {
    const h = harness(); h.open(); h.api.closeFamilySheet(); h.render(); h.unmount(); h.flush();
    assert.equal(h.frames.size, 0); assert.notEqual(h.active, h.trigger);
  });
  it("desktop arrow routing and focus remain scoped to the active navigation", () => {
    const h = harness(); h.resize(false); h.desktop.earnings.focus();
    assert.equal(h.api.moveFamilyFocus("earnings", "ArrowRight"), true); h.render(); h.flush();
    assert.equal(h.page, "technicals"); assert.equal(h.active, h.desktop.market);
  });
  it("local arrow routing retains its page owner and ignores unrelated keys", () => {
    const h = harness({ variant: "local" }); h.resize(false); h.local.earnings.focus();
    assert.equal(h.api.moveLocalFocus("earnings", "ArrowRight"), true); h.render(); h.flush();
    assert.equal(h.page, "forecast"); assert.equal(h.active, h.local.forecast);
    assert.equal(h.api.moveLocalFocus("forecast", "Enter"), false);
  });
  it("a hidden focus target is never selected by a queued handoff", () => {
    const h = harness(); const hidden = h.node("hidden", () => false); h.api.queueOwnedFocus(() => hidden); h.flush(); assert.notEqual(h.active, hidden);
  });
  it("panel names reuse the actual selected local page in both languages", () => {
    const h = harness(); assert.equal(h.pageLabel("forecast", false), "Analyst"); assert.equal(h.pageLabel("forecast", true), "分析师");
  });
});
