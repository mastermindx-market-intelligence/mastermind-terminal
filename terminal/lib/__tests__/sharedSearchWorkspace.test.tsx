// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SharedSearchWorkspace from "@/components/SharedSearchWorkspace";
import SearchModal from "@/components/SearchModal";
import { LangProvider } from "@/lib/i18n";
const state = vi.hoisted(() => ({ load: vi.fn(), opened: vi.fn() }));
vi.mock("@/lib/sharedShellSearchCatalog", () => ({ loadSharedSearchCatalog: state.load }));
vi.mock("@/components/onboarding/OnboardingProvider", () => ({ useOnboarding: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsPhone: () => false, useIsMobile: () => false }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: vi.fn() }));
vi.mock("@/components/CompanyListingIdentity", () => ({ default: ({ symbol, onOpen }: { symbol: string; onOpen: () => void }) => <div data-company-listing={symbol}><span>{symbol}</span><button onClick={onOpen}>Open Analysis</button></div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const catalog = { sharedShellDirectory: [{ href: "/bonds.html", title: { en: "Bonds", zh: "债券" }, kind: "legacy", group: "market" }], sharedShellCatalog: { nativePaths: ["/analysis"], legacyPaths: ["/bonds.html", "/tools/calculators/cagr.html"] } };
const companies = [{ symbol: "BABA", name: "Alibaba", venue: "NYSE" }, { symbol: "9988.HK", name: "Alibaba", venue: "HKEX" }];
let root: Root, host: HTMLDivElement;
beforeEach(() => { state.load.mockReset().mockResolvedValue(catalog); state.opened.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function click(text: string) { const b=Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(x=>x.textContent?.includes(text));expect(b,text).toBeTruthy();await act(async()=>b!.click()); }
function Harness({ companyState = "ready" }: { companyState?: "ready" | "unavailable" }) {
 const [q, setQ] = useState("Alibaba"); const [selected, setSelected] = useState<string | null>("9988.HK");
 return <LangProvider><SharedSearchWorkspace query={q} onQueryChange={setQ} companies={companies} companyState={companyState}
 selectedCompany={selected} activeCompanyIndex={1} onSelectCompany={setSelected} onCompanyKey={()=>{}}
 listingDetail={<span data-picked-symbol={selected}>HKEX · Trading currency HKD</span>} options={{ onOpenTool: state.opened }}/></LangProvider>;
}
it("keeps exact listing/query when tools fail and retries only the tool service",async()=>{
 state.load.mockRejectedValueOnce(new Error("chunk"));await act(async()=>root.render(<Harness/>));
 expect(host.textContent).toContain("The tool directory could not be searched.");expect(host.querySelector("input")?.value).toBe("Alibaba");
 expect(host.querySelector("[data-picked-symbol]")?.getAttribute("data-picked-symbol")).toBe("9988.HK");
 await click("Retry tools");expect(state.load).toHaveBeenCalledTimes(2);expect(host.querySelector("input")?.value).toBe("Alibaba");expect(host.textContent).toContain("HKD");
});
it("keeps tools usable when company search is unavailable and opens an exact finite destination only deliberately",async()=>{
 await act(async()=>root.render(<Harness companyState="unavailable"/>));await click("Tools");expect(host.textContent).toContain("No published tools or pages match");
 const input=host.querySelector("input")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"bonds");input.dispatchEvent(new Event("input",{bubbles:true}));});
 await click("Bonds");expect(state.opened).not.toHaveBeenCalled();await click("Open tool");expect(state.opened).toHaveBeenCalledWith("/bonds.html","bonds");
});
it("bounds a nonsettling catalog read, rejects late completion, and permits explicit retry",async()=>{
 vi.useFakeTimers();let settle!:(v:typeof catalog)=>void;state.load.mockReturnValueOnce(new Promise(r=>{settle=r;}));await act(async()=>root.render(<Harness/>));
 await act(async()=>vi.advanceTimersByTime(10001));expect(host.textContent).toContain("The tool directory could not be searched");await act(async()=>settle(catalog));expect(host.textContent).toContain("The tool directory could not be searched");
 await click("Retry tools");expect(state.load).toHaveBeenCalledTimes(2);expect(host.textContent).not.toContain("The tool directory could not be searched");
});
it("uses the single existing dialog and commits only the explicitly selected full company listing",async()=>{
 const picked=vi.fn();await act(async()=>root.render(<LangProvider><SearchModal open seed="Alibaba" mode="pick" companyScope manifest={Object.fromEntries(companies.map(r=>[r.symbol,{name:r.name,mkt:r.venue,col:"",verdict:null,sec:"Equities"}]))} inWatchlist={new Set()} onClose={()=>{}} onPick={picked} sharedSearch={{onOpenTool:state.opened}}/></LangProvider>));
 expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);expect(host.textContent).toContain("Choose a listing");
 const hk=Array.from(host.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(x=>x.textContent?.includes("9988.HK"))!;await act(async()=>hk.click());expect(picked).not.toHaveBeenCalled();await click("Open Analysis");expect(picked).toHaveBeenCalledWith("9988.HK");
});

const longDirectory = Array.from({ length: 35 }, (_, index) => ({
 href: `/tool-${index}.html`, title: { en: `Tool ${index}`, zh: `工具 ${index}` }, kind: "legacy", group: "market",
}));
function ToolsHarness({ selectedTool }: { selectedTool?: string }) {
 return <LangProvider><SharedSearchWorkspace query="" onQueryChange={()=>{}} companies={[]} companyState="ready"
  selectedCompany={null} activeCompanyIndex={-1} onSelectCompany={()=>{}} onCompanyKey={()=>{}} listingDetail={null}
  options={{ scope: "tools", selectedTool, onOpenTool: state.opened }}/></LangProvider>;
}
function listGeometry(height: number, rowHeight: number) {
 vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function(this: Element) {
  return this.getAttribute("role") === "listbox" ? height : 0;
 });
 vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
  if (this.getAttribute("role") === "listbox") return new DOMRect(20, 100, 400, height);
  if (this.getAttribute("role") === "option") {
   const list = this.parentElement!;
   const index = Array.from(list.children).indexOf(this);
   return new DOMRect(20, 100 + index * (rowHeight + 8) - list.scrollTop, 400, rowHeight);
  }
  return new DOMRect();
 });
 state.load.mockResolvedValue({ sharedShellDirectory: longDirectory, sharedShellCatalog: { nativePaths: [], legacyPaths: longDirectory.map(row=>row.href) } });
}
function visibleActive(input: HTMLInputElement) {
 const option = document.getElementById(input.getAttribute("aria-activedescendant")!)!;
 expect(option).toBeTruthy();
 const bounds = option.getBoundingClientRect();
 const list = option.parentElement!.getBoundingClientRect();
 expect(bounds.top).toBeGreaterThanOrEqual(list.top);
 expect(bounds.bottom).toBeLessThanOrEqual(list.bottom);
 return option;
}
it.each([{ height: 340, row: 80 }, { height: 220, row: 72 }])("keeps keyboard Tools selection visible in its own $height-pixel list without moving focus or opening", async({ height, row })=>{
 listGeometry(height, row);await act(async()=>root.render(<ToolsHarness/>));
 const input=host.querySelector("input")!;input.focus();host.scrollTop=17;
 const options=host.querySelectorAll('[role="option"]');expect(options).toHaveLength(30);
 for(let n=0;n<9;n++) {
  await act(async()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true})));
  expect(visibleActive(input)).toBe(options[n]);expect(document.activeElement).toBe(input);
 }
 expect(options[0].parentElement!.scrollTop).toBeGreaterThan(0);
 for(let n=7;n>=0;n--) {
  await act(async()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true,cancelable:true})));
  expect(visibleActive(input)).toBe(options[n]);expect(document.activeElement).toBe(input);
 }
 expect(host.scrollTop).toBe(17);expect(state.opened).not.toHaveBeenCalled();
 await act(async()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true})));
 expect(state.opened).toHaveBeenCalledTimes(1);expect(state.opened).toHaveBeenCalledWith("/tool-0.html","");
});
it("reveals a deep restored Tool once the catalog arrives without changing its destination",async()=>{
 listGeometry(220,72);await act(async()=>root.render(<ToolsHarness selectedTool="/tool-12.html"/>));
 const input=host.querySelector("input")!;
 expect(visibleActive(input)).toBe(host.querySelectorAll('[role="option"]')[12]);
 expect(state.opened).not.toHaveBeenCalled();
 await act(async()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true})));
 expect(state.opened).toHaveBeenCalledTimes(1);expect(state.opened).toHaveBeenCalledWith("/tool-12.html","");
});
