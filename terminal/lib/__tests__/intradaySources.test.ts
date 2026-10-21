import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchIntraday, polygonLookbackDays, polygonUsSessionBaseMinutes } from "../intradaySources";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("polygonLookbackDays", () => {
  it("keeps every US hourly timeframe inside Polygon's aggregate limit", () => {
    expect(polygonLookbackDays(60, "us")).toBe(60);
    expect(polygonLookbackDays(120, "us")).toBe(60);
    expect(polygonLookbackDays(240, "us")).toBe(60);
  });

  it("uses a smaller hourly window for 24/7 crypto", () => {
    expect(polygonLookbackDays(60, "crypto")).toBe(30);
    expect(polygonLookbackDays(240, "crypto")).toBe(30);
  });

  it("preserves the existing minute windows", () => {
    expect(polygonLookbackDays(5, "us")).toBe(10);
    expect(polygonLookbackDays(30, "us")).toBe(25);
  });
});

describe("polygonUsSessionBaseMinutes", () => {
  it("uses boundary-aligned source aggregates without provider-built hourly bars", () => {
    expect(polygonUsSessionBaseMinutes(1)).toBe(1);
    expect(polygonUsSessionBaseMinutes(2)).toBe(1);
    expect(polygonUsSessionBaseMinutes(3)).toBe(1);
    expect(polygonUsSessionBaseMinutes(10)).toBe(5);
    expect(polygonUsSessionBaseMinutes(15)).toBe(15);
    expect(polygonUsSessionBaseMinutes(45)).toBe(15);
    expect(polygonUsSessionBaseMinutes(60)).toBe(30);
    expect(polygonUsSessionBaseMinutes(240)).toBe(30);
  });
});

it("propagates the daytime deadline signal through the actual Polygon response body", async () => {
  vi.stubEnv("POLYGON_API_KEY", "unit-test-key");
  const controller = new AbortController();
  const reason = new Error("bounded fetch ended");
  let received: AbortSignal | undefined;
  let bodyStarted = false;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
    received = options.signal as AbortSignal;
    return { ok: true, json: () => {
      bodyStarted = true;
      return new Promise((_resolve, reject) => received?.addEventListener("abort",
        () => reject(received?.reason), { once: true }));
    } };
  }));
  const response = fetchIntraday("AMD", "5m", true, undefined, true, controller.signal);
  const rejection = expect(response).rejects.toBe(reason);
  await vi.waitFor(() => expect(bodyStarted).toBe(true));
  expect(received).toBe(controller.signal);
  controller.abort(reason);
  await rejection;
  expect(fetch).toHaveBeenCalledTimes(1);
});
