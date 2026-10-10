// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RSPivotStudy from "@/components/workspaces/RSPivotStudy";

vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({ kind: "account", email: "fixture@example.com", userId: "fixture" }) }));
vi.mock("@/components/workspaces/RSPivotChart", () => ({ default: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root, host:HTMLDivElement;
const pending:Array<{resolve:(response:Response)=>void;signal:AbortSignal}>=[];
const source=vi.fn((_url:string, init:RequestInit) => new Promise<Response>(resolve => pending.push({resolve,signal:init.signal as AbortSignal})));
beforeEach(() => {
  pending.length=0; source.mockClear(); vi.stubGlobal("fetch",source);
  host=document.createElement("div"); document.body.append(host); root=createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("owns one pending run before React disables the button and recovers from an unavailable source", async () => {
  await act(async () => root.render(<RSPivotStudy />));
  const run=()=>host.querySelector<HTMLButtonElement>('button')!;
  await act(async () => { run().click(); run().click(); });
  // Two inputs for one run; no second pair of requests before the busy commit.
  expect(source).toHaveBeenCalledTimes(2); expect(run().disabled).toBe(true);
  await act(async () => { pending.slice(0,2).forEach(p=>p.resolve({ok:true,json:async()=>({bars:[]})} as Response)); });
  expect(run().disabled).toBe(false); expect(host.querySelector('[role="alert"]')?.textContent).toContain('unavailable');
  await act(async () => run().click());
  expect(source).toHaveBeenCalledTimes(4); expect(run().disabled).toBe(true);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => root.unmount());
  expect(pending.slice(2).every(p=>p.signal.aborted)).toBe(true);
  // Transport may ignore abort and settle later; there is no current mounted run.
  await act(async () => { pending.slice(2).forEach(p=>p.resolve({ok:true,json:async()=>({bars:[]})} as Response)); });
});
