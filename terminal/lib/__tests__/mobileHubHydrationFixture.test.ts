// @vitest-environment jsdom
import React, { act } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { URL as NodeURL } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/mobileHubHydration.b523.json";

// Source-only experiment: no Playwright/browser launch or historical timing replay.
// Execute exact tested b523 chart publisher and owner/helper seams under controlled
// React effect/commit and storage inputs. JSX is the real RollerStrip composition.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const componentSource = () => readFileSync(new NodeURL("../../components/mobile/RollerStrip.tsx", import.meta.url), "utf8");
const shellSource = () => readFileSync(new NodeURL("../../components/TerminalShell.tsx", import.meta.url), "utf8");
const helperSource = () => readFileSync(new NodeURL("../../e2e/mobile-chart-chrome.spec.ts", import.meta.url), "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

type Owner = { state: string; markSeen: () => void };
type SourceExports = Record<string, unknown>;
function compile(source: string, dependencies: Record<string, unknown>, tsx = false): SourceExports {
  const code = ts.transpileModule(source, { fileName: tsx ? "fixture.tsx" : "fixture.ts", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", code)((key: string) => {
    if (!(key in dependencies)) throw new Error(`Unmodeled source dependency: ${key}`);
    return dependencies[key];
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

async function setup(value: string | null = null, readError = false, width = 390, chartInitiallyReady = true) {
  const original = process.env.MOBILE_HUB_FIXTURE_ORIGINAL === "1";
  let root: Root | undefined;
  const host = document.createElement("div"); document.body.append(host);
  const effects: Array<() => void> = [], commits: Array<() => void> = [], frames: FrameRequestCallback[] = [];
  const waiters: Array<() => void> = [];
  const scheduler = { holdCommits: false };
  const storage = { getItem: vi.fn(() => { if (readError) throw new Error("synthetic storage failure"); return value; }), setItem: vi.fn((_key: string, next: string) => { value = next; }) };
  vi.stubGlobal("localStorage", storage);
  const controlledReact = { ...React,
    useEffect(effect: React.EffectCallback, deps: React.DependencyList) {
      React.useEffect(() => {
        let active = true; let cleanup: ReturnType<React.EffectCallback>;
        effects.push(() => { if (active) cleanup = effect(); });
        return () => { active = false; cleanup?.(); };
      // Forward the source effect's dependencies unchanged; adding the wrapper
      // closure as a dependency would manufacture extra mount executions.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
    },
    useState(initial: unknown) {
      const [state, setState] = React.useState(initial);
      return [state, (next: React.SetStateAction<unknown>) => {
        if (scheduler.holdCommits) commits.push(() => setState(next)); else setState(next);
      }];
    },
  };
  const dependencies = { react: controlledReact, "react/jsx-runtime": jsxRuntime,
    "@/lib/i18n": { useT: () => (key: string) => key },
    "@/lib/useHubDiscovery": {}, "./RollerStrip.module.css": new Proxy({}, { get: (_target, key) => String(key) }) };
  const hookUrl = new NodeURL("../useHubDiscovery.ts", import.meta.url);
  let useOwner: () => Owner;
  if (!original && existsSync(hookUrl) && shellSource().includes("useHubDiscovery()")) {
    useOwner = compile(readFileSync(hookUrl, "utf8"), dependencies).useHubDiscovery as () => Owner;
    expect(shellSource()).toContain('moreBadge={hubDiscoveryState === "unseen"}');
    expect(shellSource()).toContain("hubDiscoveryState={hubDiscoveryState}");
  } else {
    const shell = shellSource();
    const seam = original ? fixture.sources.ownerSeam.source : shell.slice(shell.indexOf('  // Optimistic "seen"'), shell.indexOf("  // SSR-consistent default", shell.indexOf('  // Optimistic "seen"')));
    expect(sha(seam)).toBe(fixture.sources.ownerSeam.sha256);
    useOwner = compile(`import {useEffect,useState} from 'react'; export function useOwner(){${seam}\nreturn {state:hubSeen?'seen':'unseen',markSeen:()=>setHubSeen(true)};}`, dependencies).useOwner as () => Owner;
  }
  // Incoming b523 wheel changes are preserved; only the current candidate's
  // props/render tail is composed over the exact tested prefix. No chart/module merge.
  const marker = "export type RollerStripProps";
  const roller = original ? fixture.sources.roller.source : fixture.sources.roller.source.slice(0, fixture.sources.roller.source.indexOf(marker))
    + componentSource().slice(componentSource().indexOf(marker));
  const Roller = compile(roller, dependencies, true).default as React.ComponentType<Record<string, unknown>>;
  const props = { symbols: ["NVDA"], symbol: "NVDA", timeframes: ["D"], timeframe: "D",
    onSymbol: () => {}, onTapSymbol: () => {}, onTimeframe: () => {}, onDraw: () => {}, drawActive: false,
    onUndo: () => {}, onRedo: () => {}, canUndo: false, canRedo: false };
  function Surface() {
    const owner = useOwner();
    return React.createElement("div", { className: "chart-wrap" }, React.createElement("canvas"), React.createElement(Roller,
      { ...props, onMore: owner.markSeen, moreBadge: owner.state === "unseen", hubDiscoveryState: owner.state }));
  }
  const chart = compile(fixture.sources.chartReady.source, {});
  const announce = chart.announceTerminalVisualReady as (symbol: string, state: string, identity: Record<string, unknown>) => { cancel: () => void; reevaluate: () => void };
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => { frames.push(fn); return frames.length; });
  let announcement: ReturnType<typeof announce> | undefined;
  const onReady = vi.fn();
  const chartAuthority = { ready: chartInitiallyReady };
  const locator = (selector: string) => ({ selector, first() { return this; }, getAttribute: async (name: string) => host.querySelector(selector)?.getAttribute(name) ?? null });
  const page = {
    viewportSize: () => ({ width }),
    addInitScript: async (fn: () => void) => { fn(); },
    goto: async () => {
      act(() => { root = createRoot(host); root.render(React.createElement(Surface)); });
      // Actual b523 publisher, with controlled successful chart-authority/paint
      // dependencies. Its real onReady callback and event both execute.
      announcement = announce("NVDA", "data", { timeframe: "D", generation: 1,
        isCurrent: () => true, isReady: () => chartAuthority.ready, isRendered: () => true, renderVisuals: () => {}, onReady });
      while (frames.length) frames.shift()!(0);
    },
    locator, getByTestId: (id: string) => locator(`[data-testid="${id}"]`),
    evaluate: async (fn: () => unknown) => fn(),
  };
  const sourceExpect = Object.assign((value: unknown, message?: string) => {
    if (value && typeof value === "object" && "selector" in value) {
      const item = value as ReturnType<typeof locator>;
      return {
        toBeVisible: async () => { expect(host.querySelector(item.selector), `${item.selector}: ${host.innerHTML.slice(0,1000)}`).not.toBeNull(); },
        toHaveAttribute: (name: string, expected: RegExp | string) => new Promise<void>((resolve) => {
          const check = () => { const actual = host.querySelector(item.selector)?.getAttribute(name); if (actual != null && (typeof expected === "string" ? actual === expected : expected.test(actual))) resolve(); };
          waiters.push(check); check();
        }),
      };
    }
    return expect(value, message);
  }, { poll: (read: () => unknown) => ({ toBe: (wanted: unknown) => new Promise<void>((resolve, reject) => {
    const check = async () => { try { if (await read() === wanted) resolve(); } catch (error) { reject(error); } };
    waiters.push(() => { void check(); }); void check();
  }) }) });
  const text = helperSource(); const start = text.indexOf("async function openTerminal(page: Page) {");
  const helper = original ? fixture.sources.openTerminal.source : text.slice(start, text.indexOf("/** Pointer drags", start));
  const js = ts.transpileModule(helper, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const open = new Function("expect", "phone", `${js};return openTerminal;`)(sourceExpect, (p: typeof page) => p.viewportSize().width <= 640) as (p: typeof page) => Promise<void>;
  let resolved = false, rejected: unknown;
  const running = open(page).then(() => { resolved = true; }, (error) => { rejected = error; });
  const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); waiters.forEach((check) => check()); await Promise.resolve(); };
  await tick();
  cleanups.push(async () => { announcement?.cancel(); await act(async () => root?.unmount()); host.remove(); });
  return { host, storage, scheduler, commits, onReady, running, chartAuthority,
    flushChart: async () => { announcement?.reevaluate(); while (frames.length) frames.shift()!(0); await tick(); },
    get resolved() { return resolved; }, get rejected() { return rejected; },
    state: () => host.querySelector('[data-testid="roller-more"]')?.getAttribute("data-hub-discovery-state"),
    badge: () => host.querySelector('[data-testid="roller-more-badge"]'),
    flushEffect: async () => { await act(async () => { for (const effect of effects.splice(0)) effect(); }); await tick(); },
    flushCommit: async () => { await act(async () => { for (const commit of commits.splice(0)) commit(); }); await tick(); },
  };
}

describe("actual tested chart-ready versus committed hub hydration", () => {
  it("binds every immutable source input to its advertised exact bytes", () => {
    for (const input of Object.values(fixture.sources)) expect(sha(input.source)).toBe(input.sha256);
  });
  it("does not return ready while the missing-key storage effect has not executed", async () => {
    const f = await setup();
    expect(f.onReady).toHaveBeenCalledOnce(); expect(f.rejected).toBeUndefined();
    expect(f.storage.getItem).not.toHaveBeenCalled();
    expect(f.badge()).toBeNull(); // preserves initial no-flash behavior
    if (process.env.MOBILE_HUB_FIXTURE_ORIGINAL !== "1") expect(f.state()).toBe("hydration-pending");
    expect(f.resolved).toBe(false);
    await f.flushEffect();
    expect(f.storage.getItem).toHaveBeenCalledWith("mm.hubSeen");
    expect(f.state()).toBe("unseen"); expect(f.badge()).not.toBeNull();
    await f.running; expect(f.resolved).toBe(true);
  });
  it("does not return ready after a missing-key read until its React commit", async () => {
    const f = await setup(); f.scheduler.holdCommits = true;
    await f.flushEffect();
    expect(f.storage.getItem).toHaveBeenCalledOnce(); expect(f.commits.length).toBeGreaterThan(0);
    expect(f.badge()).toBeNull(); expect(f.resolved).toBe(false);
    await f.flushCommit();
    expect(f.state()).toBe("unseen"); expect(f.badge()).not.toBeNull();
    await f.running; expect(f.resolved).toBe(true);
  });
  it("classifies a stored seen value without flashing or demanding a badge", async () => {
    const f = await setup("1"); expect(f.badge()).toBeNull();
    await f.flushEffect(); await f.running;
    expect(f.state()).toBe("seen"); expect(f.badge()).toBeNull(); expect(f.resolved).toBe(true);
  });
  it("never turns a failed storage read into successful unseen readiness", async () => {
    const f = await setup(null, true); await f.flushEffect(); await f.running;
    expect(f.state()).toBe("storage-error"); expect(f.badge()).toBeNull();
    expect(f.resolved).toBe(false); expect(f.rejected).toBeDefined();
  });
  it("does not substitute hub hydration for the real chart-ready signal", async () => {
    const f = await setup(null, false, 390, false);
    await f.flushEffect();
    if (process.env.MOBILE_HUB_FIXTURE_ORIGINAL !== "1") expect(f.state()).toBe("unseen");
    expect(f.badge()).not.toBeNull(); expect(f.resolved).toBe(false); expect(f.onReady).not.toHaveBeenCalled();
    f.chartAuthority.ready = true; await f.flushChart(); await f.running;
    expect(f.onReady).toHaveBeenCalledOnce(); expect(f.resolved).toBe(true);
  });
  it("does not require phone discovery hydration on a desktop viewport", async () => {
    const f = await setup(null, false, 1440); await f.running;
    expect(f.rejected).toBeUndefined(); expect(f.onReady).toHaveBeenCalledOnce(); expect(f.storage.getItem).not.toHaveBeenCalled(); expect(f.resolved).toBe(true);
  });
});
