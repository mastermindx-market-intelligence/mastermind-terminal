// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import SignalButton from "@/components/SignalButton";
import { decodeProphetObservations, type ProphetReadStatus } from "../prophetObservations";
import { prophetFixture } from "./prophetObservationsFixture";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Prophet in the actual Intelligence launcher", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  const render = async (status: ProphetReadStatus = "ready", data: unknown = prophetFixture(), zh = false) => {
    const props = { prophet: { symbol: "KO", account: "reader-a", status, data: data === null ? null : decodeProphetObservations(data, "KO") } };
    await act(async () => root.render(<SignalButton oracle={{ label: "Starter", color: "var(--text)" }} desk={{ label: "Neutral", color: "var(--text)" }}
      oracleLabel="Oracle" deskLabel="Research" viewLabel="View" onView={() => {}} zh={zh} {...props} />));
  };
  it("surfaces recorded beyond-cap evidence without replacing the two existing sources", async () => {
    await render();
    const row = host.querySelector('[data-testid="prophet-observation-launcher"]');
    expect(row).not.toBeNull(); expect((row?.textContent ?? "")).toContain("Prophet");
    expect((row?.textContent ?? "")).toContain("Recorded evidence"); expect((row?.textContent ?? "")).toContain("2026-10-16");
    expect(row?.textContent).not.toMatch(/buy|entry open|candidate accepted/i);
    expect(host.textContent).toContain("Starter"); expect(host.textContent).toContain("Neutral");
    expect(host.querySelectorAll("button")).toHaveLength(1); expect(host.querySelector("button button, button a")).toBeNull();
  });
  it("shows an outage rather than a reassuring No setup", async () => {
    await render("unavailable", null);
    const row = host.querySelector('[data-testid="prophet-observation-launcher"]');
    expect((row?.textContent ?? "")).toContain("Source unavailable"); expect(row?.textContent).not.toMatch(/No setup|No recent recorded turn/);
  });
  it("keeps authentication and subscription refusals distinct", async () => {
    await render("unauthenticated", null); expect(host.textContent).toContain("Sign in to view");
    await render("forbidden", null); expect(host.textContent).toContain("Plan access required");
  });
  it("keeps all new reading copy in the active language", async () => {
    await render("ready", prophetFixture(), true);
    const row = host.querySelector('[data-testid="prophet-observation-launcher"]');
    expect((row?.textContent ?? "")).toContain("已记录迹象"); expect(row?.textContent).not.toContain("Recorded evidence");
  });
});
