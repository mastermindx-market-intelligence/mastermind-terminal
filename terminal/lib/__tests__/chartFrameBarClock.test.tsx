// @vitest-environment jsdom
// The frame-bar clock ticks once a second without a React update. A 1 Hz setState restarted the
// English boot's idle-priority hydration-effect render of the whole Terminal every second (the
// /terminal route boundary hydrates at Offscreen priority, so its mount effects queue Idle-lane
// updates), which left the tablet main thread in a permanent one-long-task-per-second loop.
import { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChartFrameBar, { DEFAULT_CHART_SETTINGS } from "@/components/ChartFrameBar";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 13, 9, 30, 0));
});
afterEach(() => {
  if (root) act(() => { root!.unmount(); });
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("ChartFrameBar clock", () => {
  it("advances the clock text every second without committing a React render", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let commits = 0;
    act(() => {
      root!.render(
        <LangProvider>
          <Profiler id="cfb" onRender={() => { commits++; }}>
            <ChartFrameBar timeframe="D" chartApi={null} settings={DEFAULT_CHART_SETTINGS} onSettings={() => {}} />
          </Profiler>
        </LangProvider>,
      );
    });
    const clock = host.querySelector<HTMLElement>(".cfb-clock")!;
    expect(clock).not.toBeNull();
    // Painted by the mount pass itself, so the first frame never shows an empty clock.
    expect(clock.textContent).toMatch(/^09:30:00 \S/);
    expect(host.querySelector(".cfb-tz")!.textContent).toMatch(/^UTC/);
    const settled = commits;

    // One act per tick, so a per-second setState would show up as one commit per second.
    for (let i = 0; i < 5; i++) act(() => { vi.advanceTimersByTime(1_000); });
    expect(clock.textContent).toMatch(/^09:30:05 /);
    expect(commits).toBe(settled);
  });
});
