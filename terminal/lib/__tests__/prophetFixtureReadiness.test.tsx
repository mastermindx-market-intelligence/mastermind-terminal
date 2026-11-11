import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { getResolveRoutes } from "next/dist/server/lib/router-utils/resolve-routes";
import { defaultConfig } from "next/dist/server/config-shared";
import { normalizeAppPath } from "next/dist/shared/lib/router/utils/app-paths";
import { getSortedRoutes } from "next/dist/shared/lib/router/utils/sorted-routes";
import { getRouteRegex } from "next/dist/shared/lib/router/utils/route-regex";
import { getRouteMatcher } from "next/dist/shared/lib/router/utils/route-matcher";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ShellLayout from "@/app/(shell)/layout";
import LegacyShellPage from "@/app/(shell)/[...legacyPath]/page";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";
import { LangProvider } from "@/lib/i18n";
import { getJSONResult, invalidate, type CacheOutcome } from "@/lib/dataCache";
import { announceTerminalVisualReady, TERMINAL_VISUAL_READY_EVENT } from "@/lib/terminalBoot";

const state = vi.hoisted(() => ({ cookies: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  getAll: () => state.cookies,
  get: (name: string) => state.cookies.find(cookie => cookie.name === name),
  set: () => {},
}) }));
vi.mock("next/navigation", async importOriginal => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/components/chrome/AppShell", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

// Execute the actual Playwright producer only up to its first navigation. No page,
// browser, HTTP transport or routed request is created by this VM.
async function producedCookies() {
  let body: (args: unknown, info: unknown) => Promise<void> = async () => {};
  const cookies: { name: string; value: string }[] = [];
  const stop = new Error("fixture setup captured before navigation");
  const source = readFileSync(path.resolve("e2e/prophet-early-observations.spec.ts"), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(javascript, { exports: {}, Buffer, URL, require: (id: string) => {
    if (id === "@playwright/test") return { test: (_name: string, run: typeof body) => { body = run; }, expect: () => { throw Error("unexpected assertion before navigation"); } };
    if (id === "../test-fixtures/prophet_wmko_observations_fixture.json") return {};
    throw Error(`unexpected fixture import ${id}`);
  } });
  await expect(body({ context: { addCookies: async (values: typeof cookies) => { cookies.push(...values); } }, baseURL: "http://127.0.0.1:3108", page: {
    addInitScript: async () => {}, route: async () => {}, viewportSize: () => ({ width: 1440 }), goto: async () => { throw stop; },
  } }, {})).rejects.toBe(stop);
  return cookies;
}

// Actual Next route ordering/resolution over the checked-in app/public inventory.
// Only the filesystem adapter is controlled; no socket is bound or connected.
async function resolveSourceRoute(url: string) {
  const routes = new Map<string, string>();
  for (const file of readdirSync(path.resolve("app"), { recursive: true }) as string[]) {
    if (/(?:^|\/)(?:page|route)\.tsx?$/.test(file)) routes.set(normalizeAppPath("/" + file.replace(/\.tsx?$/, "")), file);
  }
  const fsChecker = {
    headers: [], onMatchHeaders: [], redirects: [], rewrites: { beforeFiles: [], afterFiles: [], fallback: [] }, exportPathMapRoutes: [], buildId: "unit",
    getMiddlewareMatchers: () => undefined, handleLocale: (pathname: string) => ({ pathname }),
    getDynamicRoutes: () => getSortedRoutes([...routes.keys()]).filter(route => route.includes("[")).map(route => ({ page: route, match: getRouteMatcher(getRouteRegex(route)) })),
    getItem: async (pathname: string) => {
      const asset = path.join(process.cwd(), "public", pathname);
      if (existsSync(asset)) return { type: "publicFolder", itemPath: pathname, fsPath: asset };
      return routes.has(pathname) ? { type: "appFile", itemPath: pathname } : null;
    },
  } as unknown as Parameters<typeof getResolveRoutes>[0];
  const resolve = getResolveRoutes(
    fsChecker,
    { ...defaultConfig, useFileSystemPublicRoutes: true, crossOrigin: undefined, skipProxyUrlNormalize: false } as unknown as Parameters<typeof getResolveRoutes>[1],
    () => defaultConfig.assetPrefix,
    { dir: process.cwd(), dev: false, minimalMode: false, port: 3108, hostname: "127.0.0.1" } as Parameters<typeof getResolveRoutes>[3],
    undefined as unknown as Parameters<typeof getResolveRoutes>[4],
    {} as Parameters<typeof getResolveRoutes>[5],
  );
  const socket = new Socket(); const req = new IncomingMessage(socket); req.url = url; req.method = "GET"; req.headers = { host: "127.0.0.1:3108" };
  const res = new ServerResponse(req);
  try { return await resolve({ req, res, isUpgradeReq: false, signal: new AbortController().signal }); }
  finally { req.destroy(); res.destroy(); socket.destroy(); }
}

// Run the actual daily OHLC outcome branch, before data projection, with controlled
// dependencies. This avoids mounting a canvas while retaining ChartPanel's genuine
// unavailable-vs-absent decision and the real terminalBoot frame scheduler.
async function chartOutcome(outcome: CacheOutcome, symbol = "KO") {
  const frames: FrameRequestCallback[] = [];
  const emitted: { type: string; detail: unknown }[] = [];
  vi.stubGlobal("window", { requestAnimationFrame: (frame: FrameRequestCallback) => { frames.push(frame); }, dispatchEvent: (event: { type: string; detail: unknown }) => { emitted.push(event); return true; } });
  vi.stubGlobal("CustomEvent", class { constructor(readonly type: string, readonly init: { detail: unknown }) {} get detail() { return this.init.detail; } });
  const source = readFileSync(path.resolve("components/ChartPanel.tsx"), "utf8");
  const start = source.indexOf("const ohlcRead = await reads.ohlc;");
  const end = source.indexOf("daily = ohlc.bars.map", start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const status = { textContent: "" };
  const javascript = ts.transpileModule(`(async () => { ${source.slice(start, end)} })()`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  await vm.runInNewContext(javascript, { reads: { ohlc: Promise.resolve(outcome) }, cpMark: () => {}, symbol, cancelled: false, epoch: 1, epochRef: { current: 1 },
    onDataOriginRef: { current: () => {} }, originUnavailable: () => ({}), deriveDataOrigin: () => ({}), clearChartData: () => {}, releaseVisualOwners: () => {},
    statusRef: { current: status }, showEmptyRef: { current: () => {} },
    announceVisualReady: (kind: "data" | "empty") => announceTerminalVisualReady(symbol, kind, { timeframe: "3D", generation: 1, isCurrent: () => true }),
  });
  for (let i = 0; frames.length && i < 70; i++) frames.shift()!(i * 16);
  return { status: status.textContent, ready: emitted.filter(event => event.type === TERMINAL_VISUAL_READY_EVENT) };
}

beforeEach(() => {
  state.cookies = [];
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("TERMINAL_E2E_FIXTURE", "1"); vi.stubEnv("FLOW_FIXTURE", "1");
  vi.stubEnv("TERMINAL_E2E_EMAIL", "responsive@example.com"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-anon-key");
  invalidate();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("preserves unavailable chart readiness when the opaque cookie reaches the shell catchall", async () => {
  state.cookies = (await producedCookies()).filter(cookie => cookie.name !== "mm_e2e_rs30");
  const forbiddenFetch = vi.fn(async () => { throw Error("unexpected provider request"); }); vi.stubGlobal("fetch", forbiddenFetch);
  const child = <span>Missing data route</span>;
  const view = await ShellLayout({ children: child });
  expect(view.type).toBe(MemberVerificationUnavailable);
  expect(view.props.children).toBeUndefined(); expect(forbiddenFetch).not.toHaveBeenCalled();
  const html = renderToStaticMarkup(<LangProvider>{view}</LangProvider>);
  expect(html).toContain("Account service unavailable");
  // Controlled HTML response of the early-return layout: the cache must not turn
  // a successful HTML body into missing history, nor ChartPanel announce READY.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(html, { status: 200, headers: { "Content-Type": "text/html" } })));
  const outcome = await getJSONResult("/data/KO.json");
  expect(outcome).toMatchObject({ status: "unavailable", reason: "malformed" });
  expect(await chartOutcome(outcome)).toEqual({ status: "Chart data unavailable.", ready: [] });
});

it.each(["KO", "WM"])("missing public %s JSON resolves before the auth-aware HTML catchall and earns only empty READY", async symbol => {
  state.cookies = await producedCookies();
  const forbiddenFetch = vi.fn(async () => { throw Error("unexpected provider request"); }); vi.stubGlobal("fetch", forbiddenFetch);
  expect(() => readFileSync(path.resolve("public/data/KO.json"))).toThrow();
  expect(() => readFileSync(path.resolve("public/data/WM.json"))).toThrow();
  const resolved = await resolveSourceRoute(`/data/${symbol}.json`);
  expect(resolved.matchedOutput?.itemPath).toBe("/data/[...path]");
  const handlerPath = path.resolve("app/data/[...path]/route.ts");
  const handler = await import(handlerPath) as { GET: () => Response; HEAD: () => Response };
  const response = handler.GET();
  expect(response.status).toBe(404); expect(response.headers.get("content-type")).toBe("application/json");
  const body = await response.text(); expect(JSON.parse(body)).toEqual({ error: "not_found" });
  expect(response.headers.get("cache-control")).toBe("no-store"); expect(forbiddenFetch).not.toHaveBeenCalled();
  expect(handler.HEAD().status).toBe(404); expect(await handler.HEAD().text()).toBe("");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: response.status, headers: response.headers })));
  const outcome = await getJSONResult(`/data/${symbol}.json`);
  expect(outcome).toMatchObject({ status: "absent", httpStatus: 404 });
  const chart = await chartOutcome(outcome, symbol);
  expect(chart.status).toBe("No data for this symbol."); expect(chart.ready).toHaveLength(1);
  expect(chart.ready[0].detail).toEqual({ symbol, state: "empty", timeframe: "3D", generation: 1 });
});

it("keeps existing public JSON ahead of the missing-resource handler and private HTML behind auth", async () => {
  expect((await resolveSourceRoute("/data/NVDA.json")).matchedOutput).toMatchObject({ type: "publicFolder", itemPath: "/data/NVDA.json" });
  expect((await resolveSourceRoute("/private-missing-page")).matchedOutput?.itemPath).toBe("/[...legacyPath]");
  state.cookies = await producedCookies();
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("unexpected provider request"); }));
  const view = await ShellLayout({ children: <span>Private child</span> });
  expect(view.type).toBe(MemberVerificationUnavailable); expect(view.props.children).toBeUndefined();
  await expect(LegacyShellPage({ params: Promise.resolve({ legacyPath: ["data", "KO.json"] }) })).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
});
