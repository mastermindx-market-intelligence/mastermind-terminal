import {expect,test} from "@playwright/test";
import golden from "../lib/__tests__/fixtures/aapl-event-workspace.json";
const id="10000000-0000-4000-8000-000000000001",cutoff="2026-08-01T00:00:00Z";
function baseline(generation=golden.generation_id,container="a".repeat(64),selection="b".repeat(64)){
 const release=golden.sources.find(source=>source.kind==="issuer_release")!;
 return {ok:true,workspace:{schema:"earnings.issuer_release_projection.v1",issuer:{company_id:golden.issuer.company_id,display_name:golden.issuer.display_name},event_id:golden.event_id,generation_id:generation,completeness:{release:{status:"present",document_id:release.document_id}},selected_release:{company_id:golden.issuer.company_id,event_id:golden.event_id,generation_id:generation,document_id:release.document_id,source_sha256:release.source_sha256,filing_key:release.filing_key,receipt_state:"byte_replayed",public_known_at:null,platform_known_at:null}},
  reference:{owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:golden.event_id,mode:"pinned",version_ref:generation,fingerprint:selection,selection:{field:"issuer_release"}},
  selection_receipt:{schema:"earnings.issuer_release_selection.v1",container_fingerprint:container,fingerprint:selection},
  receipt:{owner:"earnings.workspace_generation",company_id:golden.issuer.company_id,event_id:golden.event_id,generation_id:generation,fingerprint:container,public_known_at:null,platform_known_at:null,generation_emitted_at:golden.generated_at,rights:{allowed:true,policy_version:"fixture",checked_at:"2026-10-05T00:00:00Z"}}};
}
const prior=baseline(),current=baseline("c".repeat(24),"d".repeat(64),"e".repeat(64));
const manifest={schema:"investigation_manifest.v2",argument_relations:[],intent:{title:"Retained Apple release",question:"What changed in this release?",subjects:[{kind:"issuer",owner:"data_os.security_master",object_id:golden.issuer.company_id},{kind:"security",owner:"terminal.analysis_symbol",object_id:"AAPL"}]},layout_refs:[],thesis_refs:[],evidence_refs:[prior.reference],review_baseline_ref:prior.reference,continuation:{}};
for(const lang of ["en","zh"] as const)test(`selected release review and replay preserve separate identities — ${lang}`,async({page},info)=>{
 const c=lang==="en"?{replay:"Open retained snapshot",cutoff:"Snapshot cutoff (UTC)",selected:"Selected issuer release",review:"Review current evidence",revised:"Content revised",advance:"Use this reviewed version in an edit",cancel:"Cancel editing"}:{replay:"打开保留快照",cutoff:"快照截止时间（UTC）",selected:"所选发行人公告",review:"复核当前证据",revised:"内容已修订",advance:"在编辑中使用此已复核版本",cancel:"取消编辑"};
 await page.addInitScript(value=>localStorage.setItem("mm.lang",value),lang);
 let reviews=0,replays=0,selectedCurrent=0;const writes:string[]=[];
 page.on("request",request=>{if(request.method()!=="GET"&&new URL(request.url()).pathname.startsWith("/api/")&&!request.url().includes("/api/collect"))writes.push(request.url());});
 await page.route("**/api/layouts",route=>route.fulfill({json:{layouts:[],teams:[],teamRead:{ok:true}}}));
 await page.route("**/api/investigations{,?*}",route=>route.fulfill({json:new URL(route.request().url()).searchParams.has("id")?{status:"found",id,revision:1,current_revision:1,lifecycle:"active",manifest,committed_at:golden.generated_at,layouts:[]}:{status:"listed",items:[]}}));
 await page.route("**/api/investigations/baseline?*",route=>{
  const fingerprint=new URL(route.request().url()).searchParams.get("fingerprint");
  expect([prior.reference.fingerprint,current.reference.fingerprint]).toContain(fingerprint);
  if(fingerprint===current.reference.fingerprint)selectedCurrent++;
  return route.fulfill({json:fingerprint===current.reference.fingerprint?current:prior});
 });
 await page.route("**/api/investigations/replay?*",route=>{
  replays++;
  return route.fulfill({json:{...prior,status:"replayed",id,revision:1,root_fingerprint:prior.reference.fingerprint,replay:{schema:"earnings.platform_snapshot_replay.v1",policy:"platform_snapshot",cutoff,root_generation_id:golden.generation_id,selected_generation_id:golden.generation_id,scope:"retained_chain_through_saved_baseline",steps:1,public_known_replay:false,user_seen_replay:false}}});
 });
 await page.route("**/api/investigations/review?*",route=>{
  reviews++;
  return route.fulfill({json:{status:"reviewed",id,revision:1,baseline:prior.receipt,current:current.receipt,baseline_reference:prior.reference,current_reference:current.reference,review:{schema:"investigation.evidence_review.v1",summary:"incomplete",items:[{id:`source:issuer_release:${prior.workspace.selected_release.document_id}`,membership:"present",version:"revised",qualification:"unchanged",availability:"available",excluded:false,correction:false,interpretation:{comparable:false,reason:"not_applicable"}}]}}});
 });
 await page.goto(`/analysis?view=investigations&investigation=${id}&revision=1`);
 await expect(page.getByRole("button",{name:c.review,exact:true})).toBeVisible();expect(reviews+replays).toBe(0);
 await page.getByLabel(c.cutoff,{exact:true}).fill(cutoff);
 await page.getByRole("button",{name:c.replay,exact:true}).click();
 await expect(page.getByRole("heading",{name:c.selected,exact:true})).toBeVisible();
 await expect(page.getByText(prior.workspace.selected_release.document_id!,{exact:true})).toBeVisible();
 await expect(page.getByText("Snapshot facts",{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 if(info.project.name==="mobile"){
  await page.setViewportSize({width:320,height:844});
  await page.evaluate(()=>{const root=document.querySelector("main");if(!root)return;const sizes=[...root.querySelectorAll<HTMLElement>("*")].map(el=>[el,parseFloat(getComputedStyle(el).fontSize)] as const);for(const [el,size] of sizes)el.style.fontSize=`${size*2}px`;});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole("button",{name:c.review,exact:true}).focus();await expect(page.getByRole("button",{name:c.review,exact:true})).toBeFocused();
  await page.screenshot({path:info.outputPath("selected-release-320-double-text.png"),fullPage:true});
 }
 await page.getByRole("button",{name:c.review,exact:true}).click();await expect(page.getByText(c.revised,{exact:true})).toBeVisible();
 await page.getByRole("button",{name:c.advance,exact:true}).click();await expect(page.getByRole("button",{name:c.cancel,exact:true})).toBeVisible();expect(selectedCurrent).toBe(1);expect(writes).toEqual([]);
 await page.getByRole("button",{name:c.cancel,exact:true}).click();
 await page.reload();await expect(page.getByRole("button",{name:c.review,exact:true})).toBeVisible();expect(reviews).toBe(1);expect(replays).toBe(1);expect(writes).toEqual([]);
});
