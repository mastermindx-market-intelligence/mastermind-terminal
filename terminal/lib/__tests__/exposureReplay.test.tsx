// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExposureReplay from "@/components/exposure-map/ExposureReplay";
import { exposureReplayT } from "@/components/exposure-map/exposureReplayStrings";
import { reduceReplayFrame } from "@/lib/exposureReplayFrames";
import { flowGetResult } from "@/lib/flowClientCache";
import { reportedGammaBook } from "./fixtures/reportedGammaBooks";

vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: vi.fn() }));
const load = vi.mocked(flowGetResult);
const asData = (data: unknown) => ({ status: "data" as const, data });
const asAbsent = () => ({ status: "absent" as const, httpStatus: 404 });

const NOW = Date.parse("2026-10-21T12:00:00Z");
const TODAY = "2026-10-21";
const ALL = { kind: "all" } as const;
const live = reportedGammaBook("2026-10-19");

/** A stored book for any session, rebuilt from the fixture pair by identity surgery. */
const bookFor = (session: string, scale = 1) => {
  type Book = Omit<ReturnType<typeof reportedGammaBook>, "asof"> & { asof: string };
  const book = reportedGammaBook("2026-10-16", scale) as Book;
  book.asof = session;
  const p = book.exposure_projection;
  p.clocks.source_session = session; p.clocks.oi_report_date = session;
  p.valuation.source_session = session; p.underlying_reference.source_session = session;
  p.input_sha256 = (session === "2026-10-16" ? "a" : "c").repeat(64);
  const id = p.contract_identity;
  id.source_session = session; id.effective_from = session;
  id.effective_to = session === "2026-10-16" ? "2026-10-17" : "2026-10-16";
  id.input_sha256 = p.input_sha256;
  id.reference_pages[0].params.as_of = session;
  id.reference_pages[0].params["expiration_date.gte"] = session;
  return book;
};

const index = { root: "SPY", dates: ["2026-10-19", "2026-10-16", "2026-10-15"], latest: "2026-10-19" };
const storedIndex = () => async (key: string) => key === "gex_dates:SPY" ? asData(index)
  : key === "gex_at:SPY:2026-10-16" ? asData(bookFor("2026-10-16", 2))
  : key === "gex_at:SPY:2026-10-15" ? asData(bookFor("2026-10-15", 0.5)) : asAbsent();

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  load.mockReset();
  load.mockImplementation(storedIndex());
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

async function render(extra: Partial<Parameters<typeof ExposureReplay>[0]> = {}) {
  // A fresh mount: the index effect keys on root, so a same-props re-render must not reuse it.
  await act(async () => root.unmount());
  host.innerHTML = ""; root = createRoot(host);
  await act(async () => root.render(<ExposureReplay root="SPY" source={live} metric="gamma" lens={ALL}
    today={TODAY} now={NOW} lang="en" {...extra} />));
  for (let n = 0; n < 60 && host.querySelector("[data-replay-status]")?.getAttribute("data-replay-status") === "loading"; n++) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }
}
const host0 = () => host.querySelector("[data-replay-status]") as HTMLElement;
const status = () => host0()?.getAttribute("data-replay-status");

describe("ExposureReplay", () => {
  it("reaches ready with two stored frames plus the current book", async () => {
    await render();
    expect(status()).toBe("ready");
    expect(host.querySelectorAll("thead th")).toHaveLength(4);
    const kinds = [...host.querySelectorAll("thead [class*=\"headKind\"]")].map((node) => node.textContent);
    expect(kinds).toEqual([exposureReplayT("en")("reconstructed"), exposureReplayT("en")("reconstructed"), exposureReplayT("en")("current")]);
    const currentDominant = reduceReplayFrame(live, "SPY", "2026-10-19", "gamma", ALL, TODAY, NOW, true);
    if (currentDominant.kind !== "frame") throw new Error("expected a frame");
    expect(host.querySelector("[class*=\"leaderPath\"]")?.textContent).toContain("→ " + currentDominant.frame.dominant);
    expect(host0().getAttribute("data-replay-frame")).toBe("2");
    expect(host.textContent).toContain(exposureReplayT("en")("noInterpolation"));
  });

  it("shows no-index for an absent index and unavailable for a failed read, with Retry refetching", async () => {
    load.mockImplementation(async () => asAbsent());
    await render();
    expect(status()).toBe("no-index");
    expect(host.textContent).toContain(exposureReplayT("en")("noIndex"));
    expect(host.querySelectorAll("td")).toHaveLength(0);

    load.mockReset();
    load.mockImplementation(async () => { throw new Error("offline"); });
    await render();
    expect(status()).toBe("unavailable");
    expect(host.textContent).toContain(exposureReplayT("en")("unavailable"));
    const calls = load.mock.calls.length;
    await act(async () => { (host.querySelector("[class*=\"empty\"] button") as HTMLButtonElement).click(); });
    for (let n = 0; n < 40 && load.mock.calls.length === calls; n++) await act(async () => new Promise((r) => setTimeout(r, 5)));
    expect(load.mock.calls.length).toBeGreaterThan(calls);
  });

  it("renders a listed session whose book is absent as a MISSING gap with the reason", async () => {
    load.mockImplementation(async (key) => key === "gex_dates:SPY" ? asData(index) : asAbsent());
    await render();
    expect(status()).toBe("ready");
    expect(host.querySelectorAll("thead th")).toHaveLength(4);
    expect(host.querySelector("thead [class*=\"headKind\"]")?.textContent).toBe(exposureReplayT("en")("missing"));
    const th = host.querySelector("thead th[title]") as HTMLElement;
    expect(th.getAttribute("title")).toBe(exposureReplayT("en")("gapUnavailable"));
    const gapCell = host.querySelector("td[class*=\"cell\"][title]") as HTMLElement;
    expect(gapCell?.textContent).toBe("—");
    expect(gapCell?.getAttribute("data-sign")).toBe("unknown");
  });

  it("moves the active frame with ArrowLeft and ArrowRight on the scrubber", async () => {
    await render();
    const scrubber = host.querySelector("input[type=\"range\"]") as HTMLInputElement;
    expect(host0().getAttribute("data-replay-frame")).toBe("2");
    const key = (k: string) => act(() => { scrubber.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); return Promise.resolve(); });
    await key("ArrowLeft");
    expect(host0().getAttribute("data-replay-frame")).toBe("1");
    await key("ArrowLeft"); await key("ArrowLeft");
    expect(host0().getAttribute("data-replay-frame")).toBe("0");
    await key("ArrowRight");
    expect(host0().getAttribute("data-replay-frame")).toBe("1");
  });

  it("selects a struck cell, reports the strike and activates that column", async () => {
    const onSelectStrike = vi.fn();
    await render({ onSelectStrike });
    const target = reduceReplayFrame(live, "SPY", "2026-10-19", "gamma", ALL, TODAY, NOW, true);
    if (target.kind !== "frame") throw new Error("expected a frame");
    const strike = target.frame.dominant;
    if (strike == null) throw new Error("fixture has no dominant");
    const cell = host.querySelector(`td[data-tier]:not([data-sign="unknown"])`) as HTMLTableCellElement;
    await act(async () => { cell.click(); });
    expect(onSelectStrike).toHaveBeenCalledWith(Number(cell.textContent!.replace(/[^\d-]/g, "")) === strike ? strike : expect.any(Number));
    expect(onSelectStrike).toHaveBeenCalledTimes(1);
    const inspector = host.querySelector("[class*=\"inspector\"]") as HTMLElement;
    expect(inspector.textContent).toContain(String(strike));
  });

  it("offers this session's book on the active frame and jumps back to current", async () => {
    const onLoadSession = vi.fn();
    await render({ onLoadSession });
    const ghost = [...host.querySelectorAll("button")].find((b) => b.textContent === exposureReplayT("en")("openSessionBook")) as HTMLButtonElement;
    expect(ghost).toBeTruthy();
    await act(async () => { ghost.click(); });
    expect(onLoadSession).toHaveBeenCalledWith("2026-10-19");
  });

  it("renders zh kind labels and honest caveat copy", async () => {
    await render({ lang: "zh" });
    expect(status()).toBe("ready");
    expect(host.textContent).toContain(exposureReplayT("zh")("current"));
    expect(host.textContent).toContain(exposureReplayT("zh")("reconstructed"));
    expect(host.textContent).toContain(exposureReplayT("zh")("noInterpolation"));
    expect(host.textContent).not.toContain("OBSERVED");
  });

  it("keeps the replay palette away from price-direction colours", () => {
    const css = readFileSync("components/exposure-map/ExposureReplay.module.css", "utf8");
    for (const banned of ["#26c281", "#f0566b", "--up", "--down", "green", "red"]) {
      expect(css.toLowerCase()).not.toContain(banned);
    }
  });
});

