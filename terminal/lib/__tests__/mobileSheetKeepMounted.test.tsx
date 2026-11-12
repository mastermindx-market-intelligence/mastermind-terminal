// @vitest-environment jsdom
// PP2-UI-b — MobileSheet keeps its children mounted when `keepMounted` is true and the
// sheet is parked (open=false). The default behaviour is unchanged: closed renders nothing.
//
// Falsifier 5 of the accepted Paper contract (#723) plus the Codex build-identity edge:
// Selection retains root, strike, expiry, and source session through Map → Pin/chart →
// return; the chart instance remains mounted and map scroll restores.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MobileSheet from "@/components/ui/MobileSheet";

let rootEl: HTMLDivElement, host: Root;
let mountCount = 0;

interface CounterProps { label: string }
function Counter({ label }: CounterProps) {
  React.useEffect(() => {
    mountCount += 1;
    return () => { mountCount -= 1; };
  }, []);
  return <span data-counter-label={label}>{label}</span>;
}

interface WrapperProps {
  open: boolean;
  keepMounted?: boolean;
  onClose: () => void;
  detents?: readonly [number, number];
}
function Wrapper({ open, keepMounted, onClose, detents }: WrapperProps) {
  return <MobileSheet open={open} keepMounted={keepMounted} onClose={onClose} detents={detents} initialFocus="sheet">
    <div data-pp2b-child><Counter label="A" /></div>
  </MobileSheet>;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; },
    } as unknown as MediaQueryList)) as typeof window.matchMedia;
  }
  // jsdom may ship requestAnimationFrame; force a deterministic timer-based one.
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(Date.now()), 0)) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as unknown as typeof window.cancelAnimationFrame;
  // jsdom does not ship PointerEvent; provide a minimal polyfill so React's onPointerDown
  // family receives the right prototype.
  if (typeof globalThis.PointerEvent === "undefined") {
    class PointerEventPolyfill extends MouseEvent {
      public readonly pointerId: number;
      public readonly pointerType: string;
      public readonly isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? "";
        this.isPrimary = init.isPrimary ?? false;
      }
    }
    // @ts-expect-error: jsdom global.
    globalThis.PointerEvent = PointerEventPolyfill;
    // @ts-expect-error: jsdom window.
    window.PointerEvent = PointerEventPolyfill;
  }
  rootEl = document.createElement("div");
  document.body.appendChild(rootEl);
  host = createRoot(rootEl);
  mountCount = 0;
});

afterEach(async () => {
  await act(async () => host.unmount());
  rootEl.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flushFrames() {
  // Run every timer (raf-substitute timeout, etc.) inside React's act boundary.
  await act(async () => { await vi.runAllTimersAsync(); });
}

async function render(props: WrapperProps) {
  await act(async () => { host.render(<Wrapper {...props} />); });
  await flushFrames();
}

describe("mobileSheetKeepMounted (k1) default behaviour is unchanged", () => {
  it("renders no dialog when closed", async () => {
    await render({ open: false, onClose: () => {} });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mountCount).toBe(0);
  });

  it("unmounts the child on a normal close (open true → false, no keepMounted)", async () => {
    await render({ open: true, onClose: () => {} });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(mountCount).toBe(1);
    await render({ open: false, onClose: () => {} });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mountCount).toBe(0);
  });
});

describe("mobileSheetKeepMounted (k2) parking keeps the children mounted", () => {
  it("keeps the root rendered with inert, aria-hidden, data-parked, inline visibility & pointer-events; no scrim; no body scroll lock", async () => {
    await render({ open: true, onClose: () => {} });
    expect(mountCount).toBe(1);
    await render({ open: false, keepMounted: true, onClose: () => {} });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog!.hasAttribute("inert")).toBe(true);
    expect(dialog!.getAttribute("aria-hidden")).toBe("true");
    expect(dialog!.getAttribute("data-parked")).toBe("true");
    expect(dialog!.hasAttribute("aria-modal")).toBe(false);
    const inlineStyle = dialog!.getAttribute("style") ?? "";
    expect(inlineStyle).toContain("visibility: hidden");
    expect(inlineStyle).toContain("pointer-events: none");
    expect(document.querySelector(".msheet-scrim")).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(mountCount).toBe(1);
  });

  it("does NOT remount when the sheet is re-presented after parking", async () => {
    await render({ open: true, onClose: () => {} });
    expect(mountCount).toBe(1);
    await render({ open: false, keepMounted: true, onClose: () => {} });
    expect(mountCount).toBe(1);
    // park again, re-present
    await render({ open: false, keepMounted: true, onClose: () => {} });
    await render({ open: true, keepMounted: true, onClose: () => {} });
    expect(mountCount).toBe(1);
  });
});

describe("mobileSheetKeepMounted (k3) parked sheet swallows no keystrokes", () => {
  it("Escape and Tab on document do not call onClose while parked", async () => {
    const onClose = vi.fn();
    await render({ open: true, onClose });
    await render({ open: false, keepMounted: true, onClose });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("mobileSheetKeepMounted (k4) re-presenting restores the last inner focus without overwriting previousFocusRef", () => {
  it("a button focused inside the sheet, parked, then re-presented regains focus", async () => {
    const onClose = vi.fn();
    function Wrapper({ open, keepMounted }: { open: boolean; keepMounted?: boolean }) {
      return <div>
        <button type="button" data-opener>Outside</button>
        <MobileSheet open={open} keepMounted={keepMounted} onClose={onClose} initialFocus="sheet">
          <div>
            <button type="button" data-pp2b-inner>Inner</button>
          </div>
        </MobileSheet>
      </div>;
    }
    // 1) initial mount closed so previousFocus is recorded as the opener on the OPEN
    // transition below, the same path as a real launcher click.
    await act(async () => { host.render(<Wrapper open={false} />); });
    await flushFrames();
    const opener = document.querySelector<HTMLButtonElement>("[data-opener]")!;
    expect(opener).not.toBeNull();

    // 2) open the sheet — focus is on the opener at commit, then the effect snaps it
    // into the sheet (recording opener as previousFocusRef).
    await act(async () => { opener.focus(); });
    await act(async () => { host.render(<Wrapper open={true} />); });
    await flushFrames();
    const inner = document.querySelector<HTMLButtonElement>("[data-pp2b-inner]")!;
    expect(inner).not.toBeNull();
    await act(async () => { inner.focus(); });
    expect(document.activeElement).toBe(inner);

    // 3) park (open=false, keepMounted=true)
    await act(async () => { host.render(<Wrapper open={false} keepMounted={true} />); });
    await flushFrames();

    // 4) re-present (open=true) → focus moves back to the last inner element.
    await act(async () => { host.render(<Wrapper open={true} keepMounted={true} />); });
    await flushFrames();
    expect(document.activeElement).toBe(inner);

    // 5) final close (open=false, keepMounted=false) refocuses the opener.
    await act(async () => { host.render(<Wrapper open={false} keepMounted={false} />); });
    await flushFrames();
    expect(document.activeElement).toBe(opener);
  });
});

describe("mobileSheetKeepMounted (k5) detent state survives parking and resets on the final close", () => {
  it("the detent state survives park→re-present, and a final close resets it", async () => {
    const onClose = vi.fn();
    await render({ open: true, keepMounted: false, onClose, detents: [60, 94] });
    await flushFrames();
    expect(document.querySelector('[data-detent]')!.getAttribute("data-detent")).toBe("initial");

    const sheet = document.querySelector<HTMLElement>('[data-detent]')!;
    const handle = sheet.querySelector<HTMLElement>('[data-handle="1"]')!;
    vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue({ height: window.innerHeight * 0.6 } as DOMRect);
    await act(async () => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, pointerType: "touch", isPrimary: true, clientY: 600 }));
      handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, pointerType: "touch", isPrimary: true, clientY: 100 }));
      handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "touch", isPrimary: true, clientY: 100 }));
    });
    expect(sheet.getAttribute("data-detent")).toBe("full");

    // Park from full: an initial-only test cannot detect detent loss.
    await render({ open: false, keepMounted: true, onClose, detents: [60, 94] });
    await flushFrames();
    expect(document.querySelector('[data-detent="full"]')).not.toBeNull();

    // re-present keeps the detent intact
    await render({ open: true, keepMounted: true, onClose, detents: [60, 94] });
    await flushFrames();
    expect(document.querySelector('[data-detent="full"]')).not.toBeNull();

    // final close (no keepMounted) mounts the sheet afresh with the initial detent
    await render({ open: false, keepMounted: false, onClose, detents: [60, 94] });
    await render({ open: true, keepMounted: false, onClose, detents: [60, 94] });
    await flushFrames();
    expect(document.querySelector('[data-detent]')!.getAttribute("data-detent")).toBe("initial");
  });
});

describe("mobileSheetKeepMounted (k6) final close taken directly from parking restores the opener", () => {
  it("park → final close refocuses opener1; a later open from opener2 closes back to opener2", async () => {
    const onClose = vi.fn();
    function TwoOpeners({ open, keepMounted }: { open: boolean; keepMounted?: boolean }) {
      return <div>
        <button type="button" data-opener-1>Opener one</button>
        <button type="button" data-opener-2>Opener two</button>
        <MobileSheet open={open} keepMounted={keepMounted} onClose={onClose} initialFocus="sheet">
          <div><button type="button" data-pp2b-inner>Inner</button></div>
        </MobileSheet>
      </div>;
    }
    // Mount closed, then open from opener1 so previousFocusRef records opener1.
    await act(async () => { host.render(<TwoOpeners open={false} />); });
    await flushFrames();
    const opener1 = document.querySelector<HTMLButtonElement>("[data-opener-1]")!;
    const opener2 = document.querySelector<HTMLButtonElement>("[data-opener-2]")!;
    await act(async () => { opener1.focus(); });
    await act(async () => { host.render(<TwoOpeners open={true} />); });
    await flushFrames();
    const inner = document.querySelector<HTMLButtonElement>("[data-pp2b-inner]")!;
    await act(async () => { inner.focus(); });
    expect(document.activeElement).toBe(inner);

    // Park, then final-close DIRECTLY from parking: open never becomes true in between,
    // so the focus effect's deps do not change, it never re-runs, and its cleanup —
    // the only place that refocuses the opener and clears the refs — never executes.
    await act(async () => { host.render(<TwoOpeners open={false} keepMounted={true} />); });
    await flushFrames();
    expect(document.activeElement).not.toBe(opener1);
    await act(async () => { host.render(<TwoOpeners open={false} keepMounted={false} />); });
    await flushFrames();
    expect(document.activeElement).toBe(opener1);

    // The refs must have been cleared by that close: a later open from opener2 must
    // close back to opener2, not to the stale opener1 still held by previousFocusRef.
    await act(async () => { opener2.focus(); });
    await act(async () => { host.render(<TwoOpeners open={true} />); });
    await flushFrames();
    await act(async () => { host.render(<TwoOpeners open={false} />); });
    await flushFrames();
    expect(document.activeElement).toBe(opener2);
  });
});
