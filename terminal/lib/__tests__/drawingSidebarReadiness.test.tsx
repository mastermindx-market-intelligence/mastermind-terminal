/**
 * @vitest-environment jsdom
 *
 * Executes the shell's actual drawing state, owner/load effects, admission and
 * Sidebar wiring with real React commits. The chart and successful cloud/save
 * paths are outside this probe; the unchanged E2E suite owns their acceptance.
 */
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import DrawingSidebar, { type DrawingSidebarProps } from "@/components/DrawingSidebar";
import { accountIdentity, identityOwnerKey, isAccountOwner } from "@/lib/accountIdentity";
import { reconcileDrawingJournal, writeDrawingJournal, refreshDrawingJournalSymbol } from "@/lib/drawingOutbox";
import { DRAWING_OWNER_HEADER, beginDrawingLoad, abandonDrawingLoad, abandonAllDrawingLoads, isCurrentDrawingLoad } from "@/lib/drawingPersistence";
import { normalizeDrawings } from "@/lib/drawings";
import { drawingSaveIssueFromEntry } from "@/lib/drawingSaveConflict";

const source = readFileSync(path.resolve("components/TerminalShell.tsx"), "utf8");
const ast = ts.createSourceFile("TerminalShell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const shell = ast.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "TerminalShell");
if (!shell?.body) throw new Error("Missing actual TerminalShell body");

function slice(start: string, end: string) {
  const from = source.indexOf(start);
  if (from < 0 || source.indexOf(start, from + start.length) >= 0) throw new Error(`Ambiguous source start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  if (to < 0) throw new Error(`Missing source end: ${end}`);
  return source.slice(from, to);
}

function statement(binding: string) {
  const matches = shell!.body!.statements.filter(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => {
      const name = declaration.name;
      return ts.isIdentifier(name) ? name.text === binding : name.elements.some(element =>
        ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.name.text === binding);
    }));
  if (matches.length !== 1) throw new Error(`Ambiguous shell binding: ${binding}`);
  return matches[0].getText(ast);
}

const sidebars: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> = [];
function visit(node: ts.Node) {
  if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === "DrawingSidebar") sidebars.push(node);
  ts.forEachChild(node, visit);
}
visit(shell);
if (sidebars.length !== 1) throw new Error("Expected one real DrawingSidebar caller");
function wired(name: string) {
  const attributes = sidebars[0].attributes.properties.filter((node): node is ts.JsxAttribute =>
    ts.isJsxAttribute(node) && node.name.getText(ast) === name);
  const value = attributes[0]?.initializer;
  if (attributes.length !== 1 || !value || !ts.isJsxExpression(value) || !value.expression) throw new Error(`Missing real Sidebar expression: ${name}`);
  return value.expression.getText(ast);
}

const excluded = Object.fromEntries([
  "parseDrawingSnapshot", "shouldApplyDrawingCloudCopy", "decideDrawingLoadReconciliation",
  "remainingPreloadPending", "unionCloudWithPreloadAdditions", "drawingSaveIssueFromLoadPark", "flushDrawings",
].map(name => [name, vi.fn(() => { throw new Error(`Outside held-read probe: ${name}`); })]));
const dependencies = {
  accountIdentity, identityOwnerKey, isAccountOwner, reconcileDrawingJournal, writeDrawingJournal,
  refreshDrawingJournalSymbol, DRAWING_OWNER_HEADER, beginDrawingLoad, abandonDrawingLoad,
  abandonAllDrawingLoads, isCurrentDrawingLoad, normalizeDrawings, drawingSaveIssueFromEntry, ...excluded,
};
const singlePane = ["NVDA"];
type Observation = { owner: string; hydratedOwner: string; hasCache: boolean; cacheLength: number; disabled: boolean; pressed: string | null; pinned: string | null };
const observations: Observation[] = [];
const irrelevant: Omit<DrawingSidebarProps, "tool" | "creationDisabledReason" | "onTool" | "pinned" | "onPinned"> = {
  magnet: "off", sticky: false, stayActive: false, drawingsVisible: true, drawingsLocked: false,
  drawingCount: 0, userDrawingCount: 0, detectedDrawingCount: 0, indicatorCount: 0,
  canUndo: false, canRedo: false, drawStyle: { color: "#4d82ff", width: 1.5, dash: "solid" },
  onMagnet: () => {}, onSticky: () => {}, onToggleVisibility: () => {}, onToggleLock: () => {},
  onUndo: () => {}, onRedo: () => {}, onClear: () => {}, onDrawStyle: () => {},
};

// TypeScript removes only type annotations. None of the production predicates,
// effect bodies, ref assignments, or selected JSX prop expressions is rewritten.
const probeSource = `(() => {
  const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React;
  const { ${Object.keys(dependencies).join(", ")} } = dependencies;
  ${slice("const GUEST_DRAW_KEY =", "const drawingCollectionsEqual =")}
  return function Probe({ userId = "owner-a", email = "owner@example.test", replayOn = false, panes = singlePane }) {
    const active = "NVDA";
    ${statement("identity")}
    ${slice("  const [toolState, setToolState] =", "  const [detectCmd, setDetectCmd] =")}
    ${slice("  const drawingCreationDisabledReason =", "  const drawingKeepsActive =")}
    ${statement("drawingsVisible")}
    ${statement("drawingHistoryVersion")}
    ${slice("  const [drawStore, setDrawStore] =", "  const restoreOtherDrawingCopies =")}
    ${slice("  // Ownership invalidates async callbacks; recovery keeps the original attempt and revision.", "  // load drawings once per symbol that appears in a pane; don't clobber an in-flight local edit")}
    ${slice("  // load drawings once per symbol that appears in a pane; don't clobber an in-flight local edit", "  useEffect(() => {\n    const persistPendingDrawings = () => {")}
    ${slice("  const drawingOwnerMatches =", "  const activeStoredDrawings =")}
    useLayoutEffect(() => {
      const button = document.querySelector('[data-testid="drawing-group-lines-main"]');
      observations.push({ owner: currentDrawingOwnerKey, hydratedOwner: drawingOwnerKey,
        hasCache: drawStoreRef.current[active] !== undefined, cacheLength: drawStoreRef.current[active]?.length ?? 0,
        disabled: button.disabled, pressed: button.getAttribute('aria-pressed'), pinned: drawingPinnedTool });
    });
    return React.createElement(DrawingSidebar, { ...irrelevant,
      tool: ${wired("tool")}, creationDisabledReason: ${wired("creationDisabledReason")},
      onTool: ${wired("onTool")}, pinned: ${wired("pinned")}, onPinned: ${wired("onPinned")} });
  };
})()`;
const compiled = ts.transpileModule(probeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const Probe = new Function("React", "DrawingSidebar", "dependencies", "singlePane", "irrelevant", "observations", `return ${compiled}`)(
  React, DrawingSidebar, dependencies, singlePane, irrelevant, observations,
) as React.ComponentType<{ userId?: string; email?: string; replayOn?: boolean; panes?: string[] }>;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

type Request = { url: string; owner: string | null; settled: boolean; reject: (error: Error) => void };
let root: Root;
let container: HTMLDivElement;
let requests: Request[];
const button = (id = "drawing-group-lines-main") => {
  const element = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`Missing actual button: ${id}`);
  return element;
};
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); observations.length = 0; requests = [];
  Object.values(excluded).forEach(spy => spy.mockClear());
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    requests.push({ url, owner: new Headers(init.headers).get(DRAWING_OWNER_HEADER), settled: false, reject });
  })));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
  for (const spy of Object.values(excluded)) expect(spy).not.toHaveBeenCalled();
});
async function mount(props: React.ComponentProps<typeof Probe> = {}) { await act(async () => root.render(<Probe {...props} />)); }
async function reject(index: number) { await act(async () => { requests[index].settled = true; requests[index].reject(new Error("fixture GET unavailable")); }); }

describe("drawing controls follow the shell's real owner and load readiness", () => {
  it("starts disabled, then accepts one click after placeholder publication while GET remains held", async () => {
    await mount();
    expect(observations[0]).toMatchObject({ owner: "account:owner-a", hasCache: false, disabled: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: "/api/drawings?symbol=NVDA", owner: "account:owner-a", settled: false });
    expect(observations.at(-1)).toMatchObject({ hasCache: true, cacheLength: 0, disabled: false });
    act(() => button().click());
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(requests[0].settled).toBe(false);
  });

  it("withdraws creation availability when the actual current load rejects", async () => {
    await mount(); expect(button().disabled).toBe(false);
    await reject(0);
    expect(observations.at(-1)).toMatchObject({ hasCache: false, disabled: true, pinned: null });
    act(() => { button().click(); button().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(observations.at(-1)?.pinned).toBeNull();
    expect(button("drawing-group-lines-menu-trigger").disabled).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("fences the transitional old-owner cache and ignores the stale owner's rejection", async () => {
    await mount();
    await mount({ userId: "owner-b" });
    expect(observations.find(row => row.owner === "account:owner-b" && row.hydratedOwner === "account:owner-a"))
      .toMatchObject({ hasCache: true, disabled: true });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ owner: "account:owner-b", settled: false });
    expect(observations.at(-1)).toMatchObject({ owner: "account:owner-b", hydratedOwner: "account:owner-b", hasCache: true, disabled: false });
    await reject(0);
    expect(button().disabled).toBe(false);
    await reject(1);
    expect(observations.at(-1)).toMatchObject({ hasCache: false, disabled: true });
  });

  it.each([{ replayOn: true }, { panes: ["NVDA", "AAPL"] }])("preserves replay and multi-chart restrictions after readiness ($replayOn, $panes)", async props => {
    await mount(props);
    expect(observations.at(-1)).toMatchObject({ hasCache: true, disabled: true });
    act(() => button().click());
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });

  it("disables an already-open flyout and favorite when the actual load fails", async () => {
    await mount();
    // Hydrate the real favorites UI's scheduled animation frame, without
    // settling the cloud request or reaching its retry deadline.
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    act(() => button("drawing-group-lines-menu-trigger").click());
    act(() => button("drawing-favorite-hline").click());
    expect(button("drawing-tool-hline").disabled).toBe(false);
    await reject(0);
    expect(button("drawing-tool-hline").disabled).toBe(true);
    const favorite = document.querySelector<HTMLButtonElement>('[data-testid="drawing-favorite-tool-hline"]');
    expect(favorite).not.toBeNull(); expect(favorite!.disabled).toBe(true);
    act(() => { favorite!.click(); button("drawing-tool-hline").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(observations.at(-1)?.pinned).toBeNull();
  });
});
