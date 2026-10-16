// @vitest-environment jsdom
import React, { useLayoutEffect, useRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SmartScreensPanel from "@/components/screener/SmartScreensPanel";
import ScreenAssumptionPreview from "@/components/screener/ScreenAssumptionPreview";
import { captureAssumptionSnapshot } from "@/lib/smartScreen/assumptionPreview";
import { DEFAULT_SCREENER_FILTERS, normalizeDefinition, type ScreenDefinition, type ScreenRow } from "@/lib/smartScreen/predicate";
import type { AccountIdentity } from "@/lib/accountIdentity";

// Queries below use the panel's existing data-ss-* hook attributes (querySelector), matching
// how the panel itself is instrumented, instead of requiring a testId attribute config.

vi.mock("@/lib/i18n", () => ({
  useLang: () => ({ lang: "en" }),
  useT: () => (key: string) => key,
}));

const h = vi.hoisted(() => ({
  snap: {} as Record<string, unknown>,
  store: {} as Record<string, unknown>,
}));

vi.mock("@/lib/smartScreen/useSmartScreens", () => ({
  useSmartScreens: () => ({ snap: h.snap, store: h.store }),
}));

vi.mock("@/lib/smartScreen/devicePresets", () => ({
  readDevicePresets: () => [],
}));

vi.mock("@/lib/ownerStorage", () => ({
  browserStorage: () => null,
}));

const DEF_A = (): ScreenDefinition => {
  const normalized = normalizeDefinition({
    grammar: 1,
    scope: { markets: "all", asset: "Funds", unpriced: false },
    where: {
      all: [
        { f: "dv", op: "gte", v: 1_000_000 },
        { f: "verdict", op: "in", v: ["BUY", "RECLAIM"] },
      ],
    },
  });
  if (!normalized.ok) throw new Error(`fixture refused: ${normalized.error}`);
  return normalized.def;
};

const row = (over: Partial<ScreenRow>): ScreenRow => ({
  sym: "X", sec: "Funds", mktId: "us",
  last: 25, chg: 1, dv: 5e7, mcap: 1e10, offHi: -10, offLo: 8,
  verdict: "BUY", gics: "Financials", regimeBull: true,
  ...over,
});

const ROWS: ScreenRow[] = [
  row({ sym: "F1", dv: 5e6 }),
  row({ sym: "F2", dv: 5e7 }),
  row({ sym: "F3", dv: null }),
  row({ sym: "F9", sec: "Bonds" }),
];

const SCREEN_ID = "abcd".repeat(8);
const record = (def: ScreenDefinition) => {
  const normalized = normalizeDefinition(def);
  if (!normalized.ok) throw new Error("fixture refused");
  return {
    schema: 1 as const, id: SCREEN_ID, rev: 3, name: "Fund screen", def,
    hash: normalized.hash, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", review: null,
  };
};

const identity = (userId: string): AccountIdentity => ({ kind: "account", userId, email: `${userId}@x.test` });

const snapFor = (over: Record<string, unknown> = {}) => ({
  owner: "account:u1", status: "ready", readFailure: null, busy: false, device: "ok",
  pending: [], ack: { readAt: "2026-10-13T00:00:00Z", screens: [record(DEF_A())], readOnly: [], invalid: 0 },
  ...over,
});

const storeSpies = () => ({
  create: vi.fn(), update: vi.fn(), remove: vi.fn(), retry: vi.fn(), refresh: vi.fn(),
  discard: vi.fn(), useAccountVersion: vi.fn(), overwrite: vi.fn(), saveAsNew: vi.fn(), load: vi.fn(),
});

const q = (el: Element | null, selector: string): HTMLElement => {
  if (!el) throw new Error("missing ancestor");
  const node = el.querySelector(selector);
  if (!node) throw new Error(`not found: ${selector}`);
  return node as HTMLElement;
};

const renderPanel = (over: { rows?: ScreenRow[]; asOf?: string; ready?: boolean; identity?: AccountIdentity } = {}) =>
  render(
    <SmartScreensPanel
      identity={over.identity ?? identity("u1")}
      rows={over.rows ?? ROWS}
      ready={over.ready ?? true}
      asOf={over.asOf ?? "2026-10-10"}
      filters={DEFAULT_SCREENER_FILTERS}
      prefsEnabled={null}
      showAllMarkets
      labelGics={(v) => v}
      labelAsset={(v) => v}
      onOpen={vi.fn()}
    />,
  );

const openPreview = (container: HTMLElement) => {
  fireEvent.click(q(container, "[data-ss-toggle]"));
  fireEvent.click(q(container, `[data-ss-screen="${SCREEN_ID}"] [data-ss-compare]`));
  return q(container, "[data-ss-assumption='open']");
};

describe("SmartScreensPanel × ScreenAssumptionPreview (J6 candidate)", () => {
  let store: ReturnType<typeof storeSpies>;

  beforeEach(() => {
    store = storeSpies();
    h.snap = snapFor();
    h.store = store as unknown as Record<string, unknown>;
  });

  afterEach(cleanup);

  it("mounts Compare per saved screen, captures ONCE on the deliberate click, and computes A/B", () => {
    const view = renderPanel();
    expect(document.querySelector("[data-ss-assumption='open']")).toBeNull(); // nothing before the click

    const preview = openPreview(view.container);
    // The capture names the generation it froze before any threshold is chosen.
    expect(preview.getAttribute("data-ss-assumption-as-of")).toBe("2026-10-10");
    expect(q(preview, "[data-ss-assumption-source]").textContent).toContain("4 rows");

    // Apply with the SAME threshold first: B canonicalizes to A, so A and B agree everywhere —
    // the preview must not invent differences.
    fireEvent.click(q(preview, "[data-ss-assumption-apply]"));
    expect(q(preview, "[data-ss-assumption-summary]").textContent).toContain("Both 2");

    // Raise the dv threshold: F1 becomes A-only; F3 (missing dv) stays unknown, not a fail.
    fireEvent.change(q(preview, "[data-ss-assumption-threshold]"), { target: { value: "20000000" } });
    fireEvent.click(q(preview, "[data-ss-assumption-apply]"));
    expect(q(preview, "[data-ss-assumption-summary]").textContent).toContain("A-only 1");
    expect(q(preview, "[data-ss-assumption-group='aOnly']").textContent).toContain("F1");
    expect(q(preview, "[data-ss-assumption-changed]").textContent).toContain("$20M"); // panel's unit-aware formatter
    // Missing data and out-of-scope are named as coverage, never as entries/exits.
    expect(q(preview, "[data-ss-assumption-coverage-bucket='unknown']").textContent).toContain("F3");
    expect(q(preview, "[data-ss-assumption-coverage-bucket='outOfScope']").textContent).toContain(": 1");
    expect(q(preview, "[data-ss-assumption-def-a]").textContent).toContain("A (saved)");
    expect(q(preview, "[data-ss-assumption-def-b]").textContent).toContain("B (trial)");
  });

  it("never writes: no store create/update/remove/refresh, no fetch, no localStorage during preview", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in preview"));
    const view = renderPanel();
    const preview = openPreview(view.container);
    fireEvent.click(q(preview, "[data-ss-assumption-apply]"));
    fireEvent.click(q(preview, "[data-ss-assumption-close]"));

    expect(store.create).not.toHaveBeenCalled();
    expect(store.update).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.refresh).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(document.querySelector("[data-ss-assumption='open']")).toBeNull(); // close really unmounts
    fetchSpy.mockRestore();
    setItem.mockRestore();
  });

  it("keeps the captured generation when the live scan changes — newer asOf is drift, not a refresh", () => {
    const view = renderPanel();
    openPreview(view.container);

    view.rerender(
      <SmartScreensPanel
        identity={identity("u1")}
        rows={[...ROWS, row({ sym: "NEW" })]}
        ready
        asOf="2026-10-12"
        filters={DEFAULT_SCREENER_FILTERS}
        prefsEnabled={null}
        showAllMarkets
        labelGics={(v) => v}
        labelAsset={(v) => v}
        onOpen={vi.fn()}
      />,
    );

    // Re-query: the rerender may replace nodes; assert the LIVE preview, not a stale element.
    const live = q(view.container, "[data-ss-assumption='open']");
    const drift = q(live, "[data-ss-assumption-drift]");
    expect(live.getAttribute("data-ss-assumption-as-of")).toBe("2026-10-10"); // still the capture
    expect(drift.getAttribute("data-ss-assumption-drift")).toBe("newer-generation");
    expect(drift.textContent).toContain("2026-10-12");
    expect(q(live, "[data-ss-assumption-source]").textContent).toContain("4 rows"); // NEW never seeps in
  });

  it("discloses a same-asOf republication without relabeling or refreshing the snapshot", () => {
    const view = renderPanel();
    openPreview(view.container);

    view.rerender(
      <SmartScreensPanel
        identity={identity("u1")}
        rows={[...ROWS, row({ sym: "CORRECTED" })]} // same generation, new array
        ready
        asOf="2026-10-10"
        filters={DEFAULT_SCREENER_FILTERS}
        prefsEnabled={null}
        showAllMarkets
        labelGics={(v) => v}
        labelAsset={(v) => v}
        onOpen={vi.fn()}
      />,
    );

    const live = q(view.container, "[data-ss-assumption='open']");
    const drift = q(live, "[data-ss-assumption-drift]");
    expect(drift.getAttribute("data-ss-assumption-drift")).toBe("same-as-of-republish");
    expect(live.getAttribute("data-ss-assumption-as-of")).toBe("2026-10-10");
    expect(q(live, "[data-ss-assumption-source]").textContent).toContain("4 rows");
  });

  it("closes the preview on an owner partition change — no capture crosses owners", () => {
    const view = renderPanel();
    openPreview(view.container);
    expect(document.querySelector("[data-ss-assumption='open']")).not.toBeNull();

    view.rerender(
      <SmartScreensPanel
        identity={identity("u2")}
        rows={ROWS}
        ready
        asOf="2026-10-10"
        filters={DEFAULT_SCREENER_FILTERS}
        prefsEnabled={null}
        showAllMarkets
        labelGics={(v) => v}
        labelAsset={(v) => v}
        onOpen={vi.fn()}
      />,
    );
    expect(document.querySelector("[data-ss-assumption='open']")).toBeNull();
  });

  it("closes the preview on an explicit unauthenticated owner failure", () => {
    const view = renderPanel();
    openPreview(view.container);
    expect(document.querySelector("[data-ss-assumption='open']")).not.toBeNull();

    h.snap = snapFor({ status: "unavailable", readFailure: "unauthenticated", ack: null });
    view.rerender(
      <SmartScreensPanel
        identity={identity("u1")}
        rows={ROWS}
        ready
        asOf="2026-10-10"
        filters={DEFAULT_SCREENER_FILTERS}
        prefsEnabled={null}
        showAllMarkets
        labelGics={(v) => v}
        labelAsset={(v) => v}
        onOpen={vi.fn()}
      />,
    );
    expect(document.querySelector("[data-ss-assumption='open']")).toBeNull();
  });

  it("hides the previous owner capture before passive effects run, even for a reused screen ID", () => {
    const observed: boolean[] = [];
    function Observe({userId}: {userId:string}) {
      const ref=useRef<HTMLDivElement>(null);
      useLayoutEffect(()=>{if(userId==="u2")observed.push(!!ref.current?.querySelector("[data-ss-assumption='open']"));},[userId]);
      return <div ref={ref}><SmartScreensPanel identity={identity(userId)} rows={ROWS} ready asOf="2026-10-10" filters={DEFAULT_SCREENER_FILTERS} prefsEnabled={null} showAllMarkets labelGics={v=>v} labelAsset={v=>v} onOpen={vi.fn()}/></div>;
    }
    const view=render(<Observe userId="u1"/>); openPreview(view.container);
    h.snap=snapFor({owner:"account:u2"});
    view.rerender(<Observe userId="u2"/>);
    expect(observed).toEqual([false]);
  });

  it("refuses capture with a missing generation or a mismatched owner partition", () => {
    const view=renderPanel({asOf:""}); fireEvent.click(q(view.container,"[data-ss-toggle]"));
    const button=q(view.container,"[data-ss-compare]") as HTMLButtonElement;
    expect(button.disabled).toBe(true); fireEvent.click(button);
    expect(view.container.querySelector("[data-ss-assumption='open']")).toBeNull();
    view.unmount(); h.snap=snapFor({owner:"account:u2"});
    const other=renderPanel(); fireEvent.click(q(other.container,"[data-ss-toggle]"));
    expect((q(other.container,"[data-ss-compare]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses to capture before the scan is ready", () => {
    const view = renderPanel({ ready: false });
    fireEvent.click(q(view.container, "[data-ss-toggle]"));
    const button = q(view.container, `[data-ss-screen="${SCREEN_ID}"] [data-ss-compare]`) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(document.querySelector("[data-ss-assumption='open']")).toBeNull();
  });
});

describe("ScreenAssumptionPreview refusals (rendered directly)", () => {
  afterEach(cleanup);

  const renderDirect = (captureDef: ScreenDefinition, asOf = "2026-10-10") =>
    render(
      <ScreenAssumptionPreview
        capture={captureAssumptionSnapshot({ screenId: "s", name: "S", def: captureDef, asOf, rows: ROWS })}
        drifted={false}
        liveAsOf={asOf}
        liveReady
        lang="en"
        describeLeaf={(leaf) => `${leaf.f} ${leaf.op} ${String(leaf.v ?? "")}`}
        describeDefinition={(def) => JSON.stringify(def.scope)}
        onClose={vi.fn()}
      />,
    );

  it("refuses a newer grammar explicitly instead of previewing it as v1", () => {
    const newer = { ...DEF_A(), grammar: 2 } as unknown as ScreenDefinition;
    const view = renderDirect(newer);
    expect(view.container.querySelector("[data-ss-assumption-refusal]")!.getAttribute("data-ss-assumption-refusal")).toBe("grammar_newer");
    expect(view.container.querySelector("[data-ss-assumption-leaf]")).toBeNull(); // nothing offered to change
  });

  it("refuses a screen with no numeric leaf instead of inventing a change", () => {
    const noNumeric = normalizeDefinition({
      grammar: 1,
      scope: { markets: "all", asset: null, unpriced: false },
      where: { all: [{ f: "verdict", op: "present" }] },
    });
    expect(noNumeric.ok).toBe(true);
    if (!noNumeric.ok) return;
    const view = renderDirect(noNumeric.def);
    expect(view.container.querySelector("[data-ss-assumption-refusal]")!.getAttribute("data-ss-assumption-refusal")).toBe("no_numeric_leaf");
    expect(view.container.querySelector("[data-ss-assumption-summary]")).toBeNull();
  });

  it("refuses an invalid, out-of-range threshold with a visible message and no result", () => {
    const view = renderDirect(DEF_A());
    fireEvent.change(q(view.container, "[data-ss-assumption-threshold]"), { target: { value: "1e16" } });
    fireEvent.click(q(view.container, "[data-ss-assumption-apply]"));
    expect(view.container.querySelector("[data-ss-assumption-refusal]")!.getAttribute("data-ss-assumption-refusal")).toBe("bad_threshold");
    expect(view.container.querySelector("[data-ss-assumption-summary]")).toBeNull();
  });

  it("refuses a blank threshold instead of coercing it to zero", () => {
    const view=renderDirect(DEF_A());
    fireEvent.change(q(view.container,"[data-ss-assumption-threshold]"),{target:{value:"   "}});
    fireEvent.click(q(view.container,"[data-ss-assumption-apply]"));
    expect(view.container.querySelector("[data-ss-assumption-refusal='bad_threshold']")).not.toBeNull();
    expect(view.container.querySelector("[data-ss-assumption-summary]")).toBeNull();
  });

  it("shows the changed condition with field, operator, value and units; close hands control back", () => {
    const onClose = vi.fn();
    const capture = captureAssumptionSnapshot({ screenId: "s", name: "S", def: DEF_A(), asOf: "2026-10-10", rows: ROWS });
    const view = render(
      <ScreenAssumptionPreview
        capture={capture}
        drifted={false}
        liveAsOf="2026-10-10"
        liveReady
        lang="zh"
        describeLeaf={(leaf) => `${leaf.f} ${leaf.op === "gte" ? "≥" : "≤"} ${Number(leaf.v ?? 0).toLocaleString()} USD`}
        describeDefinition={(def) => JSON.stringify(def.scope)}
        onClose={onClose}
      />,
    );
    fireEvent.change(q(view.container, "[data-ss-assumption-threshold]"), { target: { value: "20000000" } });
    fireEvent.click(q(view.container, "[data-ss-assumption-apply]"));
    expect(q(view.container, "[data-ss-assumption-changed]").textContent).toContain("dv ≥ 20,000,000 USD");
    fireEvent.click(q(view.container, "[data-ss-assumption-close]"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});


describe("whole saved definition table handoff", () => {
  beforeEach(() => { h.snap = snapFor(); h.store = storeSpies(); });
  afterEach(cleanup);
  for (const complex of [true, false]) {
    it(`opens the exact ${complex ? "nested OR" : "multi-market"} definition without owner writes`, () => {
      const def: ScreenDefinition = { grammar: 1, scope: { markets: ["us", "hk"], asset: "Equities", unpriced: false },
        where: complex ? { all: [{ f: "dv", op: "gte", v: 1000000 }, { any: [{ f: "chg", op: "gte", v: 3 }, { f: "chg", op: "lte", v: -3 }] }] } : { all: [] } };
      h.snap = snapFor({ ack: { screens: [record(def)], readOnly: [], invalid: 0 } });
      const onOpen = vi.fn(), onOpenExact = vi.fn();
      const props = { identity: identity("u1"), rows: ROWS, ready: true, asOf: "2026-10-15", filters: DEFAULT_SCREENER_FILTERS,
        prefsEnabled: ["us"] as ["us"], showAllMarkets: false, labelGics: (v:string)=>v, labelAsset: (v:string)=>v, onOpen, onOpenExact };
      const view = render(<SmartScreensPanel {...props}/>);
      fireEvent.click(q(view.container, "[data-ss-toggle]"));
      const button=q(view.container, "[data-ss-open]") as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(onOpenExact).toHaveBeenCalledTimes(1);
      const normalized=normalizeDefinition(def); if(!normalized.ok) throw new Error("fixture");
      expect(onOpenExact).toHaveBeenCalledWith("Fund screen", normalized.def);
      expect(onOpen).not.toHaveBeenCalled();
      for(const fn of Object.values(h.store)) expect(fn).not.toHaveBeenCalled();
    });
  }
});
