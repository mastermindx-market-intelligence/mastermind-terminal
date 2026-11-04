/**
 * chartEngineBenchReady.test.ts — unit tests for waitBenchReady (the
 * context-lost retry around the bench readiness wait).
 *
 * A small fake ReadyPage records every method call and lets each test
 * script the next response: first success, a one-shot context-lost then
 * success, a real timeout. Test (f) verifies the page functions exported
 * from ready.ts are SELF-CONTAINED: they reference only `window` when run
 * in a fresh node:vm context.
 */

import { describe, expect, it, vi } from "vitest";
import * as vm from "node:vm";
import {
  BENCH_READY,
  CONTEXT_LOST_RE,
  HAS_BENCH,
  isContextLost,
  waitBenchReady,
  type ReadyPage,
} from "../chart-engine/bench/ready";

type Call =
  | { kind: "waitForFunction"; fn: () => unknown; arg: unknown; opts: { timeout: number } }
  | { kind: "evaluate"; fn: () => unknown }
  | { kind: "waitForLoadState"; state: "load"; opts: { timeout: number } };

function makeFake(
  evaluateResponses: Array<() => Promise<unknown> | unknown>,
): { page: ReadyPage; calls: Call[] } {
  const calls: Call[] = [];
  let evaluateIdx = 0;
  const page: ReadyPage = {
    waitForFunction: vi.fn(async (fn, arg, opts) => {
      calls.push({ kind: "waitForFunction", fn, arg, opts });
      return true;
    }),
    evaluate: vi.fn((fn: () => unknown) => {
      calls.push({ kind: "evaluate", fn });
      const response = evaluateResponses[evaluateIdx++];
      if (!response) throw new Error("evaluate: no scripted response");
      return response();
    }) as ReadyPage["evaluate"],
    waitForLoadState: vi.fn(async (state, opts) => {
      calls.push({ kind: "waitForLoadState", state, opts });
    }),
  };
  return { page, calls };
}

describe("isContextLost", () => {
  it("matches the canonical Playwright execution-context-destroyed message", () => {
    expect(
      isContextLost(
        new Error(
          "page.evaluate: Execution context was destroyed, most likely because of a navigation",
        ),
      ),
    ).toBe(true);
  });
  it("matches the 'Cannot find context with specified id' Playwright variant", () => {
    expect(isContextLost(new Error("Cannot find context with specified id"))).toBe(true);
  });
  it("does NOT match a real timeout", () => {
    expect(isContextLost(new Error("page.waitForFunction: Timeout 120000ms exceeded."))).toBe(false);
  });
  it("does NOT match a generic JS error", () => {
    expect(isContextLost(new Error("boom"))).toBe(false);
  });
  it("does NOT match a closed page/browser (must never be retried)", () => {
    expect(isContextLost(new Error("page.evaluate: Target page, context or browser has been closed"))).toBe(false);
    expect(isContextLost(new Error("Target crashed."))).toBe(false);
  });
  it("exports CONTEXT_LOST_RE with both branches", () => {
    expect(CONTEXT_LOST_RE.test("Execution context was destroyed")).toBe(true);
    expect(CONTEXT_LOST_RE.test("Cannot find context with specified id")).toBe(true);
  });
});

describe("waitBenchReady", () => {
  it("(a) first attempt succeeds; waitForLoadState never called", async () => {
    const { page, calls } = makeFake([async () => undefined]);
    const out = await waitBenchReady(page, { timeoutMs: 120_000, maxAttempts: 3 });
    expect(out).toEqual({ attempts: 1 });
    const wfls = calls.filter((c) => c.kind === "waitForLoadState");
    expect(wfls.length).toBe(0);
  });

  it("(b) evaluate rejects once with a context-lost then succeeds; waitForLoadState called exactly once", async () => {
    const { page, calls } = makeFake([
      async () => {
        throw new Error(
          "page.evaluate: Execution context was destroyed, most likely because of a navigation",
        );
      },
      async () => undefined,
    ]);
    const out = await waitBenchReady(page, { timeoutMs: 120_000, maxAttempts: 3 });
    expect(out).toEqual({ attempts: 2 });
    const wfls = calls.filter((c) => c.kind === "waitForLoadState");
    expect(wfls.length).toBe(1);
    expect(wfls[0]).toEqual({ kind: "waitForLoadState", state: "load", opts: { timeout: 120_000 } });
  });

  it("(c) evaluate rejects with a non-context-lost error -> rethrown unchanged; no retry; waitForLoadState never called", async () => {
    const timeoutErr = new Error("page.waitForFunction: Timeout 120000ms exceeded.");
    const { page, calls } = makeFake([async () => Promise.reject(timeoutErr)]);
    await expect(
      waitBenchReady(page, { timeoutMs: 120_000, maxAttempts: 3 }),
    ).rejects.toBe(timeoutErr);
    const wfls = calls.filter((c) => c.kind === "waitForLoadState");
    expect(wfls.length).toBe(0);
  });

  it("(d) every attempt loses context -> rejects with the LAST error after exactly maxAttempts; maxAttempts: 2 gives exactly 2", async () => {
    const err1 = new Error("Execution context was destroyed, first");
    const err2 = new Error("Execution context was destroyed, second");
    const err3 = new Error("Execution context was destroyed, third");
    const { page: page3, calls: calls3 } = makeFake([
      async () => Promise.reject(err1),
      async () => Promise.reject(err2),
      async () => Promise.reject(err3),
    ]);
    await expect(
      waitBenchReady(page3, { timeoutMs: 120_000, maxAttempts: 3 }),
    ).rejects.toBe(err3);
    const wf3 = calls3.filter((c) => c.kind === "waitForFunction");
    expect(wf3.length).toBe(3);

    const errA = new Error("Execution context was destroyed, A");
    const errB = new Error("Execution context was destroyed, B");
    const { page: page2, calls: calls2 } = makeFake([
      async () => Promise.reject(errA),
      async () => Promise.reject(errB),
    ]);
    await expect(
      waitBenchReady(page2, { timeoutMs: 120_000, maxAttempts: 2 }),
    ).rejects.toBe(errB);
    const wf2 = calls2.filter((c) => c.kind === "waitForFunction");
    expect(wf2.length).toBe(2);
  });

  it("(c2) a closed-page error is rethrown as the SAME object with no retry", async () => {
    const closed = new Error("page.evaluate: Target page, context or browser has been closed");
    const { page, calls } = makeFake([async () => Promise.reject(closed)]);
    await expect(waitBenchReady(page, { timeoutMs: 120_000, maxAttempts: 3 })).rejects.toBe(closed);
    expect(calls.filter((c) => c.kind === "waitForLoadState").length).toBe(0);
    expect(calls.filter((c) => c.kind === "waitForFunction").length).toBe(1);
  });

  it("(g) the retry AWAITS waitForLoadState before re-arming waitForFunction", async () => {
    const order: string[] = [];
    let wfCount = 0;
    const page: ReadyPage = {
      waitForFunction: vi.fn(async () => {
        wfCount += 1;
        order.push(`wf${wfCount}:start`);
        order.push(`wf${wfCount}:end`);
        return true;
      }),
      evaluate: vi.fn(async () => {
        if (wfCount === 1) {
          throw new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation");
        }
        order.push("evaluate:ok");
      }) as ReadyPage["evaluate"],
      waitForLoadState: vi.fn(async () => {
        order.push("wfls:start");
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("wfls:end");
      }),
    };
    const out = await waitBenchReady(page, { timeoutMs: 120_000, maxAttempts: 3 });
    expect(out).toEqual({ attempts: 2 });
    expect(order).toEqual([
      "wf1:start", "wf1:end", "wfls:start", "wfls:end", "wf2:start", "wf2:end", "evaluate:ok",
    ]);
  });

  it("(h) waitForFunction itself rejecting with a context-lost error is retried too", async () => {
    const lost = new Error(
      "page.waitForFunction: Execution context was destroyed, most likely because of a navigation.",
    );
    const seen: string[] = [];
    let wfCount = 0;
    const page: ReadyPage = {
      waitForFunction: vi.fn(async () => {
        wfCount += 1;
        seen.push(`waitForFunction#${wfCount}`);
        if (wfCount === 1) throw lost;
        return true;
      }),
      evaluate: vi.fn(async () => {
        seen.push("evaluate");
      }) as ReadyPage["evaluate"],
      waitForLoadState: vi.fn(async () => {
        seen.push("waitForLoadState");
      }),
    };
    const out = await waitBenchReady(page, { timeoutMs: 120_000, maxAttempts: 3 });
    expect(out).toEqual({ attempts: 2 });
    expect(seen).toEqual(["waitForFunction#1", "waitForLoadState", "waitForFunction#2", "evaluate"]);
  });

  it("(i) maxAttempts: 0 is clamped to one attempt and rejects with a real Error", async () => {
    const { page, calls } = makeFake([]);
    await expect(waitBenchReady(page, { timeoutMs: 1, maxAttempts: 0 })).rejects.toBeInstanceOf(Error);
    expect(calls.filter((c) => c.kind === "waitForFunction").length).toBe(1);
  });

  it("(e) waitForFunction is called with arg === undefined and opts { timeout: <timeoutMs> } as the third argument", async () => {
    const { page, calls } = makeFake([async () => undefined]);
    await waitBenchReady(page, { timeoutMs: 120_000, maxAttempts: 3 });
    const wfs = calls.filter((c) => c.kind === "waitForFunction");
    expect(wfs.length).toBe(1);
    expect(wfs[0].arg).toBeUndefined();
    expect(wfs[0].opts).toEqual({ timeout: 120_000 });
  });
});

describe("HAS_BENCH and BENCH_READY are self-contained page functions", () => {
  function runInFreshContext(fn: () => unknown, windowObj: Record<string, unknown>): unknown {
    return vm.runInNewContext("(" + fn.toString() + ")()", { window: windowObj });
  }

  it("(f) page functions captured from the fake run in a fresh vm scope without a Node closure", async () => {
    // First, exercise waitBenchReady once so the fake captures HAS_BENCH and BENCH_READY.
    const { page, calls } = makeFake([async () => undefined]);
    await waitBenchReady(page, { timeoutMs: 120_000, maxAttempts: 3 });
    const waitForFnCalls = calls.filter(
      (c): c is { kind: "waitForFunction"; fn: () => unknown; arg: unknown; opts: { timeout: number } } =>
        c.kind === "waitForFunction",
    );
    const evalCalls = calls.filter(
      (c): c is { kind: "evaluate"; fn: () => unknown } => c.kind === "evaluate",
    );
    expect(waitForFnCalls.length).toBe(1);
    expect(evalCalls.length).toBe(1);
    const capturedHasBench = waitForFnCalls[0].fn;
    const capturedBenchReady = evalCalls[0].fn;

    // The captured function must reference only `window`; with __mmBench it returns true.
    expect(
      runInFreshContext(capturedHasBench, {
        __mmBench: { ready: Promise.resolve() },
      }),
    ).toBe(true);
    // With an empty window it must return false.
    expect(runInFreshContext(capturedHasBench, {})).toBe(false);

    // BENCH_READY must resolve when window.__mmBench.ready exists.
    const ready = runInFreshContext(capturedBenchReady, {
      __mmBench: { ready: Promise.resolve() },
    }) as Promise<void>;
    await expect(ready).resolves.toBeUndefined();

    // A Node-closure-leaked function MUST throw ReferenceError in a fresh vm scope.
    const leaked = (): boolean => Boolean(someNodeSideName);
    expect(() => runInFreshContext(leaked, {})).toThrowError(/someNodeSideName is not defined/);

    // Sanity: the exported HAS_BENCH and BENCH_READY pass the same self-contained test.
    expect(
      runInFreshContext(HAS_BENCH, { __mmBench: { ready: Promise.resolve() } }),
    ).toBe(true);
    expect(runInFreshContext(HAS_BENCH, {})).toBe(false);
    const exportedReady = runInFreshContext(BENCH_READY, {
      __mmBench: { ready: Promise.resolve() },
    }) as Promise<void>;
    await expect(exportedReady).resolves.toBeUndefined();
  });
});

function someNodeSideName(): boolean {
  return true;
}