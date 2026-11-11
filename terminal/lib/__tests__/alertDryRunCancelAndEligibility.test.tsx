// @vitest-environment jsdom
//
// E17 (#916): the alert dry-run panel's request lifetime. Adopted from the duration-independent
// recovery proposal on #916 (no client deadline, no automatic retry).
//
// Before this change:
//   • Cancel only aborted the request; the phase settled when the transport rejected, so a
//     transport that ignored the abort left the panel "running" with Run disabled until the
//     request settled on its own;
//   • the request identity was {symbol, condition}, so signing out or losing the plan left a
//     pending or finished verdict on screen;
//   • leaving and returning to the same inputs (A → B → A) showed A's old phase again.
// The input-change cleanup is also ownership-aware: a Run clicked after new inputs commit but before
// the old inputs' passive cleanup runs keeps its own request.
//
// Mounted for real: the panel under StrictMode inside the real LangProvider, with only `fetch`
// replaced. Each fetch is HELD on a promise so the pending render can be inspected before the
// transport settles. Fake timers prove no deadline timer is ever armed.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React, { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import Panel from "@/components/alerts/AlertDryRunPanel";
import { LangProvider, applyLang } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const condition = { type: "suite_event", suite: "structure", event: "bos" } as const;
const valid = { schema: "alert-dry-run/1", readOnly: true, verdict: "cannot_evaluate", reason: "no_data" };
const response = () => ({ status: 200, json: async () => valid });

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

let host: HTMLDivElement;
let root: Root;
let props: React.ComponentProps<typeof Panel>;

const state = () => host.querySelector("section")?.getAttribute("data-dry-run-state");
const button = (id = "go") => host.querySelector(`[data-testid="alert-dry-run-${id}"]`) as HTMLButtonElement;
const render = async (updates: Partial<typeof props> = {}) => {
  props = { ...props, ...updates };
  await act(async () =>
    root.render(
      <StrictMode>
        <LangProvider>
          <Panel {...props} />
        </LangProvider>
      </StrictMode>,
    ),
  );
};
const click = async (id = "go") => {
  await act(async () => button(id).click());
};
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(async () => {
  vi.useFakeTimers();
  document.documentElement.setAttribute("data-lang", "en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = { symbol: "AAPL", condition, signedIn: true, locked: false };
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("Cancel settles at once and a late transport rejection leaves it cancelled", async () => {
  const pending = deferred();
  vi.stubGlobal("fetch", vi.fn(() => pending.promise));
  await click();
  await click("cancel");
  expect(state()).toBe("cancelled");
  pending.reject(new Error("late transport rejection"));
  await flush();
  expect(state()).toBe("cancelled");
});

it.each(["headers", "body"])("Cancel settles at once during %s even if the transport ignores the abort", async (stage) => {
  const pending = deferred();
  let signal!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return stage === "headers" ? pending.promise : Promise.resolve({ status: 200, json: () => pending.promise });
    }),
  );
  await click();
  await click("cancel");
  expect(state()).toBe("cancelled");
  expect(button().disabled).toBe(false);
  expect(signal.aborted).toBe(true);
  pending.resolve(stage === "headers" ? response() : valid);
  await flush();
  expect(state()).toBe("cancelled");
});

it.each(["success", "rejection"])("a late old %s cannot settle a manual rerun", async (settlement) => {
  const old = deferred();
  const current = deferred();
  vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise));
  await click();
  await act(async () => {
    flushSync(() => button("cancel").click());
    button().click();
  });
  expect(state()).toBe("running");
  if (settlement === "success") old.resolve(response());
  else old.reject(new Error("old"));
  await flush();
  expect(state()).toBe("running");
  current.resolve(response());
  await flush();
  expect(state()).toBe("result");
});

it("A → B → A inputs do not revive a pending run", async () => {
  const old = deferred();
  vi.stubGlobal("fetch", vi.fn(() => old.promise));
  await click();
  await render({ symbol: "MSFT" });
  await render({ symbol: "AAPL" });
  expect(state()).toBe("idle");
  expect(button().disabled).toBe(false);
  old.resolve(response());
  await flush();
  expect(state()).toBe("idle");
});

it.each(["headers", "body"])("no client deadline: a slow valid %s stays running past 60 s, then completes", async (stage) => {
  const pending = deferred();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => (stage === "headers" ? pending.promise : Promise.resolve({ status: 200, json: () => pending.promise }))),
  );
  await click();
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(state()).toBe("running");
  expect(vi.getTimerCount()).toBe(0);
  pending.resolve(stage === "headers" ? response() : valid);
  await flush();
  expect(state()).toBe("result");
});

it.each(["en", "zh"] as const)("keeps the real %s cancel and locked copy", async (lang) => {
  await act(async () => applyLang(lang));
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  await click();
  await click("cancel");
  expect(host.textContent).toContain(lang === "zh" ? "试运行已取消：没有结论。" : "Dry run cancelled: no verdict.");
  await render({ locked: true });
  expect(button().disabled).toBe(true);
  expect(host.textContent).toContain(lang === "zh" ? "付费计划专享 — 升级解锁" : "Included with a paid plan — upgrade to unlock");
});

it.each([500, 200])("a malformed status-%s response stays unavailable with no invented verdict", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status, json: async () => ({ verdict: "not_met" }) }));
  await click();
  expect(state()).toBe("unavailable");
  expect(host.querySelector("section")?.getAttribute("data-dry-run-verdict")).toBe("");
});

it.each(["network", "body"])("a %s rejection stays unavailable", async (stage) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      stage === "network"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({
            status: 200,
            json: async () => {
              throw new Error("invalid");
            },
          }),
    ),
  );
  await click();
  expect(state()).toBe("unavailable");
});

// These fail when the request identity leaves out the matching eligibility flag.
it.each([{ signedIn: false }, { locked: true }])("an eligibility change clears a finished result: %j", async (update) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
  await click();
  expect(state()).toBe("result");
  await render(update);
  expect(state()).toBe("idle");
  await render({ signedIn: true, locked: false });
  expect(state()).toBe("idle");
});

it.each([{ signedIn: false }, { locked: true }])("an eligibility change fences a pending run and resets: %j", async (update) => {
  const pending = deferred();
  let signal!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return pending.promise;
    }),
  );
  await click();
  await render(update);
  expect.soft(state()).toBe("idle");
  expect.soft(signal.aborted).toBe(true);
  expect.soft(button().disabled).toBe(true);
  expect.soft(vi.getTimerCount()).toBe(0);
  pending.resolve(response());
  await flush();
  expect.soft(state()).toBe("idle");
  await render({ signedIn: true, locked: false });
  expect.soft(state()).toBe("idle");
  expect.soft(button().disabled).toBe(false);
});

it("removing and re-adding the condition cannot revive a pending body under StrictMode", async () => {
  const body = deferred();
  let signal!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return Promise.resolve({ status: 200, json: () => body.promise });
    }),
  );
  await click();
  await render({ condition: null });
  expect(host.querySelector("section")).toBeNull();
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await render({ condition });
  body.resolve(valid);
  await flush();
  expect(state()).toBe("idle");
});

it("smoke: after an unmount mid-request a fresh root still runs and arms no timer", async () => {
  const body = deferred();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce({ status: 200, json: () => body.promise }).mockResolvedValueOnce(response()),
  );
  await click();
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  root = createRoot(host);
  await render();
  await click();
  expect(state()).toBe("result");
  body.reject(new Error("old root"));
  await flush();
  expect(state()).toBe("result");
  expect(vi.getTimerCount()).toBe(0);
});

// Clicks Run inside the commit that applies new inputs: the DOM already holds the new handler, and
// the old inputs' passive cleanup has not run yet. A click lands there when an async input change
// commits and the user clicks before React flushes passive effects.
function ClickOnCommit({ armed }: { armed: boolean }) {
  useLayoutEffect(() => {
    if (armed) button().click();
  }, [armed]);
  return null;
}

it.each([
  { from: {}, to: { symbol: "MSFT" } },
  { from: { signedIn: false }, to: { signedIn: true } },
])("a Run clicked before the old inputs' cleanup keeps its own request: %j", async ({ from, to }) => {
  const pending = deferred();
  let signal!: AbortSignal;
  const fetchMock = vi.fn((_url: string, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return pending.promise;
  });
  vi.stubGlobal("fetch", fetchMock);
  const tree = (armed: boolean) => (
    <StrictMode>
      <LangProvider>
        <Panel {...props} />
        <ClickOnCommit armed={armed} />
      </LangProvider>
    </StrictMode>
  );
  props = { ...props, ...from };
  await act(async () => root.render(tree(false)));
  props = { ...props, ...to };
  await act(async () => root.render(tree(true)));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(state()).toBe("running");
  expect(signal.aborted).toBe(false);
  pending.resolve(response());
  await flush();
  expect(state()).toBe("result");
});
