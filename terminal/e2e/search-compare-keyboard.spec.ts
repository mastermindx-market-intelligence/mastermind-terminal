import { test, expect, type Page } from "@playwright/test";
async function settle(page: Page){await page.evaluate(()=>document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));}
import {writeFileSync} from 'node:fs';
import originalEnvelope from '../lib/__tests__/fixtures/workspace/chart_layout_v2_real_capture.json';
import {fixtureAuthSetup} from './fixtures/investigation-auth';
import {isolateWatchlistStore} from './watchlistStore';
import {isolateLayoutStore} from './layoutStore';
test.setTimeout(120000);
for(const lang of ['en','zh'])test('Compare keyboard active-state focus '+lang,async({page,baseURL},info)=>{
 await isolateWatchlistStore(page,info,baseURL);await isolateLayoutStore(page,info,baseURL);const bundle=await fixtureAuthSetup(page,baseURL!);
 await page.addInitScript(l=>{localStorage.setItem('mm.lang',l);localStorage.setItem('mm.chartSettings',JSON.stringify({titleMode:'ticker',showSymbolName:true}));},lang);
 const writes:string[]=[],brain:string[]=[],mirrors:unknown[]=[],reads:unknown[]=[],layoutReads:string[]=[];const missing=false;
 await page.route('**/api/__e2e__/supabase/auth/v1/user',r=>r.request().method()==='GET'?r.fulfill({json:{id:bundle.sub,aud:'authenticated',role:'authenticated',created_at:'2026-10-04T00:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{theme:'light',theme_auto:'0',lang},identities:[]}}):(writes.push('auth '+r.request().method()),r.abort()));
 await page.route('**/api/brain/chart/state',r=>{expect(r.request().method()).toBe('POST');const body=r.request().postDataJSON();expect(body.client).toBe('terminal');expect(body.acks).toEqual([]);mirrors.push(body);return r.fulfill({status:200,json:{ok:true}});});
 await page.route('**/api/brain/me',r=>r.fulfill({json:{tier:'guest',quotas:{fast:{remaining:0,limit:0,period:'day'},pro:{remaining:0,limit:0,period:'day'}}}}));
 const config={panes:['NVDA'],paneTfs:['W'],split:1,activePane:0,sync:false,chartType:'area',inds:[],indParams:{},hidden:[],compare:[],compareCfg:{},lockedVLine:null};
 const envelope={...originalEnvelope.expected,widgets:[{...originalEnvelope.expected.widgets[0],config}]};
 const head={id:'30000000-0000-4000-8000-000000000001',name:'Current named B',updated_at:'2026-10-15T00:00:00Z',config:{...envelope,revision:2,widgets:[{...envelope.widgets[0],config:{...config,panes:['MSFT'],paneTfs:['D'],chartType:'candles',sync:true}}]}};
 const ref={layout_id:head.id,layout_revision_id:'20000000-0000-4000-8000-000000000001',digest:'a'.repeat(64),role:'primary'};
 const record={id:'10000000-0000-4000-8000-000000000001',status:'found',revision:1,current_revision:2,lifecycle:'active',committed_at:'2026-10-04T00:00:00Z',manifest:{schema:'investigation_manifest.v2',argument_relations:[],intent:{title:lang==='en'?'Retained layout question':'保留布局研究问题',question:lang==='en'?'Does the saved chart context preserve the original investigation?':'保存的图表背景是否保留原始研究？',subjects:[{kind:'security',owner:'terminal.analysis_symbol',object_id:'NVDA'}]},layout_refs:[ref],thesis_refs:[],evidence_refs:[],continuation:{}},layouts:[{id:ref.layout_revision_id,layout_id:head.id,name:'Retained A',digest:ref.digest,config:envelope}]};
 const snapshot=JSON.stringify({record,head});
 await page.route('**/api/layouts{,?*}',r=>{if(r.request().method()!=='GET'){writes.push('layouts '+r.request().method());return r.abort();}layoutReads.push(r.request().url());return r.fulfill({json:{layouts:[head],teams:[],teamRead:{ok:true}}});});
 await page.route('**/api/investigations{,?*}',r=>{
  if(r.request().method()!=='GET'){writes.push('investigations '+r.request().method());return r.abort();}
  const q=new URL(r.request().url()).searchParams;reads.push({query:Object.fromEntries(q),missing});
  if(q.has('id')){expect(Object.fromEntries(q)).toEqual({id:record.id,revision:'1'});return r.fulfill({json:missing?{...record,layouts:[]}:record});}
  return r.fulfill({json:{status:'listed',items:[{id:record.id,revision:2,lifecycle:'active',title:record.manifest.intent.title,question:record.manifest.intent.question,updated_at:record.committed_at}]}});
 });
 page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/brain/')&&!['/api/brain/me','/api/brain/chart/state'].includes(u.pathname))brain.push(r.method()+' '+u.pathname);if(r.method()!=='GET'&&['/api/drawings','/api/theses','/api/smart-screens','/api/watchlists'].some(p=>u.pathname.startsWith(p)))writes.push(r.method()+' '+u.pathname);});
 await page.goto(`/terminal?investigation=${record.id}&revision=1&layout_revision=${ref.layout_revision_id}`);
 const notice=page.getByTestId('retained-layout-read');await expect(notice).toContainText(lang==='en'?'Retained layout opened.':'已打开保留布局。',{timeout:45000});await notice.locator('button').last().click();


 const openCompare=async()=>{const top=page.locator('.topbar .cmp-btn');
 if(await top.isVisible())await top.click();
 else if((page.viewportSize()?.width||0)<640){await page.getByTestId('roller-more').click();await page.getByTestId('hub-tile-compare').click();}
 else {await page.getByTestId('toolbar-more').click();await page.locator('[data-toolbar-menu-action=compare]').click();}};await openCompare();
 const dialog=page.locator('.smodal-cmp');await expect(dialog).toBeVisible();await dialog.getByRole('combobox').fill('MSFT');
 const row=dialog.locator('.r').filter({has:page.locator('.tk',{hasText:/^MSFT$/})});await expect(row).toHaveCount(1);const idle=row.locator('.cmp-add-idle');await expect(idle).toBeVisible();
 await expect(dialog).toHaveAttribute('role','dialog');
 await dialog.getByRole('combobox').focus();await page.keyboard.press('Shift+Tab');await expect(idle).toBeFocused();
 await page.keyboard.press('Tab');await expect(dialog.getByRole('combobox')).toBeFocused();

 const price=row.locator('.cmp-seg-half').nth(0),percent=row.locator('.cmp-seg-half').nth(1),done=row.locator('.cmp-add-done');const states: { state: string; focus: { text: string | null | undefined; cls: string | undefined } }[]=[];
 const visibleFocus=()=>page.evaluate(()=>{let p=document.activeElement as HTMLElement|null;while(p){const c=getComputedStyle(p);if(c.opacity==='0'||c.visibility==='hidden'||p.inert)return false;p=p.parentElement;}return true;});
 const shot=async(state:string)=>{await settle(page);expect(await visibleFocus()).toBe(true);states.push({state,focus:await page.evaluate(()=>({text:document.activeElement?.textContent,cls:document.activeElement?.className}))});await page.screenshot({path:info.outputPath(state+'.png')});};
 await dialog.getByRole('combobox').focus();
 for(let i=0;i<30 && !(await idle.evaluate(e=>e===document.activeElement));i++)await page.keyboard.press('Tab');
 await expect(idle).toBeFocused();await page.keyboard.press('Tab');expect(await visibleFocus(),'Tab skips inactive controls').toBe(true);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mm.cmpCfg')||'{}').MSFT)).toBeUndefined();
 await page.keyboard.press('Shift+Tab');await expect(idle).toBeFocused();expect(await row.getByRole('button').count()).toBe(1);
 await page.keyboard.press('Enter');await expect(price).toBeFocused();await expect(row.locator('.cmp-seg')).toHaveCSS('opacity','1');expect(await row.getByRole('button').count()).toBe(2);const ring=await price.evaluate(e=>{const b=e.getBoundingClientRect(),p=e.parentElement!.getBoundingClientRect(),c=getComputedStyle(e),extension=parseFloat(c.outlineWidth)+parseFloat(c.outlineOffset);return{width:parseFloat(c.outlineWidth),inside:b.left-extension>=p.left&&b.right+extension<=p.right&&b.top-extension>=p.top&&b.bottom+extension<=p.bottom};});expect(ring.width).toBeGreaterThan(0);expect(ring.inside,'focus ring remains inside the clipped segmented control').toBe(true);await shot('price-choice');
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await openCompare();await dialog.getByRole('combobox').fill('MSFT');await page.keyboard.press('Enter');await expect(price).toBeFocused();
 await page.keyboard.press('Tab');await expect(percent).toBeFocused();await page.keyboard.press('Space');await expect(done).toBeFocused();await expect(done).toHaveCSS('opacity','1');expect(await row.getByRole('button').count()).toBe(1);await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mm.cmpCfg')||'{}').MSFT?.mode)).toBe('percent');await shot('percent-added');
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await openCompare();await dialog.getByRole('combobox').fill('MSFT');await done.focus();await expect(done).toBeFocused();
 await page.keyboard.press('Enter');await expect(idle).toBeFocused();await expect(dialog.locator('.scmp-chip')).toHaveCount(0);
 await dialog.getByRole('combobox').focus();await page.keyboard.press('Enter');await expect(price).toBeFocused();await page.keyboard.press('Space');await expect(done).toBeFocused();await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mm.cmpCfg')||'{}').MSFT?.mode)).toBe('price');
 await page.keyboard.press('Shift+Tab');await expect(dialog.locator('.scmp-chip button')).toBeFocused();await page.keyboard.press('Space');await expect(dialog.locator('.scmp-chip')).toHaveCount(0);await expect(idle).toBeFocused();await expect(idle).toHaveCSS('opacity','1');await shot('removed-idle');
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mm.cmpCfg')||'{}').MSFT)).toBeUndefined();
 const opener=(page.viewportSize()?.width||0)>=1100?page.locator('.topbar .cmp-btn'):(page.viewportSize()?.width||0)<640?page.getByTestId('roller-more'):page.getByTestId('toolbar-more');
 await expect(opener).toBeFocused();
 // Breakpoint changes replace the entry control while this dialog remains open.
 const wasPhone=(page.viewportSize()?.width||0)<640;
 await openCompare();await dialog.getByRole('combobox').fill('MSFT');
 await page.setViewportSize(wasPhone?{width:1440,height:900}:{width:390,height:844});
 const responsiveEntry=wasPhone?page.locator('.topbar .cmp-btn'):page.getByTestId('roller-more');
 await expect(responsiveEntry).toBeVisible();await dialog.getByRole('combobox').focus();
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(responsiveEntry).toBeFocused();
 expect(writes).toEqual([]);expect(brain).toEqual([]);expect(JSON.stringify({record,head})).toBe(snapshot);writeFileSync(info.outputPath('keyboard-proof.json'),JSON.stringify({states,writes,brain,reads,mirrors},null,2));
});
