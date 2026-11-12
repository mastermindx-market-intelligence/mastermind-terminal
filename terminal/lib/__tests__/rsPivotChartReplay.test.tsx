// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RSPivotChart from "@/components/workspaces/RSPivotChart";
import type { StudyReport, StudyTrade } from "../rsPivotStudy";
import type { Bar6 } from "../intradayShared";

const { markers } = vi.hoisted(() => ({ markers: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("@/lib/chart-engine", () => ({ createEngine: () => ({
  addSeries: () => ({ setData: vi.fn(), setMarkers: markers, createPriceLine: vi.fn() }),
  panes: () => [], timeScale: () => ({ fitContent: vi.fn() }), applyOptions: vi.fn(), resize: vi.fn(), destroy: vi.fn(),
}) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  markers.mockClear(); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host=document.createElement("div"); document.body.append(host); root=createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("does not reveal the next open-gap exit on the preceding candle's completed close", async () => {
  const t=Date.parse("2026-09-08T10:00:00Z")/1000;
  const bars:Bar6[]=[[t,100,102,99,101,10],[t+1800,101,102,100,101,10],[t+3600,98,99,97,98,10]];
  const trade={signalBarAt:t,signalAt:t+1800,entryAt:t+1800,exitBarAt:t+3600,exitAt:t+3600,exitTiming:"open",entry:101,stop:99,target:105,confirmedAt:null,pivotAt:null} as StudyTrade;
  const report={rsPath:[],lastCompleted:null} as unknown as StudyReport;
  await act(async () => root.render(<RSPivotChart bars={bars} report={report} trade={trade} />));
  expect(markers.mock.lastCall![0].some((m:{text:string})=>m.text==="Hypothetical exit")).toBe(true);
  const slider=host.querySelector<HTMLInputElement>('input[type="range"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(slider,"1");
    slider.dispatchEvent(new Event("input",{bubbles:true}));
  });
  const observed=markers.mock.lastCall![0] as {time:number;text:string}[];
  expect(observed.some(m=>m.text==="Hypothetical open entry")).toBe(true);
  expect(observed.some(m=>m.text==="Hypothetical exit")).toBe(false);
  expect(observed.every(m=>m.time<=t+1800)).toBe(true);
});
