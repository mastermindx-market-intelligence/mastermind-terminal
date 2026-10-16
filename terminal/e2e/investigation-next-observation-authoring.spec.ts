import {test,expect} from "@playwright/test";
import {createHash} from 'node:crypto';import {writeFileSync} from 'node:fs';
import {fixtureAuthSetup} from "./fixtures/investigation-auth";
import {canonicalInvestigationJson,type InvestigationManifest} from "../lib/investigationContracts";
test.setTimeout(120000);
const originalId='10000000-0000-4000-8000-000000000011';
for(const lang of ['en','zh'] as const)test(`existing observation explicit Save and exact readback — ${lang}`,async({page},info)=>{
 const copy=lang==='en'?{edit:'Edit saved question',save:'Save research',cancel:'Cancel editing',field:'Next observation (optional)',heading:'Next observation',duplicate:'Duplicate as new research',title:'Title'}:{edit:'编辑问题',save:'保存研究',cancel:'取消编辑',field:'下一项观察（可选）',heading:'下一项观察',duplicate:'复制为新研究',title:'标题'};
 const base:InvestigationManifest={schema:'investigation_manifest.v2',argument_relations:[],intent:{title:'Observation authoring source',question:'Which observation changes this view?',subjects:[]},layout_refs:[],thesis_refs:[],evidence_refs:[],continuation:{next_question:'Retain next question',next_observation:'Original observation'}};
 const before=canonicalInvestigationJson(base);type Command={id:string;operation_id:string;action:string;expected_revision:number;manifest:InvestigationManifest};const commands:Command[]=[];const otherWrites:string[]=[];const telemetry:string[]=[];
 const records=new Map<string,Map<number,InvestigationManifest>>([[originalId,new Map([[3,base]])]]);
 const receipt=(id:string,revision:number,manifest:InvestigationManifest,operation_id='70000000-0000-4000-8000-000000000011')=>({status:'committed',id,investigation_id:id,revision,lifecycle:'active',manifest,committed_at:'2026-10-04T10:00:00Z',revision_id:`80000000-0000-4000-8000-${String(revision).padStart(12,'0')}`,sequence:revision,parent_revision_id:revision===1?null:`80000000-0000-4000-8000-${String(revision-1).padStart(12,'0')}`,operation_id,author_ref:'40000000-0000-4000-8000-000000000011',recorded_at:'2026-10-04T10:00:00Z',manifest_digest:createHash('sha256').update(canonicalInvestigationJson(manifest)).digest('hex')});
 await fixtureAuthSetup(page,info.project.use.baseURL!);await page.addInitScript(v=>localStorage.setItem('mm.lang',v),lang);
 await page.route('**/api/collect',async r=>{telemetry.push(r.request().method());await r.fulfill({status:204});});
 await page.route('**/api/layouts',r=>r.fulfill({json:{layouts:[],teams:[],teamRead:{ok:true}}}));
 await page.route('**/api/investigations{,?*}',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='POST'){
   const c=req.postDataJSON() as Command;commands.push(c);let versions=records.get(c.id);const current=versions?Math.max(...versions.keys()):0;
   expect(c.expected_revision).toBe(current);expect(c.action).toBe(current?'revise':'create');
   const version=current+1;if(!versions){versions=new Map();records.set(c.id,versions);}versions.set(version,structuredClone(c.manifest));await r.fulfill({json:receipt(c.id,version,c.manifest,c.operation_id)});return;
  }
  if(req.method()!=='GET'){otherWrites.push(req.method());await r.abort();return;}
  if(q.has('id')){const id=q.get('id')!,versions=records.get(id);if(!versions){await r.fulfill({json:{status:'not_found'}});return;}const current=Math.max(...versions.keys()),revision=Number(q.get('revision')||current),manifest=versions.get(revision);await r.fulfill({json:manifest?{...receipt(id,revision,manifest),status:'found',current_revision:current,layouts:[]}:{status:'not_found'}});return;}
  await r.fulfill({json:{status:'listed',items:[...records].map(([id,v])=>{const rev=Math.max(...v.keys()),m=v.get(rev)!;return{id,revision:rev,lifecycle:'active',title:m.intent.title,question:m.intent.question,updated_at:'2026-10-04T10:00:00Z'};})}});
 });
 page.on('request',r=>{const p=new URL(r.url()).pathname;if(p.startsWith('/api/')&&!['/api/investigations','/api/collect'].includes(p)&&!['GET','HEAD','OPTIONS'].includes(r.method()))otherWrites.push(r.method()+' '+p);});
 const open=async(rev:number)=>{await page.goto(`/analysis?view=investigations&investigation=${originalId}&revision=${rev}`);await expect(page.getByRole('heading',{name:base.intent.title,exact:true})).toBeVisible();};
 const region=page.getByRole('region',{name:copy.heading,exact:true});const field=page.getByLabel(copy.field,{exact:true});
 await open(3);await page.getByRole('button',{name:copy.edit,exact:true}).click();await expect(field).toHaveValue('Original observation');
 await field.fill('Unsaved change');expect(commands).toHaveLength(0);await page.getByRole('button',{name:copy.cancel,exact:true}).click();expect(await region.locator('p').textContent()).toBe('Original observation');expect(commands).toHaveLength(0);
 await page.getByRole('button',{name:copy.edit,exact:true}).click();await expect(field).toHaveValue('Original observation');
 const next=lang==='en'?'  Watch exact margin <5% & next report.\nExplicit condition  ':'  观察精确利润率 <5% & 下一份报告。\n明确条件  ';
 await field.fill(next);expect(commands).toHaveLength(0);await field.scrollIntoViewIfNeeded();await field.screenshot({path:info.outputPath('edited-unsaved.png')});
 await page.getByRole('button',{name:copy.save,exact:true}).click();await expect(region).toBeVisible();expect(await region.locator('p').textContent()).toBe(next);expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({id:originalId,action:'revise',expected_revision:3});expect(commands[0].manifest).toEqual({...base,continuation:{...base.continuation,next_observation:next}});
 await page.reload();await expect(region).toBeVisible();expect(await region.locator('p').textContent()).toBe(next);await region.scrollIntoViewIfNeeded();await region.screenshot({path:info.outputPath('saved-v4.png')});
 await open(3);expect(await region.locator('p').textContent()).toBe('Original observation');await open(4);
 await page.getByRole('button',{name:copy.edit,exact:true}).click();await field.fill('');expect(commands).toHaveLength(1);await page.getByRole('button',{name:copy.save,exact:true}).click();await expect(field).toHaveCount(0);await expect(region).toHaveCount(0);expect(commands).toHaveLength(2);expect(commands[1]).toMatchObject({action:'revise',expected_revision:4});expect(commands[1].manifest).toEqual({...base,continuation:{next_question:'Retain next question'}});
 await page.getByRole('button',{name:copy.duplicate,exact:true}).click();await expect(field).toHaveValue('');await field.fill('Independent copied observation');await page.getByLabel(copy.title,{exact:true}).fill('Independent question');expect(commands).toHaveLength(2);await page.getByRole('button',{name:copy.save,exact:true}).click();await expect(page.getByRole('heading',{name:'Independent question',exact:true})).toBeVisible();expect(commands).toHaveLength(3);expect(commands[2]).toMatchObject({action:'create',expected_revision:0});expect(commands[2].id).not.toBe(originalId);expect(commands[2].manifest).toEqual({...base,intent:{...base.intent,title:'Independent question'},continuation:{next_question:'Retain next question',next_observation:'Independent copied observation'}});
 await page.reload();await expect(region).toBeVisible();expect(await region.locator('p').textContent()).toBe('Independent copied observation');
 await open(3);expect(await region.locator('p').textContent()).toBe('Original observation');expect(canonicalInvestigationJson(base)).toBe(before);expect(canonicalInvestigationJson(records.get(originalId)!.get(3)!)).toBe(before);expect(otherWrites).toEqual([]);
 writeFileSync(info.outputPath('OWNER_EXACT.json'),JSON.stringify({lang,original:before,finalOriginal:canonicalInvestigationJson(records.get(originalId)!.get(3)!),commands,otherWrites,telemetry,scope:'Three explicitly clicked Saves, exact old revision and copy readback on isolated owner transport; not live persistence or lifecycle closure'},null,2)+'\n');
});
