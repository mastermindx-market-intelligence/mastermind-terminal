// @vitest-environment jsdom
//
// MarketOntology F11-6 — AnalysisBrainHost through the REAL BrainWidget (review round-1 on
// PR #798: finding 1 MAJOR + finding 4). Rendered with a bare createRoot — NO StrictMode — so
// effects run exactly once, the way the production bundle runs them. That matters: under
// StrictMode's mount→unmount→remount, BrainWidget's write-through effect finds MM_BRAIN_CFG on
// its second run and registers a cleanup, which hides the production leak this file pins.
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiContextClientV1 } from "@/lib/aiContext";

// One hoisted route object, read by the mocks on EVERY render, so a test flips the observed
// route and re-renders — the same thing Next's app router does on a soft navigation.
const nav = vi.hoisted(() => ({ path: "/analysis", search: "symbol=NVDA" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import AnalysisBrainHost from "@/components/chrome/AnalysisBrainHost";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Host = {
  MM_BRAIN_CFG?: { getAiContext?: () => AiContextClientV1 | undefined };
  MMBrain?: unknown;
  __MM_BRAIN_ACTIVE_SYMBOL__?: string;
};
const host = () => window as unknown as Host;
// What production mm_brain.js reads at send time: the document singleton's getter, not the
// host's prop. `undefined` is the legacy-mapping answer (the widget builds its own block).
const readCtx = () => host().MM_BRAIN_CFG?.getAiContext?.();
const noop = () => {};

describe("AnalysisBrainHost ↔ document-singleton MM_BRAIN_CFG (no StrictMode)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  function render(active = "NVDA") {
    act(() => {
      root!.render(
        <AnalysisBrainHost active={active} onCommand={noop} onAnnotate={noop} onAuthRequired={noop} />,
      );
    });
  }
  function mount(path: string, search: string, active = "NVDA") {
    nav.path = path;
    nav.search = search;
    root = createRoot(container);
    render(active);
  }
  function navigate(path: string, search: string, active = "NVDA") {
    nav.path = path;
    nav.search = search;
    render(active);
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    delete host().MM_BRAIN_CFG;
    delete host().MMBrain;
    delete host().__MM_BRAIN_ACTIVE_SYMBOL__;
    document.querySelectorAll('script[src="https://www.mastermind-x.com/mm_brain.js"]').forEach((s) => s.remove());
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = undefined;
    container.remove();
  });

  it("cold mount on the thesis view: the singleton reads analysis/theses at revision 0 (first-send law)", () => {
    mount("/analysis", "view=theses&symbol=NVDA");
    const ctx = readCtx();
    expect(ctx).toBeDefined();
    expect(ctx!.schema).toBe("ai_context_client.v1");
    expect(ctx!.context_revision).toBe(0);
    expect(ctx!.active).toEqual({ type: "security", id: "NVDA" });
    expect(ctx!.ambient).toMatchObject({ page: "analysis", panel: "theses", symbol: "NVDA" });
  });

  it("company view and an unsupported view report company / null", () => {
    mount("/analysis", "symbol=NVDA");
    expect(readCtx()!.ambient).toMatchObject({ page: "analysis", panel: "company" });
    navigate("/analysis", "view=nope&symbol=NVDA");
    expect(readCtx()!.ambient.page).toBe("analysis");
    expect(readCtx()!.ambient.panel).toBeNull();
  });

  it("an identical logical tuple re-applied by the host effect does not bump; a real transition bumps exactly once", () => {
    mount("/analysis", "symbol=NVDA");
    const first = readCtx()!;
    expect(first.context_revision).toBe(0);

    // `path` is in the host effect's dependency list, so changing ONLY the pathname re-fires
    // the effect with the SAME (symbol, page, panel) tuple — this is the provider's duplicate
    // suppression exercised THROUGH the host, which the e2e cannot reach (an identical URL
    // leaves the dependencies untouched and the effect never runs).
    navigate("/analysis/", "symbol=NVDA");
    const reapplied = readCtx()!;
    expect(reapplied.origin_id).toBe(first.origin_id);
    expect(reapplied.context_revision).toBe(0);

    navigate("/analysis/", "view=theses&symbol=NVDA");
    const theses = readCtx()!;
    expect(theses.origin_id).toBe(first.origin_id);
    expect(theses.ambient.panel).toBe("theses");
    expect(theses.context_revision).toBe(1);

    navigate("/analysis", "view=theses&symbol=NVDA"); // path-only change again, theses tuple unchanged
    expect(readCtx()!.context_revision).toBe(1);

    navigate("/analysis", "symbol=NVDA"); // back to company: a real transition
    expect(readCtx()!.ambient.panel).toBe("company");
    expect(readCtx()!.context_revision).toBe(2);
  });

  it("a shell symbol handoff on the same view bumps once", () => {
    mount("/analysis", "symbol=NVDA");
    navigate("/analysis", "symbol=AMD", "AMD");
    const ctx = readCtx()!;
    expect(ctx.active).toEqual({ type: "security", id: "AMD" });
    expect(ctx.ambient.panel).toBe("company");
    expect(ctx.context_revision).toBe(1);
  });

  it("after the host unmounts (soft navigation off /analysis), the singleton reports NO context — never the dead analysis tuple (finding 1)", () => {
    mount("/analysis", "view=theses&symbol=NVDA");
    expect(readCtx()!.ambient.panel).toBe("theses");
    // Production mechanism under test: on first mount BrainWidget's write-through effect found
    // no MM_BRAIN_CFG and registered no cleanup, and its install effect seeded a closure over
    // its own ref that nothing clears. The ONLY thing standing between a /portfolio turn and
    // ambient {page:"analysis", panel:"theses"} is the host's own alive guard.
    act(() => root!.unmount());
    root = undefined;
    expect(typeof host().MM_BRAIN_CFG?.getAiContext).toBe("function"); // the singleton outlives the mount
    expect(readCtx()).toBeUndefined();
  });

  it("a remount after unmount binds a fresh provider (new origin_id, revision 0) into the same singleton", () => {
    mount("/analysis", "view=theses&symbol=NVDA");
    const first = readCtx()!;
    act(() => root!.unmount());
    root = createRoot(container);
    nav.search = "symbol=NVDA";
    render();
    const again = readCtx()!;
    expect(again).toBeDefined();
    expect(again.origin_id).not.toBe(first.origin_id);
    expect(again.context_revision).toBe(0);
    expect(again.ambient.panel).toBe("company");
  });
});
