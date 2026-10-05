import {expect,test} from "@playwright/test";
const id="10000000-0000-4000-8000-000000000001",tid="20000000-0000-4000-8000-000000000001",v1="30000000-0000-4000-8000-000000000001",v2="30000000-0000-4000-8000-000000000002";
const version=(id:string,n:number)=>({id,thesisId:tid,version:n,lifecycleState:"active",systemRecordedAt:"2026-10-04T00:00:00Z",content:{title:"Apple belief",statement:n===1?"Retained version one":"Current version two",catalysts:["Growth"],falsifiers:["Contraction"],risks:["Supply"],horizon:"quarters"},subject:{display:"Apple"}});
for(const lang of ["en","zh"] as const)test(`retains canonical Thesis N when head is N+1 and never publishes on read — ${lang}`,async({page},info)=>{
 const c=lang==="en"?{start:"Start new research",name:"Title",question:"Research question",browse:"Browse my Theses",item:"Apple belief · Version 2",version:"Version",role:"Role",retain:"Retain selected version",save:"Save research",open:"Open retained Theses",edit:"Edit saved question",remove:"Remove reference",empty:"No Thesis versions retained.",unavailable:"These exact Thesis versions are unavailable. Current beliefs have not replaced them."}:{start:"开始新研究",name:"标题",question:"研究问题",browse:"浏览个人论点",item:"Apple belief · 版本 2",version:"版本",role:"角色",retain:"保留所选版本",save:"保存研究",open:"打开保留论点",edit:"编辑问题",remove:"移除引用",empty:"未保留论点版本。",unavailable:"这些确切论点版本暂不可用，未替换为当前观点。"};
 const mobile=/mobile/i.test(info.project.name);
 await page.addInitScript(lang=>{localStorage.setItem("mm.lang",lang);sessionStorage.clear();},lang);
 const writes:Array<{path:string;body:any}>=[];let saved:any=null,reads=0,missing=false;
 page.on("request",request=>{const path=new URL(request.url()).pathname;if(request.method()!=="GET"&&path.startsWith("/api/")&&path!=="/api/collect")writes.push({path,body:request.postDataJSON()});});
 await page.route("**/api/layouts",route=>route.fulfill({json:{layouts:[],teams:[],teamRead:{ok:true}}}));
 await page.route("**/api/theses{,?*}",route=>route.fulfill({json:new URL(route.request().url()).searchParams.has("id")?{thesis:{id:tid,current:version(v2,2),history:[version(v2,2),version(v1,1)],historyTruncated:false}}:{theses:[{id:tid,title:"Apple belief",currentVersion:2}],truncated:false}}));
 await page.route("**/api/investigations{,?*}",route=>{
  if(route.request().method()==="POST"){
   const command=route.request().postDataJSON();saved={status:"found",id:command.id,revision:command.expected_revision+1,current_revision:command.expected_revision+1,lifecycle:"active",manifest:command.manifest,committed_at:"2026-10-04T00:00:00Z",layouts:[]};
   return route.fulfill({json:{...saved,status:"committed"}});
  }
  return route.fulfill({json:new URL(route.request().url()).searchParams.has("id")?saved:{status:"listed",items:saved?[{id:saved.id,revision:saved.revision,lifecycle:"active",title:saved.manifest.intent.title,question:saved.manifest.intent.question,updated_at:saved.committed_at}]:[]}});
 });
 await page.route("**/api/investigations/theses?*",route=>{reads++;return route.fulfill({json:{status:"resolved",id:saved.id,revision:saved.revision,items:saved.manifest.thesis_refs.map((ref:any)=>missing?{ref,status:"unavailable"}:{ref,status:"available",version:version(v1,1)})}});});
 await page.goto("/analysis?view=investigations");await page.getByRole("button",{name:c.start,exact:true}).click();await page.getByLabel(c.name,{exact:true}).fill("Apple version study");await page.getByLabel(c.question,{exact:true}).fill("What changed in the belief?");
 await page.getByRole("button",{name:c.browse,exact:true}).click();await page.getByRole("button",{name:c.item,exact:true}).click();await page.getByRole("combobox",{name:c.version,exact:true}).selectOption(v1);await page.getByRole("combobox",{name:c.role,exact:true}).selectOption("alternative");expect(writes).toHaveLength(0);
 await page.getByRole("button",{name:c.retain,exact:true}).click();expect(writes).toHaveLength(0);await page.getByRole("button",{name:c.save,exact:true}).click();await expect(page.getByRole("heading",{name:"Apple version study",exact:true})).toBeVisible();expect(writes).toHaveLength(1);expect(writes[0].path).toBe("/api/investigations");expect(writes[0].body.manifest.thesis_refs).toEqual([{thesis_id:tid,version_id:v1,role:"alternative"}]);expect(reads).toBe(0);
 await page.getByRole("button",{name:c.open,exact:true}).click();await expect(page.getByText("Retained version one",{exact:true})).toBeVisible();await expect(page.getByText("Current version two",{exact:true})).toHaveCount(0);expect(writes).toHaveLength(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByText("Retained version one",{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath("retained-thesis-version.png"),fullPage:true});
 if(mobile){
  const openBtn=page.getByRole("button",{name:c.open,exact:true}),statement=page.getByText("Retained version one",{exact:true});
  await page.setViewportSize({width:320,height:844});
  await page.evaluate(()=>{
   const main=document.querySelector("main");if(!main)throw new Error("Missing research main");
   const snapshot=[...main.querySelectorAll<HTMLElement>("*")].map(el=>({el,size:parseFloat(getComputedStyle(el).fontSize)}));
   for(const {el,size} of snapshot)el.style.fontSize=`${size*2}px`;
  });
  const nodes=[statement,openBtn];
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  for(const loc of nodes){await expect(loc).toBeVisible();const box=await loc.boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(-1);expect(box!.x+box!.width).toBeLessThanOrEqual(321);}
  await openBtn.focus();await page.keyboard.press("Shift+Tab");await page.keyboard.press("Tab");await expect(openBtn).toBeFocused();await page.keyboard.press("Enter");
  await expect(statement).toBeVisible();await expect(page.getByText("Current version two",{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(writes).toHaveLength(1);
  await page.screenshot({path:info.outputPath("retained-thesis-320-double-text.png"),fullPage:true});
 }
 missing=true;await page.getByRole("button",{name:c.open,exact:true}).click();await expect(page.getByText(c.unavailable,{exact:true})).toBeVisible();await expect(page.getByText("Retained version one",{exact:true})).toHaveCount(0);
 await page.reload();await expect(page.getByRole("heading",{name:"Apple version study",exact:true})).toBeVisible();expect(reads).toBe(mobile?3:2);expect(writes).toHaveLength(1);
 await page.getByRole("button",{name:c.edit,exact:true}).click();await page.getByRole("button",{name:c.remove,exact:true}).click();await expect(page.getByText(c.empty,{exact:true})).toBeVisible();expect(writes).toHaveLength(1);await page.getByRole("button",{name:c.save,exact:true}).click();await expect(page.getByRole("heading",{name:"Apple version study",exact:true})).toBeVisible();expect(writes).toHaveLength(2);expect(writes[1].body.manifest.thesis_refs).toEqual([]);expect(writes[1].body.expected_revision).toBe(1);
});
