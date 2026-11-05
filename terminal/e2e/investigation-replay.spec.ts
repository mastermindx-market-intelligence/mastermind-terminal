import {expect,test} from "@playwright/test";
import golden from "../lib/__tests__/fixtures/aapl-event-workspace.json";
import {normalizeEventWorkspace} from "../lib/eventWorkspace";
const id="10000000-0000-4000-8000-000000000001",fingerprint="a".repeat(64),cutoff="2026-08-01T00:00:00Z";
const ref={owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:golden.event_id,mode:"pinned",version_ref:golden.generation_id,fingerprint};
const manifest={schema:"investigation_manifest.v2",argument_relations:[],intent:{title:"Retained Apple research",question:"What was in the retained snapshot?",subjects:[{kind:"issuer",owner:"data_os.security_master",object_id:golden.issuer.company_id}]},layout_refs:[],thesis_refs:[],evidence_refs:[ref],review_baseline_ref:ref,continuation:{}};
const baseline={ok:true,workspace:normalizeEventWorkspace(golden),reference:ref,receipt:{schema:"earnings.retained_baseline.v1",owner:"earnings.workspace_generation",company_id:golden.issuer.company_id,event_id:golden.event_id,generation_id:golden.generation_id,fingerprint,public_known_at:golden.lifecycle.source_available_at,platform_known_at:golden.lifecycle.observed_at,generation_emitted_at:golden.generated_at,rights:{allowed:true,policy_version:"fixture",checked_at:"2026-10-04T00:00:00Z"}}};
for(const lang of ["en","zh"] as const)test(`retained snapshot inspection has no research writes or current fallback — ${lang}`,async({page},info)=>{
 const c=lang==="en"?{title:"Inspect a retained snapshot",cutoff:"Snapshot cutoff (UTC)",open:"Open retained snapshot",facts:"Snapshot facts",missing:"The retained history is unavailable. Current evidence has not replaced it."}:{title:"查看保留快照",cutoff:"快照截止时间（UTC）",open:"打开保留快照",facts:"快照事实",missing:"保留历史暂不可用，未使用当前证据替代。"};
 await page.addInitScript(lang=>localStorage.setItem("mm.lang",lang),lang);
 let reads=0,unavailable=false;const writes:string[]=[];
 page.on("request",request=>{const path=new URL(request.url()).pathname;if(request.method()!=="GET"&&path.startsWith("/api/")&&path!=="/api/collect")writes.push(request.url());});
 await page.route("**/api/layouts",route=>route.fulfill({json:{layouts:[],teams:[],teamRead:{ok:true}}}));
 await page.route("**/api/investigations/baseline?*",route=>route.fulfill({json:baseline}));
 await page.route("**/api/investigations{,?*}",route=>route.fulfill({json:new URL(route.request().url()).searchParams.has("id")?{status:"found",id,revision:1,current_revision:1,lifecycle:"active",manifest,committed_at:"2026-10-04T00:00:00Z",layouts:[]}:{status:"listed",items:[]}}));
 await page.route("**/api/investigations/replay?*",route=>{
  reads++;expect(new URL(route.request().url()).searchParams.get("cutoff")).toBe(cutoff);
  if(unavailable)return route.fulfill({status:503,json:{ok:false,reason:"missing_history"}});
  return route.fulfill({json:{...baseline,status:"replayed",id,revision:1,root_fingerprint:fingerprint,replay:{schema:"earnings.platform_snapshot_replay.v1",policy:"platform_snapshot",cutoff,root_generation_id:golden.generation_id,selected_generation_id:golden.generation_id,scope:"retained_chain_through_saved_baseline",steps:1,public_known_replay:false,user_seen_replay:false}}});
 });
 await page.goto(`/analysis?view=investigations&investigation=${id}&revision=1`);
 await expect(page.getByRole("heading",{name:c.title})).toBeVisible();expect(reads).toBe(0);expect(writes).toHaveLength(0);
 await page.getByLabel(c.cutoff,{exact:true}).fill(cutoff);expect(reads).toBe(0);
 await page.getByRole("button",{name:c.open,exact:true}).click();await expect(page.getByRole("heading",{name:c.facts})).toBeVisible();expect(reads).toBe(1);expect(writes).toHaveLength(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByRole("heading",{name:c.facts}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath("retained-platform-snapshot.png"),fullPage:true});
 unavailable=true;await page.getByRole("button",{name:c.open,exact:true}).click();await expect(page.getByText(c.missing,{exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:c.facts})).toHaveCount(0);expect(writes).toHaveLength(0);
 await page.reload();await expect(page.getByRole("heading",{name:c.title})).toBeVisible();expect(reads).toBe(2);expect(writes).toHaveLength(0);
});
