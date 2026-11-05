// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ExposureChangeInspector from "@/components/exposure-map/ExposureChangeInspector";
import { buildChangeInspector, type ChangeInspectorModel } from "@/lib/exposureChangeInspector";
import { compareReportedGamma, type ReportedGammaMember, type ReportedGammaSnapshot } from "@/lib/exposureReportedChange";

const previousSession = "2026-03-19";
const currentSession = "2026-03-20";
const cutoff = Date.parse("2026-03-21T12:00:00Z");
const member = (strike: number, right: "C" | "P", valueUsd: number | null): ReportedGammaMember =>
  ({ expiry: "2026-04-17", strike, right, valueUsd });
const snapshot = (session: string, members: ReportedGammaMember[]): ReportedGammaSnapshot => ({
  root: "SPY", securityId: "SEC-X", sourceSession: session, sourceKey: `source:${session}`,
  definitionKey: "reported_gamma/v1", scopeKey: "root:SEC-X:reported",
  availableAt: `${session}T21:00:00Z`, oiReportDate: session,
  oiPositionSession: `${session}T16:15:00-04:00`, correctionRef: null, members,
});
function modelFor(previous: ReportedGammaMember[], current: ReportedGammaMember[], focusStrike?: number, topK?: number) {
  return buildChangeInspector({
    previousSession, currentSession, focusStrike, topK,
    change: compareReportedGamma(snapshot(currentSession, current), snapshot(previousSession, previous), cutoff),
  });
}
function precisionModel() {
  return modelFor(
    [member(100, "C", 0), member(105, "C", 0), member(110, "P", 0), member(115, "C", 1234567.890123)],
    [member(100, "C", 0), member(105, "C", 1e-9), member(110, "P", -1e-9), member(115, "C", 2234567.890123)],
  );
}
function populationModel() {
  return modelFor(
    [member(100, "C", 1000), member(110, "C", null), member(120, "P", 3000), member(150, "C", 5000)],
    [member(100, "C", 2000), member(110, "C", 3000), member(120, "P", 1000), member(140, "C", 4000)],
  );
}

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function render(model: ChangeInspectorModel, props: { lang?: "en" | "zh"; selectedStrike?: number | null; onSelectStrike?: (strike: number) => void } = {}) {
  const { lang = "en", ...selection } = props;
  await act(async () => root.render(<ExposureChangeInspector model={model} lang={lang} {...selection} />));
}
const panel = () => host.querySelector<HTMLElement>("[data-testid=exposure-change-inspector]")!;
const table = () => host.querySelector<HTMLTableElement>("[data-testid=change-values-table]")!;
const cards = () => host.querySelector<HTMLOListElement>("[data-testid=change-values-cards]")!;
const row = (strike: number) => table().querySelector<HTMLTableRowElement>(`tbody tr[data-strike="${strike}"]`)!;
const card = (strike: number) => cards().querySelector<HTMLLIElement>(`li[data-strike="${strike}"]`)!;
const field = (element: Element, key: string) => element.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
async function view(value: "compact" | "exact", lang: "en" | "zh" = "en") {
  const label = value === "compact" ? (lang === "en" ? "Compact" : "紧凑") : (lang === "en" ? "Exact USD" : "精确美元");
  const control = [...host.querySelectorAll<HTMLButtonElement>("[data-testid=change-values-controls] button")].find(button => button.textContent === label);
  if (!control) throw new Error(`Missing persistent control: ${label}`);
  control.focus();
  await act(async () => control.click());
  return control;
}
function rowsIn(element: Element, selector: string) {
  return [...element.querySelectorAll(selector)].map(row => row.getAttribute("data-strike"));
}
function population(key: string) { return host.querySelector(`[data-population="${key}"] strong`)?.textContent; }
function aggregate(label: string) {
  const cell = [...host.querySelectorAll("div")].find(el => el.firstElementChild?.tagName === "SPAN"
    && el.firstElementChild.textContent === label && el.querySelector(":scope > strong"));
  return cell?.querySelector(":scope > strong")?.textContent;
}

describe("Exact reported-Gamma change investigation", () => {
  it("uses the persistent controls to reveal tiny signed amounts and full supplied USD precision", async () => {
    await render(precisionModel());
    expect(field(row(105), "signedChangeUsd").textContent).toBe("+$0");
    const before = rowsIn(table(), "tbody tr");
    const exact = await view("exact");
    expect(exact.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(exact);
    expect(field(row(100), "signedChangeUsd").textContent).toBe("$0");
    expect(field(row(105), "signedChangeUsd").textContent).toBe("+$1e-9");
    expect(field(row(110), "signedChangeUsd").textContent).toBe("−$1e-9");
    expect(field(row(115), "previousNetUsd").textContent).toBe("$1234567.890123");
    expect(field(row(115), "currentNetUsd").textContent).toBe("$2234567.890123");
    expect(rowsIn(table(), "tbody tr")).toEqual(before);
    expect(field(row(100), "signedChangeUsd").hasAttribute("data-sign")).toBe(false);
    expect(field(row(105), "signedChangeUsd").getAttribute("data-sign")).toBe("positive");
    expect(field(row(110), "signedChangeUsd").getAttribute("data-sign")).toBe("negative");
    const compact = await view("compact");
    expect(compact.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(compact);
    expect(field(row(105), "signedChangeUsd").textContent).toBe("+$0");
    expect(field(row(115), "previousNetUsd").textContent).toBe("$1.23M");
    expect(rowsIn(table(), "tbody tr")).toEqual(before);
  });

  it("keeps net, net-magnitude and gross changes distinct in both responsive representations", async () => {
    const model = modelFor(
      [member(100, "C", 100), member(100, "P", -50)],
      [member(100, "C", 80), member(100, "P", -20)],
    );
    await render(model); await view("exact");
    for (const representation of [row(100), card(100)]) {
      expect(field(representation, "previousNetUsd").textContent).toBe("$50");
      expect(field(representation, "currentNetUsd").textContent).toBe("$60");
      expect(field(representation, "signedChangeUsd").textContent).toBe("+$10");
      expect(field(representation, "netMagnitudeChangeUsd").textContent).toBe("+$10");
      expect(field(representation, "grossChangeUsd").textContent).toBe("−$50");
    }
    expect(aggregate("Previous net")).toBe("$50");
    expect(aggregate("Current net")).toBe("$60");
    expect(aggregate("Net change")).toBe("+$10");
    expect(aggregate("Gross change")).toBe("−$50");
  });

  it("exposes all supplied population counts without treating overlapping categories as a total", async () => {
    await render(populationModel()); await view("exact");
    const disclosure = host.querySelector<HTMLDetailsElement>("details")!;
    expect(disclosure.querySelector("summary")?.textContent).toBe("Reported membership and qualification");
    disclosure.open = true;
    expect({
      matched: population("matched"), previousOnly: population("previousOnly"), currentOnly: population("currentOnly"),
      lost: population("qualificationLost"), gained: population("qualificationGained"),
      previousObserved: population("previousObserved"), currentObserved: population("currentObserved"),
      unavailableEither: population("unavailableEither"),
    }).toEqual({
      matched: "2", previousOnly: "1", currentOnly: "1", lost: "0", gained: "1",
      previousObserved: "4", currentObserved: "4", unavailableEither: "1",
    });
    expect(disclosure.textContent).toContain("Categories can overlap and are not summed");
    expect(disclosure.textContent).toContain("Source collection coverage is not supplied");
    expect(aggregate("Previous net")).toBe("$4000");
    expect(aggregate("Current net")).toBe("$3000");
    expect(panel().textContent).toContain("2 contracts matched");
  });

  it("uses the same ordered rows and amounts for the table and named narrow cards", async () => {
    await render(precisionModel()); await view("exact");
    expect(rowsIn(cards(), ":scope > li")).toEqual(rowsIn(table(), "tbody tr"));
    for (const strike of [100, 105, 110, 115]) {
      for (const key of ["previousNetUsd", "currentNetUsd", "signedChangeUsd", "netMagnitudeChangeUsd", "grossChangeUsd"]) {
        expect(field(card(strike), key).textContent).toBe(field(row(strike), key).textContent);
      }
      const article = card(strike).querySelector("article")!;
      const heading = document.getElementById(article.getAttribute("aria-labelledby")!);
      expect(heading?.textContent).toContain(String(strike));
    }
    expect(table().querySelector("caption")?.textContent).toBe("Matched reported Gamma by strike · USD");
    expect(table().querySelectorAll("thead th[scope=col]")).toHaveLength(5);
    expect(table().querySelectorAll("tbody th[scope=row]")).toHaveLength(4);
  });

  it("requests exact strike identity through the existing callback and waits for parent selection", async () => {
    const selected = vi.fn();
    const exactStrike = 123.456789;
    const model = modelFor([member(exactStrike, "C", 10)], [member(exactStrike, "C", 20)]);
    await render(model, { selectedStrike: null, onSelectStrike: selected }); await view("exact");
    const choice = row(exactStrike).querySelector<HTMLButtonElement>("button")!;
    expect(choice.getAttribute("aria-label")).toBe("Select strike 123.456789");
    await act(async () => choice.click());
    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected).toHaveBeenCalledWith(exactStrike);
    expect(choice.getAttribute("aria-pressed")).toBe("false");
    await render(model, { selectedStrike: exactStrike, onSelectStrike: selected });
    expect(row(exactStrike).querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
    expect(card(exactStrike).querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
    expect(panel().getAttribute("data-value-mode")).toBe("exact");
  });

  it("renders strikes as read-only values when the caller supplies no action", async () => {
    await render(populationModel(), { selectedStrike: 100 });
    expect(table().querySelector("tbody button,a,input,[tabindex]")).toBeNull();
    expect(cards().querySelector("button,a,input,[tabindex]")).toBeNull();
    expect(row(100).querySelector("[data-strike-label]")?.textContent).toBe("100");
    expect(row(100).querySelector("[data-strike-label]")?.getAttribute("aria-label")).toBe("Selected strike 100");
    await view("exact");
    expect(table().querySelector("tbody button")).toBeNull();
    expect(card(100).querySelector("[data-strike-label]")?.textContent).toBe("100");
  });

  it("preserves the top-ranked subset, appended focus and count outside the ranked set", async () => {
    const previous = Array.from({ length: 10 }, (_, i) => member(100 + i * 5, "C", 0));
    const current = Array.from({ length: 10 }, (_, i) => member(100 + i * 5, "C", i));
    const model = modelFor(previous, current, 100, 2);
    expect(model.more).toBe(8); // The appended focus is part of this existing count.
    await render(model, { selectedStrike: 100 }); await view("exact");
    expect(rowsIn(table(), "tbody tr")).toEqual(["145", "140", "100"]);
    expect(rowsIn(cards(), ":scope > li")).toEqual(["145", "140", "100"]);
    expect(table().querySelectorAll("tr[data-focus]")).toHaveLength(1);
    expect(row(100).getAttribute("data-focus")).toBe("true");
    expect(host.querySelector("[data-testid=change-outside-rank]")?.textContent).toBe("8 strikes outside the ranked set");
    expect(panel().textContent).toContain("Selected strike shown below the largest changes.");
    await view("compact");
    expect(rowsIn(table(), "tbody tr")).toEqual(["145", "140", "100"]);
    expect(model.rows.map(row => row.strike)).toEqual([145, 140, 100]);
  });

  it("names a supplied focus that is absent from the matched comparison without substituting another strike", async () => {
    const model = modelFor([member(100, "C", 10)], [member(100, "C", 20)], 999);
    const callback = vi.fn();
    await render(model, { selectedStrike: 999, onSelectStrike: callback }); await view("exact");
    expect(host.querySelector("[data-testid=change-focus-unavailable]")?.textContent).toBe("Selected strike 999 is outside this matched comparison.");
    expect(rowsIn(table(), "tbody tr")).toEqual(["100"]);
    expect(table().querySelectorAll("tbody button[aria-pressed=true]")).toHaveLength(0);
    expect(callback).not.toHaveBeenCalled();
  });

  it("withdraws old figures when the supplied model loses data and retains only the display preference on recovery", async () => {
    await render(precisionModel()); await view("exact");
    const unavailable = buildChangeInspector({ change: null, currentSession, previousSession });
    await render(unavailable);
    expect(panel().getAttribute("data-state")).toBe("unavailable");
    expect(panel().querySelector("table,ol,strong")).toBeNull();
    expect(host.querySelector("[data-testid=change-values-controls]")).toBeNull();
    expect(panel().textContent).not.toMatch(/1234567\.890123|2234567\.890123|1e-9/);
    expect(panel().querySelector("[role=status]")?.textContent).toBe("No earlier reported session to match.");
    await render(modelFor([member(250, "C", 10)], [member(250, "C", 17.25)]));
    expect(panel().getAttribute("data-value-mode")).toBe("exact");
    expect(rowsIn(table(), "tbody tr")).toEqual(["250"]);
    expect(field(row(250), "signedChangeUsd").textContent).toBe("+$7.25");
    expect(panel().textContent).not.toMatch(/1234567\.890123|2234567\.890123|1e-9/);
  });

  it("preserves the exact sessions, signs and numbers with Chinese controls and source explanation", async () => {
    await render(precisionModel(), { lang: "zh", onSelectStrike: vi.fn() });
    const exact = await view("exact", "zh");
    expect(exact.getAttribute("aria-pressed")).toBe("true");
    expect(panel().textContent).toContain("2026-03-19 → 2026-03-20");
    expect(field(row(110), "signedChangeUsd").textContent).toBe("−$1e-9");
    expect(row(105).querySelector("button")?.getAttribute("aria-label")).toBe("选择行权价 105");
    expect(table().querySelector("caption")?.textContent).toBe("按行权价匹配的报告 Gamma · 美元");
    expect(panel().textContent).toContain("未提供来源采集覆盖率");
    await view("compact", "zh");
    expect(field(row(110), "signedChangeUsd").textContent).toBe("−$0");
  });
});

