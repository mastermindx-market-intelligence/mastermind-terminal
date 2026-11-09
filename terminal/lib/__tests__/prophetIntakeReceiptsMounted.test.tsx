// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import receipts from "../../test-fixtures/prophet_intake_receipts_fixture.json";

const env = vi.hoisted(() => ({ lang: "en", payload: {} as Record<string, unknown> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock("@/lib/flowClientCache", () => ({
  flowGet: vi.fn(async (key: string) => key === "prophet_idx" ? env.payload : null),
}));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: env.lang }) }));
vi.mock("../../components/prophet/SelectionCohortCard", () => ({
  SelectionCohortCard: () => null, SelectionCohortMastheadTile: () => null,
  useSelectionCohort: () => ({ view: null }),
}));
vi.mock("../../components/prophet/SignalCard", () => ({
  SignalCard: () => null, phaseTone: () => "", planAsof: () => "", planConfidence: () => 0,
  planOriginationNote: () => "", planPhase: () => "", planRecommendedAction: () => "",
}));
vi.mock("../../components/prophet/ConfidencePanel", () => ({ ConfidencePanel: () => null }));
vi.mock("../../components/prophet/GeometryRail", () => ({ GeometryRail: () => null }));
vi.mock("../../components/prophet/OptionCard", () => ({ OptionCard: () => null }));

import { ProphetView } from "../../components/prophet/ProphetView";
import { flowGet } from "@/lib/flowClientCache";

describe("screening receipts in the actual ProphetView", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    env.lang = "en";
    env.payload = {
      asof: "2026-10-23", source_asof: "2026-10-20",
      source_delayed: true, source_mixed_vintage: true, plans: [],
      intake: { receipts: structuredClone(receipts) },
    };
    host = document.createElement("div"); document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove(); vi.clearAllMocks(); vi.useRealTimers();
  });
  async function mount() { await act(async () => root.render(<ProphetView />)); }

  for (const lang of ["en", "zh"]) {
    it(`${lang}: reads intake from the incumbent index and keeps source date separate`, async () => {
      env.lang = lang;
      await mount();
      const shelf = host.querySelector<HTMLDetailsElement>(".obs-prophet-intake-receipts")!;
      const stream = host.querySelector('[role="listbox"]')!;
      expect(shelf).toBeTruthy();
      expect(stream.nextElementSibling).toBe(shelf);
      expect(shelf.open).toBe(false);
      expect(shelf.textContent).toContain(lang === "en" ? "19 of 30" : "19 / 30 只");
      expect(shelf.textContent).toContain(lang === "en" ? receipts.groups[0].en : receipts.groups[0].zh);
      expect(shelf.textContent).not.toContain(lang === "en" ? receipts.groups[0].zh : receipts.groups[0].en);
      const vintage = host.querySelector('[data-testid="prophet-source-vintage"]')!;
      expect(vintage.textContent).toContain("20");
      expect(vintage.textContent).toContain(lang === "en" ? "Delayed" : "数据延迟");
      expect(vintage.textContent).toContain(lang === "en" ? "Mixed vintages" : "数据时点不一致");
      expect(flowGet).toHaveBeenCalledWith("prophet_idx");
    });
  }

  it("keeps the open shelf and producer order during a language change; PERF has no receipt panel", async () => {
    await mount();
    const shelf = host.querySelector<HTMLDetailsElement>(".obs-prophet-intake-receipts")!;
    shelf.open = true;
    env.lang = "zh";
    await mount();
    expect(host.querySelector(".obs-prophet-intake-receipts")).toBe(shelf);
    expect(shelf.open).toBe(true);
    expect(shelf.textContent).toContain("本次快照未纳入");
    expect([...shelf.querySelectorAll(".obs-prophet-intake-names b")].map(node => node.textContent))
      .toEqual(receipts.groups.slice(0, 2).flatMap(group => group.names.map(name => name.ticker)));
    const perf = [...host.querySelectorAll("button")].find(button => button.textContent === "绩效")!;
    await act(async () => perf.click());
    expect(host.querySelector(".obs-prophet-intake-receipts")).toBeNull();
    const signals = [...host.querySelectorAll("button")].find(button => button.textContent === "信号")!;
    await act(async () => signals.click());
    expect(host.querySelector<HTMLDetailsElement>(".obs-prophet-intake-receipts")?.open).toBe(false);
  });

  it.each([
    ["absent", undefined], ["null", null],
    ["inconsistent", { receipts: { ...receipts, declined: 18 } }],
  ])("does not invent a zero or a shelf for %s intake", async (_label, intake) => {
    env.payload.intake = intake;
    await mount();
    expect(host.querySelector(".obs-prophet-intake-receipts")).toBeNull();
    expect(host.querySelector('[data-testid="prophet-source-vintage"]')).toBeTruthy();
    expect(host.querySelector('[role="listbox"]')).toBeTruthy();
  });

  it("retains the thirty-second marks cadence without polling or refetching receipt totals", async () => {
    vi.useFakeTimers();
    await mount();
    expect(vi.mocked(flowGet).mock.calls.filter(call => call[0] === "prophet_idx")).toHaveLength(1);
    expect(vi.mocked(flowGet).mock.calls.filter(call => call[0] === "prophet_marks")).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(vi.mocked(flowGet).mock.calls.filter(call => call[0] === "prophet_marks")).toHaveLength(2);
    expect(vi.mocked(flowGet).mock.calls.filter(call => call[0] === "prophet_idx")).toHaveLength(1);
    expect(host.querySelector(".obs-prophet-intake-receipts")?.textContent).toContain("19 of 30");
  });
});
