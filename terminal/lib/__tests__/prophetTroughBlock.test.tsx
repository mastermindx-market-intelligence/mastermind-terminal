// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { troughSpecimen, TROUGH_BANNED_WORDS } from "../../e2e/prophetTroughSpecimens";
import type { TroughSpecimenState } from "../../e2e/prophetTroughSpecimens";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined; let container: HTMLDivElement;
function mount(node: React.ReactNode) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); act(() => root!.render(node)); }
afterEach(() => { act(() => root?.unmount()); root = undefined; container?.remove(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
async function modules(enabled = true) {
  vi.stubEnv("NEXT_PUBLIC_PROPHET_TROUGH_READ_ENABLED", enabled ? "1" : "0");
  const component = await import("@/components/prophet/setup/TroughRead");
  const consumer = await import("../prophetTroughRead");
  return { ...component, ...consumer };
}
for (const lang of ["en", "zh"] as const) for (const state of ["A", "B", "C", "D", "E"] as TroughSpecimenState[]) {
  it(`${state} ${lang}: disclosed depth, quiet defaults and no banned prose`, async () => {
    const { TroughReadBlock, parseProphetTroughRead } = await modules();
    mount(<TroughReadBlock read={parseProphetTroughRead(troughSpecimen(state))} symbol="ADP" lang={lang} />);
    expect(container.textContent).not.toMatch(TROUGH_BANNED_WORDS);
    expect(container.textContent).not.toMatch(/Studied on three stocks only; not yet tested widely\.|仅研究过三只股票；尚未广泛检验。/);
    expect(container.querySelectorAll("a,[role=alert]")).toHaveLength(0);
    if (state === "D") { expect(container.querySelector("button")).toBeNull(); return; }
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[hidden]")).not.toBeNull();
    act(() => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).not.toMatch(/Studied on three stocks only; not yet tested widely\.|仅研究过三只股票；尚未广泛检验。/);
    expect(container.textContent).toContain(lang === "en" ? "Turned up is read on 3‑day bars only: momentum crossed back up after sitting in its low zone, and a faster momentum gauge was rising too. Only completed bars count." : "回升只在3日K线上判断：动能在低位区停留后重新上穿，且一个更快的动能指标也在上升。只计算已完成的K线。");
    expect(container.querySelectorAll('[data-testid="trough-frame"]')).toHaveLength(4);
    expect(container.textContent).not.toMatch(TROUGH_BANNED_WORDS);
    if (lang === "en") {
      expect(container.textContent).toContain("Group figures: not yet available");
      expect(container.textContent).toContain("Only completed bars count.");
      expect(container.textContent).toContain("Which timeframe matters for which kind of stock is still being measured; this headline only lists them.");
      expect(container.textContent).not.toContain("this headline only counts.");
      expect(container.querySelector('[data-testid="trough-headline"]')!.nextElementSibling!.textContent).toBe("More timeframes washed out means a deeper decline. It has not been shown to make the low more likely to hold.");
      expect(container.querySelector('[role="meter"]')).toBeNull();
      expect(container.textContent).not.toContain("Turned up on");
      const rows = container.querySelectorAll('[data-testid="trough-frame"]');
      for (const i of [0, 2, 3]) expect(rows[i].lastElementChild!.textContent).toBe("—");
      expect(container.textContent).not.toMatch(/Most of this decline|K_gt_D|hist_rising/);
      if (state === "C") { expect(container.textContent).toContain("No decline right now"); expect(container.querySelector('[title^="◯"]')).toBeNull(); }
      if (state === "E") expect(container.querySelectorAll('[data-testid="trough-frame"]')[3].textContent).toBe("2‑week——");
    }
    act(() => container.querySelectorAll("button")[1].click());
    expect(button.getAttribute("aria-expanded")).toBe("false"); expect(document.activeElement).toBe(button);
  });
}
it("retains non-null kind and provenance presentation", async () => {
  const { TroughReadBlock, parseProphetTroughRead } = await modules(); const data = troughSpecimen();
  data.tickers.ADP.kind = { label: "leans_cyclical", position: .7 }; data.tickers.ADP.provenance = "own";
  mount(<TroughReadBlock read={parseProphetTroughRead(data)} symbol="ADP" lang="en" />);
  expect(container.textContent).toContain("Kind: leans cyclical, high-beta");
  expect(container.querySelector('[role="meter"]')!.getAttribute("aria-valuenow")).toBe("0.7");
  expect(container.textContent).toContain("Most of this decline was its own");
});
it.each([[.2, "shallower than"], [1 / 3, "about as deep as"], [2 / 3, "about as deep as"], [.8, "deeper than"]] as const)("history percentile %s maps to %s", async (pct, sentence) => {
  const { TroughReadBlock, parseProphetTroughRead } = await modules(); const data = troughSpecimen(); data.tickers.ADP.own_history!.own_history_pct = pct;
  mount(<TroughReadBlock read={parseProphetTroughRead(data)} symbol="ADP" lang="en" />);
  expect(container.textContent).toContain(`This washout is ${sentence} its usual ones.`);
  const dot = container.querySelector('[title="2022-06-17: 3 ATRc"]') as HTMLElement;
  expect(Number.parseFloat(dot.style.left)).toBeCloseTo(4 + 3 / 7 * 92);
});
it.each([undefined, "0", "true", "yes"])("flag %s stays disabled unless exactly 1", async value => {
  vi.stubEnv("NEXT_PUBLIC_PROPHET_TROUGH_READ_ENABLED", value);
  const { PROPHET_TROUGH_READ_ENABLED } = await import("../prophetTroughRead");
  expect(PROPHET_TROUGH_READ_ENABLED).toBe(false);
});
it("flag off mounts nothing and performs no fetch", async () => {
  const { TroughRead, TroughReadBlock, TROUGH_READ_UNAVAILABLE } = await modules(false);
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await act(async () => mount(<><TroughRead symbol="ADP" lang="en" /><TroughReadBlock read={TROUGH_READ_UNAVAILABLE} symbol="ADP" lang="en" /></>));
  expect(container.innerHTML).toBe(""); expect(fetch).not.toHaveBeenCalled();
});
it("starts unavailable, refreshes on focus and clears on access loss", async () => {
  const { TroughRead } = await modules(); let published = false; let allowed = true;
  vi.stubGlobal("fetch", vi.fn(async () => allowed && published ? Response.json(troughSpecimen()) : new Response(null, { status: allowed ? 404 : 403 })));
  await act(async () => mount(<TroughRead symbol="ADP" lang="en" />)); expect(container.textContent).toContain("Not available");
  published = true; await act(async () => window.dispatchEvent(new Event("focus"))); expect(container.textContent).toContain("turning up");
  allowed = false; await act(async () => window.dispatchEvent(new Event("focus"))); expect(container.textContent).toContain("Not available"); expect(container.textContent).not.toContain("Semiconductors");
});
it("nullable sections omit safely and nullable group state is a dash", async () => {
  const { TroughReadBlock, parseProphetTroughRead } = await modules(); const data = troughSpecimen();
  data.tickers.ADP.kind = null; data.tickers.ADP.own_history = null; data.tickers.ADP.provenance = null; data.tickers.ADP.group!.state = null;
  mount(<TroughReadBlock read={parseProphetTroughRead(data)} symbol="ADP" lang="en" />);
  expect(container.textContent).toContain("Kind: not yet available"); expect(container.textContent).toContain("Group (Semiconductors): —");
  expect(container.textContent).not.toContain("AGAINST ITS OWN HISTORY");
});
