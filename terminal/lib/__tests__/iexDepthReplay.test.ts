import { describe, expect, it } from "vitest";
import { validateLargeTradesEnvelope } from "../largeTrades/engine";
import { parseIexDepthEnvelope, iexExecutionProfile, iexDepthPriceRange } from "../iexDepthReplay";
import fixture from "./fixtures/iexDepthReplay.synthetic.json";
const copy = () => structuredClone(fixture);

describe("IEX depth extends the incumbent execution envelope without a second source", () => {
  it("validates a synthetic native-decoder output while retaining exact equity units", () => {
    const value = parseIexDepthEnvelope(fixture, "SPY");
    expect(value).not.toBeNull();
    expect(value?.instrument.priceScale).toBe(10000);
    expect(value?.instrument.quantityUnit).toBe("shares");
    expect(value?.depthReplay.samples).toHaveLength(5);
    expect(validateLargeTradesEnvelope(fixture)).toBe(true);
  });
  it("preserves sampled price rather than rounding it to a futures quarter tick", () => {
    const data = parseIexDepthEnvelope(fixture, "SPY")!;
    expect(data.depthReplay.samples[1].asks[0].priceInt).toBe(1000100);
    expect(iexExecutionProfile(data, data.depthReplay.samples[1]).rows.find(r => r.unknown === 30)?.priceInt).toBe(1000150);
  });
  it("reuses observed correction accounting without restoring the filled book", () => {
    const data = parseIexDepthEnvelope(fixture, "SPY")!;
    expect(data.depthReplay.samples.map(p => iexExecutionProfile(data, p).volume)).toEqual([50,80,90,110,60]);
    expect(data.depthReplay.samples[3].bidTotal).toBe(60);
    expect(data.depthReplay.samples[4].bidTotal).toBe(60);
    const last = iexExecutionProfile(data,data.depthReplay.samples[4]);
    expect(last.unknown).toBe(40);
    expect(last.rows.reduce((n,r) => n+r.total,0)).toBe(last.volume);
  });
  it("does not include a later-sequence execution with an older native timestamp", () => {
    const raw = copy();
    raw.prints.push({ ...raw.prints[0], id:"late-old-clock", sourceSequence:"99999", quantity:999 });
    const data = parseIexDepthEnvelope(raw,"SPY")!;
    expect(iexExecutionProfile(data,data.depthReplay.samples[0]).volume).toBe(50);
  });
  it("does not fabricate missing depth or confuse a source gap with an empty observed book", () => {
    const raw = copy();
    expect(raw.depthReplay.samples[2].status).toBe("unavailable");
    expect(raw.depthReplay.samples[2].asks).toEqual([]);
    delete (raw as Partial<typeof raw>).depthReplay;
    expect(validateLargeTradesEnvelope(raw)).toBe(true);
    expect(parseIexDepthEnvelope(raw,"SPY")).toBeNull();
  });
  it("rejects symbol, source hash, measurement or price-scale drift", () => {
    for (const patch of [{ symbol:"QQQ" }, { sourceSha256:"b".repeat(64) }, { measurement:"time_weighted" }, { priceScale:4 }]) {
      const raw = copy(); Object.assign(raw.depthReplay,patch);
      expect(parseIexDepthEnvelope(raw,"SPY")).toBeNull();
    }
    expect(parseIexDepthEnvelope(fixture,"QQQ")).toBeNull();
  });
  it("rejects future or misbound archive clocks, regressed sequences and mixed streams", () => {
    for (const patch of [
      { availableNs:"1" }, { transportSendNs:"9999999999999999999" },
      { marketNs:"1" }, { sourceSequence:"0" }, { session:"20261005.8005.00000002.0000007b" },
    ]) {
      const raw=copy(); Object.assign(raw.depthReplay.samples[1],patch);
      expect(parseIexDepthEnvelope(raw,"SPY")).toBeNull();
    }
  });
  it("rejects malformed, duplicate, reversed or impossible level quantities", () => {
    for(const kind of ["duplicate","negative","sum","unknown"]){
      const raw=copy();const point=raw.depthReplay.samples[0];
      if(kind==="duplicate")point.asks = [...point.asks, { priceInt:1000000, quantity:150 }];
      if(kind==="negative")point.asks[0].quantity=-1;
      if(kind==="sum")point.askTotal=2;
      if(kind==="unknown")point.status="unavailable";
      expect(parseIexDepthEnvelope(raw,"SPY")).toBeNull();
    }
  });
  it("refuses unbounded arrays, undefined metadata and an empty snapshot list", () => {
    const raw=copy();raw.depthReplay.samples=[];
    expect(parseIexDepthEnvelope(raw,"SPY")).toBeNull();
    raw.depthReplay.samples=Array.from({length:2001},()=>fixture.depthReplay.samples[0]);
    expect(parseIexDepthEnvelope(raw,"SPY")).toBeNull();
  });
});

describe("historical price viewport",()=>{
  it("focuses observed top without throwing away distant source orders",()=>{
    const data=parseIexDepthEnvelope(fixture,"SPY")!;const p=structuredClone(data.depthReplay.samples[0]);
    p.bids=[{priceInt:999900,quantity:100},{priceInt:300000,quantity:100}];p.asks=[{priceInt:1000100,quantity:100}];
    expect(iexDepthPriceRange([p],"near")).toEqual([99,101]);
    expect(iexDepthPriceRange([p],"all")).toEqual([30,100.01]);
    expect(p.bids).toHaveLength(2);
  });
  it("does not use a future snapshot to frame an earlier cursor",()=>{
    const data=parseIexDepthEnvelope(fixture,"SPY")!;
    expect(iexDepthPriceRange([data.depthReplay.samples[0]],"near")).toEqual([99,101]);
    const p=structuredClone(data.depthReplay.samples[0]);p.asks=[];
    expect(iexDepthPriceRange([p],"near")).toBeNull();
  });
});
