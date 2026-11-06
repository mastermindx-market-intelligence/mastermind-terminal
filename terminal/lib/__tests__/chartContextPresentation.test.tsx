// @vitest-environment jsdom
import React, { StrictMode, act, useRef } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChartContextPresentation } from "@/components/useChartContextPresentation";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Props {
  target: HTMLElement | null;
  open: boolean;
  scope: string;
  disabled?: boolean;
  focusNext?: boolean;
  hidePrevious?: boolean;
}
function Reader({ target, open, scope, disabled, focusNext, hidePrevious }: Props) {
  const reader = useRef<HTMLElement>(null);
  const ui = useChartContextPresentation(reader, scope, open, target);
  return open && target ? createPortal(
    <section ref={reader} data-reader style={{ overflow: target.dataset.mode === "panel" ? "auto" : "visible" }}>
      {!hidePrevious && <button data-context-focus="previous" disabled={disabled}>Previous</button>}
      <button data-context-focus="next" autoFocus={focusNext}>Next</button>
      <details open={ui.expanded.help}>
        <summary data-context-focus="help" onClick={(event) => { event.preventDefault(); ui.toggle("help"); }}>Help</summary>
        <p>Reader explanation</p>
      </details>
    </section>, target,
  ) : null;
}

describe("chart reader presentation across portal replacement", () => {
  let container: HTMLElement;
  let root: Root;
  let outside: HTMLButtonElement;
  let props: Props;
  let observers: { active: boolean; emit: () => void }[];
  const hosts: HTMLElement[] = [];

  function host(mode: "panel" | "host" | "page" = "panel", height = 300, content = 1200) {
    const node = document.createElement("div");
    node.dataset.mode = mode;
    node.dataset.viewport = String(height);
    node.dataset.content = String(content);
    node.style.overflow = mode === "host" ? "auto" : "visible";
    document.body.append(node);
    hosts.push(node);
    return node;
  }
  async function render(patch: Partial<Props> = {}) {
    props = { ...props, ...patch };
    await act(async () => root.render(<StrictMode><Reader {...props} /></StrictMode>));
  }
  const panel = () => document.querySelector<HTMLElement>("[data-reader]")!;
  const control = (key = "previous") => panel().querySelector<HTMLElement>(`[data-context-focus="${key}"]`)!;
  function scroll(node: HTMLElement, top: number) {
    node.scrollTop = top;
    node.dispatchEvent(new Event("scroll"));
  }
  function toggleHelp() {
    control("help").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }
  function resize() {
    for (const observer of observers) if (observer.active) observer.emit();
  }

  beforeEach(() => {
    observers = [];
    vi.stubGlobal("ResizeObserver", class {
      record: { active: boolean; emit: () => void };
      constructor(callback: ResizeObserverCallback) {
        this.record = { active: true, emit: () => callback([], this as unknown as ResizeObserver) };
        observers.push(this.record);
      }
      observe() {}
      disconnect() { this.record.active = false; }
    });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return Number(this.dataset.viewport ?? 300);
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return Number(this.dataset.content ?? (this.hasAttribute("data-reader") ? 1200 : 300));
    });
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
      return (this.isConnected ? [new DOMRect(0, 0, 320, 44)] : []) as unknown as DOMRectList;
    });
    container = document.createElement("div");
    outside = document.createElement("button");
    document.body.append(container, outside);
    root = createRoot(container);
    props = { target: host(), open: true, scope: "NVDA:3D:live" };
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    outside.remove();
    hosts.splice(0).forEach((node) => node.remove());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retains disclosure, scroll and focus even when the old host is detached before commit", async () => {
    await render();
    act(toggleHelp);
    control().focus();
    scroll(panel(), 280);
    props.target!.remove();
    await render({ target: host() });
    expect(panel().querySelector("details")!.open).toBe(true);
    expect(panel().scrollTop).toBe(280);
    expect(document.activeElement).toBe(control());
  });

  it("keeps a same-session snapshot through a temporary null portal target", async () => {
    await render();
    act(toggleHelp);
    control("help").focus();
    scroll(panel(), 320);
    await render({ target: null });
    await render({ target: host("host") });
    expect(panel().querySelector("details")!.open).toBe(true);
    expect(props.target!.scrollTop).toBe(320);
    expect(document.activeElement).toBe(control("help"));
  });

  it("commits a summary activation even if the host changes in the same task", async () => {
    await render();
    const replacement = host();
    await act(async () => {
      toggleHelp();
      props = { ...props, target: replacement };
      root.render(<StrictMode><Reader {...props} /></StrictMode>);
    });
    expect(panel().querySelector("details")!.open).toBe(true);
  });

  it("retains the internal offset through plain inline mode without moving the page", async () => {
    await render();
    scroll(panel(), 310);
    const pageScroll = vi.spyOn(window, "scrollTo");
    await render({ target: host("page") });
    expect(pageScroll).not.toHaveBeenCalled();
    await render({ target: host() });
    expect(panel().scrollTop).toBe(310);
  });

  it("clamps to the bounded host's actual available range", async () => {
    await render();
    scroll(panel(), 600);
    await render({ target: host("host", 300, 420) });
    expect(props.target!.scrollTop).toBe(120);
  });

  it("changes internal scroller when fullscreen reuses the same host", async () => {
    await render();
    scroll(panel(), 330);
    panel().style.overflow = "visible";
    props.target!.style.overflow = "auto";
    resize();
    expect(props.target!.scrollTop).toBe(330);
    scroll(props.target!, 150);
    panel().style.overflow = "auto";
    props.target!.style.overflow = "visible";
    resize();
    expect(panel().scrollTop).toBe(150);
  });

  it("ignores a zero scroll from a now non-scrollable old panel", async () => {
    await render();
    scroll(panel(), 290);
    panel().style.overflow = "visible";
    scroll(panel(), 0);
    await render({ target: host() });
    expect(panel().scrollTop).toBe(290);
  });

  it("does not reset an intentional user scroll on an unrelated render or resize", async () => {
    await render();
    scroll(panel(), 250);
    await render();
    scroll(panel(), 90);
    resize();
    expect(panel().scrollTop).toBe(90);
  });

  it("does not take focus from a different outside control during a host gap", async () => {
    await render();
    control().focus();
    await render({ target: null });
    outside.focus();
    await render({ target: host() });
    expect(document.activeElement).toBe(outside);
  });

  it.each(["pointerdown", "keydown"])("cancels restoration after outside %s intent even when focus falls back to body", async (eventName) => {
    await render();
    control().focus();
    document.body.dispatchEvent(new Event(eventName, { bubbles: true }));
    await render({ target: host() });
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves a different newly focused reader control alone", async () => {
    await render();
    control().focus();
    await render({ target: host(), focusNext: true });
    expect(document.activeElement).toBe(control("next"));
  });

  it("does not restore to a disabled control", async () => {
    await render();
    control().focus();
    await render({ target: host(), disabled: true });
    expect(document.activeElement).toBe(document.body);
  });

  it("does not restore a control absent from the new reader state", async () => {
    await render();
    control().focus();
    await render({ target: host(), hidePrevious: true });
    expect(document.activeElement).toBe(document.body);
  });

  it("resets a reused scroller for a new source while retaining only still-owned live focus", async () => {
    await render();
    act(toggleHelp);
    control().focus();
    scroll(panel(), 250);
    await render({ scope: "AAPL:3D:live" });
    expect(panel().scrollTop).toBe(0);
    expect(panel().querySelector("details")!.open).toBe(false);
    expect(document.activeElement).toBe(control());
    await render({ target: host() });
    expect(document.activeElement).toBe(control());
    expect(panel().scrollTop).toBe(0);
  });

  it("does not resurrect a cancelled focus claim when source identity changes", async () => {
    await render();
    control().focus();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await render({ scope: "AAPL:3D:live" });
    await render({ target: host() });
    expect(document.activeElement).toBe(document.body);
  });

  it("carries a source reset through a missing host and ignores the old source's late scroll", async () => {
    await render();
    const oldPanel = panel();
    scroll(oldPanel, 250);
    await render({ target: null, scope: "AAPL:3D:live" });
    scroll(oldPanel, 400);
    await render({ target: host("host") });
    expect(props.target!.scrollTop).toBe(0);
  });

  it("does not claim focus while the document is inactive", async () => {
    await render();
    control().focus();
    vi.mocked(document.hasFocus).mockReturnValue(false);
    await render({ target: host() });
    expect(document.activeElement).toBe(document.body);
  });

  it("explicit dismissal clears presentation memory without taking the launcher's focus", async () => {
    await render();
    act(toggleHelp);
    control().focus();
    scroll(panel(), 250);
    await render({ open: false });
    outside.focus();
    await render({ open: true, target: host() });
    expect(panel().querySelector("details")!.open).toBe(false);
    expect(panel().scrollTop).toBe(0);
    expect(document.activeElement).toBe(outside);
  });

  it.each(["AAPL:3D:live", "NVDA:D:live", "NVDA:3D:replay"])("resets presentation on source identity %s", async (scope) => {
    await render();
    act(toggleHelp);
    control().focus();
    scroll(panel(), 250);
    await render({ scope, target: host() });
    expect(panel().querySelector("details")!.open).toBe(false);
    expect(panel().scrollTop).toBe(0);
    expect(document.activeElement).toBe(document.body);
  });
});

