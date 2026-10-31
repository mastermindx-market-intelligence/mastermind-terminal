import { test, expect } from "@playwright/test";
import { prepare } from "./smartScreensFixture";
import { writeFileSync } from "node:fs";
const old={as_of:"2026-10-12",symbols:{IWCACHE:{name:"Cached scan",last:111,chg:4,vol:1000,sec:"Equities",mkt:"NASDAQ"}}};
for(const mode of ["503","invalid"] as const) test(`last usable scan survives ${mode} refresh and reopening`,async({page,browser},info)=>{
 test.setTimeout(90000);
 await prepare(page.context(),info.project.use.baseURL!,`iw2-persist-${mode}`,false);
 await page.route("**/__iw2_seed",r=>r.fulfill({contentType:"text/html",body:"<!doctype html><title>isolated cache fixture</title>"}));
 await page.goto('/__iw2_seed');
 await page.evaluate(data=>new Promise((resolve,reject)=>{const r=indexedDB.open('mm-data-cache',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('json',{keyPath:'url'});s.createIndex('ts','ts');};r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('json','readwrite');tx.objectStore('json').put({url:'/data/manifest.json',data,ts:Date.now()-3600000});tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=()=>reject(tx.error);};}),old);
 let release!:()=>void;const held=new Promise<void>(r=>release=r);let attempts=0;const writes:string[]=[];
 page.on('request',r=>{if(r.method()!=='GET'&&new URL(r.url()).pathname.startsWith('/api/')&&!r.url().includes('/api/collect'))writes.push(r.method()+' '+new URL(r.url()).pathname);});
 await page.route('**/api/flow?f=gexstate_index*',r=>r.fulfill({status:404,json:{absent:true}}));
 await page.route('**/data/manifest.json**',async r=>{const n=++attempts;if(n===1){await held;await r.fulfill(mode==='503'?{status:503,json:{unavailable:true}}:{json:{symbols:[]}});}else await r.fulfill({status:503,json:{unavailable:true}});});
 let persisted:unknown=null,error:string|null=null;
 try{
 await page.goto('/discover?tab=screener');const row=page.locator('tbody tr:has(.sym-cell)');await expect(row).toContainText('IWCACHE',{timeout:45000});release();await expect(page.locator('[data-scr-refresh]')).toContainText('Refresh failed');await page.screenshot({path:info.outputPath('before-reopen.png')});
 await page.goto('/__iw2_seed');persisted=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('mm-data-cache',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('json','readonly');const get=tx.objectStore('json').get('/data/manifest.json');get.onsuccess=()=>resolve(get.result??null);get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();};}));
 expect.soft((persisted as {data:unknown})?.data).toEqual(old);
 await page.goto('/discover?tab=screener');await expect(row).toContainText('IWCACHE',{timeout:10000});await expect(row).toContainText('111.00');await expect(page.locator('.scr2-asof')).toContainText('2026-10-12');await expect(page.locator('[data-scr-refresh]')).toContainText('Refresh failed');expect(writes).toEqual([]);expect(attempts).toBe(2);await page.screenshot({path:info.outputPath('after-reopen.png')});
 }catch(e){error=String(e);await page.screenshot({path:info.outputPath('failure.png')});throw e;}finally{release();writeFileSync(info.outputPath('MEASUREMENTS.json'),JSON.stringify({mode,browser:browser.version(),viewport:info.project.use.viewport,persisted,attempts,writes,error,scope:'Local native IndexedDB record and full page reopen; no shared/live data effects'},null,2));}
});
