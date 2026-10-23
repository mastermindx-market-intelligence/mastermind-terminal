// @vitest-environment jsdom
// View tests for the Exposure scenario panel. jsdom + createRoot/act (the repo's existing
// pattern — @testing-library/react is not a dependency of this package).
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExposureScenario from "@/components/exposure-map/ExposureScenario";
import type { ScenarioBasis } from "@/lib/exposureScenario";

const GOLD: ScenarioBasis = { root: "SPX", session: "2026-10-16", referenceSpot: 600.24, gexMn: -1383, vexMn: 220,
  cexMn: -80, emPct: 0.81, qualification: "qualified", sourceRef: null };
// The engine-contract golden inputs; the component default is the flat spot/Δσ/time = 0,0,0 case.
const WI = { targetSpot: 600, deltaSigmaPts: -1, days: 0.25 };

let host: HTMLDivElement;
let root: Root;
const q = (sel: string) => host.querySelector(sel);
const render = async (ui: React.ReactElement) => { await act(async () => root.render(ui)); };
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const groupBtn = (label: string, text: string) => {
  const group = q(`[role="group"][aria-label="${label}"]`);
  if (!group) throw new Error(`missing group ${label}`);
  const btn = [...group.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!btn) throw new Error(`missing button ${text} in ${label}`);
  return btn;
};
const typeValue = async (input: Element, value: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("ExposureScenario view", () => {
  it("golden basis renders ready: headline, terms, eyebrow, EM band, selected chip", async () => {
    await render(<ExposureScenario basis={GOLD} lang="en" initialInputs={WI} />);
    const el = q("[data-scenario-status]")!;
    expect(el.getAttribute("data-scenario-status")).toBe("ready");
    expect(el.getAttribute("data-scenario-sigma")).toBe("-1");
    const text = el.textContent ?? "";
    expect(text).toContain("+184.702M");
    expect(text).toContain("−55.298M");
    expect(text).toContain("+220.000M");
    expect(text).toContain("+20.000M");
    expect(text).toContain("LOCAL SCENARIO VALUE · $ · SPOT MOVE FROM 600.24 · 0.25 DAY");
    expect(text).toContain("EXPECTED MOVE 1σ ±0.81%");
    expect(text).toContain("Δσ −1 pt · selected");
  });
  it("pressing + on VOL SHIFT changes the headline and the selected series", async () => {
    await render(<ExposureScenario basis={GOLD} lang="en" initialInputs={WI} />);
    const el = q("[data-scenario-status]")!;
    expect(el.textContent).toContain("+184.702M");
    await click(groupBtn("VOL SHIFT · absolute · all tenors", "+"));
    // Δσ −0.75: total = −55.298 + 165 + 20 = +129.702M, nearest series still −1
    expect(el.textContent).toContain("+129.702M");
    expect(el.getAttribute("data-scenario-sigma")).toBe("-1");
    await click(groupBtn("VOL SHIFT · absolute · all tenors", "+"));
    await click(groupBtn("VOL SHIFT · absolute · all tenors", "+"));
    // Δσ −0.25: the 0 series is now the nearest → selected
    expect(el.getAttribute("data-scenario-sigma")).toBe("0");
  });
  it("the WORKED tab evaluates the golden live", async () => {
    await render(<ExposureScenario basis={GOLD} lang="en" />);
    const tab = [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent === "WORKED");
    if (!tab) throw new Error("missing WORKED tab");
    await click(tab);
    const text = host.textContent ?? "";
    expect(text).toContain("+184.702M");
    expect(text).toContain("Rounded move would give 184.68M");
    expect(text).toContain("oracle 499/499");
    expect(text).not.toContain("Self-check failed");
  });
  it("vex null with Δσ −1 → summary-unavailable, headline —, needVex, never a signed value", async () => {
    await render(<ExposureScenario basis={{ ...GOLD, vexMn: null }} lang="en"
      initialInputs={{ targetSpot: 600, deltaSigmaPts: -1, days: 0.25 }} />);
    const el = q("[data-scenario-status]")!;
    expect(el.getAttribute("data-scenario-status")).toBe("summary-unavailable");
    expect(q('[data-testid="scenario-headline"]')!.textContent).toBe("—");
    expect(el.textContent).toContain("Vol shift needs an admitted VEX");
    expect(el.textContent).toContain("unavailable");
    expect(el.textContent).not.toContain("+184");
    expect(el.textContent).not.toContain("−55.298");
  });
  it("a dated basis is not admitted", async () => {
    await render(<ExposureScenario basis={{ ...GOLD, qualification: "dated" }} lang="en" />);
    const el = q("[data-scenario-status]")!;
    expect(el.getAttribute("data-scenario-status")).toBe("not-admitted");
    expect(el.textContent).toContain("Scenario needs a qualified projection");
    expect(el.textContent).toContain("Dated and aggregate books carry no local value.");
  });
  it("a target beyond ±3% is out-of-range", async () => {
    await render(<ExposureScenario basis={GOLD} lang="en" />);
    const input = q('[role="group"][aria-label="SPOT MOVE"] input');
    if (!input) throw new Error("missing spot input");
    await typeValue(input, "630");
    const el = q("[data-scenario-status]")!;
    expect(el.getAttribute("data-scenario-status")).toBe("out-of-range");
    expect(q('[data-testid="scenario-headline"]')!.textContent).toBe("—");
    expect(el.textContent).toContain("Outside the local range (±3% · ±5 pt · ≤ 5 days)");
  });
  it("Reset to spot returns the target to the reference", async () => {
    await render(<ExposureScenario basis={GOLD} lang="en" />);
    const input = q('[role="group"][aria-label="SPOT MOVE"] input') as HTMLInputElement;
    await click(groupBtn("SPOT MOVE", "+"));
    await click(groupBtn("SPOT MOVE", "+"));
    expect(input.value).toBe("603.24");
    const reset = [...host.querySelectorAll("button")].find((b) => b.textContent === "Reset to spot");
    if (!reset) throw new Error("missing reset button");
    await click(reset);
    expect(input.value).toBe("600.24");
    expect(q("[data-scenario-status]")!.getAttribute("data-scenario-status")).toBe("ready");
  });
  it("ZH renders the ZH caveat", async () => {
    await render(<ExposureScenario basis={GOLD} lang="zh" />);
    expect(host.textContent).toContain("围绕参考现货对每个输入线性化");
  });
  it("Open in Exposure ↗ appears only when the parent passes onOpenMap", async () => {
    await render(<ExposureScenario basis={GOLD} lang="en" />);
    expect(host.textContent).not.toContain("Open in Exposure ↗");
    const onOpenMap = vi.fn();
    await render(<ExposureScenario basis={GOLD} lang="en" onOpenMap={onOpenMap} />);
    const btn = [...host.querySelectorAll("button")].find((b) => b.textContent === "Open in Exposure ↗");
    if (!btn) throw new Error("missing open button");
    await click(btn);
    expect(onOpenMap).toHaveBeenCalledTimes(1);
  });
  it("no raw hex colours and no undefined anywhere", async () => {
    await render(<ExposureScenario basis={{ ...GOLD, vexMn: null, cexMn: null }} lang="en" />);
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toContain("undefined");
  });
});
