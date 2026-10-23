"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FormingCandles } = require("../lib/formingCandles");
const { handleQuotesRequest } = require("../lib/quotes");
const T = Date.parse("2026-10-21T13:30:00Z");
const bar = (t, c, v = 20, h = c, l = c) => ({ t, o: c, h, l, c, v });
const flush = () => new Promise(resolve => setImmediate(resolve));

test("retains skipped seconds, upserts revisions and keeps the latest event clock", () => {
  const f = new FormingCandles();
  f.demand("AAPL", T);
  for (const [offset, price, volume] of [[0,100,20],[1000,105,30],[2000,95,10],[3000,101,5]]) {
    f.ingest("AAPL", bar(T+offset,price,volume), T+offset+999,T+offset+1000);
  }
  let s = f.snapshot("AAPL",T+4000);
  assert.deepEqual(s.minutes[0], [T,100,105,95,101,65]);
  const rev = s.revision;
  f.ingest("AAPL", bar(T+1000,105,30),T+1999,T+5000);
  assert.equal(f.snapshot("AAPL",T+5000).revision,rev);
  f.ingest("AAPL",bar(T+1000,103,17),T+1999,T+6000);
  s=f.snapshot("AAPL",T+6000);
  assert.deepEqual(s.minutes[0],[T,100,103,95,101,52]);
  assert.equal(s.asOfMs,T+3999);
});

test("closed-minute prefix and live suffix never overlap, including a mid-minute join", async () => {
  let now=T+80_000;
  const calls=[];
  const f=new FormingCandles({now:()=>now,fetchMinutes:async (_sym,_day,end)=>{
    calls.push(end);
    return end===T+60_000 ? [bar(T,100,100)] : [bar(T,100,100),bar(T+60_000,101,50)];
  }});
  f.demand("AAPL",now);
  f.ingest("AAPL",bar(T+80_000,101,20),T+80_999,now+1000);
  await flush();
  let s=f.snapshot("AAPL",now);
  assert.equal(s.prefixThroughMs,T+60_000);
  assert.equal(s.minutes.reduce((n,b)=>n+b[5],0),120);
  now=T+123_000;
  f.ingest("AAPL",bar(T+121_000,102,30),T+121_999,now);
  f.demand("AAPL",now);
  await flush();
  s=f.snapshot("AAPL",now);
  assert.deepEqual(calls,[T+60_000,T+120_000]);
  assert.equal(s.minutes.reduce((n,b)=>n+b[5],0),180);
  assert.equal(new Set(s.minutes.map(b=>b[0])).size,s.minutes.length);
  assert.equal(s.seconds.length,2,"second-resolution history survives minute seeding");
});

test("a correction received during a prefix fetch remains dirty", async () => {
  let now=T+80_000, resolve;
  const f=new FormingCandles({now:()=>now,fetchMinutes:()=>new Promise(r=>{resolve=r;})});
  f.demand("AAPL",now); await flush();
  f.ingest("AAPL",bar(T+80_000,101,20),T+80_999,now+1000);
  resolve([bar(T,100,100)]); await flush();
  now=T+86_000;
  f.ingest("AAPL",bar(T+10_000,99,17),T+10_999,now);
  await flush();
  f.ingest("AAPL",bar(T+11_000,98,18),T+11_999,now+1000);
  resolve([bar(T,100,95)]); await flush();
  assert.equal(f.snapshot("AAPL",now).dirtyPrefix,true);
});

test("invalidating a stream fences a pending seed and changes generation on fresh demand",async()=>{
  let resolve;
  const f=new FormingCandles({fetchMinutes:()=>new Promise(r=>{resolve=r;})});
  const old=f.demand("AAPL",T+80_000).generation; await flush();
  f.invalidate();
  resolve([bar(T,100,100)]);await flush();
  assert.equal(f.snapshot("AAPL",T+80_000),null);
  assert.notEqual(f.demand("AAPL",T+81_000).generation,old);
});

test("malformed seed cannot claim prefix coverage",async()=>{
  const f=new FormingCandles({fetchMinutes:async()=>[bar(T,100,-1)]});
  f.demand("AAPL",T+80_000);
  f.ingest("AAPL",bar(T+80_000,101),T+80_999,T+81_000);
  await flush();
  assert.equal(f.snapshot("AAPL",T+82_000).prefixThroughMs,0);
});

test("forming data is chart-opt-in, bounded, and not available after quote demotion",()=>{
  let demands=0;
  const deps={polygon:{isHealthy:()=>true,ensureSubscribed:()=>{},demandForming:()=>demands++,getForming:()=>({revision:1})},
    store:{getQuotes:()=>({AAPL:{source:"polygon-live-second",basis:"REALTIME",last:100}})}};
  const read=query=>handleQuotesRequest(new URLSearchParams(query),T,deps);
  assert.equal(read("syms=AAPL").body.AAPL.forming,undefined);
  assert.equal(demands,0);
  assert.equal(read("syms=AAPL&view=regular&forming=1").body.AAPL.forming.revision,1);
  assert.equal(demands,1);
  assert.equal(read("syms=AAPL&forming=0").status,400);
  assert.equal(read("syms=A,B,C,D,E,F,G,H,I&forming=1").status,400);
  deps.store.getQuotes=()=>({AAPL:{source:"polygon-delayed",basis:"DELAYED_15M",last:100}});
  assert.equal(read("syms=AAPL&forming=1").body.AAPL.forming,undefined);
});

for (const extension of [false, true]) test(`a changed second fences ${extension ? "extended" : "initial"} prefix coverage`, async () => {
  let now=T+80_000, resolve;
  const f=new FormingCandles({now:()=>now,fetchMinutes:()=>new Promise(r=>{resolve=r;})});
  f.demand("AAPL",now); await flush();
  f.ingest("AAPL",bar(T+80_000,101,20),T+80_999,now+1000);
  if (extension) {
    resolve([bar(T,100,100)]); await flush();
    now=T+123_000; f.demand("AAPL",now); await flush();
  }
  const t=extension ? T+80_000 : T+10_000;
  f.ingest("AAPL",bar(t,101,30,120,95),t+999,now);
  resolve(extension ? [bar(T,100,100),bar(T+60_000,101,50,105,99)] : [bar(T,100,100)]);
  await flush();
  assert.equal(f.snapshot("AAPL",now).dirtyPrefix,true);
  if (extension) {
    const retained=f.snapshot("AAPL",now);
    assert.equal(retained.prefixThroughMs,T+60000);
    assert.equal(retained.minutes.find(b=>b[0]===T+60000)[2],120,"racing REST must not erase the socket correction");
  }
  now+=6000; f.demand("AAPL",now); await flush();
  resolve(extension ? [bar(T,100,100),bar(T+60_000,101,60,120,95)] : [bar(T,100,110,120,95)]);
  await flush();
  assert.equal(f.snapshot("AAPL",now).dirtyPrefix,false);
  assert.equal(Math.max(...f.snapshot("AAPL",now).minutes.map(b=>b[2])),120);
});

test("hot capacity does not churn generations or unbound concurrent seed requests",async()=>{
  const resolves=[]; let calls=0;
  const f=new FormingCandles({fetchMinutes:()=>{calls++;return new Promise(r=>resolves.push(r));}});
  const first=f.demand("S0",T+80_000).generation;
  for(let pass=0;pass<2;pass++) for(let i=0;i<65;i++) f.demand(`S${i}`,T+80_000+pass*1000);
  await flush();
  assert.equal(f.states.size,64);
  assert.equal(f.states.get("S0").generation,first);
  assert.equal(f.demand("S64",T+82_000),null);
  assert.equal(calls,4);
  for(const resolve of resolves) resolve([]);
  await flush();
  assert.equal(f.activeSeeds,0);
});


test("a late correction after second retention repairs the opaque minute without dropping contributions",async()=>{
  let now=T+80_000, resolve;
  const f=new FormingCandles({now:()=>now,fetchMinutes:()=>new Promise(r=>{resolve=r;})});
  f.demand("AAPL",now);await flush();
  f.ingest("AAPL",bar(T+80_000,101,50,120,90),T+80_999,now+1000);
  resolve([bar(T,100,100)]);await flush();
  now=T+600_000;
  f.ingest("AAPL",bar(now,102,20),now+999,now+1000);
  f.ingest("AAPL",bar(T+80_000,101,17,105,95),T+80_999,now+2000);
  await flush();
  let snapshot=f.snapshot("AAPL",now);
  assert.equal(snapshot.dirtyPrefix,true);
  assert.equal(snapshot.minutes.find(b=>b[0]===T+60000)[5],50);
  assert.equal(snapshot.seconds.some(b=>b[0]===T+80000),false);
  resolve([bar(T,100,100),bar(T+60000,101,47,105,95)]);await flush();
  snapshot=f.snapshot("AAPL",now);
  assert.equal(snapshot.prefixThroughMs,T+120000);
  assert.equal(snapshot.dirtyPrefix,false);
  assert.equal(snapshot.minutes.find(b=>b[0]===T+60000)[5],47);
});


test("the real A adapter repairs old corrections without advancing the live quote clock",async()=>{
  const { Polygon }=require("../lib/polygon");
  let now=T+80_000;
  const writes=[],quotes=new Map(),requests=[];
  const polygon=new Polygon({quotes,setQuote:(sym,q)=>{writes.push(q);quotes.set(sym,q);}},"test-key",null);
  polygon.cluster="live";
  polygon.forming=new FormingCandles({now:()=>now,fetchMinutes:async(_s,_d,end)=>{
    requests.push(end);
    return end===T+60000 ? [bar(T,100,100)] : [bar(T,100,100),bar(T+60000,101,47,105,95)];
  }});
  const realNow=Date.now;Date.now=()=>now;
  const emit=(t,c,v,h=c,l=c)=>polygon._onA({ev:"A",sym:"AAPL",s:t,e:t+999,o:c,h,l,c,v});
  try {
    polygon.forming.demand("AAPL",now);await flush();
    now=T+81_000;emit(T+80000,101,80,120,90);
    now=T+600_000;emit(now,102,20);
    const before=writes.length, stamp=quotes.get("AAPL").asOfMs;
    emit(T+80000,101,40,105,95);
    assert.equal(polygon.forming.snapshot("AAPL",now).dirtyPrefix,true);
    assert.equal(writes.length,before);
    assert.equal(quotes.get("AAPL").asOfMs,stamp);
    await flush();
    assert.equal(requests.at(-1),T+120000);
    assert.equal(polygon.forming.snapshot("AAPL",now).minutes.find(b=>b[0]===T+60000)[2],105);
    const revision=polygon.forming.snapshot("AAPL",now).revision;
    emit(now+10000,102,20);
    emit(now,102,-1);
    assert.equal(polygon.forming.snapshot("AAPL",now).revision,revision);
  } finally { Date.now=realNow; }
});
