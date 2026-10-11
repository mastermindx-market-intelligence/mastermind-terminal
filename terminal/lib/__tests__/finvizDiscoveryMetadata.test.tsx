// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import FinvizDiscovery from "@/components/sector-intelligence/FinvizDiscovery";
import { LangProvider, applyLang } from "../i18n";
import { DEFAULT_SECTOR_STATE } from "../sectorIntelligence";
import { finvizMembershipPayload, finvizMembershipFixture } from "./fixtures/finvizMembership";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Finviz source coverage display", () => {
  let root: Root, host: HTMLDivElement;
  const render = async (manifest: unknown = finvizMembershipFixture(), timeframe: "1D" | "1W" = "1D", ticker = "ALFA") => {
    const data = finvizMembershipPayload();
    data.tiles[0].members[0].t = ticker; data.tiles[1].members[0].t = ticker;
    await act(async () => root.render(<LangProvider><FinvizDiscovery
      state={{ ...DEFAULT_SECTOR_STATE, matrixTimeframe: timeframe, finvizSubtheme: "finviz:subtheme:one", company: ticker }}
      onChange={() => undefined} feed={{ data: { ...data, ...(manifest === "absent" ? {} : { membership_manifest: manifest }) },
        receipt: { source: "finviz", path: "/marketdata/themes_heatmap.json", status: "ready", asOf: data.asof,
          observedAt: "2026-10-10T15:00:00Z", stale: false, contentHash: "synthetic" } }} /></LangProvider>));
  };
  const value = (label: string) => [...host.querySelectorAll("dt")].find(el => el.textContent === label)?.nextElementSibling?.textContent;
  beforeEach(() => { document.documentElement.setAttribute("data-lang", "en"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  it("separates membership vintage from market date and unpriced from unresolved members", async () => {
    await render();
    expect(value("Market date")).toBe("2026-10-09");
    expect(value("Membership date")).toBe("2026-08-15");
    expect(value("Membership observed")).toBe("2026-08-15T02:01:34+00:00");
    expect(value("Members without measurements (all periods)")).toBe("1");
    expect(value("Unresolved identities")).toBe("Unknown");
    expect(value("Source-declared partial groups")).toBe("Unknown");
    expect(value("Source-declared missing groups")).toBe("Unknown");
    expect(value("Correction status")).toContain("later corrections unknown");
  });
  it("uses the chosen timeframe without changing global membership accounting", async () => {
    await render(); expect(value("Measured members · 1D")).toBe("2 / 3");
    await render(finvizMembershipFixture(), "1W"); expect(value("Measured members · 1W")).toBe("0 / 3");
    expect(value("Measured subthemes · 1W")).toBe("0 / 2");
    expect(value("Members without measurements (all periods)")).toBe("1");
  });
  it("leaves missing legacy metadata unknown without claiming source confirmation", async () => {
    await render("absent"); expect(value("Membership date")).toBe("Unknown");
    expect(value("Members without measurements (all periods)")).toBe("Unknown");
    expect(host.textContent).toContain("Membership metadata is unavailable");
    expect(host.querySelectorAll('[data-testid="finviz-group"]')).toHaveLength(2);
  });
  it("does not freshen unknown membership using the market clock", async () => {
    const manifest = finvizMembershipFixture(); manifest.membership = { status: "unknown", reason: "receipt_unavailable", asof: null, refreshed_at_utc: null, parser_version: null };
    (manifest.corrections as Record<string, unknown>).status = "unknown";
    await render(manifest); expect(value("Membership date")).toBe("Unknown"); expect(value("Correction status")).toBe("Unknown");
    expect(value("Measured members · 1D")).toBe("2 / 3");
  });
  it("withholds population after contradictory metadata replaces an admitted snapshot", async () => {
    await render(); const manifest = finvizMembershipFixture(); manifest.unresolved_identity_count = 0;
    await render(manifest); expect(host.querySelector('[data-testid="finviz-population"]')).toBeNull();
    expect(host.textContent).toContain("source is unavailable");
  });
  it("localizes the metadata labels through the same language provider", async () => {
    await render(); await act(async () => applyLang("zh"));
    expect(value("成员日期")).toBe("2026-08-15"); expect(value("未解析身份")).toBe("未知");
    expect(host.textContent).not.toContain("Membership date");
  });
  it("keeps an unrouteable ticker in the roster without creating an invalid company link", async () => {
    await render(finvizMembershipFixture(), "1D", "ABC.DEF.G");
    expect(host.textContent).toContain("ABC.DEF.G"); expect(host.querySelector('[data-testid="finviz-inspector"] a')).toBeNull();
  });
});
