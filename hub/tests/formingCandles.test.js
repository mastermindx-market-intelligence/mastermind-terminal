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
