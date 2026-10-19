import { describe, expect, it } from "vitest";
import type { ModuleCtx, SuiteBar, SuiteColors } from "@/lib/indicator-canvas/types";
import { computeUltimateRsi, sharedRsi } from "@/lib/suites/rsix/rsiEngine";

const colors: SuiteColors = {
  up:"#26c281",down:"#f0566b",flowBuy:"#22b8d5",flowSell:"#a92cce",
  warn:"#e8a33d",brand:"#4d82ff",text:"#d6dae3",muted:"#717a8e",neutral:"#4a5468",
};
const bars: SuiteBar[] = Array.from({length:80},(_,i)=>{
  const c=100+Math.sin(i/4)*3+i*.07;
  return {t:1700000000+i*86400,o:c-.2,h:c+.7,l:c-.8,c,v:1000+i};
});
function ctx(pass: ModuleCtx["suite"], rows=bars): ModuleCtx {
  return {bars:rows,tf:"1D",symbol:"TEST",isIntraday:false,s:{},suite:pass,colors,lang:"en"};
}

describe("RSI pass-scoped shared kernel",()=>{
  it("reuses one RSI pair across module contexts in the same suite pass without polluting settings",()=>{
    const pass:ModuleCtx["suite"]={
      "eng.len":14,"eng.source":"close","eng.smooth":true,"eng.smoothLen":14,"eng.smoothType":"ema",
    };
    const keysBefore=Object.keys(pass);
    const jsonBefore=JSON.stringify(pass);
    const a=sharedRsi(ctx(pass));
    const b=sharedRsi({...ctx(pass),s:{threshold:65}});
    expect(b).toBe(a);
    expect(b.rsi).toBe(a.rsi);
    expect(b.smooth).toBe(a.smooth);
    expect(Object.keys(pass)).toEqual(keysBefore);
    expect(JSON.stringify(pass)).toBe(jsonBefore);
  });

  it("misses when bars or engine settings change, and stays bit-identical to direct computation",()=>{
    const pass:ModuleCtx["suite"]={
      "eng.len":14,"eng.source":"close","eng.smooth":true,"eng.smoothLen":14,"eng.smoothType":"ema",
    };
    const a=sharedRsi(ctx(pass));
    const copied=bars.map(b=>({...b}));
    const b=sharedRsi(ctx(pass,copied));
    expect(b).not.toBe(a);
    expect([...b.rsi]).toEqual([...a.rsi]);

    pass["eng.len"]=9;
    const c=sharedRsi(ctx(pass,copied));
    expect(c).not.toBe(b);
    const direct=computeUltimateRsi(copied,9,"close",14,"ema");
    expect([...c.rsi]).toEqual([...direct.rsi]);
    expect([...c.smooth]).toEqual([...direct.smooth]);
  });
});
