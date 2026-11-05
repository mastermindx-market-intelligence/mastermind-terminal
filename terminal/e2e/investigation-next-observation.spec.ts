import {test,expect} from "@playwright/test";
import {writeFileSync} from "node:fs";
import {fixtureAuthSetup} from "./fixtures/investigation-auth";
import {canonicalInvestigationJson,type InvestigationManifest} from "../lib/investigationContracts";
test.setTimeout(90000);
const id="10000000-0000-4000-8000-000000000011";
for(const lang of ["en","zh"] as const) test(`saved next observation exact revision — ${lang}`,async({page},info)=>{
 const initial=lang==="en"?"  Watch reported margin: <script>literal only</script> & no automatic action.\nPreserve the first observation.  ":"  观察报告利润率：<script>仅为文本</script> & 不自动操作。\n保留第一项观察。  ";
 const changed=lang==="en"?"Second observation belongs only to revision 2.":"第二项观察仅属于版本 2。";
 const label=lang==="en"?"Next observation":"下一项观察";
 const base:InvestigationManifest={schema:"investigation_manifest.v2",argument_relations:[],intent:{title:"Exact saved observation",question:"Which observation would change this view?",subjects:[]},layout_refs:[],thesis_refs:[],evidence_refs:[],continuation:{next_question:"Retained next question",next_observation:initial}};
 const manifests=[base,{...base,continuation:{...base.continuation,next_observation:changed}},{...base,continuation:{next_question:"Retained next question"}}];
 const original=manifests.map(canonicalInvestigationJson);const writes:string[]=[];const telemetry:string[]=[];const reads:string[]=[];let deny=false;
 await fixtureAuthSetup(page,info.project.use.baseURL!);
 await page.addInitScript(v=>localStorage.setItem("mm.lang",v),lang);
 await page.route("**/api/collect",async r=>{telemetry.push(r.request().method());await r.fulfill({status:204});});
 await page.route("**/api/layouts",r=>r.fulfill({json:{layouts:[],teams:[],teamRead:{ok:true}}}));
 await page.route("**/api/investigations{,?*}",async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  if(req.method()!=="GET"){writes.push(req.method());await r.abort();return;}
  reads.push(q.toString());
  if(q.has("id")){
   const revision=Number(q.get("revision")||3);
   if(deny||q.get("id")!==id||!manifests[revision-1]){await r.fulfill({json:{status:"not_found"}});return;}
   await r.fulfill({json:{status:"found",id,revision,current_revision:3,lifecycle:"active",manifest:manifests[revision-1],committed_at:"2026-10-04T10:00:00Z",layouts:[]}});return;
  }
  await r.fulfill({json:{status:"listed",items:[{id,revision:3,lifecycle:"active",title:base.intent.title,question:base.intent.question,updated_at:"2026-10-04T10:00:00Z"}]}});
 });
 page.on("request",r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&new URL(r.url()).pathname!=='/api/collect'&&!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(r.method()+" "+new URL(r.url()).pathname);});
 const open=async(rev:number)=>{await page.goto(`/analysis?view=investigations&investigation=${id}&revision=${rev}`);await expect(page.getByRole("heading",{name:base.intent.title,exact:true})).toBeVisible();};
 const region=page.getByRole("region",{name:label,exact:true});
 await open(1);
 await expect(page.getByRole("heading",{name:label,exact:true})).toBeVisible({timeout:3000});
 await expect(region).toBeVisible();expect(await region.locator('p').textContent()).toBe(initial);
 expect(await region.locator('script').count()).toBe(0);expect(await region.locator('button,input,textarea,select,a').count()).toBe(0);
 await region.scrollIntoViewIfNeeded();await region.screenshot({path:info.outputPath("revision1.png")});
 const geometry=await region.evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,right:r.right,width:r.width,viewport:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,whiteSpace:getComputedStyle(e.querySelector('p')!).whiteSpace};});
 expect(geometry.x).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(geometry.viewport+1);expect(geometry.overflow).toBeLessThanOrEqual(1);expect(geometry.whiteSpace).toBe('pre-wrap');
 await open(2);expect(await region.locator('p').textContent()).toBe(changed);await region.scrollIntoViewIfNeeded();await region.screenshot({path:info.outputPath("revision2.png")});
 await open(1);expect(await region.locator('p').textContent()).toBe(initial);await page.reload();await expect(region).toBeVisible();expect(await region.locator('p').textContent()).toBe(initial);
 await open(3);await expect(region).toHaveCount(0);await expect(page.getByText("Retained next question",{exact:true})).toBeVisible();
 deny=true;await page.reload();await expect(page.getByRole("heading",{name:base.intent.title,exact:true})).toHaveCount(0);await expect(region).toHaveCount(0);
 expect(manifests.map(canonicalInvestigationJson)).toEqual(original);expect(writes).toEqual([]);
 for(const revision of [1,2,3])expect(reads.some(q=>new URLSearchParams(q).get('revision')===String(revision))).toBe(true);
 writeFileSync(info.outputPath('OWNER_EXACT.json'),JSON.stringify({lang,original,final:manifests.map(canonicalInvestigationJson),writes,telemetry,reads,geometry,deniedReadbackNoStale:true,scope:'Existing saved read-only consumer; isolated transport fixtures only, not production persistence or full H2'},null,2)+'\n');
});
