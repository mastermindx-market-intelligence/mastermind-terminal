// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TheaterHarness from "@/app/dev/theater/page";
import { DONE_SETTLE_MS, PACE_MS } from "@/lib/conductorState";

// Exercise the actual harness, queue, and conductor. A parent ref runs in commit
// before passive subscriptions; clicking there makes the startup race deterministic.
describe("theater queue subscription readiness", () => {
  let host: HTMLDivElement;
  let root: Root | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const playButton = () => host.querySelector("button") as HTMLButtonElement;

  it("does not expose an enabled Play button in server markup", () => {
    host.innerHTML = renderToString(React.createElement(TheaterHarness));
    expect(playButton().textContent).toBe("Play demo");
    expect(playButton().disabled).toBe(true);
  });

  it("ignores a pre-subscription click then runs all seven steps once ready", async () => {
    let clickedBeforeEffects = false;
    root = createRoot(host);
    await act(async () => {
      root!.render(React.createElement("div", {
        ref: (node: HTMLDivElement | null) => {
          if (!node || clickedBeforeEffects) return;
          clickedBeforeEffects = true;
          (node.querySelector("button") as HTMLButtonElement).click();
        },
      }, React.createElement(TheaterHarness)));
    });
    expect(clickedBeforeEffects).toBe(true);
    expect(host.textContent).toContain("AI objects on chart: 0");
    expect(playButton().disabled).toBe(false);
    expect(host.querySelector(".cmx")).toBeNull();
    await act(async () => { playButton().click(); });
    expect(playButton().textContent).toBe("Playing…");
    expect(playButton().disabled).toBe(true);
    await act(async () => { vi.advanceTimersByTime(PACE_MS * 7); });
    expect(host.textContent).toContain("AI objects on chart: 6");
    expect(playButton().disabled).toBe(false);
    await act(async () => { vi.advanceTimersByTime(DONE_SETTLE_MS); });
    expect(host.querySelector(".cmx-plate.show")).not.toBeNull();
    const orb = host.querySelector(".cmx-orb") as HTMLButtonElement;
    await act(async () => { orb.click(); });
    expect(host.querySelectorAll(".cmx-row")).toHaveLength(7);
  });
});
