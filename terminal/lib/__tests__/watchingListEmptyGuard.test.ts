// @vitest-environment jsdom
//
// Minor 5 (round-6 review of PR #517): WatchingList used to render its own header + a
// "0 conditions" (or "cannot read", when `unavailable`) count card even with nothing to list —
// the exact labelled-empty-region defect AlertTimeline.tsx already guards against for the same
// reason (Major 3, round-3 review; see alertTimelineEmptyGuard.test.ts). Whichever module
// already narrates why there is nothing to watch (calm-empty/outage/no-coverage) is always the
// one visible when WatchingList's own rows are empty, so hiding it entirely — in every state,
// including `unavailable` — loses no information. RED-first: this test fails against the pre-fix
// component (which always renders the module) and passes only once WatchingList returns null for
// zero rows, exactly as AlertTimeline does.
//
// No @testing-library/react in this repo (vitest.config.ts's `include` is
// lib/__tests__/**/*.test.ts only) — react-dom/client's createRoot + react's act, per the
// BrainWidget/AlertTimeline precedent.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import WatchingList, { type WatchingRow } from "@/components/alerts/WatchingList";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROW: WatchingRow = { id: "a0", symbol: "NVDA", label: "NVDA price above 200", state: "armed" };

describe("WatchingList — zero-row guard (minor 5, round-6 review)", () => {
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

  function mount(rows: WatchingRow[], opts: { unavailable?: boolean } = {}) {
    act(() => {
      root = createRoot(container);
      root!.render(React.createElement(WatchingList, { rows, lang: "en", unavailable: opts.unavailable }));
    });
  }

  it("renders nothing at all for zero rows — no orphan '0 conditions' card", () => {
    mount([]);
    expect(container.textContent).toBe("");
  });

  it("renders nothing at all for zero rows even when `unavailable` — the outage module above already says so", () => {
    mount([], { unavailable: true });
    expect(container.textContent).toBe("");
    expect(container.textContent).not.toContain("cannot read");
  });

  it("renders the header + row for a non-empty list", () => {
    mount([ROW]);
    expect(container.textContent).toContain("What we're watching for you");
    expect(container.textContent).toContain("NVDA");
    expect(container.textContent).toContain("1 condition");
  });
});
