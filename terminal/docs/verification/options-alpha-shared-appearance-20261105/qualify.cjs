const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.resolve(process.cwd(), 'node_modules/@playwright/test'));
const { PNG } = require(path.resolve(process.cwd(), 'node_modules/pngjs'));
const out = process.argv[2];
assert(out); fs.mkdirSync(out, {recursive:true});
const feed=JSON.parse(fs.readFileSync('lib/__tests__/fixtures/candidate_feed.json'));
const row=feed.formed_candidates[0];
row.campaign_context={schema:'options.alpha_candidate_campaign_context/v1',campaign_revision_id:row.first_qualifying_campaign_revision_id,group:{session_date:'2026-08-13',ticker:'SPY',right:'C',expiration:'2026-08-15',strike:450,strike_key:'450'},flow_side_counts:{'~buy':2,'~sell':1,mixed:1},intent:{opening_closing:'unavailable',direction_reliability:'soft',accumulation_distribution:'unavailable'}};
const payload={feed,receipt:JSON.parse(fs.readFileSync('lib/__tests__/fixtures/candidate_feed.receipt.json')),metadata:{payload_etag:'synthetic-test-only',receipt_etag:'synthetic-test-only',payload_last_modified:'Thu, 13 Aug 2026 14:30:02 GMT',receipt_last_modified:'Thu, 13 Aug 2026 14:30:02 GMT',served_at:'2026-08-13T14:30:05Z'}};
function luminance(c) {const v=c.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2];}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
const measurements=[];
(async()=>{const browser=await chromium.launch();try{
for(const [device,width,height] of [['desktop',1440,900],['tablet',820,1180],['mobile',390,844]]){
 const context=await browser.newContext({viewport:{width,height},hasTouch:device!=='desktop'});
 await context.route(/^https?:\/\//,route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();if(u.pathname.startsWith('/api/')&&!u.pathname.startsWith('/api/flow'))return route.fulfill({status:503,json:{error:'local appearance fixture'}});return route.continue();});
 const page=await context.newPage();await page.route('**/api/flow?f=options_alpha_candidate_feed',route=>route.fulfill({json:payload}));
 await page.goto('http://127.0.0.1:3276/options?tab=prophet',{waitUntil:'domcontentloaded',timeout:60000});await page.getByRole('tab',{name:/Options Alpha/}).click();
 const card=page.getByTestId('options-alpha-candidate-item');await card.waitFor();
 const source=await card.evaluate(el=>({ids:el.textContent.match(/oc[a-z]+_[a-f0-9]+/g),clocks:[...el.querySelectorAll('time')].map(n=>n.getAttribute('dateTime'))}));
 const url=page.url();
 async function record(lang,theme){
  await page.waitForFunction(({lang,theme})=>document.documentElement.dataset.lang===lang&&document.documentElement.dataset.theme===theme,{lang,theme});
  const state=await card.evaluate(el=>{const root=document.documentElement;const note=el.querySelector('.obs-options-alpha-context-head small');const cs=getComputedStyle(el),ns=getComputedStyle(note);const nums=s=>s.match(/[\d.]+/g).map(Number);return{theme:root.dataset.theme,lang:root.dataset.lang,shared:root.dataset.mmxSharedShell,bg:getComputedStyle(root).getPropertyValue('--bg').trim(),cardBackground:cs.backgroundColor,cardBorder:cs.borderTopColor,noteColor:ns.color,noteFont:ns.fontSize,noteRGB:nums(ns.color).slice(0,3),cardRGB:nums(cs.backgroundColor).slice(0,3),cardOpaque:nums(cs.backgroundColor).length===3||nums(cs.backgroundColor)[3]===1,documentOverflow:document.documentElement.scrollWidth>innerWidth,cardOverflow:el.scrollWidth>el.clientWidth+1,ids:el.textContent.match(/oc[a-z]+_[a-f0-9]+/g),clocks:[...el.querySelectorAll('time')].map(n=>n.getAttribute('dateTime'))}});
  assert.equal(state.shared,'1');assert.equal(page.url(),url);assert.deepEqual(state.ids,source.ids);assert.deepEqual(state.clocks,source.clocks);assert.equal(state.documentOverflow,false);assert.equal(state.cardOverflow,false);assert((await card.textContent()).includes('SPY C 2026-08-15 450'));
  const disclosure=card.locator('details').first();const summary=disclosure.locator('summary');await summary.scrollIntoViewIfNeeded();assert(await summary.isVisible());await summary.click();assert.equal(await disclosure.getAttribute('open'),'');await summary.click();
  const point=await card.evaluate(el=>{const a=el.getBoundingClientRect(),n=el.querySelector('.obs-options-alpha-context-head small').getBoundingClientRect();return{x:Math.min(a.width-4,n.right-a.left+2),y:n.top-a.top+n.height/2}});
  const file=path.join(out,`${device}-${lang}-${theme}.png`);await card.screenshot({path:file});
  const png=PNG.sync.read(fs.readFileSync(file));const offset=(Math.floor(point.y)*png.width+Math.floor(point.x))*4;state.sampledNoteBackground=[...png.data.subarray(offset,offset+3)];state.noteContrast=contrast(state.noteRGB,state.sampledNoteBackground);
  measurements.push({device,width,height,...state});fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({sourceOnly:true,fixtureOnly:true,actualSharedControls:true,measurements},null,2));
  if(theme==='light') assert(state.noteContrast>=4.5,`frozen context note contrast ${state.noteContrast}: ${JSON.stringify(state)}`);
 }
 await record('en','dark');
 await page.getByRole('button',{name:'Light theme',exact:true}).click();await record('en','light');
 await page.getByRole('button',{name:'Chinese language',exact:true}).click();await record('zh','light');
 await page.getByRole('button',{name:'浅色主题',exact:true}).click();await record('zh','dark');
 await context.close();
}
fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({sourceOnly:true,fixtureOnly:true,actualSharedControls:true,measurements},null,2));
console.log(JSON.stringify({states:measurements.length,lightContrast:measurements.filter(x=>x.theme==='light').map(x=>({device:x.device,lang:x.lang,ratio:x.noteContrast})),out}));
}finally{await browser.close()}})().catch(error=>{fs.writeFileSync(path.join(out,'failure.txt'),error.stack);console.error(error.stack);process.exitCode=1});
