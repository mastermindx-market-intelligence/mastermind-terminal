// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VolTermPanel } from "@/components/vol/VolTermPanel";
import { VolSkewPanel } from "@/components/vol/VolSkewPanel";
import { VolHistoryPanel } from "@/components/vol/VolHistoryPanel";
import { finiteSegments, fmtPct } from "@/components/vol/volShared";
import type { VolTermRow, VolSmilePoint } from "@/components/vol/volTypes";
vi.mock("@/components/ui/Tip", () => ({ Tip: ({children}: {children: React.ReactNode}) => <>{children}</> }));
let el: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); el=document.createElement("div"); document.body.append(el); root=createRoot(el); });
afterEach(async()=>{ await act(async()=>root.unmount()); el.remove(); vi.restoreAllMocks(); });
async function render(v:React.ReactNode) { await act(async()=>root.render(v)); }
const term=(ivs:Array<number|null|undefined>)=>ivs.map((atm_iv,i)=>({dte:[7,14,21,28,56,84][i],exp:["2026-10-02","2026-10-09","2026-10-16","2026-10-23","2026-11-20","2026-12-18"][i],atm_iv})) as VolTermRow[];
const history=(values:Array<number|null>)=>values.map((atm_iv,i)=>({date:`2026-09-${String(i+1).padStart(2,"0")}`,atm_iv,iv_rank:null,close:null}));
const paths=(stroke="var(--brand-2)")=>[...el.querySelectorAll<SVGPathElement>("path")].filter(p=>p.getAttribute("stroke")===stroke);
const dots=(fill="var(--brand-2)")=>[...el.querySelectorAll("circle")].filter(p=>p.getAttribute("fill")===fill);
const smile=(points:VolSmilePoint[])=>[{exp:"2026-10-23",points}];
const point=(strike:number,c:number|null,q:number|null)=>({strike,call_iv:c,put_iv:q});

describe("term source observations",()=>{
 it("null ATM IV is not a plotted zero",async()=>{await render(<VolTermPanel term={term([12, null, 14])} lang="en"/>);expect(dots()).toHaveLength(2);});
 it("an explicit missing expiry breaks the line instead of disappearing",async()=>{await render(<VolTermPanel term={term([12,13,undefined,14,15,16])} lang="en"/>);expect(paths()).toHaveLength(2);expect(paths().map(p=>(p.getAttribute("d")!.match(/L/g)||[]).length)).toEqual([1,2]);});
 it("an invalid dte is not coerced into a 0DTE observation",async()=>{const rows=term([12,13,14]);(rows[0] as unknown as {dte:unknown}).dte=null;await render(<VolTermPanel term={rows} lang="en"/>);expect(dots()).toHaveLength(2);});
 it("all-null values do not create a zero-volatility curve",async()=>{await render(<VolTermPanel term={term([null,null,null])} lang="en"/>);expect(el.querySelector("svg")).toBeNull();});
 it("invalid calendar expiries cannot become term coordinates",async()=>{const rows=term([12,13]);rows[0].exp="2026-02-30";await render(<VolTermPanel term={rows} lang="en"/>);expect(dots()).toHaveLength(1);});
 it("duplicate term expiry identities are quarantined rather than arbitrarily won",async()=>{const rows=term([12,13,14]);rows.push({...rows[1],atm_iv:99});await render(<VolTermPanel term={rows} lang="en" onSelectExp={()=>undefined}/>);expect(el.querySelector('button[data-expiry="2026-10-09"]')).toBeNull();expect(dots()).toHaveLength(2);});
 it("an isolated long-dated finite point remains visible after a missing gap",async()=>{await render(<VolTermPanel term={term([12,13,14,null,null,16])} lang="en"/>);expect(dots()).toHaveLength(4);expect(paths()).toHaveLength(2);});
 it("numeric zero is preserved when genuinely supplied",async()=>{await render(<VolTermPanel term={term([0,12])} lang="en"/>);expect(dots()).toHaveLength(2);expect(el.textContent).toContain("0%");});
 it("a single supplied observation remains visible as a point",async()=>{await render(<VolTermPanel term={term([12.8])} lang="en"/>);expect(dots()).toHaveLength(1);expect(paths()[0].getAttribute("d")).not.toContain("L");});
 it.each(["en","zh"] as const)("term differences state actual tenors in %s",async(lang)=>{await render(<VolTermPanel term={term([12.8,13.3,null,14.6,16.1,16.9])} lang={lang}/>);expect(el.textContent).toContain(lang==="en"?"7→28d +1.8 pts":"7→28天 +1.8 点");expect(el.textContent).toContain(lang==="en"?"28→84d +2.3 pts":"28→84天 +2.3 点");expect(el.textContent).not.toContain("0→30");});
 it("a missing front source point cannot manufacture a term-shape verdict",async()=>{await render(<VolTermPanel term={term([null,13,14,15,16,17])} lang="en"/>);expect(el.textContent).not.toContain("Contango");});
 it("complete supplied data keeps the full line and neutral shape",async()=>{await render(<VolTermPanel term={term([12,13,14,15,16,17])} lang="en"/>);expect(paths()).toHaveLength(1);expect(el.textContent).toContain("Contango");expect(paths()[0].getAttribute("d")?.match(/L/g)).toHaveLength(5);});
 it("exposes every admitted term expiry through one compact exact-expiry selector",async()=>{const onSelect=vi.fn();await render(<VolTermPanel term={term([12.8,13.3,null,14.6])} lang="en" selectedExp="2026-10-23" onSelectExp={onSelect}/>);const select=el.querySelector<HTMLSelectElement>('[data-testid="term-expiry-select"]')!;expect(select).toBeTruthy();expect(select.options).toHaveLength(4);expect(select.value).toBe("2026-10-23");expect([...select.options].find(o=>o.value==="2026-10-16")?.textContent).toContain("21D · ATM IV unavailable");await act(async()=>{select.value="2026-10-16";select.dispatchEvent(new Event("change",{bubbles:true}));});expect(onSelect).toHaveBeenCalledTimes(1);expect(onSelect).toHaveBeenCalledWith("2026-10-16");});
});

describe("smile per-side missingness",()=>{
 const points=()=>[point(80,24,26),point(90,22,25),point(100,20,20),point(110,null,22),point(120,23,25)];
 it("a missing call is not a zero call and the put remains visible",async()=>{await render(<VolSkewPanel smile={smile(points())} lang="en"/>);expect(dots()).toHaveLength(4);expect(dots("var(--ai)")).toHaveLength(5);});
 it("a missing call separates its segments without splitting the put series",async()=>{await render(<VolSkewPanel smile={smile(points())} lang="en"/>);expect(paths()).toHaveLength(2);expect(paths("var(--ai)")).toHaveLength(1);});
 it("proxy skew cannot interpolate across an explicitly missing leg",async()=>{await render(<VolSkewPanel smile={smile(points())} lang="en"/>);expect(el.textContent).not.toContain("95–105%");});
 it("an entirely unknown smile remains unavailable",async()=>{await render(<VolSkewPanel smile={smile([point(90,null,null),point(100,null,null),point(110,null,null)])} lang="en"/>);expect(el.querySelector("svg")).toBeNull();});
 it("null/blank/boolean strikes are not invented price coordinates",async()=>{const values=[point(90,20,21),point(100,19,20),{strike:null,call_iv:12,put_iv:13},{strike:"",call_iv:12,put_iv:13},{strike:false,call_iv:12,put_iv:13}] as unknown as VolSmilePoint[];await render(<VolSkewPanel smile={smile(values)} lang="en"/>);expect(dots()).toHaveLength(2);});
 it("invalid calendar expiry does not become a selectable series",async()=>{await render(<VolSkewPanel smile={[{exp:"2026-02-30",points:[point(90,20,21),point(100,19,20)]}]} lang="en"/>);expect(el.querySelector("svg")).toBeNull();expect(el.querySelectorAll("button")).toHaveLength(0);});
 it("duplicate smile expiry identities are quarantined",async()=>{const row={exp:"2026-10-23",points:[point(90,20,21),point(100,19,20)]};await render(<VolSkewPanel smile={[row,{...row,points:[point(90,80,81),point(100,79,80)]}]} lang="en"/>);expect(el.querySelector("svg")).toBeNull();expect(el.querySelectorAll("button")).toHaveLength(0);});
 it("duplicate strike identities stay explicit gaps and never enter proxy math",async()=>{await render(<VolSkewPanel smile={smile([point(90,20,21),point(100,19,20),point(100,90,91),point(110,21,22)])} lang="en"/>);expect(el.textContent).toContain("1 conflicting strike unavailable");expect(el.textContent).not.toContain("95–105%");const full=[...el.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent?.includes("Full supplied range"))!;await act(async()=>full.click());expect(dots()).toHaveLength(2);expect(dots("var(--ai)")).toHaveLength(2);expect(paths()).toHaveLength(2);expect(paths("var(--ai)")).toHaveLength(2);expect(paths().every(path=>!(path.getAttribute("d")??"").includes("L"))).toBe(true);});
 it("one valid leg observation remains inspectable as a point",async()=>{await render(<VolSkewPanel smile={smile([point(100,20,null)])} lang="en"/>);expect(dots()).toHaveLength(1);expect(dots("var(--ai)")).toHaveLength(0);});
 it("genuine zero stays zero, never added to the other missing side",async()=>{await render(<VolSkewPanel smile={smile([point(90,0,null),point(100,0,null)])} lang="en"/>);expect(dots()).toHaveLength(2);expect(dots("var(--ai)")).toHaveLength(0);});
 it("complete call and put curves remain available",async()=>{await render(<VolSkewPanel smile={smile([point(90,22,23),point(100,20,20),point(110,21,22)])} lang="en"/>);expect(paths()).toHaveLength(1);expect(paths("var(--ai)")).toHaveLength(1);expect(dots()).toHaveLength(3);expect(dots("var(--ai)")).toHaveLength(3);});
 it("does not substitute another smile when the parent selects an unavailable expiry",async()=>{const onSelect=vi.fn();const rows=[{exp:"2026-10-23",points:[point(90,22,23),point(100,20,20)]},{exp:"2026-11-20",points:[point(90,24,25),point(100,21,22)]}];await render(<VolSkewPanel smile={rows} lang="en" selectedExp="2026-10-16" onSelectExp={onSelect}/>);expect(el.querySelector("svg")).toBeNull();expect(el.textContent).toContain("No smile for the selected expiry");expect(el.textContent).toContain("2026-10-16 has no supplied per-strike IV series");const available=[...el.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent?.includes("2026-11-20"))!;await act(async()=>available.click());expect(onSelect).toHaveBeenCalledWith("2026-11-20");});
});

describe("history coverage counts observations, not null conversions",()=>{
 it("nine observations plus a null cannot satisfy the existing ten-observation threshold",async()=>{await render(<VolHistoryPanel history={history([12,13,14,15,16,null,17,18,19,20])} iv52wHi={null} iv52wLo={null} lang="en"/>);expect(el.querySelector("svg")).toBeNull();});
 it("explicit null splits a sufficiently populated history",async()=>{await render(<VolHistoryPanel history={history([12,13,14,15,16,null,17,18,19,20,21])} iv52wHi={null} iv52wLo={null} lang="en"/>);expect(paths()).toHaveLength(2);expect(el.textContent).toContain("10 sessions");});
 it("an impossible calendar day cannot provide the missing tenth observation",async()=>{const rows=history([12,13,14,15,16,17,18,19,20]);rows.push({date:"2026-02-30",atm_iv:12,iv_rank:null,close:null});await render(<VolHistoryPanel history={rows} iv52wHi={null} iv52wLo={null} lang="en"/>);expect(el.querySelector("svg")).toBeNull();});
 it("duplicate dates cannot inflate history coverage",async()=>{const rows=history([12,13,14,15,16,17,18,19,20]);rows.push({...rows[0],atm_iv:99},{date:"2026-09-10",atm_iv:21,iv_rank:null,close:null});await render(<VolHistoryPanel history={rows} iv52wHi={null} iv52wLo={null} lang="en"/>);expect(el.querySelector("svg")).toBeNull();});
 it("a complete history and real zero retain ten observations",async()=>{await render(<VolHistoryPanel history={history([0,12,13,14,15,16,17,18,19,20])} iv52wHi={null} iv52wLo={null} lang="en"/>);expect(paths()).toHaveLength(1);expect(el.textContent).toContain("10 sessions");});
 it("single unavailable side does not inject non-finite SVG attributes",async()=>{await render(<VolSkewPanel smile={smile([point(90,null,20),point(100,15,18),point(110,19,null)])} lang="zh"/>);expect(el.innerHTML).not.toMatch(/(?:NaN|Infinity)/);});
 it("retains the existing finite segmentation and zero formatting primitives",()=>{expect(finiteSegments([1,2,NaN,3],x=>x)).toEqual([[1,2],[3]]);expect(fmtPct(0)).toBe("0.0%");expect(fmtPct(null)).toBe("—");});
});
