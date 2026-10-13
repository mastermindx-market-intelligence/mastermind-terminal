// Mastermind Chart Engine — wiring assertions the C01-A03 contract census found
// missing; each test names the mutant it kills. The lwc and dom wiring lived
// in lwcAdapter.test.ts and chartEngineCanvasModel.test.ts (F-1 and F-2). This
// file covers F-3: engineToInputOptions maps handleScroll / handleScale /
// kineticScroll (boolean and object forms) onto the input controller. Node
// environment is enough — engineToInputOptions is a pure function over
// EngineOptions, with no DOM, no canvas, no chart model.
//
// Mutants killed:
//   M5 — replace `engine.handleScroll` / `engine.handleScale` in
//   lib/chart-engine/canvas/inputBridge.ts:78-79 with `undefined`, which forces
//   the controller to fall back to SCROLL_DEFAULTS / SCALE_DEFAULTS regardless
//   of caller input. Every "false" / "{ mouseWheel: false }" case here fails.

import { describe, expect, it } from "vitest";
import { engineToInputOptions } from "@/lib/chart-engine/canvas/inputBridge";
import type { InputControllerOptions } from "@/lib/chart-engine/canvas/input";

// The static type of EngineOptions.kineticScroll is Record<string, unknown>,
// but coerceBoolMap in inputBridge.ts handles boolean at runtime (matching the
// handleScroll/handleScale widening in api.ts). This wrapper widens the input
// locally so the test can pass both object and boolean forms without lying
// about the engineToInputOptions signature.
type InputBag = Omit<Parameters<typeof engineToInputOptions>[0], "kineticScroll"> & {
  kineticScroll?: Record<string, unknown> | boolean;
};
const map = (opts: InputBag): InputControllerOptions =>
  engineToInputOptions(opts as unknown as Parameters<typeof engineToInputOptions>[0]);

const SCROLL_DEFAULTS = {
  mouseWheel: true,
  pressedMouseMove: true,
  horzTouchDrag: true,
  vertTouchDrag: true,
} as const;

const SCALE_DEFAULTS = {
  mouseWheel: true,
  pinch: true,
  axisPressedMouseMove: true,
} as const;

const KINETIC_DEFAULTS = { mouse: true, touch: true } as const;

describe("engineToInputOptions mapping (C01-A03 F-3)", () => {
  it("empty EngineOptions bag returns SCROLL / SCALE / KINETIC defaults verbatim", () => {
    const out: InputControllerOptions = map({});
    expect(out.handleScroll).toEqual({ ...SCROLL_DEFAULTS });
    expect(out.handleScale).toEqual({ ...SCALE_DEFAULTS });
    expect(out.kineticScroll).toEqual({ ...KINETIC_DEFAULTS });
  });

  it("handleScroll: false flips every scroll key to false (kills M5 for handleScroll)", () => {
    const out = map({ handleScroll: false });
    expect(out.handleScroll).toEqual({
      mouseWheel: false,
      pressedMouseMove: false,
      horzTouchDrag: false,
      vertTouchDrag: false,
    });
    // handleScale / kineticScroll must remain at defaults; the false here applies
    // only to handleScroll.
    expect(out.handleScale).toEqual({ ...SCALE_DEFAULTS });
    expect(out.kineticScroll).toEqual({ ...KINETIC_DEFAULTS });
  });

  it("handleScroll: { mouseWheel: false } flips only mouseWheel; pressedMouseMove stays true", () => {
    const out = map({ handleScroll: { mouseWheel: false } });
    expect(out.handleScroll.mouseWheel).toBe(false);
    expect(out.handleScroll.pressedMouseMove).toBe(true);
    expect(out.handleScroll.horzTouchDrag).toBe(true);
    expect(out.handleScroll.vertTouchDrag).toBe(true);
  });

  it("handleScale: false flips every scale key to false (kills M5 for handleScale)", () => {
    const out = map({ handleScale: false });
    expect(out.handleScale).toEqual({
      mouseWheel: false,
      pinch: false,
      axisPressedMouseMove: false,
    });
    expect(out.handleScroll).toEqual({ ...SCROLL_DEFAULTS });
    expect(out.kineticScroll).toEqual({ ...KINETIC_DEFAULTS });
  });

  it("handleScale: { pinch: false } flips only pinch; mouseWheel stays true", () => {
    const out = map({ handleScale: { pinch: false } });
    expect(out.handleScale.pinch).toBe(false);
    expect(out.handleScale.mouseWheel).toBe(true);
    expect(out.handleScale.axisPressedMouseMove).toBe(true);
  });

  it("kineticScroll: { mouse: false, touch: true } forwards verbatim", () => {
    const out = map({ kineticScroll: { mouse: false, touch: true } });
    expect(out.kineticScroll).toEqual({ mouse: false, touch: true });
    expect(out.handleScroll).toEqual({ ...SCROLL_DEFAULTS });
    expect(out.handleScale).toEqual({ ...SCALE_DEFAULTS });
  });

  it("kineticScroll: false flips both kinetic keys to false", () => {
    const out = map({ kineticScroll: false });
    expect(out.kineticScroll).toEqual({ mouse: false, touch: false });
    expect(out.handleScroll).toEqual({ ...SCROLL_DEFAULTS });
    expect(out.handleScale).toEqual({ ...SCALE_DEFAULTS });
  });
});