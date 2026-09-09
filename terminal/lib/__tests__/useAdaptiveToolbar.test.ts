// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  publishAdaptiveToolbarSettled,
  type AdaptiveToolbarSnapshot,
  useAdaptiveToolbar,
} from "../useAdaptiveToolbar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

let rootWidth = 650;
let container: HTMLDivElement;
let root: Root | undefined;
let clientWidthDescriptor: PropertyDescriptor | undefined;
let fontsDescriptor: PropertyDescriptor | undefined;

function installFontsReady(ready: Promise<unknown> | null): void {
  if (ready === null) {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: undefined,
    });
    return;
  }
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready },
  });
}

function ToolbarHarness({ signature = "toolbar-v1" }: { signature?: string }) {
  const { ref, mode } = useAdaptiveToolbar(signature);
  return React.createElement(
    "div",
    {
      ref,
      className: "chart-tabs",
      "data-toolbar-mode": mode,
      style: { columnGap: "0px", paddingLeft: "0px", paddingRight: "0px" },
    },
    React.createElement("div", {
      className: "ct",
      "data-test-width": "100",
      style: { marginLeft: "0px", marginRight: "0px" },
    }),
    React.createElement(
      "div",
      { className: "tools", style: { columnGap: "0px" } },
      React.createElement(
        "div",
        {
          "data-toolbar-item": "",
          "data-toolbar-timeframes": "",
          "data-test-width": "180",
          style: { marginLeft: "0px", marginRight: "0px" },
        },
        React.createElement("button", {
          className: "tfbtn on",
          "data-test-width": "40",
          style: { marginLeft: "0px", marginRight: "0px" },
        }),
        React.createElement("button", {
          className: "tfbtn-edit",
          "data-test-width": "20",
          style: { marginLeft: "0px", marginRight: "0px" },
        }),
      ),
      React.createElement("button", {
        "data-toolbar-item": "",
        "data-toolbar-core": "true",
        "data-test-width": "140",
        style: { marginLeft: "0px", marginRight: "0px" },
      }),
      React.createElement("button", {
        "data-toolbar-item": "",
        "data-test-width": "120",
        style: { marginLeft: "0px", marginRight: "0px" },
      }),
      React.createElement("button", {
        "data-toolbar-more": "",
        "data-test-width": "50",
        style: { marginLeft: "0px", marginRight: "0px" },
      }),
    ),
    React.createElement("output", { "data-rendered-mode": mode }),
  );
}

function toolbar(): HTMLDivElement {
  const element = container.querySelector<HTMLDivElement>(".chart-tabs");
  if (!element) throw new Error("toolbar harness did not mount");
  return element;
}

function mountHarness(): void {
  act(() => {
    root = createRoot(container);
    root.render(React.createElement(ToolbarHarness));
  });
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  rootWidth = 650;
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);

  clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return (this as HTMLElement).classList?.contains("chart-tabs") ? rootWidth : 0;
    },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = Number.parseFloat(this.dataset.testWidth || "0");
    return {
      x: 0,
      y: 0,
      width,
      height: 30,
      top: 0,
      right: width,
      bottom: 30,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });

  fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  if (clientWidthDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidthDescriptor);
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  }
  if (fontsDescriptor) {
    Object.defineProperty(document, "fonts", fontsDescriptor);
  } else {
    delete (document as unknown as Record<string, unknown>).fonts;
  }
});

describe("adaptive toolbar committed-settled contract", () => {
  it("withholds settled while fonts are pending, then publishes the committed final route", async () => {
    const fonts = deferred<void>();
    installFontsReady(fonts.promise);
    mountHarness();

    const element = toolbar();
    expect(element.dataset.toolbarMode).toBe("full");
    expect(element.dataset.toolbarSettled).toBeUndefined();
    // The measurement-only CSS override must never survive a synchronous measurement pass.
    // Leaving it active while fonts are pending forces every overflow item visible and makes the
    // product route disagree with the committed mode even though the settled receipt is absent.
    expect(element.dataset.toolbarMeasuring).toBeUndefined();

    // The authoritative font measurement chooses a different route. Settled may not be published
    // against the old, already-rendered route in the same closure that calculates this mode.
    rootWidth = 430;
    await act(async () => {
      fonts.resolve();
      await fonts.promise;
      await Promise.resolve();
    });

    expect(element.dataset.toolbarMode).toBe("overflow");
    expect(element.querySelector("[data-rendered-mode]")?.getAttribute("data-rendered-mode"))
      .toBe("overflow");
    expect(element.dataset.toolbarSettled).toBe("true");
    expect(Number(element.dataset.toolbarRevision)).toBeGreaterThan(1);
    expect(element.dataset.toolbarMeasuring).toBeUndefined();
  });

  it("publishes only when the DOM mode matches the same current committed revision", () => {
    const element = document.createElement("div");
    element.dataset.toolbarMode = "full";
    const snapshot: AdaptiveToolbarSnapshot = {
      mode: "overflow",
      revision: 4,
      fontGateComplete: true,
      measuredWidth: 430,
    };

    expect(publishAdaptiveToolbarSettled(element, snapshot, 4)).toBe(false);
    expect(element.dataset.toolbarSettled).toBeUndefined();

    element.dataset.toolbarMode = "overflow";
    expect(publishAdaptiveToolbarSettled(element, snapshot, 4)).toBe(true);
    expect(element.dataset.toolbarSettled).toBe("true");
    expect(element.dataset.toolbarRevision).toBe("4");

    expect(publishAdaptiveToolbarSettled(element, snapshot, 5)).toBe(false);
  });

  it("revises and re-settles changed-width measurements, including a same-mode resize", async () => {
    installFontsReady(Promise.resolve());
    mountHarness();
    await flushPromises();

    const element = toolbar();
    const observer = FakeResizeObserver.instances[0];
    expect(observer).toBeDefined();
    expect(element.dataset.toolbarSettled).toBe("true");
    const fullRevision = Number(element.dataset.toolbarRevision);

    rootWidth = 430;
    act(() => { observer.trigger(); });
    expect(element.dataset.toolbarMode).toBe("overflow");
    expect(element.dataset.toolbarSettled).toBe("true");
    const overflowRevision = Number(element.dataset.toolbarRevision);
    expect(overflowRevision).toBeGreaterThan(fullRevision);

    // A changed width is a new authoritative measurement even when it remains in overflow mode.
    rootWidth = 420;
    act(() => { observer.trigger(); });
    expect(element.dataset.toolbarMode).toBe("overflow");
    expect(element.dataset.toolbarSettled).toBe("true");
    const sameModeRevision = Number(element.dataset.toolbarRevision);
    expect(sameModeRevision).toBeGreaterThan(overflowRevision);

    // A duplicate callback for the exact same width/mode is not authoritative and must converge.
    act(() => { observer.trigger(); });
    expect(Number(element.dataset.toolbarRevision)).toBe(sameModeRevision);
  });

  it("settles deterministically from the initial measurement when FontFaceSet is unavailable", () => {
    installFontsReady(null);
    mountHarness();

    const element = toolbar();
    expect(element.dataset.toolbarMode).toBe("full");
    expect(element.dataset.toolbarSettled).toBe("true");
    expect(Number(element.dataset.toolbarRevision)).toBe(1);
  });

  it("does not let a late font promise publish after unmount", async () => {
    const fonts = deferred<void>();
    installFontsReady(fonts.promise);
    mountHarness();
    const element = toolbar();

    act(() => { root?.unmount(); });
    root = undefined;
    await act(async () => {
      fonts.resolve();
      await fonts.promise;
      await Promise.resolve();
    });

    expect(element.dataset.toolbarSettled).toBeUndefined();
    expect(element.dataset.toolbarMeasuring).toBeUndefined();
  });

  it("settles via a bounded fallback when FontFaceSet.ready never resolves or rejects (MINOR-4)", async () => {
    vi.useFakeTimers();
    try {
      // Deliberately never resolved/rejected: a hung or broken FontFaceSet implementation.
      const fonts = deferred<void>();
      installFontsReady(fonts.promise);
      mountHarness();

      const element = toolbar();
      expect(element.dataset.toolbarSettled).toBeUndefined();

      // The authoritative fallback measurement should choose a different route, proving it is a
      // real remeasurement and not merely re-publishing the stale initial snapshot.
      rootWidth = 430;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });

      expect(element.dataset.toolbarMode).toBe("overflow");
      expect(element.dataset.toolbarSettled).toBe("true");
      expect(Number(element.dataset.toolbarRevision)).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes blind action polling and binds one aggregate deadline to the owning test", () => {
    const helperSource = readFileSync(
      path.resolve(process.cwd(), "e2e", "terminalToolbar.ts"),
      "utf8",
    );

    expect(helperSource).toContain("data-toolbar-settled");
    expect(helperSource).toContain("data-toolbar-revision");
    expect(helperSource).toContain("armToolbarJourneyDeadline");
    expect(helperSource).toContain("TOOLBAR_SETTLE_WAIT_MS");
    expect(helperSource).toContain("test.info().timeout");
    expect(helperSource).toContain("_startWallTime");
    expect(helperSource).toContain("TOOLBAR_DEFAULT_UNARMED_BUDGET_MS = 8_000");
    expect(helperSource).not.toContain("TOOLBAR_JOURNEY_BUDGET_MS = 26_000");
    expect(helperSource).not.toContain("timeout: 25_000");
    expect(helperSource).not.toContain("could not reach ${opts.what}");
    expect(helperSource).not.toContain("the control moved mid-attempt");
    for (const field of [
      "what",
      "mode",
      "revision",
      "settled",
      "direct_visible",
      "more_visible",
      "more_enabled",
      "overflow_open",
      "done",
      "budget_remaining_ms",
    ]) {
      expect(helperSource).toContain(field);
    }
  });
});
