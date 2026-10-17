// Chart-engine bench readiness wait with context-lost retry.
//
// The per-run loop in bench/chart-engine.cadence.bench.ts navigates to
// /dev/chart-bench then waits for window.__mmBench to expose a `ready`
// Promise. Between page.waitForFunction resolving and page.evaluate
// running, the page may navigate again (a dev-server reload or a client
// redirect), which destroys the execution context and aborts the whole
// run before any measurement. waitBenchReady detects that specific class
// of failure, waits for the next navigation to settle, and re-arms the
// wait. Other errors (including a real timeout) are rethrown untouched.
//
// Module-level page functions are SELF-CONTAINED: they reference only
// `window` so they can be serialized into the page without a Node-side
// closure leak. This file never imports @playwright/test at runtime;
// Playwright's Page is described structurally by ReadyPage.

export type ReadyPage = {
  waitForFunction(
    fn: () => unknown,
    arg: undefined,
    opts: { timeout: number },
  ): Promise<unknown>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  waitForLoadState(
    state: "load",
    opts: { timeout: number },
  ): Promise<void>;
};

export const CONTEXT_LOST_RE =
  /Execution context was destroyed|Cannot find context with specified id/;

export function isContextLost(e: unknown): boolean {
  if (e == null) return false;
  const msg =
    e instanceof Error
      ? e.message
      : typeof e === "object" && "message" in (e as Record<string, unknown>)
        ? String((e as { message: unknown }).message)
        : String(e);
  return CONTEXT_LOST_RE.test(msg);
}

export const HAS_BENCH = (): boolean =>
  Boolean(
    (window as unknown as { __mmBench?: { ready?: Promise<void> } }).__mmBench,
  );

export const BENCH_READY = (): Promise<void> =>
  (
    window as unknown as {
      __mmBench: { ready: Promise<void> };
    }
  ).__mmBench.ready;

export async function waitBenchReady(
  page: ReadyPage,
  opts?: { timeoutMs?: number; maxAttempts?: number },
): Promise<{ attempts: number }> {
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const maxAttempts = opts?.maxAttempts ?? 3;
  let lastError: unknown = undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await page.waitForFunction(HAS_BENCH, undefined, { timeout: timeoutMs });
      await page.evaluate(BENCH_READY);
      return { attempts: attempt };
    } catch (e) {
      lastError = e;
      if (!isContextLost(e) || attempt === maxAttempts) throw e;
      await page.waitForLoadState("load", { timeout: timeoutMs });
    }
  }
  throw lastError;
}