import { test, expect } from "@playwright/test";
import { prepare } from "./smartScreensFixture";
import { writeFileSync } from "node:fs";
const old = {as_of:"2026-10-12",symbols:{IWCACHE:{name:"Cached scan",last:111,chg:4,vol:1000,sec:"Equities",mkt:"NASDAQ"}}};
const fresh = {as_of:"2026-10-14",symbols:{IWFRESH:{name:"Refreshed scan",last:222,chg:5,vol:1000,sec:"Equities",mkt:"NASDAQ"},IWDOWN:{name:"Below predicate",last:333,chg:1,vol:1000,sec:"Equities",mkt:"NASDAQ"}}};
for(const mode of ["503", "invalid", "fresh"] as const) for(const zh of [false,true]) test(`cached scan refresh ${mode} preserves predicate ${zh?'ZH':'EN'}`,async({page,browser},info)=>{
 test.setTimeout(120000);
 await prepare(page.context(),info.project.use.baseURL!,`iw2-stale-${info.project.name}-${zh}`,zh);
 await page.route("**/__iw2_seed",r=>r.fulfill({contentType:"text/html",body:"<!doctype html><title>isolated cache fixture</title>"}));
 await page.goto('/__iw2_seed');
 const seeded = await page.evaluate(data=>new Promise((resolve,reject)=>{
  const r=indexedDB.open('mm-data-cache',1);
  r.onupgradeneeded=()=>{const s=r.result.createObjectStore('json',{keyPath:'url'});s.createIndex('ts','ts');};
  r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('json','readwrite');tx.objectStore('json').put({url:'/data/manifest.json',data,ts:Date.now()-3600000});tx.oncomplete=()=>{db.close();resolve(data);};tx.onerror=()=>reject(tx.error);};
 }),old);
 expect(seeded).toEqual(old);
 let release!:()=>void; const held=new Promise<void>(r=>release=r);let attempt=0;const writes:string[]=[],telemetryRequests:string[]=[],events:unknown[]=[];
 page.on('request',r=>{if(r.method()!=='GET'&&new URL(r.url()).pathname.startsWith('/api/')){const path=new URL(r.url()).pathname;(path === '/api/collect' ? telemetryRequests : writes).push(r.method()+' '+path);}});
 await page.route('**/api/flow?f=gexstate_index*',r=>r.fulfill({status:404,json:{absent:true}}));
 await page.route('**/data/manifest.json**',async r=>{const n=++attempt;events.push({request:n});if(n===1){await held;await r.fulfill(mode === "503" ? {status:503,json:{unavailable:true}} : {json:mode === "invalid" ? {symbols:[]} : fresh});}else await r.fulfill({json:fresh});events.push({response:n});});
 let error:string|null=null;
 try{
  await page.goto('/discover?tab=screener');
  const row=page.locator('tbody tr:has(.sym-cell)');const stamp=page.locator('.scr2-asof');const status=page.locator('[data-scr-refresh]');
  await expect(row).toContainText('IWCACHE',{timeout:45000});await expect(row).toContainText('111.00');await expect(stamp).toContainText('2026-10-12');
  await page.locator("select.scr2-select:has(option[value='up3'])").selectOption('up3');
  release();await expect.poll(()=>events.some(v=>'response' in (v as {response?:number}) && (v as {response?:number}).response===1)).toBe(true);
  if(mode !== 'fresh') {
  await expect(status).toHaveAttribute('data-scr-refresh','failed');
  await expect(status).toContainText(zh?'刷新失败':'Refresh failed');
  await page.screenshot({path:info.outputPath('failed-refresh.png'),fullPage:false});
  await expect(row).toContainText('IWCACHE');await expect(stamp).toContainText('2026-10-12');
  await status.getByRole('button',{name:zh?'重试':'Retry',exact:true}).click();
  }
  await expect(row).toHaveCount(1);await expect(row).toContainText('IWFRESH');await expect(row).toContainText('222.00');await expect(stamp).toContainText('2026-10-14');await expect(status).toHaveCount(0);
  await expect(page.locator("select.scr2-select:has(option[value='up3'])")).toHaveValue('up3');expect(writes).toEqual([]);expect(attempt).toBe(mode === "fresh" ? 1 : 2);
  await page.screenshot({path:info.outputPath('recovered.png'),fullPage:false});
 }catch(e){error=String(e);throw e;}finally{release();writeFileSync(info.outputPath('MEASUREMENTS.json'),JSON.stringify({mode,browser:browser.version(),viewport:info.project.use.viewport,zh,seeded,events,writes,telemetryRequests,attempt,error,scope:'Local native IndexedDB persisted-manifest fixture and routed failure; no live, auth, shared owner, or full V3 acceptance'},null,2));}
});
