// @vitest-environment jsdom
import { act, StrictMode, useRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchModal from "@/components/SearchModal";
import MobileSheet from "@/components/ui/MobileSheet";
import { useDialogFocus } from "@/components/studyTemplates/useDialogFocus";
import type { DialogFocusSession } from "@/lib/dialogFocusReturn";
import { LangProvider } from "@/lib/i18n";

const viewport = vi.hoisted(() => ({ phone: false, touch: false }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsPhone: () => viewport.phone, useIsMobile: () => viewport.touch }));
vi.mock("@/components/onboarding/OnboardingProvider", () => ({ useOnboarding: () => ({ open: vi.fn(), close: vi.fn() }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof SearchModal>;
const focusSession = (opener: HTMLElement | null = null): { current: DialogFocusSession } => ({ current: { opener, predecessors: null } });
let host: HTMLDivElement, root: Root, opener: HTMLButtonElement, extras: HTMLElement[], props: Props;
beforeEach(() => {
  vi.useFakeTimers(); viewport.phone = false; viewport.touch = false;
  localStorage.clear(); document.documentElement.setAttribute("data-lang", "en");
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => window.setTimeout(() => callback(0), 0));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => window.clearTimeout(id));
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    const hidden = !this.isConnected || this.closest("[hidden], [inert], [aria-hidden='true']") || getComputedStyle(this).display === "none";
    return (hidden ? [] : [new DOMRect(0, 0, 100, 40)]) as unknown as DOMRectList;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  opener = document.createElement("button"); opener.textContent = "Open search"; document.body.append(opener); opener.focus(); extras = [opener];
  props = { open: true, seed: "AAPL", mode: "pick", manifest: { AAPL: { name: "Apple Inc.", col: "#777", verdict: null, sec: "Stock", mkt: "NASDAQ" } },
    inWatchlist: new Set(), onClose: vi.fn(), onPick: vi.fn() };
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); extras.forEach(node => node.remove());
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
});
async function flush() { await act(async () => { await vi.runAllTimersAsync(); }); }
async function render(update: Partial<Props> = {}) {
  props = { ...props, ...update };
  await act(async () => root.render(<StrictMode><LangProvider><SearchModal {...props} /></LangProvider></StrictMode>));
  await flush();
}
const input = () => document.querySelector<HTMLInputElement>(".sh input")!;
function receivingModal() {
  const modal = document.createElement("div"); modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
  const button = document.createElement("button"); button.textContent = "Continue new task"; modal.append(button); document.body.append(modal); extras.push(modal);
  button.focus(); return button;
}

function DesktopOwner({ focusSessionRef }: { focusSessionRef: { current: DialogFocusSession } }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, vi.fn(), { focusSessionRef });
  return <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}><input data-autofocus aria-label="New presentation" /></div>;
}

describe("Search logical-session return focus", () => {
  it.each([false, true])("restores the same opener after a responsive roundtrip (phone start: %s)", async phone => {
    viewport.phone = phone; viewport.touch = phone; await render();
    expect(input().value).toBe("AAPL");
    opener.style.display = "none"; viewport.phone = !phone; viewport.touch = !phone; await render();
    expect(input().value).toBe("AAPL");
    opener.style.display = ""; viewport.phone = phone; viewport.touch = phone; await render();
    expect(input().value).toBe("AAPL"); await render({ open: false });
    expect(document.activeElement).toBe(opener);
  });

  it("captures a different opener for a new opening of the same mounted component", async () => {
    await render(); await render({ open: false }); expect(document.activeElement).toBe(opener);
    const second = document.createElement("button"); second.textContent = "Other search opener"; document.body.append(second); extras.push(second); second.focus();
    await render({ open: true }); await render({ open: false }); expect(document.activeElement).toBe(second);
  });

  it.each(["hidden", "disabled", "removed"])("does not restore an unavailable %s opener", async state => {
    await render();
    if (state === "hidden") opener.hidden = true;
    if (state === "disabled") opener.disabled = true;
    if (state === "removed") opener.remove();
    const restore = vi.spyOn(opener, "focus");
    await render({ open: false }); expect(restore).not.toHaveBeenCalled();
  });

  it.each([false, true])("leaves a receiving modal focused after close (phone: %s)", async phone => {
    viewport.phone = phone; viewport.touch = phone; await render();
    let receiving: HTMLButtonElement;
    await act(async () => { receiving = receivingModal(); });
    await render({ open: false }); await flush(); expect(document.activeElement).toBe(receiving!);
  });

  it.each([false, true])("preserves a receiving task through a presentation switch (phone start: %s)", async phone => {
    viewport.phone = phone; viewport.touch = phone; await render();
    let receiving: HTMLButtonElement;
    await act(async () => { receiving = receivingModal(); });
    viewport.phone = !phone; viewport.touch = !phone; await render();
    expect(document.activeElement).toBe(receiving!);
    for (const key of ["Tab", "Escape"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      await act(async () => { receiving!.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(false); expect(document.activeElement).toBe(receiving!);
      expect(props.onClose).not.toHaveBeenCalled();
    }
    await render({ open: false }); expect(document.activeElement).toBe(receiving!);
  });

  it("retains the existing cold desktop opener repair", async () => {
    opener.blur(); await render();
    await act(async () => opener.focus()); expect(host.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
    await render({ open: false }); expect(document.activeElement).toBe(opener);
  });

  it("restores the session opener when a new desktop owner starts at body focus", async () => {
    const focusSessionRef = focusSession(opener); opener.blur();
    await act(async () => root.render(<DesktopOwner focusSessionRef={focusSessionRef} />));
    expect(document.activeElement).not.toBe(opener);
    await act(async () => root.render(null)); expect(document.activeElement).toBe(opener);
  });
});

describe("opt-in sheet return ownership", () => {
  it("does not steal a receiving task's focus in the pending initial frame", async () => {
    const focusSessionRef = focusSession();
    const onClose = vi.fn();
    await act(async () => root.render(<MobileSheet open onClose={onClose} escapeKey="bubble" focusSessionRef={focusSessionRef}><button>Sheet action</button></MobileSheet>));
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    const receiving = receivingModal(); await flush();
    expect(document.activeElement).toBe(receiving);
    for (const key of ["Tab", "Escape"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      await act(async () => { receiving.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(false); expect(document.activeElement).toBe(receiving);
      expect(onClose).not.toHaveBeenCalled();
    }
    await act(async () => root.render(null)); expect(document.activeElement).toBe(receiving);
  });

  it("restores only once when cleanup and the final-close effect both run", async () => {
    const focusSessionRef = focusSession();
    const sheet = (open: boolean) => <MobileSheet open={open} onClose={vi.fn()} focusSessionRef={focusSessionRef}><button>Sheet action</button></MobileSheet>;
    await act(async () => root.render(sheet(true))); await flush();
    const restore = vi.spyOn(opener, "focus");
    await act(async () => root.render(sheet(false))); await flush();
    expect(restore).toHaveBeenCalledTimes(1); expect(document.activeElement).toBe(opener);
  });

  it("captures a late phone opener before the initial focus frame", async () => {
    opener.blur(); const focusSessionRef = focusSession();
    await act(async () => root.render(<MobileSheet open onClose={vi.fn()} focusSessionRef={focusSessionRef}><button>Sheet action</button></MobileSheet>));
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    opener.focus(); await flush();
    expect(focusSessionRef.current.opener).toBe(opener);
    await act(async () => root.render(null)); expect(document.activeElement).toBe(opener);
  });

  it("preserves a newer modal when a parked sheet closes finally", async () => {
    const focusSessionRef = focusSession();
    const sheet = (open: boolean, keepMounted: boolean) => <MobileSheet open={open} keepMounted={keepMounted} onClose={vi.fn()} focusSessionRef={focusSessionRef}><button>Sheet action</button></MobileSheet>;
    await act(async () => root.render(sheet(true, true))); await flush();
    await act(async () => root.render(sheet(false, true))); await flush();
    const receiving = receivingModal();
    await act(async () => root.render(sheet(false, false))); await flush();
    expect(document.activeElement).toBe(receiving);
  });
});
