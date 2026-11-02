import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// ─────────────────────────────────────────────────────────────────────────────
// Engine telemetry glue (lib/chart-engine/telemetry.ts) — the P03 default-flip
// observability. The transport (lib/analytics) is a pure mock: this suite pins
// the EVENT SHAPE (types, exact meta key sets, truncation, fail-silence) and
// the A05 refusal sequence as the PROPOSED ChartPanel patch would drive it.
// vi.mock of the house analytics module follows lwcAdapter.test.ts's precedent
// of mocking the rented/global layer out of existence.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { track } from "@/lib/analytics";
import {
  reportEngineFallback,
  reportEngineMount,
} from "@/lib/chart-engine/telemetry";

const trackMock = vi.mocked(track);

beforeEach(() => {
  trackMock.mockClear();
});

describe("reportEngineMount", () => {
  it("emits exactly { type: chart_engine_mount, meta } with ONLY the four selection fields", () => {
    reportEngineMount({ impl: "mm", source: "url", fallback: false, refusal: null });
    expect(trackMock).toHaveBeenCalledTimes(1);
    const ev = trackMock.mock.calls[0][0];
    expect(Object.keys(ev).sort()).toEqual(["meta", "type"]);
    expect(ev.type).toBe("chart_engine_mount");
    expect(ev.meta).toEqual({ impl: "mm", source: "url", fallback: false, refusal: null });
    expect(Object.keys(ev.meta as object).sort()).toEqual([
      "fallback",
      "impl",
      "refusal",
      "source",
    ]);
  });

  it("caps refusal at 200 chars and keeps null/null as null", () => {
    reportEngineMount({ impl: "lwc", source: "killswitch", fallback: false, refusal: null });
    expect(trackMock.mock.calls[0][0].meta).toMatchObject({ refusal: null });
    trackMock.mockClear();
    const long = "x".repeat(250);
    reportEngineMount({ impl: "mm", source: "default", fallback: false, refusal: long });
    const meta = trackMock.mock.calls[0][0].meta as Record<string, unknown>;
    expect(typeof meta.refusal).toBe("string");
    expect((meta.refusal as string).length).toBe(200);
    expect((meta.refusal as string)).toBe(long.slice(0, 200));
  });

  // F4 (P03 repair round 1): the field is typed `string | null` but a JS producer can
  // still hand over `undefined` (an unset variable, a spread from a partial report). The
  // old `refusal === null ? null : refusal.slice(...)` threw on it inside the try, so the
  // whole chart_engine_mount event silently vanished — exactly the failure mode the flip
  // observability must not have. refusalField is total: nullish → null, still ONE event.
  it("F4: an undefined refusal is emitted as null, not a thrown TypeError and not a dropped event", () => {
    reportEngineMount({
      impl: "mm",
      source: "default",
      fallback: false,
      refusal: undefined as unknown as string,
    });
    expect(trackMock).toHaveBeenCalledTimes(1); // …the event was NOT dropped
    const ev = trackMock.mock.calls[0][0];
    expect(ev.type).toBe("chart_engine_mount");
    const meta = ev.meta as Record<string, unknown>;
    expect("refusal" in meta).toBe(true);
    expect(meta.refusal).toBeNull();
    expect(Object.keys(meta).sort()).toEqual(["fallback", "impl", "refusal", "source"]);
  });

  it("a throwing track() is swallowed — telemetry never breaks a mount", () => {
    trackMock.mockImplementationOnce(() => {
      throw new Error("beacon exploded");
    });
    expect(() =>
      reportEngineMount({ impl: "mm", source: "stored", fallback: false, refusal: null }),
    ).not.toThrow();
  });
});

describe("reportEngineFallback", () => {
  it("emits exactly { type: chart_engine_fallback, meta } with ONLY requested/impl/refusal", () => {
    reportEngineFallback({ requested: "mm", impl: "lwc", refusal: "no bridge" });
    expect(trackMock).toHaveBeenCalledTimes(1);
    const ev = trackMock.mock.calls[0][0];
    expect(Object.keys(ev).sort()).toEqual(["meta", "type"]);
    expect(ev.type).toBe("chart_engine_fallback");
    expect(ev.meta).toEqual({ requested: "mm", impl: "lwc", refusal: "no bridge" });
    expect(Object.keys(ev.meta as object).sort()).toEqual(["impl", "refusal", "requested"]);
  });

  it("caps refusal at 200 chars too", () => {
    reportEngineFallback({ requested: "mm", impl: "lwc", refusal: "y".repeat(500) });
    const meta = trackMock.mock.calls[0][0].meta as Record<string, unknown>;
    expect((meta.refusal as string).length).toBe(200);
  });

  // F4 counterpart on the fallback event: same totality requirement.
  it("F4: an undefined refusal on a fallback event is emitted as null too", () => {
    reportEngineFallback({
      requested: "mm",
      impl: "lwc",
      refusal: undefined as unknown as string,
    });
    expect(trackMock).toHaveBeenCalledTimes(1);
    const meta = trackMock.mock.calls[0][0].meta as Record<string, unknown>;
    expect(meta.refusal).toBeNull();
    expect(Object.keys(meta).sort()).toEqual(["impl", "refusal", "requested"]);
  });

  it("a throwing track() is swallowed", () => {
    trackMock.mockImplementationOnce(() => {
      throw new Error("collector down");
    });
    expect(() =>
      reportEngineFallback({ requested: "mm", impl: "lwc", refusal: "x" }),
    ).not.toThrow();
  });
});

describe("A05: the refusal sequence of the PROPOSED ChartPanel patch", () => {
  it("guard-branch refusal emits chart_engine_fallback {requested:mm, impl:lwc, refusal} then chart_engine_mount with fallback:true", () => {
    // Drives the helpers in EXACTLY the order/arguments of PROPOSED_PATCHES'
    // ChartPanel F-13 block (guard branch):
    //   engineRefusal = "ChartPanel still needs the raw lwc bridge (F-13)";
    //   reportEngineFallback({ requested: "mm", impl: "lwc", refusal: engineRefusal });
    //   engine = createEngine(el, engineOptions);        // re-created on lwc
    //   ...
    //   reportEngineMount({ impl: engine.impl, source: engineSelection.source,
    //                       fallback: engineRefusal !== null, refusal: engineRefusal });
    let engineRefusal: string | null = null;
    engineRefusal = "ChartPanel still needs the raw lwc bridge (F-13)";
    reportEngineFallback({ requested: "mm", impl: "lwc", refusal: engineRefusal });
    const engineImpl = "lwc" as const; // what the re-create yields under F-13
    reportEngineMount({
      impl: engineImpl,
      source: "url", // user arrived with ?engine=mm
      fallback: engineRefusal !== null,
      refusal: engineRefusal,
    });

    expect(trackMock).toHaveBeenCalledTimes(2);
    expect(trackMock.mock.calls[0][0]).toEqual({
      type: "chart_engine_fallback",
      meta: {
        requested: "mm",
        impl: "lwc",
        refusal: "ChartPanel still needs the raw lwc bridge (F-13)",
      },
    });
    expect(trackMock.mock.calls[1][0]).toEqual({
      type: "chart_engine_mount",
      meta: {
        impl: "lwc",
        source: "url",
        fallback: true,
        refusal: "ChartPanel still needs the raw lwc bridge (F-13)",
      },
    });
  });

  it("catch-branch refusal keeps the same shapes (reason is the thrown message)", () => {
    let engineRefusal: string | null = null;
    const err: unknown = new Error("canvas: 2d context unavailable");
    engineRefusal = err instanceof Error ? err.message : String(err);
    reportEngineFallback({ requested: "mm", impl: "lwc", refusal: engineRefusal });
    reportEngineMount({
      impl: "lwc",
      source: "stored",
      fallback: engineRefusal !== null,
      refusal: engineRefusal,
    });
    expect(trackMock.mock.calls[0][0].meta).toEqual({
      requested: "mm",
      impl: "lwc",
      refusal: "canvas: 2d context unavailable",
    });
    expect(trackMock.mock.calls[1][0].meta).toMatchObject({ fallback: true });
  });

  it("a CLEAN mm mount emits exactly one mount event, fallback:false, refusal:null", () => {
    // no fallback branch ran (the patched block's `let engineRefusal` would stay at
    // its initial null); the patched block still reports once afterwards:
    const engineRefusal: string | null = null;
    reportEngineMount({
      impl: "mm",
      source: "default",
      fallback: engineRefusal !== null,
      refusal: engineRefusal,
    });
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock.mock.calls[0][0].meta).toMatchObject({ fallback: false, refusal: null });
  });
});

describe("telemetry module purity", () => {
  it("telemetry.ts source reads no browser globals and never touches lightweight-charts", () => {
    const source = readFileSync(new URL("../chart-engine/telemetry.ts", import.meta.url), "utf8");
    expect(/\b(window|document|localStorage|sessionStorage|globalThis)\b/.test(source)).toBe(false);
    expect(/lightweight-charts/.test(source)).toBe(false);
  });
});
