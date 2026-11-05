// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileCard } from "@/components/msc/ProfileCard";
import type { GexPayload } from "@/components/gexdesk/GexDeskView";

type Profile = NonNullable<GexPayload["profile"]>;
const fullProfile = (n = 11): Profile => ({
  method: "quoted_iv_reprice/v1", span_pct: 25,
  grid: Array.from({ length: n }, (_, i) => 100 + i),
  gamma_bn: Array.from({ length: n }, (_, i) => i - 5),
  crossings: [105],
});
const payload = (overrides: Partial<GexPayload> = {}): GexPayload => ({
  schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-30T20:15:00Z",
  spot_ref: 105, net_gex_bn: 1, gamma_flip: 105, call_wall: 108.5, put_wall: 101.25,
  by_strike: [], profile: fullProfile(), ...overrides,
});

let host: HTMLDivElement, root: Root, observed: Element[];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observed = [];
  vi.stubGlobal("ResizeObserver", class { observe(element: Element) { observed.push(element); } disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(480);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function render(gex: GexPayload | null, lang: "en" | "zh" = "en") {
  await act(async () => root.render(<ProfileCard gex={gex} lang={lang} />));
}
const panel = () => host.querySelector<HTMLElement>("[data-testid=positioning-profile-panel]")!;
const table = () => host.querySelector<HTMLTableElement>("[data-testid=profile-exact-table]");
const textOf = (testId: string) => host.querySelector(`[data-testid="${testId}"]`)?.textContent;
const spots = () => [...(table()?.querySelectorAll("[data-field=spot]") ?? [])].map(el => el.textContent);
const gammas = () => [...(table()?.querySelectorAll("[data-field=gamma]") ?? [])].map(el => el.textContent);
async function view(mode: "chart" | "table", lang: "en" | "zh" = "en") {
  const label = mode === "chart" ? (lang === "en" ? "Chart" : "图表") : (lang === "en" ? "Exact profile values" : "精确曲线数值");
  const button = [...host.querySelectorAll<HTMLButtonElement>("[data-testid=profile-view-controls] button")].find(el => el.textContent === label);
  if (!button) throw new Error(`Missing persistent profile control: ${label}`);
  button.focus();
  await act(async () => button.click());
  return button;
}
function geometry() {
  const svg = panel().querySelector("svg");
  const attrs = (element: Element, names: string[]) => names.map(name => element.getAttribute(name));
  return {
    size: svg && attrs(svg, ["width", "height", "viewBox"]),
    line: svg?.querySelector("polyline")?.getAttribute("points"),
    references: [...(svg?.querySelectorAll("line") ?? [])].map(el => attrs(el, ["x1", "x2", "y1", "y2", "stroke-dasharray"])),
    crossings: [...(svg?.querySelectorAll("circle") ?? [])].map(el => attrs(el, ["cx", "cy", "r"])),
  };
}

describe("Exact Positioning exposure profile", () => {
  it("exposes sparse finite samples while retaining the eleven-pair chart gate", async () => {
    await render(payload({ profile: fullProfile(10) }));
    expect(panel().querySelector("svg")).toBeNull();
    expect(textOf("profile-empty")).toContain("10 finite profile sample pairs supplied.");
    expect(textOf("profile-empty")).toContain("at least 11 finite pairs");
    await view("table");
    expect(table()?.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(textOf("profile-values-status")).toBe("10 finite spot–Gamma pairs · source order");
    await view("chart");
    expect(panel().querySelector("svg")).toBeNull();
    await render(payload({ profile: fullProfile(11) }));
    expect(panel().querySelector("svg")?.getAttribute("height")).toBe("224");
    expect(panel().querySelector("svg")?.getAttribute("width")).toBe("480");
    await view("table");
    expect(table()?.querySelectorAll("tbody tr")).toHaveLength(11);
  });

  it("preserves exact coordinates, billion-scale signed amounts, zero and tiny nonzero values", async () => {
    await render(payload({ profile: {
      grid: [100.123456789, 101, 102, 103, 104],
      gamma_bn: [17.1234567890123, 0, -0, 1e-12, -1e-12],
    } }));
    await view("table");
    expect(spots()).toEqual(["100.123456789", "101", "102", "103", "104"]);
    expect(gammas()).toEqual(["+17.1234567890123", "0", "0", "+1e-12", "-1e-12"]);
    expect(table()?.querySelectorAll("[data-sign=positive]")).toHaveLength(2);
    expect(table()?.querySelectorAll("[data-sign=negative]")).toHaveLength(1);
    expect(table()?.querySelector("thead")?.textContent).toContain("$bn per +1% spot");
    const cards = host.querySelector("[data-testid=profile-exact-cards]")!;
    expect([...cards.querySelectorAll("[data-field=spot]")].map(el => el.textContent)).toEqual(spots());
    expect([...cards.querySelectorAll("[data-field=gamma]")].map(el => el.textContent)).toEqual(gammas());
    expect(cards.querySelector("button,a,input,select,[tabindex]")).toBeNull();
  });

  it("keeps source order and duplicate coordinates while omitting only invalid or unpaired finite samples", async () => {
    const profile = {
      grid: [104, 101, 104, Number.NaN, 100, 107, 99],
      gamma_bn: [7, 0, -2, 3, null, 9],
    } as unknown as Profile;
    await render(payload({ profile })); await view("table");
    expect(spots()).toEqual(["104", "101", "104", "107"]);
    expect(gammas()).toEqual(["+7", "0", "-2", "+9"]);
    expect(textOf("profile-values-status")).toBe("4 finite spot–Gamma pairs · source order");
    expect(panel().textContent).toContain("repeated spot coordinates remain separate");
    expect(table()?.textContent).not.toMatch(/NaN|null/);
    await render(payload({ profile: {
      grid: [-1, 0, 5], gamma_bn: [2, 3, "4"],
    } as unknown as Profile }));
    expect(spots()).toEqual(["-1", "0"]); // Preserve the existing finite-only coordinate admission.
    expect(gammas()).toEqual(["+2", "+3"]);
  });

  it("distinguishes absent, malformed paired arrays and arrays without finite pairs without a delivery promise", async () => {
    const cases: [GexPayload["profile"], string][] = [
      [undefined, "No exposure profile supplied."],
      [null, "No exposure profile supplied."],
      [{ grid: "100", gamma_bn: [1] } as unknown as Profile, "The profile's paired samples are unavailable."],
      [{ grid: [100], gamma_bn: null } as unknown as Profile, "The profile's paired samples are unavailable."],
      [{ grid: [], gamma_bn: [] }, "No finite spot–Gamma sample pairs supplied."],
      [{ grid: [100, Infinity, 102], gamma_bn: [null, 3, NaN] } as unknown as Profile, "No finite spot–Gamma sample pairs supplied."],
    ];
    for (const [profile, message] of cases) {
      await render(payload({ profile }));
      expect(textOf("profile-empty")).toBe(message);
      expect(table()).toBeNull();
      expect(panel().querySelector("svg")).toBeNull();
      expect(host.querySelector("[data-testid=profile-view-controls]")).toBeNull();
      expect(panel().textContent).not.toContain("next nightly build");
    }
  });

  it("exposes exact supplied references and source metadata with null distinct from zero", async () => {
    const profile = { ...fullProfile(), method: "bsm_reprice_quoted_iv/v3", span_pct: 12.3456789, crossings: [0, 108.123456789] };
    await render(payload({ profile, spot_ref: 0, call_wall: 0, put_wall: null }));
    expect(textOf("profile-source-root")).toBe("SPY");
    expect(textOf("profile-source-asof")).toBe("2026-10-30T20:15:00Z");
    expect(textOf("profile-source-method")).toBe("bsm_reprice_quoted_iv/v3");
    expect(textOf("profile-source-span")).toBe("12.3456789%");
    expect(textOf("profile-reference-spot")).toBe("0");
    expect(textOf("profile-reference-callWall")).toBe("0");
    expect(textOf("profile-reference-putWall")).toBe("Not supplied");
    expect(textOf("profile-reference-flip")).toBe("0");
    expect([...host.querySelectorAll("[data-testid=profile-crossings] li")].map(el => el.textContent)).toEqual(["0", "108.123456789"]);
    expect(panel().querySelectorAll('svg line[stroke="var(--text-dim)"]')).toHaveLength(0); // Off-domain zero remains a reference, not a moved tick.
    expect(panel().textContent).toContain("It does not establish when the data became available");
  });

  it("reports missing method and span without substituting twenty-five percent or fabricating a timestamp", async () => {
    await render(payload({ asof: "", profile: { ...fullProfile(), method: undefined, span_pct: undefined } }));
    expect(textOf("profile-source-asof")).toBe("Not supplied");
    expect(textOf("profile-source-method")).toBe("Not supplied");
    expect(textOf("profile-source-span")).toBe("Not supplied");
    expect(panel().textContent).toContain("spot-grid span not supplied");
    expect(panel().textContent).not.toContain("±25%");
    await render(payload({ profile: { ...fullProfile(), span_pct: 0 } }));
    expect(textOf("profile-source-span")).toBe("0%");
    await render(payload({ profile: { ...fullProfile(), span_pct: Number.NaN } }));
    expect(textOf("profile-source-span")).toBe("Not supplied");
  });

  it("retains nearest-crossing ties, source order and the existing missing-spot fallback", async () => {
    const profile = { ...fullProfile(), crossings: [102, 98, NaN, 200] };
    await render(payload({ spot_ref: 100, profile }));
    expect(textOf("profile-reference-flip")).toBe("102");
    expect([...host.querySelectorAll("[data-testid=profile-crossings] li")].map(el => el.textContent)).toEqual(["102", "98", "200"]);
    await render(payload({ spot_ref: 100, profile: { ...profile, crossings: [98, 102, 200] } }));
    expect(textOf("profile-reference-flip")).toBe("98");
    await render(payload({ spot_ref: null, profile: { ...profile, crossings: [200, 98, 102] } }));
    expect(textOf("profile-reference-flip")).toBe("200");
    await render(payload({ profile: { ...profile, crossings: [] } }));
    expect(textOf("profile-reference-flip")).toBe("Not supplied");
    expect(textOf("profile-crossings-unavailable")).toBe("No finite crossing supplied.");
  });

  it("returns to identical chart coordinates and reference geometry after exact-value inspection", async () => {
    const gex = payload({ profile: { ...fullProfile(), crossings: [102.123456789, 105, 109.125] } });
    await render(gex);
    const before = geometry();
    expect(before.line).toBeTruthy();
    const exact = await view("table");
    expect(exact.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(exact);
    expect(panel().querySelector("svg")).toBeNull();
    const chart = await view("chart");
    expect(document.activeElement).toBe(chart);
    expect(geometry()).toEqual(before);
    expect(table()).toBeNull();
    expect(panel().querySelector("svg desc")?.textContent).toContain("billions of USD per +1% spot");
  });

  it("preserves the sign-disagreement threshold and first-nearest sample behavior", async () => {
    const profile = { ...fullProfile(), gamma_bn: [-0.05, ...Array(10).fill(1)] };
    const warns = () => panel().textContent?.includes("disagree on today's sign");
    await render(payload({ spot_ref: 100, net_gex_bn: 0.05, profile }));
    expect(warns()).toBe(true);
    await render(payload({ spot_ref: 100, net_gex_bn: 0.049, profile }));
    expect(warns()).toBe(false);
    await render(payload({ spot_ref: 100, net_gex_bn: 1, profile: { ...profile, gamma_bn: [-0.049, ...Array(10).fill(1)] } }));
    expect(warns()).toBe(false);
    await render(payload({ spot_ref: 100.5, net_gex_bn: 1, profile: { ...profile, gamma_bn: [-1, ...Array(10).fill(1)] } }));
    expect(warns()).toBe(true);
    await render(payload({ spot_ref: 100.5, net_gex_bn: 1, profile: {
      ...profile, grid: [101, 100, ...Array.from({ length: 9 }, (_, i) => i + 102)], gamma_bn: [1, -1, ...Array(9).fill(1)],
    } }));
    expect(warns()).toBe(false);
  });

  it("removes prior numeric evidence on profile or source loss and preserves only the view preference", async () => {
    const profile = { ...fullProfile(), gamma_bn: [17.1234567890123, ...Array(10).fill(1)] };
    await render(payload({ profile })); await view("table");
    expect(gammas()).toContain("+17.1234567890123");
    await render(payload({ profile: null }));
    expect(table()).toBeNull();
    expect(host.querySelector("[data-testid=profile-view-controls]")).toBeNull();
    expect(host.querySelector("[data-testid=profile-source]")).toBeNull();
    expect(panel().textContent).not.toContain("17.1234567890123");
    await render(null);
    expect(textOf("profile-empty")).toBe("No exposure profile supplied.");
    expect(host.querySelector("[data-testid=profile-source]")).toBeNull();
    await render(payload({ root: "QQQ", asof: "2026-11-03", profile: { grid: [200, 201], gamma_bn: [9.12345, 0] } }));
    expect(panel().getAttribute("data-view")).toBe("table");
    expect(spots()).toEqual(["200", "201"]);
    expect(gammas()).toEqual(["+9.12345", "0"]);
    expect(textOf("profile-source-root")).toBe("QQQ");
    expect(textOf("profile-source-asof")).toBe("2026-11-03");
    expect(panel().textContent).not.toContain("17.1234567890123");
  });

  it("keeps the measure wrapper mounted so an initially absent profile can recover at the actual width", async () => {
    await render(null);
    const measure = host.querySelector<HTMLElement>("[data-testid=profile-measure]")!;
    expect(observed).toContain(measure);
    await render(payload());
    expect(host.querySelector("[data-testid=profile-measure]")).toBe(measure);
    expect(panel().querySelector("svg")?.getAttribute("width")).toBe("480");
    await view("table");
    expect(host.querySelector("[data-testid=profile-measure]")).toBe(measure);
  });

  it("moves focus from the explicit narrow action to the persistent exact control", async () => {
    await render(payload());
    const action = host.querySelector<HTMLButtonElement>("[data-testid=profile-narrow-action]")!;
    action.focus();
    await act(async () => action.click());
    expect(host.querySelector("[data-testid=profile-narrow-action]")).toBeNull();
    const exact = [...host.querySelectorAll<HTMLButtonElement>("[data-testid=profile-view-controls] button")]
      .find(button => button.textContent === "Exact profile values")!;
    expect(document.activeElement).toBe(exact);
    expect(exact.getAttribute("aria-pressed")).toBe("true");
    expect(table()).not.toBeNull();
    // This verifies the focus contract; browser evidence must establish CSS visibility and actual narrow bounds.
  });

  it("retains a read-only semantic table, exact values and source labels in Chinese", async () => {
    await render(payload({ profile: { grid: [100.123456789, 101], gamma_bn: [0, -1e-12], crossings: [0] } }), "zh");
    await view("table", "zh");
    expect(table()?.querySelector("caption")?.textContent).toBe("采样假设现价处的重定价 Gamma");
    expect(table()?.querySelectorAll("thead th[scope=col]")).toHaveLength(2);
    expect(table()?.querySelectorAll("tbody th[scope=row]")).toHaveLength(2);
    expect(table()?.querySelector("button,a,input,select,[tabindex]")).toBeNull();
    expect(host.querySelector("[data-testid=profile-exact-cards]")?.getAttribute("aria-label")).toBe("采样假设现价处的重定价 Gamma");
    expect(spots()).toEqual(["100.123456789", "101"]);
    expect(gammas()).toEqual(["0", "-1e-12"]);
    expect(host.querySelector("[data-testid=profile-source] summary")?.textContent).toBe("来源与方法");
    expect(textOf("profile-source-asof")).toBe("2026-10-30T20:15:00Z");
    expect(textOf("profile-source-method")).toBe("未提供");
    expect(textOf("profile-reference-flip")).toBe("0");
    await view("chart", "zh");
    expect(panel().querySelector("svg")).toBeNull();
    expect(textOf("profile-empty")).toContain("2 对有限曲线样本");
  });
});
