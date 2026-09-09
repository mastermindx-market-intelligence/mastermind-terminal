// @vitest-environment jsdom
//
// Major 3 (round-3 review of PR #517): AlertTimeline used to render its own "Recent activity"
// header + an empty .spine unconditionally, even with zero rows — sitting a few pixels below
// whichever calm/degraded/outage module already narrates "no recent activity" in plain-language
// copy (AlertsCockpit's dataState collapses to calm-empty/degraded/never-ran/outage precisely
// when the timeline has no rows to show). A labelled empty region duplicating the paragraph
// above it is a hierarchy defect, visible in every committed zero-activity crop. RED-first: this
// test fails against the pre-fix component (which always rendered the header) and passes only
// once AlertTimeline returns null for zero rows.
//
// No @testing-library/react in this repo (vitest.config.ts's `include` is
// lib/__tests__/**/*.test.ts only) — react-dom/client's createRoot + react's act, per the
// BrainWidget precedent (brainWidgetRebinding.test.ts).
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import AlertTimeline, { type TimelineRow } from "@/components/alerts/AlertTimeline";
import { mappedOrNeutral, notClassified } from "@/lib/plainLabels";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROW: TimelineRow = {
  id: "a1", time: "16:05", subject: "NVDA", verdict: "NVDA price above 200",
  delivery: "sent", foldedRows: 0,
};

describe("AlertTimeline — zero-row guard (major 3, round-3 review)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    root = undefined;
    container.remove();
  });

  function mount(rows: TimelineRow[]) {
    act(() => {
      root = createRoot(container);
      root!.render(React.createElement(AlertTimeline, { rows, lang: "en", onOpen: () => {} }));
    });
  }

  it("renders nothing at all for zero rows — no orphan 'Recent activity' header", () => {
    mount([]);
    expect(container.textContent).toBe("");
    expect(container.querySelector("[data-alerts-module]")).toBeNull();
  });

  it("renders the header + row for a non-empty timeline, tagged data-alerts-module (not data-cockpit-state)", () => {
    mount([ROW]);
    expect(container.textContent).toContain("Recent activity");
    expect(container.textContent).toContain("NVDA");
    const mod = container.querySelector('[data-alerts-module="recent-activity"]');
    expect(mod).not.toBeNull();
  });

  it("renders the verdict sentence as given, without mappedOrNeutral wrapping it", () => {
    // mappedOrNeutral(mapped, lang) = mapped || notClassified(lang). A truthy
    // sentence such as "NVDA price above 200" would still pass a contains()
    // check after wrapping. Feed a falsy verdict the wrapper would replace
    // with notClassified(), and assert the raw empty verdict is what renders
    // (the wrapper words never appear) alongside a real sentence.
    expect(mappedOrNeutral("", "en")).toBe(notClassified("en"));
    expect(mappedOrNeutral("", "zh")).toBe(notClassified("zh"));
    mount([
      { ...ROW, id: "empty", verdict: "" },
      { ...ROW, id: "a1", verdict: "NVDA price above 200" },
    ]);
    expect(container.textContent).toContain("NVDA price above 200");
    expect(container.textContent).not.toContain(notClassified("en"));
    act(() => {
      root?.unmount();
      root = createRoot(container);
      root!.render(React.createElement(AlertTimeline, {
        rows: [
          { ...ROW, id: "empty", verdict: "" },
          { ...ROW, id: "a1", verdict: "价格低于 150" },
        ],
        lang: "zh",
        onOpen: () => {},
      }));
    });
    expect(container.textContent).toContain("价格低于 150");
    expect(container.textContent).toContain("近期活动");
    expect(container.textContent).not.toContain(notClassified("zh"));
  });
});
