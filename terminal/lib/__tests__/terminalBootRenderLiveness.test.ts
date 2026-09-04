import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  announceTerminalVisualReady,
  TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT,
  TERMINAL_VISUAL_READY_EVENT,
} from "../terminalBoot";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type EmittedEvent = {
  type: string;
  detail: unknown;
};

function installWindow() {
  const frames: FrameRequestCallback[] = [];
  const emitted: EmittedEvent[] = [];
  const fakeWindow = {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    },
    setTimeout,
    clearTimeout,
    dispatchEvent: (event: { type: string; detail: unknown }) => {
      emitted.push({ type: event.type, detail: event.detail });
      return true;
    },
  };
  class FakeCustomEvent<T> {
    constructor(readonly type: string, readonly init: { detail: T }) {}
    get detail() { return this.init.detail; }
  }
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("CustomEvent", FakeCustomEvent);
  return { frames, emitted };
}

function drainFrames(frames: FrameRequestCallback[], limit = 128): void {
  let frame = 0;
  while (frames.length && frame < limit) {
    frames.shift()!(frame * 16);
    frame += 1;
  }
  if (frames.length) throw new Error(`render continuation exceeded ${limit} frames`);
}

function detailsFor(emitted: EmittedEvent[], type: string): unknown[] {
  return emitted.filter((event) => event.type === type).map((event) => event.detail);
}

describe("Terminal visual-ready bounded render completion", () => {
  it("continues a current multi-pane generation beyond the former eight-frame ceiling, then emits once", () => {
    const { frames, emitted } = installWindow();
    let renderChecks = 0;
    let projections = 0;

    const pending = announceTerminalVisualReady("COST", "data", {
      timeframe: "3D",
      generation: 31,
      isCurrent: () => true,
      isReady: () => true,
      renderVisuals: () => { projections += 1; },
      isRendered: () => {
        renderChecks += 1;
        return renderChecks >= 24;
      },
    });

    drainFrames(frames);

    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toEqual([
      { symbol: "COST", timeframe: "3D", generation: 31, state: "data" },
    ]);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT)).toEqual([]);
    expect(renderChecks).toBe(24);
    expect(projections).toBeGreaterThanOrEqual(24);

    pending.reevaluate();
    expect(frames).toHaveLength(0);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toHaveLength(1);
  });

  it("emits one typed diagnostic after exactly the closed 64-check render budget", () => {
    const { frames, emitted } = installWindow();
    let renderChecks = 0;

    const pending = announceTerminalVisualReady("COST", "data", {
      timeframe: "3D",
      generation: 33,
      isCurrent: () => true,
      isReady: () => true,
      renderVisuals: () => {},
      isRendered: () => {
        renderChecks += 1;
        return false;
      },
    });

    drainFrames(frames);

    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toEqual([]);
    const diagnostics = detailsFor(emitted, TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT) as Array<Record<string, unknown>>;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      symbol: "COST",
      timeframe: "3D",
      generation: 33,
      state: "data",
      code: "render_not_ready",
      attempts: 64,
    });
    expect(renderChecks).toBe(64);
    expect(frames).toHaveLength(0);

    pending.reevaluate();
    expect(frames).toHaveLength(0);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT)).toHaveLength(1);
  });

  it("keeps semantic waiting completely owner-driven regardless of elapsed time", () => {
    vi.useFakeTimers();
    const { frames, emitted } = installWindow();
    let semanticReady = false;
    let renderChecks = 0;
    let projections = 0;

    const pending = announceTerminalVisualReady("COST", "data", {
      timeframe: "D",
      generation: 35,
      isCurrent: () => true,
      isReady: () => semanticReady,
      renderVisuals: () => { projections += 1; },
      isRendered: () => {
        renderChecks += 1;
        return true;
      },
    });

    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(60_000);
    pending.reevaluate();
    expect(frames).toHaveLength(0);
    expect(renderChecks).toBe(0);
    expect(projections).toBe(0);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toEqual([]);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT)).toEqual([]);

    semanticReady = true;
    pending.reevaluate();
    drainFrames(frames);

    expect(renderChecks).toBe(1);
    expect(projections).toBe(1);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toHaveLength(1);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT)).toEqual([]);
  });

  it("pauses a render chain when semantic authority is withdrawn and resumes only on owner reevaluation", () => {
    const { frames, emitted } = installWindow();
    let semanticReady = true;
    let renderChecks = 0;

    const pending = announceTerminalVisualReady("COST", "data", {
      timeframe: "D",
      generation: 36,
      isCurrent: () => true,
      isReady: () => semanticReady,
      renderVisuals: () => {},
      isRendered: () => {
        renderChecks += 1;
        return renderChecks >= 2;
      },
    });

    frames.shift()!(0);
    semanticReady = false;
    frames.shift()!(16);
    expect(frames).toHaveLength(0);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toEqual([]);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT)).toEqual([]);

    semanticReady = true;
    pending.reevaluate();
    drainFrames(frames);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toHaveLength(1);
  });

  it("suppresses every later ready or diagnostic edge after cancellation or supersession", () => {
    const { frames, emitted } = installWindow();
    let current = true;

    const pending = announceTerminalVisualReady("COST", "data", {
      timeframe: "D",
      generation: 37,
      isCurrent: () => current,
      isReady: () => true,
      renderVisuals: () => {},
      isRendered: () => false,
    });

    frames.shift()!(0);
    frames.shift()!(16);
    expect(frames.length).toBeGreaterThan(0);

    current = false;
    pending.cancel();
    drainFrames(frames);

    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toEqual([]);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT)).toEqual([]);
    pending.reevaluate();
    expect(frames).toHaveLength(0);
  });

  it("rejects elapsed-time semantic authority and pins the finite render budget", () => {
    const source = readFileSync(path.resolve(process.cwd(), "lib", "terminalBoot.ts"), "utf8");

    expect(source).toContain("TERMINAL_RENDER_MAX_ATTEMPTS = 64");
    expect(source).not.toContain("TERMINAL_SEMANTIC_READY_TIMEOUT_MS");
    expect(source).not.toContain("TERMINAL_SEMANTIC_RECHECK_MS");
    expect(source).not.toContain("scheduleSemanticWait");
    expect(source).not.toContain("semantic_not_ready");
    expect(source).not.toContain("setInterval");
  });
});
