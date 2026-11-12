// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import EventEdgePop from "@/components/fin/EventEdgePop";

function Reader() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return <>
    <button onClick={event => setAnchor(event.currentTarget.getBoundingClientRect())}>Event details</button>
    {anchor && <EventEdgePop anchor={anchor} onClose={() => setAnchor(null)} />}
  </>;
}

it.each(["after opening", "after a parent rerender"] as const)("dismisses on the first outside click %s", phase => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    act(() => root.render(<Reader />));
    act(() => host.querySelector("button")!.click());
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    if (phase === "after a parent rerender") {
      act(() => { vi.advanceTimersByTime(20); });
      act(() => root.render(<Reader />));
    }
    act(() => dialog!.click());
    expect(dialog!.isConnected).toBe(true);
    act(() => document.body.click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
