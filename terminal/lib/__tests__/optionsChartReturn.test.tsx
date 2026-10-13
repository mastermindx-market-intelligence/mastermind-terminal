// @vitest-environment jsdom
// PP2-UI-b — OptionsRail parks the MobileSheet (keeps the companion mounted) when "Show on chart"
// is called on a small viewport and exposes a "Back to options map" chip that re-presents it.
// The desktop rail never covers the chart, so it never receives an onShowChart prop.
//
// Falsifier 4, 5, 9, 10 of the accepted Paper contract (#723) and the Codex build-identity edge:
// Selection retains root, strike, expiry, and source session through Map → Pin/chart → return;
// a newer snapshot announced while parked queues and is applied by explicit Apply.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OptionsRail, { type OptionsRailHandle } from "@/components/options-companion/OptionsRail";
import { LangProvider } from "@/lib/i18n";

// Stub the lazy-loaded OptionsCompanion so we can observe mount count and props.
const stubState = vi.hoisted(() => {
  let latestProps: Record<string, unknown> | null = null;
  let mountCount = 0;
  return {
    latestProps: () => latestProps,
    mountCount: () => mountCount,
    setLatestProps: (p: Record<string, unknown> | null) => { latestProps = p; },
    inc: () => { mountCount += 1; },
    dec: () => { mountCount -= 1; },
    reset: () => { latestProps = null; mountCount = 0; },
  };
});
vi.mock("next/dynamic", () => ({
  default: () => {
    // Required by next/dynamic: returns a wrapper component that accepts the props.
    const StubCompanion = (props: Record<string, unknown>) => {
      stubState.setLatestProps(props);
      React.useEffect(() => { stubState.inc(); return () => stubState.dec(); }, []);
      return (
        <div data-testid="stub-companion">
          <button type="button" data-testid="stub-call-show" onClick={() => (props.onShowChart as () => void | undefined)?.()}>
            callShowChart
          </button>
          <button type="button" data-testid="stub-call-pin" onClick={() => (props.onPin as (p: unknown) => void | undefined)?.({ root: "stub", price: 1, session: "s", label: "x" })}>
            callOnPin
          </button>
        </div>
      );
    };
    return StubCompanion;
  },
}));

// Controllable matchMedia stub: store listeners so the test can fire `change` events.
interface MQL { matches: boolean; media: string; addEventListener: (t: string, cb: () => void) => void; removeEventListener: (t: string, cb: () => void) => void; }
function installMatchMedia(initialSmall: boolean, initialPhone: boolean) {
  type Listener = (() => void) | null;
  const smallListeners = new Set<Listener>();
  const phoneListeners = new Set<Listener>();
  const queries: Record<string, { listeners: Set<Listener>; matches: boolean }> = {
    "(max-width: 860px)": { listeners: smallListeners, matches: initialSmall },
    "(max-width: 640px)": { listeners: phoneListeners, matches: initialPhone },
  };
  const original = window.matchMedia;
  const stub = ((query: string) => {
    const entry = queries[query];
    if (!entry) {
      return { matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MQL;
    }
    return {
      matches: entry.matches,
      media: query,
      addEventListener: (_t: string, cb: () => void) => { entry.listeners.add(cb); },
      removeEventListener: (_t: string, cb: () => void) => { entry.listeners.delete(cb); },
    };
  }) as typeof window.matchMedia;
  window.matchMedia = stub;
  return {
    setSmall(matches: boolean) {
      queries["(max-width: 860px)"].matches = matches;
      smallListeners.forEach((l) => l && l());
    },
    setPhone(matches: boolean) {
      queries["(max-width: 640px)"].matches = matches;
      phoneListeners.forEach((l) => l && l());
    },
    restore() { window.matchMedia = original; },
  };
}

interface RailProps {
  symbol?: string;
  enabled?: boolean;
  access?: "loading" | "allowed" | "locked";
  pinned?: { root: string; price: number; session: string; label: string } | null;
  onPin?: ReturnType<typeof vi.fn>;
  replayActive?: boolean;
}
function makeRail(props: RailProps) {
  return <LangProvider>
    <OptionsRail
      symbol={props.symbol ?? "SPY"}
      enabled={props.enabled ?? true}
      access={props.access ?? "allowed"}
      pinned={props.pinned ?? null}
      onPin={props.onPin ?? vi.fn()}
      replayActive={props.replayActive ?? false}
    >
      <div data-pp2b-overview>OVERVIEW</div>
    </OptionsRail>
  </LangProvider>;
}

function renderInto(node: React.ReactNode) {
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  return { el, root };
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  stubState.reset();
  vi.useFakeTimers();
  // jsdom may ship requestAnimationFrame; force a deterministic timer-based one.
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(Date.now()), 0)) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as unknown as typeof window.cancelAnimationFrame;
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
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => { await vi.runAllTimersAsync(); });
}

describe("optionsChartReturn (r1) small viewport — Show on chart parks the sheet and exposes the chip", () => {
  it("parks the sheet, shows the chip, keeps the stub mounted", async () => {
    const onPin = vi.fn();
    const mm = installMatchMedia(true, true);
    try {
      const { el, root } = renderInto(makeRail({ onPin }));
      await act(async () => { root.render(makeRail({ onPin })); });
      await flush();
      // open the rail
      const ref = (el.querySelector("aside") as unknown as { __refs?: never }) as unknown;
      // The ref is forwarded; get it from the rendered tree via React internals alternative:
      // use the document's launcher button.
      const launcher = el.querySelector<HTMLButtonElement>('[data-testid="options-rail-toggle"]')!;
      // phone (small=true && phone=true) → mobileSheet
      await act(async () => { launcher.click(); });
      await flush();
      // panel opens; stub renders, mount count = 1
      expect(stubState.mountCount()).toBe(1);
      const props = stubState.latestProps()!;
      expect(typeof props.onShowChart).toBe("function");
      // call onShowChart → parks
      await act(async () => { (props.onShowChart as () => void)(); });
      await flush();
      // chip in document
      const chip = document.querySelector<HTMLButtonElement>('[data-testid="options-chart-return"]');
      expect(chip).not.toBeNull();
      expect(document.querySelector('[data-detent]')!.getAttribute("data-parked")).toBe("true");
      expect(stubState.mountCount()).toBe(1);
      // focus moves to the chip after a frame (the spec asserts focus after a frame)
      await flush();
      expect(document.activeElement).toBe(chip);
      await act(async () => { root.unmount(); }); el.remove();
    } finally { mm.restore(); }
  });
});

describe("optionsChartReturn (r2) clicking the chip clears the park and keeps the mount", () => {
  it("removes the chip, the stub stays mounted; the sheet is re-presented", async () => {
    const onPin = vi.fn();
    const mm = installMatchMedia(true, true);
    try {
      const { el, root } = renderInto(makeRail({ onPin }));
      await act(async () => { root.render(makeRail({ onPin })); });
      await flush();
      await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="options-rail-toggle"]')!.click(); });
      await flush();
      const props = stubState.latestProps()!;
      await act(async () => { (props.onShowChart as () => void)(); });
      await flush();
      const chip = document.querySelector<HTMLButtonElement>('[data-testid="options-chart-return"]')!;
      expect(chip).not.toBeNull();
      // before re-present: dialog exists but is parked
      expect(document.querySelector('[data-detent]')!.getAttribute("data-parked")).toBe("true");
      await act(async () => { chip.click(); });
      await flush();
      expect(document.querySelector('[data-testid="options-chart-return"]')).toBeNull();
      // K4: re-presenting re-arms the dialog — the dialog is back, no longer parked.
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog!.getAttribute("data-parked")).toBeNull();
      expect(stubState.mountCount()).toBe(1);
      await act(async () => { root.unmount(); }); el.remove();
    } finally { mm.restore(); }
  });
});

describe("optionsChartReturn (r3) desktop never exposes onShowChart", () => {
  it("desktop pass leaves the stub's onShowChart undefined", async () => {
    const onPin = vi.fn();
    const mm = installMatchMedia(false, false);
    try {
      const { el, root } = renderInto(makeRail({ onPin }));
      await act(async () => { root.render(makeRail({ onPin })); });
      await flush();
      await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="options-rail-toggle"]')!.click(); });
      await flush();
      const props = stubState.latestProps()!;
      expect(props.onShowChart).toBeUndefined();
      await act(async () => { root.unmount(); }); el.remove();
    } finally { mm.restore(); }
  });
});

describe("optionsChartReturn (r4) while parked, signal-change closes the sheet, removes the chip, calls onPin(null)", () => {
  it("a re-render with a different symbol closes the park and clears the pin", async () => {
    const onPin = vi.fn();
    const mm = installMatchMedia(true, true);
    try {
      const { el, root } = renderInto(makeRail({ symbol: "SPY", onPin }));
      await act(async () => { root.render(makeRail({ symbol: "SPY", onPin })); });
      await flush();
      await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="options-rail-toggle"]')!.click(); });
      await flush();
      const props = stubState.latestProps()!;
      await act(async () => { (props.onShowChart as () => void)(); });
      await flush();
      expect(document.querySelector('[data-testid="options-chart-return"]')).not.toBeNull();
      // change symbol
      await act(async () => {
        root.render(makeRail({ symbol: "QQQ", onPin }));
      });
      await flush();
      expect(document.querySelector('[data-testid="options-chart-return"]')).toBeNull();
      expect(onPin).toHaveBeenCalledWith(null);
      await act(async () => { root.unmount(); }); el.remove();
    } finally { mm.restore(); }
  });
  it("locked access closes the park and clears the pin", async () => {
    const onPin = vi.fn();
    const mm = installMatchMedia(true, true);
    try {
      const { el, root } = renderInto(makeRail({ onPin }));
      await act(async () => { root.render(makeRail({ onPin })); });
      await flush();
      await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="options-rail-toggle"]')!.click(); });
      await flush();
      const props = stubState.latestProps()!;
      await act(async () => { (props.onShowChart as () => void)(); });
      await flush();
      await act(async () => {
        root.render(makeRail({ onPin, access: "locked" }));
      });
      await flush();
      expect(document.querySelector('[data-testid="options-chart-return"]')).toBeNull();
      expect(onPin).toHaveBeenCalledWith(null);
      await act(async () => { root.unmount(); }); el.remove();
    } finally { mm.restore(); }
  });
  it("disabled rail closes the park and clears the pin", async () => {
    const onPin = vi.fn();
    const mm = installMatchMedia(true, true);
    try {
      const { el, root } = renderInto(makeRail({ onPin }));
      await act(async () => { root.render(makeRail({ onPin })); });
      await flush();
      await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="options-rail-toggle"]')!.click(); });
      await flush();
      const props = stubState.latestProps()!;
      await act(async () => { (props.onShowChart as () => void)(); });
      await flush();
      await act(async () => {
        root.render(makeRail({ onPin, enabled: false }));
      });
      await flush();
      expect(document.querySelector('[data-testid="options-chart-return"]')).toBeNull();
      expect(onPin).toHaveBeenCalledWith(null);
      await act(async () => { root.unmount(); }); el.remove();
    } finally { mm.restore(); }
  });
  it("replay active closes the park and clears the pin", async () => {
    const onPin = vi.fn();
    const mm = installMatchMedia(true, true);
    try {
      const { el, root } = renderInto(makeRail({ onPin }));
      await act(async () => { root.render(makeRail({ onPin })); });
      await flush();
      await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="options-rail-toggle"]')!.click(); });
      await flush();
      const props = stubState.latestProps()!;
      await act(async () => { (props.onShowChart as () => void)(); });
      await flush();
      await act(async () => {
        root.render(makeRail({ onPin, replayActive: true }));
      });
      await flush();
      expect(document.querySelector('[data-testid="options-chart-return"]')).toBeNull();
      expect(onPin).toHaveBeenCalledWith(null);
      await act(async () => { root.unmount(); }); el.remove();
    } finally { mm.restore(); }
  });
});

describe("optionsChartReturn (r5) matchMedia changes to not-small removes the chip without calling onPin(null)", () => {
  it("matchMedia going not-small clears the chip but does NOT clear the pin", async () => {
    const onPin = vi.fn();
    const mm = installMatchMedia(true, true);
    try {
      const { el, root } = renderInto(makeRail({ onPin }));
      await act(async () => { root.render(makeRail({ onPin })); });
      await flush();
      await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="options-rail-toggle"]')!.click(); });
      await flush();
      const props = stubState.latestProps()!;
      await act(async () => { (props.onShowChart as () => void)(); });
      await flush();
      expect(document.querySelector('[data-testid="options-chart-return"]')).not.toBeNull();
      onPin.mockClear();
      await act(async () => { mm.setSmall(false); });
      await flush();
      expect(document.querySelector('[data-testid="options-chart-return"]')).toBeNull();
      expect(onPin).not.toHaveBeenCalled();
      await act(async () => { root.unmount(); }); el.remove();
    } finally { mm.restore(); }
  });
});
