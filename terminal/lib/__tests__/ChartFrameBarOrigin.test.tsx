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
import { deriveDataOrigin, originComposite, originUnavailable, type DataOrigin } from "@/lib/dataOrigin";

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

  it("legacy unknown popover shows 'unknown' for basis and the VIEW_ABSENT sentence, and never the vendor-adjusted foot", () => {
    const host = render(<DataOriginChip symbol="AAPL" origin={legacyUnknownOrigin()} />);
    const pop = openPop(host);
    const text = pop.textContent ?? "";
    expect(text).toContain("unknown");
    expect(text).toContain("This file predates view labels");
    expect(text).toContain("Deep store (Mastermind history)");
    expect(text).toContain("Reconstructed — not a traded open");
    // B1: an unlabelled file never inherits the vendor-adjusted claim — the old
    // assertion here demanded the foot on a VIEW_ABSENT file, which was the bug.
    expect(text).not.toContain("Vendor-adjusted — not a printed price");
    expect(text).not.toContain("数据商复权 — 非实际成交价");
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

  // ── B1: the vendor-adjusted foot is a tradj-only claim ─────────────────────────────────
  const FOOT = "Vendor-adjusted — not a printed price";
  const FOOT_ZH = "数据商复权 — 非实际成交价";

  // A labelled tradj document with overridable view/doc fields, for the footer matrix.
  function tradjViewDoc(viewOverrides: Record<string, unknown> = {}, docOverrides: Record<string, unknown> = {}): Record<string, unknown> {
    const view: Record<string, unknown> = {
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
      ...viewOverrides,
    };
    return { t: "AAPL", o: 1, src: "polygon", bar_quality: "raw", bars: [], view, ...docOverrides };
  }

  it("foot matrix (EN): only known and partial tradj print the vendor-adjusted foot", () => {
    const known = render(<DataOriginChip symbol="AAPL" origin={deriveDataOrigin("AAPL", tradjViewDoc())} />);
    expect(openPop(known).textContent).toContain(FOOT);

    const partial = render(<DataOriginChip symbol="AAPL" origin={deriveDataOrigin("AAPL", tradjViewDoc({ refusal_reasons: ["SEGMENT_SRC_UNKNOWN"] }))} />);
    expect(chip(partial).dataset.originState).toBe("partial");
    expect(openPop(partial).textContent).toContain(FOOT);

    const legacy = render(<DataOriginChip symbol="AAPL" origin={legacyUnknownOrigin()} />);
    expect(openPop(legacy).textContent).not.toContain(FOOT);

    const refused = render(<DataOriginChip symbol="AAPL" origin={deriveDataOrigin("AAPL", tradjViewDoc({ refusal_reasons: ["LISTING_ABSENT"] }))} />);
    expect(chip(refused).dataset.originState).toBe("refused");
    expect(openPop(refused).textContent).not.toContain(FOOT);

    const sadj = render(<DataOriginChip symbol="AAPL" origin={deriveDataOrigin("AAPL", tradjViewDoc({
      contract: {
        schema: "dataos.view_contract.v1", purpose: "terminal_daily_ohlc", identity_namespace: "mmx/us/daily",
        field_units: { o: "vendor_adjusted_usd" },
        adjustment_reference: { basis: "sadj", action_revision_set_id: REV, as_at: AS_OF },
        evidence_mode: { mode: "CURRENT" }, coverage: {}, refusal_reasons: [],
      },
    }))} />);
    expect(chip(sadj).dataset.originState).toBe("refused");
    expect(openPop(sadj).textContent).not.toContain(FOOT);

    const unavailable = render(<DataOriginChip symbol="AAPL" origin={originUnavailable("AAPL")} />);
    expect(openPop(unavailable).textContent).not.toContain(FOOT);

    const composite = render(<DataOriginChip symbol="AAPL" origin={originComposite("AAPL")} />);
    expect(openPop(composite).textContent).not.toContain(FOOT);

    const pending = render(<DataOriginChip symbol="AAPL" origin={null} />);
    expect(openPop(pending).textContent).not.toContain(FOOT);
  });

  it("foot matrix (ZH): unlabelled/refused states never print the zh vendor-adjusted sentence", () => {
    act(() => { applyLang("zh"); });
    const known = render(<DataOriginChip symbol="AAPL" origin={knownOrigin()} />);
    expect(openPop(known).textContent).toContain(FOOT_ZH);

    const partial = render(<DataOriginChip symbol="AAPL" origin={deriveDataOrigin("AAPL", tradjViewDoc({ refusal_reasons: ["SEGMENT_SRC_UNKNOWN"] }))} />);
    expect(openPop(partial).textContent).toContain(FOOT_ZH);

    const legacy = render(<DataOriginChip symbol="AAPL" origin={legacyUnknownOrigin()} />);
    expect(openPop(legacy).textContent).not.toContain(FOOT_ZH);

    const refused = render(<DataOriginChip symbol="AAPL" origin={deriveDataOrigin("AAPL", tradjViewDoc({ refusal_reasons: ["LISTING_ABSENT"] }))} />);
    expect(openPop(refused).textContent).not.toContain(FOOT_ZH);

    const unavailable = render(<DataOriginChip symbol="AAPL" origin={originUnavailable("AAPL")} />);
    expect(openPop(unavailable).textContent).not.toContain(FOOT_ZH);

    const composite = render(<DataOriginChip symbol="AAPL" origin={originComposite("AAPL")} />);
    expect(openPop(composite).textContent).not.toContain(FOOT_ZH);

    const pending = render(<DataOriginChip symbol="AAPL" origin={null} />);
    expect(openPop(pending).textContent).not.toContain(FOOT_ZH);
  });

  // ── B1: the separately-labelled source clock row ───────────────────────────────────────
  const LAST_BAR = "2026-10-09";
  const lastBarDoc = (viewOverrides: Record<string, unknown> = {}, docOverrides: Record<string, unknown> = {}) =>
    tradjViewDoc(viewOverrides, { bars: [["1999-01-04", 1, 2, 0.5, 1.5, 10], [LAST_BAR, 1, 2, 0.5, 1.5, 10]], ...docOverrides });

  it("source last daily session row (EN): its own label, only when the doc qualified one", () => {
    const host = render(<DataOriginChip symbol="AAPL" origin={deriveDataOrigin("AAPL", lastBarDoc())} />);
    const text = openPop(host).textContent ?? "";
    expect(text).toContain("Source last daily session");
    expect(text).toContain(LAST_BAR);
    // The adjustment clock is untouched by the source clock.
    expect(text).toContain(AS_OF);
    expect(text).toContain(REV);

    // Empty bars qualify nothing: no row at all.
    const noSession = render(<DataOriginChip symbol="AAPL" origin={knownOrigin()} />);
    expect(openPop(noSession).textContent ?? "").not.toContain("Source last daily session");
  });

  it("legacy unknown with real bars shows the source session while basis/as-of/generation stay unknown", () => {
    const legacy = deriveDataOrigin("AAPL", {
      t: "AAPL", o: 1, src: "deep", bar_quality: "synthetic_open_deepstore",
      bars: [[LAST_BAR, 1, 2, 0.5, 1.5, 10]],
    });
    const host = render(<DataOriginChip symbol="AAPL" origin={legacy} />);
    const text = openPop(host).textContent ?? "";
    expect(text).toContain("Source last daily session");
    expect(text).toContain(LAST_BAR);
    expect(text).toContain("unknown");
    expect(text).not.toContain(FOOT);
  });

  it("zh source session row carries the zh label and the date, no EN leak", () => {
    act(() => { applyLang("zh"); });
    const host = render(<DataOriginChip symbol="AAPL" origin={deriveDataOrigin("AAPL", lastBarDoc())} />);
    const text = openPop(host).textContent ?? "";
    expect(text).toContain("来源最近日线交易日");
    expect(text).toContain(LAST_BAR);
    expect(text).not.toContain("Source last daily session");
  });

  // ── B1: the trading-currency chip beside origin ────────────────────────────────────────
  const ccyChip = (host: HTMLElement) => host.querySelector<HTMLSpanElement>('[data-testid="cfb-currency"]')!;
  const frameBar = (symbol: string, tradingCurrency: string | null, dataOrigin: DataOrigin | null = null) => render(
    <ChartFrameBar
      timeframe="D" chartApi={null} settings={DEFAULT_CHART_SETTINGS}
      onSettings={vi.fn()} symbol={symbol} dataOrigin={dataOrigin} tradingCurrency={tradingCurrency}
    />,
  );

  it("currency chip (EN): a valid code shows verbatim with an explicit aria label; unknown states the absence", () => {
    const host = frameBar("BABA", "USD", knownOrigin());
    const c = ccyChip(host);
    expect(c.tagName).toBe("SPAN");
    expect(c.textContent).toBe("USD");
    expect(c.getAttribute("aria-label")).toBe("Trading currency: USD");

    const unknown = frameBar("9988.HK", null);
    const u = ccyChip(unknown);
    expect(u.textContent).toBe("CCY?");
    expect(u.getAttribute("aria-label")).toBe("Trading currency unavailable");
    // While unknown the chip never leaks a guess (no suffix, no statement currency).
    expect(u.textContent).not.toContain("HK");
  });

  it("currency chip (ZH): explicit zh aria label and unavailable sentence", () => {
    act(() => { applyLang("zh"); });
    const host = frameBar("9988.HK", "HKD");
    expect(ccyChip(host).textContent).toBe("HKD");
    expect(ccyChip(host).getAttribute("aria-label")).toBe("交易币种：HKD");

    const unknown = frameBar("9988.HK", null);
    expect(ccyChip(unknown).textContent).toBe("币种?");
    expect(ccyChip(unknown).getAttribute("aria-label")).toBe("交易币种不可用");
  });
});
