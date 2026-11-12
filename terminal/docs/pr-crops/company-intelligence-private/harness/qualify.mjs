import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {chromium} from '@playwright/test';const __dirname=path.dirname(fileURLToPath(import.meta.url));
const output=path.join(__dirname,'.generated');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext();const page=await context.newPage();
 const records=[];let locale='en',theme='dark';
 await page.goto('http://127.0.0.1:8639/',{waitUntil:'networkidle'});
 const adjust=async(l,t)=>{if(l!==locale){await page.locator('#locale').click();locale=l;}if(t!==theme){await page.locator('#theme').click();theme=t;}};
 const inspect=()=>page.locator('#pane').evaluate(pane=>{const section=pane.querySelector('section');const select=section.querySelector('select');const s=section.getBoundingClientRect(),p=pane.getBoundingClientRect(),c=select?.getBoundingClientRect();return {paneWidth:p.width,sectionWidth:s.width,sectionClient:section.clientWidth,sectionScroll:section.scrollWidth,paneClient:pane.clientWidth,paneScroll:pane.scrollWidth,documentClient:document.documentElement.clientWidth,documentScroll:document.documentElement.scrollWidth,selectContained:!c||(c.left>=s.left&&c.right<=s.right),selectHeight:c?.height,columns:getComputedStyle(section.querySelector('dl')).gridTemplateColumns,fontFamily:getComputedStyle(section).fontFamily,fontSize:getComputedStyle(section).fontSize,hashPreserved:section.textContent.includes('a'.repeat(64))};});
 const assert=(v,msg)=>{if(!v)throw Error(msg)};
 for(const [vw,vh] of [[1440,900],[820,1180],[390,844]]){
  await page.setViewportSize({width:vw,height:vh});await page.locator('#width').selectOption(vw===1440?'1400':String(vw));
  for(const l of ['en','zh'])for(const t of ['dark','light']){
   await adjust(l,t);await page.locator('#state').selectOption('ready');await page.locator('#pane details summary').click();
   const r=await inspect();assert(r.sectionScroll<=r.sectionClient&&r.documentScroll<=r.documentClient&&r.selectContained,'route overflow '+JSON.stringify(r));
   const datedCopy=l==='en'?'Disclosed as planned on 2024-02-26':'2024-02-26披露时为计划';
   assert((await page.locator('#pane').innerText()).includes(datedCopy),'missing dated source disclosure '+l);
   records.push({kind:'route-synthetic',viewport:[vw,vh],locale:l,material:t,datedDisclosure:datedCopy,...r});await page.screenshot({path:path.join(output,`ready-${vw}-${l}-${t}.png`),fullPage:true});
   for(const state of ['guest','unselected','unsupported','access_unknown','missing_feature','loading','metadata_only','source_unavailable','selection_changed','empty','selecting']){
    await page.locator('#state').selectOption(state);const text=await page.locator('#pane').innerText();assert(!text.includes('Synthetic product')&&!text.includes('a'.repeat(64)),'stale private projection in '+state);assert(await page.locator('#pane details').count()===0,'stale references');
   }
  }
 }
 await page.setViewportSize({width:1440,height:900});await page.locator('#state').selectOption('ready');await page.locator('#stress').click();
 for(const w of ['300','390','820'])for(const l of ['en','zh'])for(const t of ['dark','light']){
  await adjust(l,t);await page.locator('#width').selectOption(w);const details=page.locator('#pane details');if(!await details.getAttribute('open').then(x=>x!==null))await details.locator('summary').click();
  const r=await inspect();assert(r.paneWidth===Number(w)&&r.sectionScroll<=r.sectionClient&&r.paneScroll<=r.paneClient&&r.documentScroll<=r.documentClient&&r.selectContained&&r.hashPreserved,'pane constraint '+JSON.stringify(r));if(Number(w)<641)assert(r.selectHeight>=44,'touch target');
  records.push({kind:'constrained-max-string',viewport:[1440,900],locale:l,material:t,width:Number(w),...r});await page.screenshot({path:path.join(output,`pane-${w}-${l}-${t}.png`),fullPage:true});
 }
 await adjust('en','dark');await page.locator('#width').selectOption('300');await page.locator('#pane select').focus();await page.keyboard.press('Tab');
 const focus=await page.evaluate(()=>{const el=document.activeElement;const css=getComputedStyle(el);return {tag:el.tagName,outline:css.outlineWidth,style:css.outlineStyle,color:css.outlineColor,focusVisible:el.matches(':focus-visible')};});assert(focus.tag==='SUMMARY'&&focus.focusVisible&&parseFloat(focus.outline)>=2,'keyboard focus');
 await page.screenshot({path:path.join(output,'keyboard-focus-300.png'),fullPage:true});
 fs.writeFileSync(path.join(output,'browser-proof.json'),JSON.stringify({at:new Date().toISOString(),claim:'ACTUAL_ISOLATED_COMPONENT_WITH_SYNTHETIC_INPUTS; light reference-study aliases only; native font fallback without Next font loader; no live host/account/source acceptance',records,passiveCases:132,focus},null,2));
 await browser.close();console.log('PASS24 geometry cases,132 passive transitions, keyboard focus');
})().catch(e=>{console.error(e.message);process.exit(1)});
