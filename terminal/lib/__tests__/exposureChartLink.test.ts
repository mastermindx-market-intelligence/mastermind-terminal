import { webcrypto } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { exposureChartFingerprint, exposureChartHref, parseExposureChartRequest, type ExposureChartRequest } from "../exposureChartLink";
import { readExposureMap } from "../exposureMap";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
const request: ExposureChartRequest = {
  v: 1, root: "SPY", session: "2026-10-16", strike: 765, archived: false, metric: "gamma",
  lens: { kind: "all" }, shock: { spotPercent: 0, ivPoints: 0, calendarDays: 0 }, fingerprint: "a".repeat(64),
};
const encode = (value: unknown) => `#exposure=${encodeURIComponent(JSON.stringify(value))}`;
const book = { root: "SPY", asof: "2026-10-16", spot_ref: 763.25, by_strike: [{ strike: 765, gamma_net: -100, gamma_call: 100, gamma_put: -200 }] };
const read = readExposureMap(book, "SPY", null, { kind: "all" }, "gamma", "2026-10-20", Date.parse("2026-10-20T12:00:00Z"));
const digest = (value = read) => exposureChartFingerprint("SPY", value, request.lens, request.metric, request.shock);

describe("Exposure chart navigation contract", () => {
  it.each([
    request,
    { ...request, archived: true, lens: { kind: "one" as const, exp: "2026-10-23" } },
    { ...request, metric: "combined" as const, shock: { spotPercent: -1, ivPoints: 2, calendarDays: 1 } },
  ])("roundtrips a bounded selection through a fixed local destination", value => {
    const href = exposureChartHref(value)!;
    const url = new URL(href, "https://app.mastermind-x.com");
    expect(url.origin).toBe("https://app.mastermind-x.com");
    expect(url.pathname).toBe("/terminal");
    expect(url.search).toBe("?symbol=SPY");
    expect(parseExposureChartRequest(url.hash)).toEqual(value);
  });
  it.each([
    { root: "spy" }, { root: "https://evil.example" }, { root: "SPY\n" },
    { session: "2026-02-30" }, { strike: 0 }, { strike: -1 }, { strike: "765" },
    { archived: 1 }, { v: 2 }, { fingerprint: "a".repeat(63) }, { destination: "//evil.example" },
    { lens: { kind: "one", exp: "2026-02-30" } }, { lens: { kind: "all", exp: "2026-10-16" } },
    { shock: { ...request.shock, calendarDays: -1 } }, { shock: { ...request.shock, extra: 1 } },
  ])("rejects malformed, ambiguous or extra navigation fields: %j", patch => {
    const value = { ...request, ...patch };
    expect(parseExposureChartRequest(encode(value))).toBeNull();
    expect(exposureChartHref(value as ExposureChartRequest)).toBeNull();
  });
  it.each(["#exposure=%", "#exposure=%7B", "#wrong=anything", `#exposure=${"a".repeat(4096)}`])("rejects invalid fragments", hash => {
    expect(parseExposureChartRequest(hash)).toBeNull();
  });
  it("refuses nonfinite values before JSON could convert them to null", () => {
    for (const strike of [NaN, Infinity, -Infinity]) expect(exposureChartHref({ ...request, strike })).toBeNull();
  });
  it("compares source-derived values independently of object key insertion order", async () => {
    expect(await digest()).toMatch(/^[a-f0-9]{64}$/);
    const reordered = Object.fromEntries(Object.entries(read).reverse()) as typeof read;
    expect(await digest(reordered)).toBe(await digest());
  });
  it("detects a same-session numerical correction", async () => {
    const corrected = readExposureMap({ ...book, by_strike: [{ ...book.by_strike[0], gamma_net: -90 }] }, "SPY", null, request.lens, "gamma", "2026-10-20");
    expect(await digest(corrected)).not.toBe(await digest());
  });
  it.each([
    { sourceRef: "different-book" }, { clocks: { available_at: "2026-10-20T10:00:00Z" } },
    { coverage: { expected: null, received: 10, qualified: 8, missing: 2 } }, { selectionKey: "2026-10-23|changed" },
  ])("detects source, availability, denominator and selection changes: %j", async patch => {
    expect(await digest({ ...read, ...patch })).not.toBe(await digest());
  });
  it("binds root and scenario independently of unchanged numeric rows", async () => {
    const baseline = await digest();
    expect(await exposureChartFingerprint("QQQ", read, request.lens, "gamma", request.shock)).not.toBe(baseline);
    expect(await exposureChartFingerprint("SPY", read, request.lens, "gamma", { ...request.shock, ivPoints: 1 })).not.toBe(baseline);
  });
  it("does not silently canonicalize unsupported or circular source values", async () => {
    await expect(digest({ ...read, spot: NaN })).rejects.toThrow();
    const cycle = { ...read } as typeof read & { self?: unknown };
    cycle.self = cycle;
    await expect(digest(cycle)).rejects.toThrow();
  });
});
