// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorRotationMap, { type SectorRotationMapProps } from "@/components/sector-intelligence/SectorRotationMap";
import { LangProvider } from "../i18n";
import type { Row } from "../sectorIntelligence";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rows: Row[] = [{ id: "xlk", ticker: "XLK", name: "Technology", momentum: { rs_21d: 7, rs_63d: 5 }, heat: {}, rotation: {} }];
const legacySnapshot = { rows, status: "ready" as const, asOf: "2026-11-12" };

describe("Rotation snapshot focus continuity", () => {
  let host: HTMLDivElement, root: Root;
  const render = async (patch: Partial<SectorRotationMapProps> = {}) => {
    const props: SectorRotationMapProps = {
      rows: [], status: "unavailable", asOf: null, selected: "xlk", mode: "map", query: "",
      history: null, historyStatus: "unavailable", legacySnapshot,
      onMode: vi.fn(), onQuery: vi.fn(), onSelect: vi.fn(), onOpenResearch: vi.fn(), onSources: vi.fn(), ...patch,
    };
    await act(async () => root.render(<LangProvider><SectorRotationMap {...props} /></LangProvider>));
  };
  beforeEach(() => {
    document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it("moves focus to the return control after opening the dated snapshot and back after returning", async () => {
    await render();
    const open = host.querySelector<HTMLButtonElement>('[data-testid="rotation-legacy-open"]')!;
    open.focus();
    expect(document.activeElement).toBe(open);
    await act(async () => open.click());
    const close = host.querySelector<HTMLButtonElement>('[data-testid="rotation-legacy-close"]')!;
    expect(close).not.toBeNull();
    expect(document.activeElement).toBe(close);
    await act(async () => close.click());
    expect(document.activeElement).toBe(host.querySelector('[data-testid="rotation-legacy-open"]'));
  });

  it("does not take focus when the legacy feed becomes available without a user gesture", async () => {
    const outside = document.createElement("button"); document.body.append(outside);
    try {
      await render({ legacySnapshot: { ...legacySnapshot, status: "loading" } });
      outside.focus();
      await render();
      expect(document.activeElement).toBe(outside);
      expect(host.querySelector('[data-testid="rotation-legacy-close"]')).toBeNull();
    } finally { outside.remove(); }
  });

  it("does not take focus on native recovery or a later outage", async () => {
    const outside = document.createElement("button"); document.body.append(outside);
    try {
      await render();
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="rotation-legacy-open"]')!.click());
      outside.focus();
      await render({ rows, status: "ready", asOf: "2026-11-13" });
      expect(document.activeElement).toBe(outside);
      await render();
      expect(document.activeElement).toBe(outside);
      expect(host.querySelector('[data-testid="rotation-legacy-close"]')).toBeNull();
    } finally { outside.remove(); }
  });
});
