// @vitest-environment jsdom
// Options R1 W3S — VolView hands the W3B comparison panel the hub's three optional
// inputs: a stamped live spot (only when the hub actually holds one), the root's
// earnings calendar day from `<SYM>.fund.json`, and the published band from the
// `moves:{ROOT}` payload. VolComparePanel is W3B-frozen; these tests pin ONLY what
// VolView passes and what the reader sees as a result — no unknown ever renders as a
// number, and the producer's multiple is never dressed up as anything else.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { flowGetMock, fundGetMock } = vi.hoisted(() => ({
  flowGetMock: vi.fn(),
  fundGetMock: vi.fn(),
}));
vi.mock("@/lib/flowClientCache", () => ({
  // VolView reads through flowGetResult: a payload is data, a null is a published absence (404).
  flowGetResult: async (key: string) => {
    const data = await flowGetMock(key);
    return data == null ? { status: "absent", httpStatus: 404 } : { status: "data", data };
  },
}));
vi.mock("@/lib/dataCache", () => ({
  // `<SYM>.fund.json` goes through the shared data-cache read the fin tabs use.
  getJSONResult: async (url: string) => fundGetMock(url),
}));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en", setLang: () => undefined }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: () => undefined }));
vi.mock("@/components/ui/Tip", () => ({ Tip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { VolView } from "@/components/vol/VolView";

let el: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  flowGetMock.mockReset();
  fundGetMock.mockReset();
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});
afterEach(async () => {
  await act(async () => root.unmount());
  el.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(v: React.ReactNode) { await act(async () => root.render(v)); }
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const text = () => el.textContent ?? "";
const moveBlock = () => el.querySelector<HTMLElement>('[data-testid="vol-compare-move"]');

function volPayload(root: string, asof: string) {
  return {
    schema: "options_hub.vol/v1",
    root,
    asof,
    atm_iv: 12,
    iv_52w_hi: 22,
    iv_52w_lo: 7,
    rv20: 11,
    vrp: 1,
    term: [
      { exp: "2026-10-23", dte: 28, atm_iv: 14.6 },
      { exp: "2026-11-20", dte: 56, atm_iv: 16.1 },
    ],
    smile: [{ exp: "2026-11-20", points: [{ strike: 660, call_iv: 15.2, put_iv: 15.4 }] }],
    history: Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, iv_rank: null, atm_iv: 12 + i * 0.1, close: null })),
  };
}
const SPY = volPayload("SPY", "2026-09-25");
const MOVES = {
  schema: "options_hub.moves/v1",
  root: "SPY",
  asof: "2026-09-25",
  expected_move: { band_mult: 1.96, horizon_days: 1, pct: 0.92, lo: 660.1, hi: 672.4 },
};

beforeEach(() => {
  flowGetMock.mockImplementation(async (key: string) => {
    if (key === "vol:SPY") return SPY;
    if (key === "moves:SPY") return MOVES;
    return null; // agg:SPY absent — the VRP panel hides, the tab stays
  });
  fundGetMock.mockImplementation(async () => ({
    status: "data",
    data: { earnings: { next_date: "2026-10-30", next_period: "Q3 2026" } },
  }));
});

describe("VolView → VolComparePanel wiring (W3S)", () => {
  it("passes the hub spot with its quote stamp to the comparison panel", async () => {
    await render(<VolView liveSpot={{ value: 666.28, asOf: "2026-10-21T15:59:00-04:00" }} />);
    await settle();
    const move = moveBlock();
    expect(move).toBeTruthy();
    // The price range is drawn FROM the stamped spot, and the stamp rides along unchanged.
    expect(move!.textContent).toContain("from spot $666.28 at 2026-10-21T15:59:00-04:00");
    expect(move!.textContent).toContain("2026-10-21T15:59:00-04:00 · live quote");
    expect(move!.textContent).not.toContain("price range not shown");
    // A garbage stamp is no stamp: the percent-only path stands instead of a fake clock.
    await render(<VolView key="nostamp" liveSpot={{ value: 666.28, asOf: "  " }} />);
    await settle();
    expect(moveBlock()!.textContent).toContain("price range not shown");
    expect(text()).not.toContain("live quote");
  });

  it("passes a null spot when no stamped spot is held", async () => {
    await render(<VolView />);
    await settle();
    const move = moveBlock();
    expect(move).toBeTruthy();
    expect(move!.textContent).toContain("±4.8 %");
    expect(move!.textContent).toContain("price range not shown");
    expect(move!.textContent).toContain("no spot supplied to this view");
    expect(text()).not.toContain("live quote");
    expect(text()).not.toContain("$666.28");
  });

  it("builds one earnings event from the fund earnings date and none when it is absent", async () => {
    await render(<VolView />);
    await settle();
    const events = el.querySelector<HTMLElement>('[data-testid="vol-compare-events"]');
    expect(events).toBeTruthy();
    expect(events!.textContent).toContain("SPY earnings · Fri 30 Oct 2026");
    expect(text()).not.toContain("No calendar events are supplied");
    // macro_release / index_review are never invented; exactly one event row exists.
    expect(events!.querySelectorAll("li")).toHaveLength(1);

    fundGetMock.mockImplementation(async () => ({ status: "absent" }));
    await render(<VolView key="nofund" />);
    await settle();
    expect(el.querySelector<HTMLElement>('[data-testid="vol-compare-events"]')!.textContent)
      .toContain("No calendar events are supplied to this view.");
  });

  it("passes the published band with its multiple, horizon and clock from the moves payload", async () => {
    await render(<VolView />);
    await settle();
    expect(text()).toContain("Published one-day band");
    expect(text()).toContain("±0.92 %");
    expect(text()).toContain("1.96σ");
    expect(text()).toContain("horizon 1 day");
    expect(text()).toContain("Band clock as of 25 Sep");
    // The producer's band and the declared estimator stay two separate columns.
    expect(text()).toContain("declared approximation");
  });

  it("passes a null published band when the moves payload lacks a finite multiple or horizon", async () => {
    // Positive control: the full payload does render the band column.
    await render(<VolView />);
    await settle();
    expect(text()).toContain("Published one-day band");

    // A multiple that is not a finite number is NO multiple: the band column drops whole.
    flowGetMock.mockImplementation(async (key: string) => {
      if (key === "vol:SPY") return SPY;
      if (key === "moves:SPY") {
        return { ...MOVES, expected_move: { ...MOVES.expected_move, band_mult: "1.96" } };
      }
      return null;
    });
    await render(<VolView key="badmult" />);
    await settle();
    expect(text()).not.toContain("Published one-day band");

    // Same for a missing horizon.
    flowGetMock.mockImplementation(async (key: string) => {
      if (key === "vol:SPY") return SPY;
      if (key === "moves:SPY") {
        return { ...MOVES, expected_move: { ...MOVES.expected_move, horizon_days: null } };
      }
      return null;
    });
    await render(<VolView key="badhorizon" />);
    await settle();
    expect(text()).not.toContain("Published one-day band");
  });
});
