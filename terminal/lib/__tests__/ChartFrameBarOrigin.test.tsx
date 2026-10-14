// @vitest-environment jsdom
// Data OS U02 — the frame-bar data-origin chip: label derived from state (never a static
// "ADJ"/"split & dividend adjusted" claim), popover content from the view contract, zh
// through the LEX tuples, request ownership (a stale symbol's origin never repaints),
// and dismissal without ever touching chart settings.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import DataOriginChip from "@/components/DataOriginChip";
import ChartFrameBar, { DEFAULT_CHART_SETTINGS } from "@/components/ChartFrameBar";
import { LangProvider, applyLang } from "@/lib/i18n";
import { deriveDataOrigin, type DataOrigin } from "@/lib/dataOrigin";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-10-13T00:00:00Z";
const REV = "e2e-fixture-rev-0001";

function knownOrigin(symbol = "AAPL"): DataOrigin {
  return deriveDataOrigin(symbol, {
    t: symbol, o: 1, src: "polygon", bar_quality: "raw", bars: [],
    view: {
      schema: "terminal.ohlc_view.v1",
      contract: {
        schema: "dataos.view_contract.v1", purpose: "terminal_daily_ohlc", identity_namespace: "mmx/us/daily",
        field_units: { o: "vendor_adjusted_usd" },
        adjustment_reference: { basis: "tradj", action_revision_set_id: REV, as_at: AS_OF },
        evidence_mode: { mode: "CURRENT", clock: "td_close", dependency_generation_ids: ["g1"], code_version: "1" },
        coverage: { from: "1999-01-04", to: "2026-10-10" }, refusal_reasons: [],
      },
      listing: { security_id: "s1", listing_id: "l1", mic: "XNAS", src: "polygon", refusal_reasons: [] },
      segments: [{ from: "1999-01-04", to: "2026-10-10", src: "polygon", bar_quality: "raw" }],
      basis_drift: null, suspected_breaks: [], refusal_reasons: [],
    },
  });
}

// A real-shape legacy document: every production file today (no view block yet).
function legacyUnknownOrigin(symbol = "AAPL"): DataOrigin {
  return deriveDataOrigin(symbol, { t: symbol, o: 1, src: "deep", bar_quality: "synthetic_open_deepstore", bars: [] });
}

let roots: Root[] = [];
function render(el: React.ReactElement): HTMLDivElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => { root.render(<LangProvider>{el}</LangProvider>); });
  return host;
}
afterEach(() => {
  for (const root of roots) act(() => { root.unmount(); });
  roots = [];
  document.body.innerHTML = "";
  act(() => { applyLang("en"); });
});

const chip = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-testid="cfb-origin"]')!;
const openPop = (host: HTMLElement) => {
  act(() => { chip(host).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  return host.querySelector<HTMLElement>('[data-testid="cfb-origin-pop"]')!;
};
const noCJK = /[㐀-鿿]/;

describe("DataOriginChip", () => {
  it("label is derived: TRADJ for known, BASIS? for unknown (EN) — never a static 'adjusted' claim", () => {
    const known = render(<DataOriginChip symbol="AAPL" origin={knownOrigin()} />);
    expect(chip(known).textContent).toBe("TRADJ");
    expect(chip(known).dataset.originState).toBe("known");

    const legacy = render(<DataOriginChip symbol="AAPL" origin={legacyUnknownOrigin()} />);
    expect(chip(legacy).textContent).toBe("BASIS?");
    expect(chip(legacy).dataset.originState).toBe("unknown");
  });

  it("zh label for unknown is 基准?", () => {
    act(() => { applyLang("zh"); });
    const host = render(<DataOriginChip symbol="AAPL" origin={legacyUnknownOrigin()} />);
    expect(chip(host).textContent).toBe("基准?");
  });

  it("pending: — label and no origin facts at all", () => {
    const host = render(<DataOriginChip symbol="AAPL" origin={null} />);
    expect(chip(host).textContent).toBe("—");
    expect(chip(host).dataset.originState).toBe("pending");
  });

  it("request ownership: an origin for ANOTHER symbol is never shown (U02.03)", () => {
    const host = render(<DataOriginChip symbol="AAPL" origin={knownOrigin("NVDA")} />);
    expect(chip(host).dataset.originState).toBe("pending");
    expect(chip(host).textContent).not.toContain("TRADJ");
    expect(chip(host).textContent).toBe("—");
  });

  it("known popover states basis, source, as-of, generation and the not-a-printed-price foot", () => {
    const host = render(<DataOriginChip symbol="AAPL" origin={knownOrigin()} />);
    const pop = openPop(host);
    const text = pop.textContent ?? "";
    expect(text).toContain("tradj — vendor-adjusted");
    expect(text).toContain("Polygon daily bars");
    expect(text).toContain(AS_OF);
    expect(text).toContain(REV);
    expect(text).toContain("Vendor-adjusted — not a printed price");
    expect(text).not.toMatch(noCJK);
    // No element in the chip or popover carries a tooltip title.
    expect(host.querySelectorAll("[title]")).toHaveLength(0);
  });

  it("legacy unknown popover shows 'unknown' for basis and the VIEW_ABSENT sentence", () => {
    const host = render(<DataOriginChip symbol="AAPL" origin={legacyUnknownOrigin()} />);
    const pop = openPop(host);
    const text = pop.textContent ?? "";
    expect(text).toContain("unknown");
    expect(text).toContain("This file predates view labels");
    expect(text).toContain("Deep store (Mastermind history)");
    expect(text).toContain("Reconstructed — not a traded open");
    expect(text).toContain("Vendor-adjusted — not a printed price");
  });

  it("zh popover carries the zh strings and no EN leak; EN popover carries no CJK", () => {
    act(() => { applyLang("zh"); });
    const zhHost = render(<DataOriginChip symbol="AAPL" origin={knownOrigin()} />);
    const zhPop = openPop(zhHost);
    expect(zhPop.textContent).toContain("数据商复权");
    expect(zhPop.textContent).toContain("非实际成交价");
    expect(zhPop.textContent).not.toContain("Vendor-adjusted");

    act(() => { applyLang("en"); });
    const enHost = render(<DataOriginChip symbol="AAPL" origin={knownOrigin()} />);
    const enPop = openPop(enHost);
    expect(enPop.textContent).not.toMatch(noCJK);
  });

  it("closes on Escape and on outside pointerdown, and never calls onSettings", () => {
    const onSettings = vi.fn();
    const host = render(
      <ChartFrameBar
        timeframe="D" chartApi={null} settings={DEFAULT_CHART_SETTINGS}
        onSettings={onSettings} symbol="AAPL" dataOrigin={knownOrigin()}
      />,
    );
    // The frame bar renders the derived chip in place of the static ADJ span.
    expect(chip(host).textContent).toBe("TRADJ");
    expect(host.textContent ?? "").not.toContain("split & dividend adjusted");

    const pop = openPop(host);
    expect(pop.textContent).toContain("tradj — vendor-adjusted");
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(host.querySelector('[data-testid="cfb-origin-pop"]')).toBe(null);

    openPop(host);
    act(() => { document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    expect(host.querySelector('[data-testid="cfb-origin-pop"]')).toBe(null);

    expect(onSettings).not.toHaveBeenCalled();
  });
});
