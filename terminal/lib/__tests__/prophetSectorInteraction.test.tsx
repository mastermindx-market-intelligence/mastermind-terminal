// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_PROPHET_STATE, type ProphetUrlState } from "@/lib/prophetUrlState";
import { decodeProphetSectorMembers, type SectorMembersPayload } from "@/lib/prophetSectorMembers";
import { ProphetSectorView } from "@/components/prophet/sector/ProphetSectorView";

const { read, viewport } = vi.hoisted(() => ({ read: vi.fn(), viewport: { phone: false } }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsPhone: () => viewport.phone }));
vi.mock("@/lib/prophetSectorMembers", async original => ({
  ...await original<typeof import("@/lib/prophetSectorMembers")>(), fetchProphetSectorMembers: read,
}));
vi.mock("@/components/prophet/sector/MemberSetup", () => ({
  MemberSetup: ({ payload, onBack }: { payload: { symbol: string }; onBack: () => void }) =>
    <section data-testid="prophet-sector-setup"><h3>{payload.symbol}</h3><button onClick={onBack}>Return from setup</button></section>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = (name: string) => decodeProphetSectorMembers(JSON.parse(readFileSync(
  join(process.cwd(), "public/data/prophet_sector_members_fixture", `${name}.json`), "utf8")))!;
const index = fixture("index");
const original = fixture("symbol_CARR") as Extract<SectorMembersPayload, { mode: "symbol" }>;
function symbolPayload(symbol: string) {
  const payload = structuredClone(original);
  payload.symbol = symbol;
  payload.memberOf.forEach(item => { item.member.symbol = symbol; item.member.name = `Company ${symbol}`; });
  return payload;
}
let host: HTMLDivElement, root: Root, lastState: ProphetUrlState;
const selected = ["CARR", "ADP", "ALLE", "HWM", "CLX"];
function Harness({ initial }: { initial: ProphetUrlState }) {
  const [state, setState] = useState(initial);
  useEffect(() => { lastState = state; }, [state]);
  return <ProphetSectorView state={state} update={patch => setState(current => ({ ...current, ...patch }))} />;
}
async function mount(overrides: Partial<ProphetUrlState> = {}) {
  await act(async () => root.render(<Harness initial={{ ...DEFAULT_PROPHET_STATE,
    lane: "sector", view: "compare", sel: selected, ...overrides }} />));
}
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  read.mockReset();
  viewport.phone = false;
  read.mockImplementation(async ({ symbol }: { symbol?: string }) => ({ status: "ok", payload: symbol ? symbolPayload(symbol) : index }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("retains all selected names, fetches three visible subjects, and keeps the selector focused when swapping", async () => {
  let finishOld!: (result: unknown) => void;
  read.mockImplementation(({ symbol }: { symbol?: string }) => symbol === "CARR"
    ? new Promise(resolve => { finishOld = resolve; })
    : Promise.resolve({ status: "ok", payload: symbol ? symbolPayload(symbol) : index }));
  await mount();
  expect(read.mock.calls.map(([query]) => query.symbol).filter(Boolean)).toEqual(["CARR", "ADP", "ALLE"]);
  expect(host.querySelector('[data-testid="prophet-sector-compare-chips"]')?.textContent).toBe(selected.join(""));
  expect(document.activeElement).toBe(host.querySelector("[data-view-heading]"));
  const picker = host.querySelector("select")!;
  picker.focus();
  await act(async () => { picker.value = "HWM"; picker.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(lastState.sel).toEqual(["HWM", "ADP", "ALLE", "CARR", "CLX"]);
  expect(document.activeElement).toBe(picker);
  expect(host.querySelector('[data-testid="prophet-sector-compare-card-HWM"]')).not.toBeNull();
  await act(async () => finishOld({ status: "ok", payload: symbolPayload("CARR") }));
  expect(host.querySelector('[data-testid="prophet-sector-compare-card-CARR"]')).toBeNull();
  expect(host.querySelector('[data-testid="prophet-sector-compare-card-HWM"]')).not.toBeNull();
});

it("returns an ungrouped comparison to group discovery without dropping the full selection", async () => {
  await mount();
  const back = host.querySelector<HTMLButtonElement>('[data-testid="prophet-sector-compare-back"]')!;
  expect(back.textContent).toContain("Choose a group");
  await act(async () => back.click());
  expect(lastState.view).toBe("overview");
  expect(lastState.group).toBeNull();
  expect(lastState.sel).toEqual(selected);
});

it("shows two phone subjects and does not describe a hidden third subject's clock as a visible mismatch", async () => {
  viewport.phone = true;
  read.mockImplementation(async ({ symbol }: { symbol?: string }) => {
    if (!symbol) return { status: "ok", payload: index };
    const payload = symbolPayload(symbol);
    payload.compatibility = { ...payload.compatibility, status: symbol === "ALLE" ? "mixed_basis" : "compatible" };
    return { status: "ok", payload };
  });
  await mount();
  expect(host.querySelectorAll("select")).toHaveLength(2);
  expect(host.querySelector('[data-testid="prophet-sector-compare-card-ALLE"]')).toBeNull();
  expect(host.textContent).toContain("Comparing 2 of 5 selected");
  expect(host.querySelector('[data-testid="prophet-sector-compare-banner"]')?.textContent).not.toContain("different clocks");
  expect(lastState.sel).toEqual(selected);
});

it("returns an ungrouped setup to a usable discovery view and clears the selected detail", async () => {
  await mount({ view: "setup", symbol: "CARR" });
  expect(document.activeElement?.textContent).toBe("CARR");
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(lastState.view).toBe("overview");
  expect(lastState.symbol).toBeNull();
  expect(lastState.sel).toEqual(selected);
});
