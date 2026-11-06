import { expect, test, type Page, type TestInfo } from "@playwright/test";
const SOURCE = '//@version=6\nindicator("D06")\nplot(close)';
const labels = {
 en: { check:"Check saved version", keep:"Keep my edits", load:"Load saved version", replace:"Replace current edits", run:"Run diagnostics", cancel:"Keep editing", saveSwitch:"Save and switch", libraryRetry:"Retry library" },
 zh: { check:"检查已保存版本", keep:"保留我的编辑", load:"加载已保存版本", replace:"替换当前编辑", run:"运行检查", cancel:"继续编辑", saveSwitch:"保存并切换", libraryRetry:"重试脚本库" },
};
async function open(page: Page, info: TestInfo, baseURL: string | undefined, lang: "en"|"zh", fault=false) {
 const key = ("d06-" + info.project.name + "-" + lang + "-" + info.title + "-" + Date.now()).replace(/[^a-z0-9-]/gi,"-").slice(0,110);
 await page.context().addCookies([{name:"mm_e2e_scripts",value:key,url:baseURL!},...(fault?[{name:"mm_e2e_script_fault",value:"1",url:baseURL!}]:[])]);
 await page.addInitScript((value)=>localStorage.setItem("mm.lang",value),lang);
 await page.goto("/scripts");
 await expect(page.locator(".editor textarea")).toBeVisible();
 await expect(page.locator(".editor textarea")).toBeEnabled();
 await expect(page.locator("html")).toHaveAttribute("data-lang",lang);
 return key;
}
async function selectEditable(page: Page) {
 await page.locator(".script-row",{hasText:"My Momentum"}).click();
 await expect(page.locator(".editor textarea")).toHaveValue(/plot\(close\)/);
}
async function noOuterOverflow(page: Page) {
 expect(await page.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
for (const lang of ["en","zh"] as const) {
 const l=labels[lang];
 test("unknown save requires explicit readback and preserves later edits in "+lang,async({page,baseURL},info)=>{
  await open(page,info,baseURL,lang); await selectEditable(page);
  let writes=0,reads=0,posted: {id:string;name:string;source:string;params:Record<string,unknown>;expected_updated_at:string}|undefined;
  await page.route("**/api/scripts/save",async route=>{writes++;posted=route.request().postDataJSON();await route.fulfill({status:200,contentType:"application/json",body:"{unconfirmed"});});
  await page.route("**/api/scripts/list",async route=>{
   reads++;
   const response=await route.fetch();const body=await response.json();
   if(reads>1)body.scripts=body.scripts.map((row:Record<string,unknown>)=>row.id===posted!.id?{...row,...posted,updated_at:"2026-11-04T09:00:00.000123Z"}:row);
   await route.fulfill({response,body:JSON.stringify(body)});
  });
  const editor=page.locator(".editor textarea"),save=page.locator("[data-script-save]"),add=page.locator("[data-script-add]");
  await editor.fill(SOURCE+"\n// ATTEMPT"); await save.click();
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state","unknown");
  await editor.fill(SOURCE+"\n// NEWER");
  await expect(save).toBeDisabled();await expect(add).toBeDisabled();
  await page.getByRole("button",{name:l.check,exact:true}).click();
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state","unresolved");
  expect(writes).toBe(1);expect(reads).toBe(1);
  await page.getByRole("button",{name:l.check,exact:true}).click();
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state","matched");
  await expect(editor).toHaveValue(/NEWER/); await expect(save).toBeEnabled();expect(writes).toBe(1);
  expect(new URL(page.url()).pathname).toBe("/scripts");
  await noOuterOverflow(page);
  await page.screenshot({path:info.outputPath("scripts-readback-"+lang+".png"),fullPage:true});
 });

 test("keyboard picker and unsaved dialog keep a stable return target in "+lang,async({page,baseURL},info)=>{
  test.skip(info.project.name!=="desktop","One keyboard sequence; narrow controls covered separately");
  await open(page,info,baseURL,lang);await selectEditable(page);
  await page.locator(".editor textarea").fill(SOURCE+"\n// KEYBOARD-DRAFT");
  const picker=page.locator(".pine-script-picker>.pair");
  await picker.focus();await page.keyboard.press("Enter");
  const target=page.locator("#pine-script-picker").getByRole("button",{name:"My Reversion",exact:true});
  await target.focus();await page.keyboard.press("Enter");
  const dialog=page.getByRole("dialog");
  await expect(dialog).toBeVisible();await expect(dialog.getByRole("button",{name:l.cancel,exact:true})).toBeFocused();
  await page.keyboard.press("Shift+Tab");await expect(dialog.getByRole("button",{name:l.saveSwitch,exact:true})).toBeFocused();
  await page.keyboard.press("Tab");await expect(dialog.getByRole("button",{name:l.cancel,exact:true})).toBeFocused();
  await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(picker).toBeFocused();
  await expect(page.locator(".editor textarea")).toHaveValue(/KEYBOARD-DRAFT/);
 });

 test("code, diagnostics and library remain reachable at narrow widths in "+lang,async({page,baseURL},info)=>{
  await open(page,info,baseURL,lang);
  await expect(page.locator(".editor textarea")).toHaveAttribute("readonly","");
  await expect(page.locator("[data-script-add]")).toBeDisabled();
  const inputControls=page.locator(".pine .stepper button");
  for(const control of await inputControls.all()){const r=await control.boundingBox();expect(r!.width).toBeGreaterThanOrEqual(44);expect(r!.height).toBeGreaterThanOrEqual(44);}
  await selectEditable(page);
  const editor=page.locator(".editor textarea");
  await editor.fill(SOURCE+"\n// "+ "wide source ".repeat(45));
  await page.getByRole("button",{name:l.run,exact:true}).click();
  await expect(page.locator("[data-diagnostics-state]")).toHaveAttribute("data-diagnostics-state","done",{timeout:15_000});
  await expect(page.locator(".pine-diagnostic-scope")).toContainText("130");
  const widths=info.project.name==="desktop"?[1440,1024,320]:[page.viewportSize()!.width];
  for(const width of widths){
   await page.setViewportSize({width,height:900});await noOuterOverflow(page);
   const extent=await page.locator(".editor").evaluate(n=>({client:n.clientWidth,scroll:n.scrollWidth}));
   expect(extent.scroll).toBeGreaterThan(extent.client);
   await page.locator(".pine-side .side-sec").last().scrollIntoViewIfNeeded();
   await expect(page.locator(".pine-side .side-sec").last()).toBeInViewport();
   await page.locator(".pine-topbar").scrollIntoViewIfNeeded();
   await page.screenshot({path:info.outputPath("scripts-"+lang+"-"+width+".png"),fullPage:true});
  }
  await editor.fill('//@version=6\nindicator("D06")\nplot(close *');
  await page.getByRole("button",{name:l.run,exact:true}).click();
  await expect(page.locator("[data-diagnostics-state]")).toHaveAttribute("data-diagnostics-state","done",{timeout:15_000});
  await expect(page.locator("[data-script-add]")).toBeDisabled();
  await expect(page.locator(".console")).toContainText(lang==="en"?"error":"错误");
 });

 test("library unavailable can retry without inventing an empty account in "+lang,async({page,baseURL},info)=>{
  await open(page,info,baseURL,lang,true);
  await expect(page.locator("[data-scripts-status]")).toHaveAttribute("data-scripts-status","unavailable");
  await expect(page.locator(".script-row")).toHaveCount(1);
  await page.context().clearCookies({name:"mm_e2e_script_fault"});
  await page.getByRole("button",{name:l.libraryRetry,exact:true}).click();
  await expect(page.locator("[data-scripts-status]")).toHaveCount(0);
  await expect(page.locator(".script-row")).toHaveCount(3);
  await selectEditable(page);await noOuterOverflow(page);
 });


  test("conflicting saved revision requires an explicit replacement in "+lang,async({page,baseURL},info)=>{
   await open(page,info,baseURL,lang);await selectEditable(page);
   let writes=0,posted:Record<string,unknown>|undefined;
   await page.route("**/api/scripts/save",async route=>{writes++;posted=route.request().postDataJSON();await route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({error:"conflict"})});});
   const remote=SOURCE+"\n// SAVED-ELSEWHERE";
   await page.route("**/api/scripts/list",async route=>{
    const response=await route.fetch(),body=await response.json();
    body.scripts=body.scripts.map((row:Record<string,unknown>)=>row.id===posted!.id?{...row,source:remote,updated_at:"2026-11-04T10:00:00.000123Z"}:row);
    await route.fulfill({response,body:JSON.stringify(body)});
   });
   const editor=page.locator(".editor textarea");await editor.fill(SOURCE+"\n// LOCAL-CONTENTS");
   await page.locator("[data-script-save]").click();
   await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state","conflict");
   await page.getByRole("button",{name:l.check,exact:true}).click();
   await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state","different");
   await page.getByRole("button",{name:l.load,exact:true}).click();
   await expect(editor).toHaveValue(/LOCAL-CONTENTS/);
   await expect(page.getByRole("button",{name:l.replace,exact:true})).toBeVisible();
   await noOuterOverflow(page);
   await page.screenshot({path:info.outputPath("scripts-conflict-"+lang+".png"),fullPage:true});
   await page.getByRole("button",{name:l.replace,exact:true}).click();
   await expect(editor).toHaveValue(remote);
   await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state","loaded");
   expect(writes).toBe(1);
  });

 test("shared-shell light presentation uses the existing owner in "+lang,async({page,baseURL},info)=>{
  test.skip(process.env.MMX_SHARED_SHELL!=="1","Existing explicit shared-shell opt-in");
  await open(page,info,baseURL,lang);await selectEditable(page);
  await page.getByRole("button",{name:lang==="en"?"Light theme":"浅色主题",exact:true}).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme","light");
  await page.locator(".editor textarea").fill(SOURCE+"\n// LIGHT-"+lang);
  await noOuterOverflow(page);
  await page.locator(".pine-topbar").scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath("scripts-light-"+lang+".png"),fullPage:true});
  await page.locator(".pine-side .side-sec").last().scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath("scripts-light-inputs-"+lang+".png"),fullPage:true});
 });
}

test("checked saved script reaches the existing Terminal chart owner",async({page,baseURL},info)=>{
 test.skip(info.project.name!=="desktop","One real route/engine integration; responsive editor covered separately");
 await open(page,info,baseURL,"en");await selectEditable(page);
 let writes=0,posted:Record<string,unknown>|undefined;
 const revision="2026-11-04T10:00:00.000123Z";
 await page.route("**/api/scripts/save",async route=>{
  writes++;posted=route.request().postDataJSON();
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,id:posted!.id,updated_at:revision})});
 });
 await page.route("**/api/scripts/list",async route=>{
  const response=await route.fetch();const body=await response.json();
  if(posted)body.scripts=body.scripts.map((row:Record<string,unknown>)=>row.id===posted!.id?{...row,...posted,updated_at:revision}:row);
  await route.fulfill({response,body:JSON.stringify(body)});
 });
 await page.locator(".editor textarea").fill('//@version=6\nindicator("D06 saved chart", overlay=true)\nplot(close)');
 await page.getByRole("button",{name:labels.en.run,exact:true}).click();
 await expect(page.locator("[data-diagnostics-state]")).toHaveAttribute("data-diagnostics-state","done");
 await expect(page.locator("[data-script-add]")).toBeEnabled();
 await page.locator("[data-script-add]").click();
 await expect(page).toHaveURL(/\/terminal(?:\?|$)/);
 await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({timeout:60_000});
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("mm.pineOn")||"[]"))).toContain(posted!.id);
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {__mmChartOwnership?:()=>{owned:{pine:number}}}).__mmChartOwnership?.().owned.pine??0),{timeout:30_000}).toBeGreaterThan(0);
 expect(new URL(page.url()).searchParams.has("addScript")).toBe(false);expect(writes).toBe(1);
 await page.screenshot({path:info.outputPath("scripts-added-to-chart.png"),fullPage:true});
});
