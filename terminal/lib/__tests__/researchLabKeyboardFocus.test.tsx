// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OptionsResearchLab } from "@/components/researchlab/OptionsResearchLab";
vi.mock("next/dynamic", () => ({ default: () => () => <span>3D renderer</span> }));
const matrix = { schema: "options_structure.matrix/v1", root: "SPY", asof: "2026-10-06T02:00:00Z", _build_meta: { asof_date: "2026-10-05" }, cells: [{ strike: 785, expiry: "2026-10-09", gex: -100, call_vol: 243000, call_oi: 110000, put_vol: 0, put_oi: null }] };
let node: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); node = document.createElement("div"); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
const mount = async (instrument = "SPY", data: unknown = matrix) => act(async () => root.render(<OptionsResearchLab root={instrument} matrix={data} lang="en" onClose={() => {}} />));
async function click(text: string) { const button = [...node.querySelectorAll("button")].find(b => b.textContent === text); expect(button).toBeDefined(); await act(async () => button!.click()); }

it("restores focus when source withdrawal removes the focused inspector action", async()=>{
 await mount(); await click("785 Call · 2026-10-09");
 const control=[...node.querySelectorAll("button")].find(b=>b.textContent==="Dismiss selection")!;
 await act(async()=>control.focus()); expect(document.activeElement).toBe(control);
 await mount("SPY",null); expect(control.isConnected).toBe(false);
 expect(document.activeElement).toBe(node.querySelector("header button"));
});
it("restores focus when source withdrawal removes the focused table row", async()=>{
 await mount(); const control=node.querySelector("tbody button") as HTMLElement;
 await act(async()=>control.focus()); await mount("SPY",null);
 expect(control.isConnected).toBe(false); expect(document.activeElement).toBe(node.querySelector("header button"));
});
it("does not steal focus from outside Lab when source withdraws", async()=>{
 await mount(); await click("785 Call · 2026-10-09");
 const control=[...node.querySelectorAll("button")].find(b=>b.textContent==="Dismiss selection")!;
 const external=document.createElement("button");document.body.append(external);
 await act(async()=>{control.focus();external.focus();});await mount("SPY",null);
 expect(document.activeElement).toBe(external);external.remove();
});
it("preserves surviving lens focus when source withdraws", async()=>{
 await mount(); await click("785 Call · 2026-10-09");
 const control=[...node.querySelectorAll("button")].find(b=>b.textContent==="Scenario lab")!;
 await act(async()=>control.focus());await mount("SPY",null);expect(document.activeElement).toBe(control);
});

it("restores the stable control for Chinese source withdrawal too", async()=>{
 await act(async()=>root.render(<OptionsResearchLab root="SPY" matrix={matrix} lang="zh" onClose={()=>{}} />));
 const control=node.querySelector("tbody button") as HTMLElement; await act(async()=>control.focus());
 await act(async()=>root.render(<OptionsResearchLab root="SPY" matrix={null} lang="zh" onClose={()=>{}} />));
 expect(document.activeElement).toBe(node.querySelector("header button"));
});
it("retains keyboard focus on a surviving selected coordinate after a value refresh", async()=>{
 await mount();const control=node.querySelector("tbody button") as HTMLElement;await act(async()=>control.focus());
 await mount("SPY",{...matrix,cells:[{...matrix.cells[0],call_vol:100}]});expect(document.activeElement).toBe(control);
});
