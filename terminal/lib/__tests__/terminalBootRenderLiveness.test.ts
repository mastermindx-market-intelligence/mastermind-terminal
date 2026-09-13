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

/** A fake window with NO `requestAnimationFrame` at all, to exercise the `setTimeout` fallback. */
function installWindowWithoutRAF() {
  const timeouts: Array<() => void> = [];
  const emitted: EmittedEvent[] = [];
  const fakeWindow = {
    setTimeout: (callback: (...args: unknown[]) => void) => {
      timeouts.push(() => callback(0));
      return timeouts.length;
    },
    clearTimeout: () => {},
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
  return { timeouts, emitted };
}

function drainTimeouts(timeouts: Array<() => void>, limit = 128): void {
  let iterations = 0;
  while (timeouts.length && iterations < limit) {
    timeouts.shift()!();
    iterations += 1;
  }
  if (timeouts.length) throw new Error(`render continuation exceeded ${limit} timeouts`);
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

  it("swallows a throwing isCurrent call and permanently cancels the generation", () => {
    const { frames, emitted } = installWindow();
    let calls = 0;

    const pending = announceTerminalVisualReady("COST", "data", {
      timeframe: "3D",
      generation: 42,
      isCurrent: () => {
        calls += 1;
        if (calls === 1) return true;
        throw new Error("isCurrent boom");
      },
      isReady: () => true,
      renderVisuals: () => {},
      isRendered: () => false,
    });

    expect(() => drainFrames(frames)).not.toThrow();
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toEqual([]);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT)).toEqual([]);

    pending.reevaluate();
    expect(frames).toHaveLength(0);
  });

  it("swallows a throwing isReady call and waits for owner reevaluation instead of crashing", () => {
    const { frames, emitted } = installWindow();
    let throwReady = true;
    let renderChecks = 0;

    const pending = announceTerminalVisualReady("COST", "data", {
      timeframe: "D",
      generation: 43,
      isCurrent: () => true,
      isReady: () => {
        if (throwReady) throw new Error("isReady boom");
        return true;
      },
      renderVisuals: () => {},
      isRendered: () => {
        renderChecks += 1;
        return true;
      },
    });

    expect(frames).toHaveLength(0);
    expect(renderChecks).toBe(0);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toEqual([]);

    throwReady = false;
    pending.reevaluate();
    expect(() => drainFrames(frames)).not.toThrow();
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toHaveLength(1);
  });

  it("swallows a throwing renderVisuals call and keeps retrying until success", () => {
    const { frames, emitted } = installWindow();
    let renderChecks = 0;
    let projections = 0;

    announceTerminalVisualReady("COST", "data", {
      timeframe: "3D",
      generation: 40,
      isCurrent: () => true,
      isReady: () => true,
      renderVisuals: () => {
        projections += 1;
        throw new Error("renderVisuals boom");
      },
      isRendered: () => {
        renderChecks += 1;
        return renderChecks >= 3;
      },
    });

    expect(() => drainFrames(frames)).not.toThrow();
    expect(projections).toBeGreaterThan(0);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toHaveLength(1);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT)).toEqual([]);
  });

  it("swallows a throwing isRendered call and treats it as not-yet-rendered", () => {
    const { frames, emitted } = installWindow();
    let calls = 0;

    announceTerminalVisualReady("COST", "data", {
      timeframe: "3D",
      generation: 41,
      isCurrent: () => true,
      isReady: () => true,
      renderVisuals: () => {},
      isRendered: () => {
        calls += 1;
        throw new Error("isRendered boom");
      },
    });

    expect(() => drainFrames(frames)).not.toThrow();
    expect(calls).toBe(64);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toEqual([]);
    const diagnostics = detailsFor(emitted, TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT);
    expect(diagnostics).toHaveLength(1);
  });

  it("falls back to window.setTimeout scheduling when requestAnimationFrame is unavailable", () => {
    const { timeouts, emitted } = installWindowWithoutRAF();
    let renderChecks = 0;

    announceTerminalVisualReady("COST", "data", {
      timeframe: "D",
      generation: 44,
      isCurrent: () => true,
      isReady: () => true,
      renderVisuals: () => {},
      isRendered: () => {
        renderChecks += 1;
        return renderChecks >= 2;
      },
    });

    expect(timeouts.length).toBeGreaterThan(0);
    expect(() => drainTimeouts(timeouts)).not.toThrow();
    expect(renderChecks).toBe(2);
    expect(detailsFor(emitted, TERMINAL_VISUAL_READY_EVENT)).toHaveLength(1);
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
