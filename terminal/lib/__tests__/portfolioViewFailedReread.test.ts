// @vitest-environment jsdom
//
// Round-3 (PR #524, tablet-shard red): a failed client re-read used to raise the page-level
// unreadable flag and unmount the already-rendered book (`PortfolioView.tsx` `reload()` →
// `setUnread(true)` → `{!unread && <>…table…</>}`). The B-F08-4 mount-time GET made that path
// fire on first paint, so a 503 after a book was already on screen blanked the rows. RED-first:
// this test fails on the previous head (page-level "Could not read your portfolio", zero
// `tr[data-ticker]`) and passes only once a failed re-read keeps the prior rows and prints the
// risk section as unreadable inside its own section.
//
// No @testing-library/react in this repo (vitest.config.ts's `include` is
// lib/__tests__/**/*.test.ts only) — react-dom/client's createRoot + react's act, per the
// BrainWidget/AlertTimeline/alertsCockpitNoCoverageActivity precedent.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import type { Position } from "@/lib/portfolio";
import { T_RISK_UNAVAILABLE } from "@/lib/portfolioRisk";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children?: React.ReactNode; href: string }) =>
    React.createElement("a", { href, ...rest }, children),
}));

vi.mock("@/components/PortfolioRisk.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

vi.mock("@/lib/dataCache", () => ({
  getJSON: vi.fn(async () => null),
}));

import PortfolioView from "@/components/PortfolioView";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEED: Position = {
  id: "p1",
  ticker: "NVDA",
  shares: 10,
  entryPrice: 150,
  entryDate: "2026-01-01",
  notes: null,
  status: "open",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("PortfolioView — a failed re-read keeps the prior rows", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/portfolio")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "portfolio unavailable" }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof globalThis.fetch;
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = undefined;
    container.remove();
    globalThis.fetch = realFetch;
  });

  async function mount(positions: Position[]) {
    await act(async () => {
      root = createRoot(container);
      root!.render(
        React.createElement(
          LangProvider,
          null,
          React.createElement(PortfolioView, { positions, email: "t@example.com" }),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("a failed re-read keeps the prior rows and shows the risk section as unreadable", async () => {
    await mount([SEED]);
    expect(container.querySelector('[data-testid="portfolio-open"] tr[data-ticker="NVDA"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="portfolio-unreadable"]')).toBeNull();
    expect(container.textContent).toContain(T_RISK_UNAVAILABLE.en);
  });
});
