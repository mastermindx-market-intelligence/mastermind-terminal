"use strict";
const {test, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const {ExtFeed} = require("../lib/extfeed");
const realNow=Date.now;
const realWebull=process.env.WEBULL_DISABLE;
const now=Date.UTC(2026,9,12,0,1,0);
afterEach(()=>{Date.now=realNow; if(realWebull===undefined)delete process.env.WEBULL_DISABLE;else process.env.WEBULL_DISABLE=realWebull;});
function snapshot(overrides={}) {
 const dt=new Date(now).toISOString();
 return {schema:"flow.ext_quotes/v2",source:"tiingo_boats",snapshot_mode:"full_replace",
  capture_id:"12345678-1234-1234-1234-123456789abc",connection_generation:1,
  stream_status:"connected",max_event_age_seconds:30,coverage_symbols:["AMD","AAPL"],
  asof_utc:dt,expires_at_utc:new Date(now+30_000).toISOString(),
  quotes:{AMD:{extPrice:100,extTs:now/1000,extSession:"overnight",extSource:"tiingo_boats",extBasis:"LIVE",
   extVenue:"BOATS",extPriceKind:"LAST_TRADE",extEventAt:dt,extReceivedAt:dt,venue_scope:"single_ats",nbbo:false}},...overrides};
}
function feed(relay) {
 Date.now=()=>now;process.env.WEBULL_DISABLE="1";
 const f=new ExtFeed({fetchRelay:async()=>relay,fetchYahooExt:async()=>{assert.fail("overnight Yahoo fetch");}});
 f.demand("AMD");return f;
}
test("BOATS preserves venue and clocks without changing regular quote authority",async()=>{
 const f=feed(snapshot());await f._runYahooPoll();
 const q=f.getExt("AMD",now,90);
 assert.equal(q.extSource,"tiingo_boats");assert.equal(q.extBasis,"LIVE");
 assert.equal(q.extVenue,"BOATS");assert.equal(q.extPriceKind,"LAST_TRADE");
 assert.equal(q.extChg,(100-90)/90*100);assert.equal(q.last,undefined);
 assert.equal(f._yahooCache.size,0);
 assert.equal(f.getExt("AMD",Date.UTC(2026,9,12,15),90),null);
 f.stop();
});
test("full replacement removes absent symbols and terminal/gap snapshots",async()=>{
 const r=snapshot();const f=feed(r);await f._runYahooPoll();
 assert.ok(f.getExt("AMD",now,90));r.quotes={};advance(r,1);await f._runYahooPoll();
 assert.equal(f.getExt("AMD",now+1,90),null);
 r.quotes=snapshot().quotes;advance(r,2);await f._runYahooPoll();assert.ok(f.getExt("AMD",now+2,90));
 r.stream_status="gap";r.quotes={};advance(r,3);await f._runYahooPoll();assert.equal(f.getExt("AMD",now+3,90),null);f.stop();
});
test("old trades expire even on relay failure or fresh publication clock",async()=>{
 const f=feed(snapshot());await f._runYahooPoll();f._fetchRelay=async()=>null;
 Date.now=()=>now+31_000;await f._runYahooPoll();
 assert.equal(f.getExt("AMD",now+31_000,90),null);f.stop();
 const r=snapshot();r.quotes.AMD.extTs-=31;r.quotes.AMD.extEventAt=new Date(now-31_000).toISOString();
 const g=feed(r);await g._runYahooPoll();assert.equal(g.getExt("AMD",now,90),null);g.stop();
});
test("licensed candidates compare event time before unofficial legs",async()=>{
 const f=feed(snapshot());f.ingest("AMD",{price:99,ts:now/1000-1,session:"overnight",source:"polygon_live",basis:"LIVE"});
 await f._runYahooPoll();assert.equal(f.getExt("AMD",now,90).extSource,"tiingo_boats");
 f.ingest("AMD",{price:101,ts:now/1000+1,session:"overnight",source:"polygon_live",basis:"LIVE"});
 assert.equal(f.getExt("AMD",now+1000,90).extSource,"polygon_live");f.stop();
});
for(const [name,mutate] of Object.entries({
 future:r=>{r.asof_utc=new Date(now+1).toISOString();},
 clockMismatch:r=>{r.quotes.AMD.extEventAt=new Date(now-1000).toISOString();},
 unknownKind:r=>{r.quotes.AMD.extPriceKind="NBBO";},
 guessedVenue:r=>{r.quotes.AMD.extVenue="NASDAQ";},
 wrongCoverage:r=>{r.coverage_symbols=["AAPL"];},
 badPrice:r=>{r.quotes.AMD.extPrice=0;},
 missingExpiry:r=>{delete r.expires_at_utc;},
 absentProvenance:r=>{delete r.quotes.AMD.extReceivedAt;},
}))test(`invalid BOATS ${name} is absent`,async()=>{
 const r=snapshot();mutate(r);const f=feed(r);await f._runYahooPoll();assert.equal(f.getExt("AMD",now,90),null);f.stop();
});
test("submillisecond receive clock survives ISO parsing",async()=>{
 const r=snapshot();r.asof_utc="2026-10-12T00:01:00.002000+00:00";
 r.expires_at_utc="2026-10-12T00:01:30.002000+00:00";
 r.quotes.AMD.extTs=now/1000+0.001222;
 r.quotes.AMD.extEventAt="2026-10-12T00:01:00.001222+00:00";
 r.quotes.AMD.extReceivedAt="2026-10-12T00:01:00.001234+00:00";
 const f=feed(r);Date.now=()=>now+3;await f._runYahooPoll();assert.ok(f.getExt("AMD",now+3,90));f.stop();
});

test("source eligibility cannot hide BOATS behind a newer uncleared provider",async()=>{
 const f=feed(snapshot());await f._runYahooPoll();
 f.ingest("AMD",{price:101,ts:now/1000+1,session:"overnight",source:"polygon_live",basis:"LIVE"});
 assert.equal(f.getExt("AMD",now+1000,90).extSource,"polygon_live");
 assert.equal(f.getExt("AMD",now+1000,90,"tiingo_boats").extSource,"tiingo_boats");
 assert.equal(f.getExt("AMD",now+1000,90,"unknown"),null);f.stop();
});
test("HTTP source eligibility is closed and removes poisoned legacy ext fields",async()=>{
 const {handleQuotesRequest}=require("../lib/quotes");const {Store}=require("../lib/store");
 const store=new Store("/dev/null/manifest.json");
 store.quotes.set("AMD",{sym:"AMD",market:"us",last:90,prevClose:89,chg:1,ts:now/1000,
  extPrice:88,extSource:"webull",extRaw:"poison"});
 const f=feed(snapshot());await f._runYahooPoll();
 const run=query=>handleQuotesRequest(new URLSearchParams(query),now,{store,extFeed:f});
 const q=run("syms=AMD&extSource=tiingo_boats");
 assert.equal(q.status,200);assert.equal(q.body.AMD.last,90);assert.equal(q.body.AMD.extSource,"tiingo_boats");
 f._relayCache.clear();const absent=run("syms=AMD&extSource=tiingo_boats");
 assert.equal(Object.keys(absent.body.AMD).some(k=>k.startsWith("ext")),false);
 for(const query of ["syms=&extSource=webull","syms=AMD&extSource=","syms=AMD&extSource=tiingo_boats&extSource=tiingo_boats","syms=AMD&view=regular&extSource=tiingo_boats"]){
  assert.equal(run(query).status,400);
 }
 f.stop();
});

function advance(r,ms){Date.now=()=>now+ms;r.asof_utc=new Date(now+ms).toISOString();r.expires_at_utc=new Date(now+ms+30_000).toISOString();}
test("relay uses receipt clock for a snapshot published during a deferred fetch",async()=>{
 let deliver;const f=feed(null);f._fetchRelay=()=>new Promise(resolve=>{deliver=resolve;});
 const pending=f._runYahooPoll();const r=snapshot();advance(r,1000);Date.now=()=>now+2000;deliver(r);await pending;
 assert.equal(f.getExt("AMD",now+2000,90).extSource,"tiingo_boats");f.stop();
});
test("a deferred fetch reclassifies the overnight boundary at receipt",async()=>{
 let deliver;const f=feed(null);Date.now=()=>Date.UTC(2026,9,11,23,59,59);
 f._fetchRelay=()=>new Promise(resolve=>{deliver=resolve;});const pending=f._runYahooPoll();
 Date.now=()=>now;deliver(snapshot());await pending;assert.ok(f.getExt("AMD",now,90));f.stop();
});
test("newer empty snapshots and generations cannot be undone by older relay responses",async()=>{
 const r=snapshot();const f=feed(r);await f._runYahooPoll();
 const old=snapshot();r.quotes={};advance(r,1000);await f._runYahooPoll();
 f._fetchRelay=async()=>old;await f._runYahooPoll();assert.equal(f.getExt("AMD",now+1000,90),null);
 const newer=snapshot({connection_generation:2});advance(newer,2000);f._fetchRelay=async()=>newer;await f._runYahooPoll();
 assert.equal(f.getExt("AMD",now+2000,90).extGeneration,2);
 const regressed=snapshot({connection_generation:1});advance(regressed,3000);f._fetchRelay=async()=>regressed;await f._runYahooPoll();
 assert.equal(f.getExt("AMD",now+3000,90).extGeneration,2);f.stop();
});
test("capture transitions require terminal invalidation or expiry and retire known UUIDs",async()=>{
 const r=snapshot();const f=feed(r);await f._runYahooPoll();
 const fresh=snapshot({capture_id:"87654321-4321-4321-4321-cba987654321"});advance(fresh,1000);f._fetchRelay=async()=>fresh;await f._runYahooPoll();
 assert.equal(f.getExt("AMD",now+1000,90).extCaptureId,r.capture_id);
 r.stream_status="ended";r.quotes={};advance(r,2000);f._fetchRelay=async()=>r;await f._runYahooPoll();
 advance(fresh,3000);f._fetchRelay=async()=>fresh;await f._runYahooPoll();assert.equal(f.getExt("AMD",now+3000,90).extCaptureId,fresh.capture_id);
 const retired=snapshot();advance(retired,4000);f._fetchRelay=async()=>retired;await f._runYahooPoll();
 assert.equal(f.getExt("AMD",now+4000,90).extCaptureId,fresh.capture_id);f.stop();
});
test("a response completing after stop cannot restore the relay cache",async()=>{
 let deliver;const f=feed(null);f._fetchRelay=()=>new Promise(resolve=>{deliver=resolve;});
 const pending=f._runYahooPoll();f.stop();deliver(snapshot());await pending;assert.equal(f._relayCache.size,0);
});
