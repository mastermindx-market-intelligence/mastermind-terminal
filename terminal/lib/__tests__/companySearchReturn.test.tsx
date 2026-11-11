// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ShellSearch from "@/components/chrome/shared-shell/ShellSearch";
import { COMPANY_SEARCH_HISTORY_KEY } from "@/lib/companySearchContext";

const state = vi.hoisted(() => ({ push: vi.fn(), active: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/lib/activeSymbol", () => ({ useActiveSymbol: () => "BABA", writeActiveSymbol: state.active }));
vi.mock("@/lib/sharedShellCopy", () => ({ useSharedShellT: () => (key: string) => key }));
vi.mock("@/components/SymbolPicker", () => ({ default: (props: {
  onCompanyPick: (symbol: string, query: string) => void; onOpenChange: (open: boolean) => void;
  searchSeed?: string; initialSelection?: string; open: boolean;
}) => <section data-seed={props.searchSeed} data-selected={props.initialSelection} data-open={String(props.open)}>
  <button onClick={() => { props.onOpenChange(false); props.onCompanyPick("9988.HK", "Alibaba"); props.onOpenChange(false); }}>choose HKEX</button>
  <button onClick={() => props.onOpenChange(false)}>close</button>
</section> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const onOpenChange = vi.fn();
beforeEach(() => {
  state.push.mockReset(); state.active.mockReset(); onOpenChange.mockReset();
  window.history.replaceState({ nextRouter: "preserved" }, "", "/discover?tool=research&q=a%20b&q=a+b#tools");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(<ShellSearch open onOpenChange={onOpenChange} />)); }

it("carries the exact HK ticker and typed selection reason, then restores the exact origin and search on Back", async () => {
  await render(); const origin = window.location.href;
  await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
  expect(state.push).toHaveBeenCalledWith("/analysis?symbol=9988.HK&company_query=Alibaba");
  expect(state.active).toHaveBeenCalledWith("9988.HK");
  expect(window.location.href).toBe(origin);
  const returnState = window.history.state;
  expect(returnState.nextRouter).toBe("preserved");
  expect(returnState[COMPANY_SEARCH_HISTORY_KEY]).toEqual({ symbol: "9988.HK", query: "Alibaba", href: origin });
  window.history.replaceState(null, "", "/analysis?symbol=9988.HK&company_query=Alibaba");
  window.history.replaceState(returnState, "", origin);
  await act(async () => window.dispatchEvent(new PopStateEvent("popstate", { state: returnState })));
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
  expect(host.querySelector("section")?.getAttribute("data-seed")).toBe("Alibaba");
  expect(host.querySelector("section")?.getAttribute("data-selected")).toBe("9988.HK");
  expect(window.location.href).toBe(origin);
});

it("ignores a marker attached to another URL and retires the restored marker on deliberate close", async () => {
  window.history.replaceState({ [COMPANY_SEARCH_HISTORY_KEY]: { symbol: "9988.HK", query: "Alibaba", href: "http://localhost/other" } }, "", window.location.href);
  await render(); expect(onOpenChange).not.toHaveBeenCalled();
  await act(async () => (host.querySelectorAll("button")[1] as HTMLButtonElement).click());
  expect(window.history.state[COMPANY_SEARCH_HISTORY_KEY]).toBeUndefined();
});
