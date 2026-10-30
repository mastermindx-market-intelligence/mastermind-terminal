import {describe,it,expect} from "vitest";
import {isExtQuoteCurrent,extQuotePollMs} from "@/lib/extQuoteFreshness";
const now=Date.UTC(2026,9,12,0,1);
const row={extSource:"tiingo_boats",extBasis:"LIVE",extVenue:"BOATS",extPriceKind:"LAST_TRADE",
 extSession:"overnight",extTs:now/1000,extReceivedTs:now/1000,extPublishedTs:now/1000,extExpiresTs:now/1000+30};
describe("BOATS client/API freshness",()=>{
 it("preserves existing provider policy",()=>expect(isExtQuoteCurrent({extSource:"yahoo-relay"},now)).toBe(true));
 it("accepts a qualified current trade and expires it without another network read",()=>{
  expect(isExtQuoteCurrent(row,now)).toBe(true);
  expect(isExtQuoteCurrent(row,now+30_000)).toBe(false);
 });
 it.each(["extBasis","extVenue","extPriceKind","extSession","extReceivedTs","extPublishedTs","extExpiresTs"])("does not infer missing %s",field=>{
  const q={...row};delete q[field as keyof typeof q];expect(isExtQuoteCurrent(q,now)).toBe(false);
 });
 it("rejects future clocks and a publication clock that rejuvenates an old trade",()=>{
  expect(isExtQuoteCurrent({...row,extTs:now/1000+1},now)).toBe(false);
  expect(isExtQuoteCurrent({...row,extTs:now/1000-31},now)).toBe(false);
  expect(isExtQuoteCurrent({...row,extExpiresTs:now/1000+100},now)).toBe(false);
 });
 it("polls within the overnight budget and keeps pre/post polling unchanged",()=>{
  expect(extQuotePollMs(now)).toBe(5_000);
  expect(extQuotePollMs(Date.UTC(2026,9,12,12))).toBe(30_000);
 });
});
