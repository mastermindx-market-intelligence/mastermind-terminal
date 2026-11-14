// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { parseCycleModel } from "../flagshipCycle";
import { CycleReading } from "@/components/workspaces/CycleIntelligence";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({lang:"en"}) }));
vi.mock("@/components/settings/SettingsProvider", () => ({ useSettings: () => ({}) }));
vi.mock("@/components/onboarding/OnboardingProvider", () => ({ useOnboarding: () => ({}) }));
vi.mock("@/lib/shared-shell/useReadingScope", () => ({ useReadingScope: () => ({}),readingJson:vi.fn() }));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const frame = { band:"secular", tier:"frame", turns:[{t:"2025-01",k:"trough",e:"Historical entry"}] };
const measured = { band:"intermediate",tier:"measured",freq:"D",series_last:"2026-03-03",
  osc:[{x:2025,v:30},{x:2026,v:60}], turns:[{date:"2025-05-06",k:"peak",provisional:false},
    {date:"2026-03-02",k:"trough",provisional:true}],proj:{low:"2026-05",central:"2026-06",high:"2026-08",nextTurn:"peak"} };
const sample = {version:1,order:["gold","shipping"],notes_as_of:"2026-01-01",tape_as_of:"2026-03-03",
  cycles:{gold:{id:"gold",short:"Gold",bands:[measured,frame]},shipping:{id:"shipping",short:"Shipping",bands:[frame]}}};
it("keeps curated turns separate from observations and preserves monthly grain",()=>{
  const data=parseCycleModel(sample)!;
  expect(data.cards[0].bands[0].turns.map(x=>x.tentative)).toEqual([false,true]);
  expect(data.cards[1].bands[0]).toMatchObject({tier:"frame",projection:null,osc:[],turns:[{tentative:null}]});
  const broken=structuredClone(sample);broken.order.push("gold");expect(parseCycleModel(broken)).toBeNull();
  const month={...measured,freq:"M",turns:[{date:"2026-03-31",t:"2026-03",k:"peak",provisional:false}]};
  expect(parseCycleModel({...sample,cycles:{...sample.cycles,gold:{...sample.cycles.gold,bands:[month]}}})?.cards[0].bands[0].turns[0].date).toBe("2026-03");
});
it("restores a selected turn and a frame-only cycle through their URL selections",async()=>{
  const host=document.createElement("div"),root=createRoot(host),model=parseCycleModel(sample)!;
  document.body.append(host);
  try {
    window.history.replaceState(null,"","/cycle-intelligence?cycle=gold&turn=2025-05-06");
    await act(async()=>root.render(<CycleReading model={model}/>));
    expect(host.textContent).toContain("Confirmed Peak");expect(host.textContent).toContain("2026-05 – 2026-08");
    const pick=host.querySelector("select")!;
    await act(async()=>{pick.value="shipping";pick.dispatchEvent(new Event("change",{bubbles:true}));root.render(<CycleReading model={model}/>);});
    expect(window.location.search).toBe("?cycle=shipping");expect(host.textContent).toContain("Historical entry");
    expect(host.querySelector("svg")).toBeNull();
  }finally{await act(async()=>root.unmount());host.remove();window.history.replaceState(null,"","/");}
});
