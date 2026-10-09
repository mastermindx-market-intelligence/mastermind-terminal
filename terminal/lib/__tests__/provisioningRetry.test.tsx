// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, StrictMode, Suspense, use, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

const H = vi.hoisted(() => {
  const state = { refresh: () => {} };
  return { state, router: { refresh: () => state.refresh() } };
});
vi.mock("next/navigation", () => ({ useRouter: () => H.router }));
vi.mock("@/lib/i18n", () => ({ tPlain: (_key: string, fallback: string) => fallback }));

import ProvisioningRetry from "@/components/ProvisioningRetry";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Result = { ready: boolean };
type Pending = { promise: Promise<Result>; resolve: (value: Result) => void };
let root: Root;
let container: HTMLDivElement;
let requests: Pending[];
function deferred(): Pending {
  let resolve!: Pending["resolve"];
  const promise = new Promise<Result>((done) => { resolve = done; });
  return { promise, resolve };
}

// The real Next/RSC fixture accompanies this suite. Here a refresh schedules the
// same React transition/suspension boundary: the current fallback stays mounted
// while the response is pending, and unchanged fallback responses retain state.
function ReadResult({ result }: { result: Result | Promise<Result> }) {
  const value = result instanceof Promise ? use(result) : result;
  return value.ready ? <div data-ready="true">Workspace ready</div> : <ProvisioningRetry />;
}
function Harness() {
  const [result, setResult] = useState<Result | Promise<Result>>({ ready: false });
  H.state.refresh = () => {
    const pending = deferred();
    requests.push(pending);
    setResult(pending.promise);
  };
  return <Suspense fallback={<div>Loading route</div>}><ReadResult result={result} /></Suspense>;
}
async function mount(strict = false) {
  await act(async () => { root.render(strict ? <StrictMode><Harness /></StrictMode> : <Harness />); });
}
async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
async function settle(ready = false) {
  await act(async () => { requests.at(-1)!.resolve({ ready }); });
}
beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  requests = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("workspace provisioning recovery", () => {
  it("retries an unchanged mounted fallback and reaches a later successful response", async () => {
    await mount();
    await advance(1200);
    expect(requests).toHaveLength(1);
    await settle();
    await advance(1199);
    expect(requests).toHaveLength(1);
    await advance(1);
    expect(requests).toHaveLength(2);
    await settle(true);
    expect(container.querySelector("[data-ready]")).not.toBeNull();
    await advance(60_000);
    expect(requests).toHaveLength(2);
  });

  it("never overlaps a slow refresh or exposes Retry while that response is pending", async () => {
    await mount();
    await advance(1200);
    await advance(60_000);
    expect(requests).toHaveLength(1);
    expect(container.querySelector("button")).toBeNull();
    await settle();
    await advance(1200);
    expect(requests).toHaveLength(2);
  });

  it("stops after four completed refreshes and reveals manual Retry without remounting", async () => {
    await mount();
    for (let i = 1; i <= 4; i++) {
      await advance(1200);
      expect(requests).toHaveLength(i);
      expect(container.querySelector("button")).toBeNull();
      await settle();
    }
    expect(container.querySelector("button")?.textContent).toBe("Retry");
    expect(sessionStorage.getItem("mm.provRetry")).toBe("4");
    await advance(60_000);
    expect(requests).toHaveLength(4);
  });

  it("resumes only the remaining per-tab budget", async () => {
    sessionStorage.setItem("mm.provRetry", "3");
    await mount();
    await advance(1200);
    expect(requests).toHaveLength(1);
    await settle();
    expect(container.querySelector("button")?.textContent).toBe("Retry");
    await advance(60_000);
    expect(requests).toHaveLength(1);
  });

  it.each(["4", "9"])("an already exhausted budget %s immediately offers manual Retry", async (stored) => {
    sessionStorage.setItem("mm.provRetry", stored);
    await mount();
    expect(container.querySelector("button")?.textContent).toBe("Retry");
    await advance(60_000);
    expect(requests).toHaveLength(0);
  });

  it.each(["not-a-number", "-2"])("malformed budget %s cannot exceed four attempts", async (stored) => {
    sessionStorage.setItem("mm.provRetry", stored);
    await mount();
    for (let i = 0; i < 4; i++) { await advance(1200); await settle(); }
    expect(container.querySelector("button")?.textContent).toBe("Retry");
    await advance(60_000);
    expect(requests).toHaveLength(4);
  });

  it("storage failure still has a finite in-memory budget", async () => {
    for (const key of ["getItem", "setItem"] as const)
      vi.spyOn(Storage.prototype, key).mockImplementation(() => { throw new Error("blocked storage"); });
    await mount();
    for (let i = 0; i < 4; i++) { await advance(1200); await settle(); }
    expect(container.querySelector("button")?.textContent).toBe("Retry");
    await advance(60_000);
    expect(requests).toHaveLength(4);
  });

  it("Strict Mode creates one active timer and cleanup cancels an unstarted retry", async () => {
    await mount(true);
    await advance(1200);
    expect(requests).toHaveLength(1);
    await settle();
    await act(async () => root.render(<div>Left route</div>));
    await advance(60_000);
    expect(requests).toHaveLength(1);
  });
});
