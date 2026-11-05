// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExposureSessionReview from "@/components/exposure-map/ExposureSessionReview";
import { exposureSessionReviewT } from "@/components/exposure-map/exposureSessionReviewStrings";
import type { Bar6 } from "@/lib/intradayShared";
import type { ReviewFrameInput } from "@/lib/exposureSessionReview";

const bar = (session: string, hm: string, h: number, l: number, c: number): Bar6 => {
  const [y, m, d] = session.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  return [Date.UTC(y, m - 1, d, hh, mm) / 1000, c, h, l, c, 0];
};
const S1 = "2026-10-19", S2 = "2026-10-20", S3 = "2026-10-21";
const BARS: Bar6[] = [
  bar(S1, "10:00", 601, 599, 600), bar(S1, "10:10", 602, 599.5, 601),
  bar(S2, "10:00", 611, 609, 610), bar(S2, "10:10", 612, 609.5, 611),
  bar(S3, "10:00", 600.5, 599.5, 600), bar(S3, "10:10", 601, 598, 600.2),
];
const FRAMES: ReviewFrameInput[] = [
  { session: S1, kind: "observed", level: 600, levelNetMn: 622 },
  { session: S2, kind: "reconstructed", level: 610, levelNetMn: -40 },
  { session: S3, kind: "current", level: 600, levelNetMn: 12 },
];
const payload = () => ({ ok: true, json: async () => ({ t: "SPY", tf: "10m", bars: BARS }) });
const fetchMock = () => vi.fn(async () => payload() as unknown as Response);
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const section = () => host.querySelector("section")!;
const status = () => section().getAttribute("data-review-status");
const render = async (props: Partial<Parameters<typeof ExposureSessionReview>[0]> = {}) => {
  await act(async () => root.render(<ExposureSessionReview root="SPY" frames={FRAMES} lang="en" {...props} />));
};
const settle = async () => { for (let n = 0; n < 40 && status() === "loading"; n++) await act(async () => new Promise((r) => setTimeout(r, 5))); };

describe("ExposureSessionReview view", () => {
  it("goes from loading to ready with three frames and the totals line", async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const requested: string[] = [];
    const get = vi.fn((url: RequestInfo) => { requested.push(String(url)); return new Promise((resolve) => { resolveFetch = resolve; }); });
    vi.stubGlobal("fetch", get);
    await render();
    expect(status()).toBe("loading");
    await act(async () => resolveFetch(payload()));
    await settle();
    expect(status()).toBe("ready");
    expect(get).toHaveBeenCalledTimes(1);
    expect(requested[0]).toBe("/api/intraday?sym=SPY&tf=10m&ext=0");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(host.textContent).toContain(exposureSessionReviewT("en")("noHoldRate"));
    expect(host.textContent).toContain("3 sessions · 2 observed · 1 reconstructed");
    expect(host.querySelector('[data-review-session]')?.getAttribute("data-review-session")).toBe(S3);
    expect(host.textContent).toContain("Observed touches");
  });
  it.each([
    ["rejects", () => Promise.reject(new Error("BAR_SOURCE_UNAVAILABLE"))],
    ["returns an error payload", () => Promise.resolve({ ok: true, json: async () => ({ t: "SPY", tf: "10m", error: "store error", bars: [] }) })],
    ["returns a wrong root", () => Promise.resolve({ ok: true, json: async () => ({ t: "QQQ", tf: "10m", bars: BARS }) })],
  ] as const)("marks bars unavailable when fetch %s, and Retry refetches", async (_label, respond) => {
    const get = vi.fn(async () => (get.mock.calls.length === 1 ? await respond() : payload()));
    vi.stubGlobal("fetch", get);
    await render();
    await settle();
    expect(status()).toBe("bars-unavailable");
    expect(host.textContent).toContain(exposureSessionReviewT("en")("barsUnavailable"));
    await act(async () => (host.querySelector(".sourceNote button, [class*=sourceNote] button") as HTMLButtonElement).click());
    await settle();
    expect(get).toHaveBeenCalledTimes(2);
    expect(status()).toBe("ready");
  });
  it("renders no-frames without fetching", async () => {
    const get = fetchMock();
    vi.stubGlobal("fetch", get);
    await render({ frames: [] });
    await settle();
    expect(status()).toBe("no-frames");
    expect(host.textContent).toContain(exposureSessionReviewT("en")("noFrames"));
    expect(get).not.toHaveBeenCalled();
  });
});

describe("ExposureSessionReview interaction", () => {
  it("selects a clicked row and shows that session in the inspector", async () => {
    vi.stubGlobal("fetch", fetchMock());
    await render();
    await settle();
    const row = host.querySelectorAll("tbody tr")[1] as HTMLTableRowElement;
    await act(async () => row.click());
    expect(host.querySelectorAll("[data-review-session]")).toHaveLength(1);
    expect(host.querySelector("[data-review-session]")?.getAttribute("data-review-session")).toBe(S2);
    expect(host.textContent).toContain(S2);
    expect(host.textContent).toContain(exposureSessionReviewT("en")("reconstructed"));
  });
  it("disables the pinned chip without a pinned level and re-measures in place with one", async () => {
    vi.stubGlobal("fetch", fetchMock());
    await render({ pinnedLevel: null });
    await settle();
    const chips = () => [...host.querySelectorAll("button[aria-pressed]")] as HTMLButtonElement[];
    expect(chips()[1].disabled).toBe(true);
    expect(chips()[1].title).toBe(exposureSessionReviewT("en")("noPinned"));
    const calls = vi.mocked(fetch).mock.calls.length;
    await render({ pinnedLevel: 600 });
    await settle();
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
    await act(async () => chips()[1].click());
    expect(chips()[1].getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("600 · pinned");
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
    expect(host.textContent).toContain("3 sessions · 2 observed · 1 reconstructed");
  });
  it("opens the price context for the selected session", async () => {
    vi.stubGlobal("fetch", fetchMock());
    const onOpenPriceContext = vi.fn();
    await render({ onOpenPriceContext });
    await settle();
    const row = host.querySelectorAll("tbody tr")[0] as HTMLTableRowElement;
    await act(async () => row.click());
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(S1)) as HTMLButtonElement;
    expect(button.textContent).toBe(exposureSessionReviewT("en")("openPriceContext").replace("{date}", S1));
    await act(async () => button.click());
    expect(onOpenPriceContext).toHaveBeenCalledWith(S1);
  });
  it("hides the price-context action without the prop and renders the zh footer eyebrow", async () => {
    vi.stubGlobal("fetch", fetchMock());
    await render({ lang: "zh" });
    await settle();
    expect(host.textContent).toContain(exposureSessionReviewT("zh")("noHoldRate"));
    expect(host.textContent).toContain(exposureSessionReviewT("zh")("descriptionNotSample").replace("{n}", "3"));
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes(exposureSessionReviewT("zh")("openPriceContext").split("{date}")[0]))).toBe(false);
  });
  it("keeps the forbidden palette and vocabulary out of the CSS module and strings", () => {
    const css = readFileSync(join(process.cwd(), "components/exposure-map/ExposureSessionReview.module.css"), "utf8");
    for (const token of ["#26c281", "#f0566b", "--up", "--down", "green", "red"]) expect(css.includes(token)).toBe(false);
    const source = readFileSync(join(process.cwd(), "components/exposure-map/exposureSessionReviewStrings.ts"), "utf8");
    const holdRateLines = source.split("\n").filter((line) => /hold[- ]rate/i.test(line));
    expect(holdRateLines).toHaveLength(2);
    expect(holdRateLines.every((line) => line.includes("noHoldRate") || line.includes("caveat"))).toBe(true);
  });
});
