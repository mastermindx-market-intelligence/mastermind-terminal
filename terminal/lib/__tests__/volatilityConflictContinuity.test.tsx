// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ flowGet: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({ flowGet: H.flowGet }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en", setLang: () => undefined }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: () => undefined }));
vi.mock("@/components/ui/Tip", () => ({ Tip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { VolTermPanel } from "@/components/vol/VolTermPanel";
import { VolSkewPanel } from "@/components/vol/VolSkewPanel";
import { VolHistoryPanel } from "@/components/vol/VolHistoryPanel";
import { VolView } from "@/components/vol/VolView";
import type { VolPayload, VolSmilePoint } from "@/components/vol/volTypes";

let host: HTMLDivElement;
let root: Root;
let payload: VolPayload;
const point = (strike: number, call_iv: number | null, put_iv: number | null): VolSmilePoint => ({ strike, call_iv, put_iv });
const basePayload = (): VolPayload => ({
  schema: "options_hub.vol/v1",
  root: "SPY",
  asof: "2026-09-25",
  atm_iv: 12.5,
  iv_rank_252: 41,
  iv_rank_all: 52,
  coverage_days_all: 300,
  since_all: "2025-07-01",
  iv_52w_hi: 25,
  iv_52w_lo: 10,
  rv20: 12.7,
  vrp: -0.2,
  term: [], smile: [], history: [],
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { configurable: true, value: 900 });
  document.body.append(host);
  root = createRoot(host);
  payload = basePayload();
  H.flowGet.mockReset();
  H.flowGet.mockImplementation(async (key: string) => key === "vol:SPY" ? payload : null);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
}
function paths(stroke = "var(--brand-2)") {
  return [...host.querySelectorAll<SVGPathElement>("path")].filter((p) => p.getAttribute("stroke") === stroke);
}
async function mountView() {
  await render(<VolView />);
  for (let i = 0; i < 12 && !host.querySelector('[data-testid="vol-expiry-context"]'); i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  const context = host.querySelector<HTMLElement>('[data-testid="vol-expiry-context"]');
  if (!context) throw new Error("vol expiry context did not mount");
  return context;
}

describe("Volatility conflict continuity", () => {
  it("keeps a duplicate strike as a gap and out of proxy-skew interpolation", async () => {
    await render(<VolSkewPanel lang="en" smile={[{
      exp: "2026-10-23",
      points: [
        point(90, 22, 24),
        point(100, 20, 20),
        point(105, 21, 22),
        point(105, 80, 81),
        point(110, 24, 25),
      ],
    }]} />);
    expect(paths()).toHaveLength(2);
    expect(paths("var(--ai)")).toHaveLength(2);
    expect(host.textContent).not.toContain("95–105%");
    expect(host.textContent).toContain("1 conflicting strike unavailable");
  });

  it("keeps a duplicate term expiry at one known DTE as a line gap", async () => {
    await render(<VolTermPanel lang="en" term={[
      { exp: "2026-10-09", dte: 7, atm_iv: 14 },
      { exp: "2026-10-16", dte: 14, atm_iv: 15 },
      { exp: "2026-10-16", dte: 14, atm_iv: 99 },
      { exp: "2026-10-23", dte: 21, atm_iv: 16 },
    ]} />);
    expect(paths()).toHaveLength(2);
    expect(paths().every((p) => !(p.getAttribute("d") ?? "").includes("L"))).toBe(true);
    expect(host.textContent).not.toContain("99.0%");
    expect(host.textContent).toContain("1 conflicting expiry unavailable");
  });

  it("withholds all term-curve continuity when duplicate expiry rows disagree on DTE", async () => {
    await render(<VolTermPanel lang="en" term={[
      { exp: "2026-10-09", dte: 7, atm_iv: 14 },
      { exp: "2026-10-16", dte: 14, atm_iv: 15 },
      { exp: "2026-10-16", dte: 18, atm_iv: 99 },
      { exp: "2026-10-23", dte: 21, atm_iv: 16 },
      { exp: "2026-10-30", dte: 28, atm_iv: 17 },
    ]} />);
    expect(paths()).toHaveLength(3);
    expect(paths().every((p) => !(p.getAttribute("d") ?? "").includes("L"))).toBe(true);
    expect(host.textContent).toContain("Term-curve lines withheld");
    expect(host.textContent).not.toContain("99.0%");
  });

  it("keeps a duplicate history date as a gap between surrounding sessions", async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      atm_iv: 12 + i,
      iv_rank: null,
      close: null,
    }));
    rows.push({ date: "2026-09-06", atm_iv: 99, iv_rank: null, close: null });
    await render(<VolHistoryPanel history={rows} iv52wHi={null} iv52wLo={null} lang="en" />);
    expect(host.textContent).toContain("10 sessions");
    expect(host.textContent).toContain("1 conflicting date unavailable");
    expect(paths()).toHaveLength(2);
    expect(paths().map((p) => ((p.getAttribute("d") ?? "").match(/L/g) ?? []).length)).toEqual([4, 4]);
  });

  it("does not re-admit a duplicate term row into the shared expiry context", async () => {
    payload = {
      ...basePayload(),
      term: [
        { exp: "2026-10-23", dte: 28, atm_iv: 14.6 },
        { exp: "2026-10-23", dte: 28, atm_iv: 99 },
      ],
      smile: [{ exp: "2026-10-23", points: [point(90, 22, 23), point(100, 20, 20), point(110, 21, 22)] }],
    };
    const context = await mountView();
    expect(context.textContent).toContain("2026-10-23");
    expect(context.textContent).toContain("ATM IV unavailable · conflicting expiry records");
    expect(context.textContent).not.toContain("14.6%");
    expect(context.textContent).not.toContain("99.0%");
    expect(context.textContent).toContain("smile supplied");
  });

  it("does not call duplicate smile-expiry objects supplied when the panel rejects them", async () => {
    const smile = { exp: "2026-10-23", points: [point(90, 22, 23), point(100, 20, 20)] };
    payload = {
      ...basePayload(),
      term: [{ exp: "2026-10-23", dte: 28, atm_iv: 14.6 }],
      smile: [smile, { ...smile, points: [point(90, 80, 81), point(100, 79, 80)] }],
    };
    const context = await mountView();
    expect(context.textContent).toContain("reported ATM IV 14.6%");
    expect(context.textContent).toContain("smile unavailable · conflicting records");
    expect(context.textContent).not.toContain("smile supplied");
  });

  it("does not call an all-conflicted-strike smile supplied when its panel is empty", async () => {
    payload = {
      ...basePayload(),
      term: [{ exp: "2026-10-23", dte: 28, atm_iv: 14.6 }],
      smile: [{ exp: "2026-10-23", points: [point(100, 20, 20), point(100, 80, 81)] }],
    };
    const context = await mountView();
    expect(context.textContent).toContain("reported ATM IV 14.6%");
    expect(context.textContent).toContain("smile unavailable · conflicting records");
    expect(context.textContent).not.toContain("smile supplied");
  });

  it("labels a usable smile as partial when a different strike is conflicted", async () => {
    payload = {
      ...basePayload(),
      term: [{ exp: "2026-10-23", dte: 28, atm_iv: 14.6 }],
      smile: [{ exp: "2026-10-23", points: [
        point(90, 22, 23), point(100, 20, 20), point(105, 21, 22), point(105, 80, 81), point(110, 24, 25),
      ] }],
    };
    const context = await mountView();
    expect(context.textContent).toContain("reported ATM IV 14.6%");
    expect(context.textContent).toContain("smile partial · 1 conflicting strike unavailable");
    expect(context.textContent).not.toContain("smile supplied");
  });
});
