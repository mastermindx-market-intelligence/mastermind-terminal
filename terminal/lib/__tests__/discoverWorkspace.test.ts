import { describe, expect, it } from "vitest";
import { DEFAULT_DISCOVER_COLUMNS, DISCOVER_CURRENT_KEY, discoverViewKey, moveDiscoverColumn, parseDiscoverView, readDiscoverPreferences, scopeDiscoverWrite, sameDiscoverValue } from "@/lib/discoverWorkspace";
import { TECH_DEFAULT_CONTROLS } from "@/lib/technicalScreenControls";
import { scopeAccountWrite } from "@/lib/accountPrefs";
import { discoverRegularReading, discoverOvernightReading } from "@/lib/discoverQuotes";
const id = "a".repeat(32);
const view = () => ({schema:1,id,name:"My view",columns:DEFAULT_DISCOVER_COLUMNS,density:"c",sort:{k:"dv",dir:-1},filters:{market:"all",signal:"any",uptrend:false,move:"any"},search:"",technical:TECH_DEFAULT_CONTROLS,fundamental:[]});
describe("Discover workspace contract",()=>{
  it("keeps identity pinned while moving optional columns in either direction",()=>{
    expect(moveDiscoverColumn(DEFAULT_DISCOVER_COLUMNS,"verdict","last")).toEqual(["sym","regimeBull","last","verdict","chg","dv","mcap","gics"]);
    expect(moveDiscoverColumn(DEFAULT_DISCOVER_COLUMNS,"sym","last")).toEqual(DEFAULT_DISCOVER_COLUMNS);
    expect(moveDiscoverColumn(DEFAULT_DISCOVER_COLUMNS,"last","sym")).toEqual(DEFAULT_DISCOVER_COLUMNS);
    expect(parseDiscoverView({...view(),columns:["chg","chg"]})?.columns).toEqual(["sym","chg"]);
    expect(parseDiscoverView({...view(),columns:["sym","future_metric"]})).toBeNull();
  });
  it("round-trips technical thresholds, chips, fundamentals and all-market scope",()=>{
    const source={...view(),showAllMarkets:true,columns:["sym","technical","fund:fund.pe_ttm"],technical:{...TECH_DEFAULT_CONTROLS,barsMax:3,chips:["weeklyBull","above200"]},fundamental:[{field:"fund.pe_ttm",op:"range",gte:0,lte:30}]};
    const parsed=parseDiscoverView(source)!;
    expect(parsed.technical).toEqual(source.technical);expect(parsed.fundamental).toEqual(source.fundamental);expect(parsed.showAllMarkets).toBe(true);
    expect(parseDiscoverView(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });
  it.each([{move:"bad"},{market:"mars"},{signal:"trade-now"},{liq:-1},{futureFilter:true}])("refuses invalid filters instead of widening the screen: %j",filters=>{
    expect(parseDiscoverView({...view(),filters})).toBeNull();
  });
  it("refuses unknown technical predicates and fundamental fields",()=>{
    expect(parseDiscoverView({...view(),technical:{...TECH_DEFAULT_CONTROLS,chips:["invented"]}})).toBeNull();
    expect(parseDiscoverView({...view(),fundamental:[{field:"fund.future",op:"unknown"}]})).toBeNull();
    expect(parseDiscoverView({...view(),sort:{k:"overnight",dir:-1}})).toBeNull();
  });
  it("does not overwrite an unread future-format sibling",()=>{
    const raw={[DISCOVER_CURRENT_KEY]:view(),[discoverViewKey("b".repeat(32))]:{schema:2,id:"b".repeat(32)}};
    const before=JSON.stringify(raw);const parsed=readDiscoverPreferences(raw);
    expect(parsed.blocked).toBe(true);expect(parsed.current?.id).toBe(id);expect(JSON.stringify(raw)).toBe(before);
  });
  it("keeps full Discover views out of auth metadata and fences the workspace adapter",()=>{
    const patch={[DISCOVER_CURRENT_KEY]:view(),[discoverViewKey(id)]:view(),discover_view_v1_invalid:{},brain_depth:"deep",alert_email_optin:true};
    expect(scopeAccountWrite(patch).data).toEqual({});
    const result=scopeDiscoverWrite(patch);
    expect(Object.keys(result.data)).toEqual([DISCOVER_CURRENT_KEY,discoverViewKey(id)]);
    expect(result.dropped).toEqual(["discover_view_v1_invalid","brain_depth","alert_email_optin"]);
  });
  it("does not confuse unsupported values with deletions or discard extensions",()=>{
    expect(sameDiscoverValue({schema:2},null)).toBe(false);
    expect(sameDiscoverValue({schema:2},{schema:2})).toBe(false);
    expect(sameDiscoverValue(undefined,null)).toBe(true);
    expect(parseDiscoverView({...view(),futureSetting:true})).toBeNull();
    expect(parseDiscoverView({...view(),technical:{...TECH_DEFAULT_CONTROLS,futurePredicate:true}})).toBeNull();
  });
});
describe("Discover quote semantics",()=>{
  const snapshot={last:100,chg:2};
  it("keeps regular and overnight lanes separate and never mixes a current price with snapshot change",()=>{
    expect(discoverRegularReading(snapshot,{last:110,regularPrice:110,regularChg:null})).toMatchObject({price:110,change:null});
    expect(discoverRegularReading(snapshot,{last:110,close:105,prevClose:100})).toMatchObject({price:105,change:5,kind:"close"});
    expect(discoverRegularReading(snapshot,null)).toMatchObject({price:100,change:2,kind:"snapshot"});
  });
  it("does not call an old exchange observation live just because HTTP is fresh",()=>{
    expect(discoverRegularReading(snapshot,{last:101,live:true,ts:100},200000).kind).toBe("quote");
    expect(discoverRegularReading(snapshot,{last:101,live:true,ts:190},200000).kind).toBe("live");
  });
  it("expires genuine BOATS observations and refuses mixed-provider extended prints",()=>{
    const q={extSource:"tiingo_boats",extBasis:"LIVE",extVenue:"BOATS",extPriceKind:"LAST_TRADE",extSession:"overnight",extTs:100,extReceivedTs:101,extPublishedTs:102,extExpiresTs:130,extCaptureId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",extGeneration:1,extPrice:102,extChg:2};
    expect(discoverOvernightReading(q,110000)).toEqual(q);expect(discoverOvernightReading(q,130000)).toBeNull();expect(discoverOvernightReading({...q,extSource:"yahoo"},110000)).toBeNull();
  });
});
