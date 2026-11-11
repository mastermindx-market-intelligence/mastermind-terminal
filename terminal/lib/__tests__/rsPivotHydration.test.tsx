// @vitest-environment jsdom
import React, { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import RSPivotStudy from "@/components/workspaces/RSPivotStudy";

const session = vi.hoisted(() => ({ account: true }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("@/components/chrome/AppShell", () => ({
  useShellIdentity: () => session.account
    ? { kind: "account", userId: "fixture", email: "fixture@example.com" }
    : { kind: "guest" },
}));
vi.mock("@/components/workspaces/RSPivotChart", () => ({ default: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove(); root = undefined; host = undefined;
  session.account = true; vi.unstubAllGlobals();
});

function serverMarkup() {
  host = document.createElement("div");
  host.innerHTML = renderToString(<RSPivotStudy />);
  document.body.append(host);
  return host.querySelector<HTMLButtonElement>("button")!;
}

it("keeps the streamed action inert until real hydration, then owns one input pair", async () => {
  const reads: Array<{ resolve: (value: Response) => void; signal: AbortSignal }> = [];
  const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>(resolve => {
    reads.push({ resolve, signal: init.signal as AbortSignal });
  }));
  vi.stubGlobal("fetch", fetcher);
  const run = serverMarkup();
  expect(run.disabled).toBe(true);
  run.click();
  expect(fetcher).not.toHaveBeenCalled();
  const recoverable: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(host!, <RSPivotStudy />, { onRecoverableError: error => recoverable.push(error) });
  });
  expect(recoverable).toEqual([]);
  expect(run.disabled).toBe(false);
  await act(async () => { run.click(); run.click(); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(reads.every(read => !read.signal.aborted)).toBe(true);
  expect(run.disabled).toBe(true);
  await act(async () => reads.forEach(read => read.resolve({ ok: true, json: async () => ({ bars: [] }) } as Response)));
  expect(host!.querySelector('[role="alert"]')?.textContent).toContain("unavailable");
  expect(run.disabled).toBe(false);
});

it("never turns the guest action on after hydration", async () => {
  session.account = false;
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const run = serverMarkup();
  expect(run.disabled).toBe(true);
  await act(async () => { root = hydrateRoot(host!, <RSPivotStudy />); });
  expect(run.disabled).toBe(true);
  await act(async () => run.click());
  expect(fetcher).not.toHaveBeenCalled();
});
