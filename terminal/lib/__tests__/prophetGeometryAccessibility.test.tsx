// @vitest-environment jsdom
import React, {act} from "react";
import {createRoot} from "react-dom/client";
import {it, expect} from "vitest";
import {GeometryRail} from "@/components/prophet/GeometryRail";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true});
for (const lang of ["en","zh"] as const) for (const direction of ["BULL","BEAR"] as const) {
  it(`${lang} ${direction}: decorative price ticks are hidden while all price labels remain exposed`, async () => {
    const el = document.createElement("div"); document.body.append(el); const root=createRoot(el);
    try {
      await act(async()=>root.render(<GeometryRail direction={direction} entry={74.43} stop={66.55} last={74.10} t1={86.25} t2={98.07} lang={lang} geometry={{dist_to_stop_r:1,dist_to_t1_r:1.5,horizon_pct_used:42}}/>));
      const rail=el.querySelector('[data-testid="geometry-rail"]')!;
      expect(rail).toBeTruthy();
      // Naming generic decorative divs is prohibited; keep the visible equivalent.
      expect(rail.querySelectorAll("div[aria-label]:not([role])").length).toBe(0);
      const labels=[...rail.querySelectorAll('[data-testid="geometry-label"]')];
      expect(labels).toHaveLength(5);
      const names=lang==="en"?["STOP","LAST","ENTRY","T1","T2"]:["止损","现价","入场","T1","T2"];
      const prices=["66.55","74.10","74.43","86.25","98.07"];
      labels.forEach((label,index)=>{
        expect(label.getAttribute("data-level")).toBe(names[index]);
        expect(label.textContent).toBe(names[index]+"$"+prices[index]);
        expect(label.closest('[aria-hidden="true"]')).toBeNull();
      });
      const ticks=[...rail.querySelectorAll('div[aria-hidden="true"]')];
      expect(ticks).toHaveLength(5);
      expect(ticks.every(t=>!t.hasAttribute("aria-label")&&!t.hasAttribute("tabindex")&&t.textContent==="")).toBe(true);
      ticks.forEach((tick,index)=>expect(parseFloat((tick as HTMLElement).style.bottom)).toBeCloseTo([0,23.95304568527918,25,62.5,100][index],10));
      expect(rail.textContent).toContain("R/R 1.50");
      expect(rail.textContent).toContain("42%");
    } finally {await act(async()=>root.unmount());el.remove();}
  });
}
