/* eslint-disable @typescript-eslint/no-require-imports -- Incumbent controlled capture tools use CommonJS. */
"use strict";
const {createHash}=require("node:crypto");
const LIGHT_MODE="shared-shell-light-bodies", DARK_MODE="shared-shell-dark-bodies";
function captureMode(args){
  if(Array.isArray(args) && args.length===0)return "dark";
  if(Array.isArray(args) && args.length===1 && args[0]==="--light-representative")return LIGHT_MODE;
  if(Array.isArray(args) && args.length===1 && args[0]==="--dark-representative")return DARK_MODE;
  throw Error("THESIS_CAPTURE_PRESENTATION_SCOPE");
}
function plan(family,mode=LIGHT_MODE){
  if(!["research","proposals"].includes(family))throw Error("THESIS_CAPTURE_LIGHT_FAMILY");
  if(mode===DARK_MODE)return [{width:1440,lang:"en",surface:family==="research"?"save-flow":"populated",file:`dark-${family==="research"?"save-flow":"populated"}-1440-en.png`,theme:"dark"}];
  if(mode!==LIGHT_MODE)throw Error("THESIS_CAPTURE_PRESENTATION_SCOPE");
  return [1440,390].flatMap(width=>["en","zh"].map(lang=>{
    const surface=family==="research" ? (width===1440 && lang==="zh" ? "view-subject-empty" : "save-flow") : "populated";
    return {width,lang,surface,file:`light-${surface}-${width}-${lang}.png`};
  }));
}
// Only the existing public PresentationOwner controls change theme/locale.
async function settleOwner(page,lang,theme="light"){
  if(!["light","dark"].includes(theme))throw Error("THESIS_CAPTURE_PRESENTATION_SCOPE");
  if(!["en","zh"].includes(lang))throw Error("THESIS_CAPTURE_LIGHT_LOCALE");
  await page.locator('[data-shared-shell="beta"]').waitFor({state:"visible",timeout:45000});
  await page.waitForFunction(()=>document.documentElement.dataset.mmxSharedShell==="1",null,{timeout:15000});
  const light=page.getByRole("button",{name:/^(Light theme|浅色主题)$/});
  await light.waitFor({state:"visible"});
  if(await light.getAttribute("aria-pressed")!==(theme==="light"?"true":"false"))await light.click();
  const locale=page.getByRole("button",{name:/^(Chinese language|中文界面)$/});
  await locale.waitFor({state:"visible"});
  if(await locale.getAttribute("aria-pressed")!==(lang==="zh" ? "true" : "false"))await locale.click();
  await page.waitForFunction(({requested,theme})=>{
    const root=document.documentElement;
    return root.dataset.mmxSharedShell==="1" && root.dataset.theme===theme && root.dataset.lang===requested;
  },{requested:lang,theme},{timeout:15000});
}
function assertObservation(facts,shot){
  const theme=shot.theme??"light";
  if(![1440,390].includes(shot.width) || !["en","zh"].includes(shot.lang)
    || !["light","dark"].includes(theme) || (theme==="dark" && (shot.width!==1440 || shot.lang!=="en"))
    || facts.sharedShell!=="1" || facts.theme!==theme || facts.lang!==shot.lang
    || facts.lightPressed!==(theme==="light"?"true":"false") || facts.localePressed!==(shot.lang==="zh" ? "true" : "false")
    || facts.viewport.width!==shot.width || facts.viewport.height!==(shot.width===1440?900:844)
    || facts.panelToken!==(theme==="light"?"#ffffff":"#181b21") || facts.textToken!==(theme==="light"?"#202632":"#d7dce3")
    || !Number.isFinite(facts.body.width) || facts.body.width<=0 || !Number.isFinite(facts.body.height) || facts.body.height<=0)
    throw Error("THESIS_CAPTURE_LIGHT_PRESENTATION");
  return facts;
}
// Read-only rendering facts for the finite Family4c22 two-panel audit. Missing
// conditional roles stay absent; this observer adds no threshold or state action.
function observeSmallTextRendering(element){
  try {
    const box=node=>{const b=node.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
    const visible=node=>{const s=getComputedStyle(node),b=box(node);return s.display!=="none" && s.visibility!=="hidden" && b.width>0 && b.height>0;};
    const style=node=>{const s=getComputedStyle(node);return {color:s.color,backgroundColor:s.backgroundColor,opacity:s.opacity,
      fontSize:s.fontSize,fontFamily:s.fontFamily.slice(0,256),fontWeight:s.fontWeight,fontStyle:s.fontStyle,lineHeight:s.lineHeight,
      display:s.display,visibility:s.visibility,box:box(node)};};
    const ancestors=(node,limit=8)=>{const rows=[];let current=node;
      while(current && rows.length<limit){const s=getComputedStyle(current);rows.push({tag:current.tagName,backgroundColor:s.backgroundColor,opacity:s.opacity,display:s.display,visibility:s.visibility});current=current.parentElement;}
      return {rows,truncated:!!current};};
    const definitions=[
      ["research-count",'[data-testid="thesis-lens-rail"] [role="tab"] > span:nth-child(2)',12],
      ["research-scope",'[data-testid="rms-scope"]',1],
      ["research-name",'input[aria-label="Name this view"],input[aria-label="为这个视图命名"]',1],
      ["notes-heading",'[data-testid="thesis-assistant-notes"] h2',1],
      ["notes-help",'[data-testid="thesis-assistant-notes"] > p',1],
      ["notes-label",'[data-testid="thesis-assistant-notes"] > label',1],
      ["notes-input",'[data-testid="thesis-assistant-notes"] textarea',1],
      ["suggest",'[data-testid="thesis-suggest-amendment"]',1],
      ["proposals-heading",'[data-testid="thesis-proposals"] h2',1],
      ["proposal-count",'[data-testid="thesis-proposals"] > div:first-child > span',1],
      ["ceiling",'[data-testid="thesis-proposals-ceiling"]',1],
      ["loading-empty-unavailable",'[data-testid="thesis-proposals-loading"],[data-testid="thesis-proposals-empty"],[data-testid="thesis-proposals-unavailable"] p',1],
      ["body",'[data-testid="thesis-proposal-row"] > p:first-child',3],
      ["based-on",'[data-testid="thesis-proposal-row"] > p:nth-child(2)',3],
      ["status",'[data-testid="thesis-proposal-row"] i[data-state]',3],
      ["time",'[data-testid="thesis-proposal-row"] time',3],
      ["accept",'[data-testid="thesis-proposal-row"] > div > button:first-child',1],
      ["reject",'[data-testid="thesis-proposal-row"] > div > button:nth-child(2)',1],
      ["retry",'[data-testid="thesis-proposals-unavailable"] button',1],
    ];
    const roles=definitions.map(([role,selector,limit])=>{
      const matches=[...element.querySelectorAll(selector)],shown=matches.filter(visible);
      return {role,present:matches.length>0,visible:shown.length>0,matched:matches.length,omitted:Math.max(0,shown.length-limit),
        entries:shown.slice(0,limit).map(node=>({style:style(node),ancestors:ancestors(node,4),disabled:node.matches(":disabled"),
          selected:node.closest('[role="tab"]')?.getAttribute("aria-selected")??null,state:["proposed","accepted","rejected"].includes(node.dataset.state)?node.dataset.state:null}))};
    });
    const names=[...element.querySelectorAll('input[aria-label="Name this view"],input[aria-label="为这个视图命名"]')],input=names.find(visible);
    let namingInput={present:names.length>0,visible:!!input,matched:names.length};
    if(input){
      const pseudo=getComputedStyle(input,"::placeholder"),placeholder=input.getAttribute("placeholder")??"",save=input.closest("form")?.querySelector('button[type="submit"]');
      namingInput={...namingInput,enabled:!input.matches(":disabled"),disabledProperty:input.disabled,readOnly:input.readOnly,valueEmpty:input.value==="",
        placeholder:["Name this view","为这个视图命名"].includes(placeholder)?placeholder:"other",placeholderLength:placeholder.length,
        placeholderMatchesLocale:placeholder===(document.documentElement.dataset.lang==="zh"?"为这个视图命名":"Name this view"),
        inputStyle:style(input),ancestors:ancestors(input),placeholderStyle:{color:pseudo.color,opacity:pseudo.opacity,fontSize:pseudo.fontSize,fontFamily:pseudo.fontFamily.slice(0,256),fontWeight:pseudo.fontWeight,fontStyle:pseudo.fontStyle,lineHeight:pseudo.lineHeight},
        saveButton:save?{present:true,disabled:save.matches(":disabled"),style:style(save)}:{present:false}};
    }
    return {status:"observed",scope:"finite-two-panel-small-text-rendering-facts-not-contrast-verdict",roles,namingInput};
  }catch{return {status:"unavailable",scope:"finite-two-panel-small-text-rendering-facts-not-contrast-verdict",roles:[],namingInput:{present:false},reason:"computed-style-observation-unavailable"};}
}
async function observe(page,target,shot){
  const lightPressed=await page.getByRole("button",{name:/^(Light theme|浅色主题)$/}).getAttribute("aria-pressed");
  const localePressed=await page.getByRole("button",{name:/^(Chinese language|中文界面)$/}).getAttribute("aria-pressed");
  const facts=await target.evaluate(element=>{
    const root=document.documentElement,style=getComputedStyle(element),box=element.getBoundingClientRect();
    const bounds=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
    const controls=[...element.querySelectorAll("button,input,select,textarea")];
    return {sharedShell:root.dataset.mmxSharedShell,theme:root.dataset.theme,lang:root.dataset.lang,
      viewport:{width:innerWidth,height:innerHeight},panelToken:style.getPropertyValue("--panel").trim(),textToken:style.getPropertyValue("--text").trim(),
      body:{x:box.x,y:box.y,width:box.width,height:box.height,background:style.backgroundColor,color:style.color,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth},
      documentWidth:root.scrollWidth,controls:controls.slice(0,32).map(e=>({tag:e.tagName,type:e.getAttribute("type"),...bounds(e),scheme:getComputedStyle(e).colorScheme})),
      omittedControls:Math.max(0,controls.length-32)};
  });
  const smallTextRendering=await target.evaluate(observeSmallTextRendering);
  return assertObservation({...facts,lightPressed,localePressed,smallTextRendering},shot);
}
function retainStyles(page,base){
  const pending=[],delivered=[];let failure;
  page.on("response",response=>{
    try{
      if(response.request().resourceType()!=="stylesheet")return;
      const url=new URL(response.url());
      if(url.origin!==base || url.username || url.password || !url.pathname.startsWith("/_next/static/") || pending.length>=32)
        throw Error("THESIS_CAPTURE_LIGHT_CSS_SCOPE");
      pending.push((async()=>{
        const body=await response.body();
        if(response.status()!==200 || body.length>4*1024*1024)throw Error("THESIS_CAPTURE_LIGHT_CSS_SCOPE");
        const text=body.toString();delivered.push({path:url.pathname,bytes:body.length,sha256:createHash("sha256").update(body).digest("hex"),
          sharedShell:text.includes("data-mmx-shared-shell"),workspace:text.includes("ThesisWorkspace")});
      })().catch(error=>{failure ||= error;}));
    }catch(error){failure ||= error;}
  });
  return async()=>{await Promise.all(pending);if(failure)throw failure;
    if(!delivered.some(x=>x.sharedShell) || !delivered.some(x=>x.workspace))throw Error("THESIS_CAPTURE_LIGHT_CSS_MISSING");
    return delivered.sort((a,b)=>a.path.localeCompare(b.path));};
}
function assertComplete(family,files,observations,mode=LIGHT_MODE){
  const shots=plan(family,mode);
  const expected=shots.map(s=>s.file).sort();
  if(JSON.stringify([...files].sort())!==JSON.stringify(expected) || observations.length!==shots.length
    || new Set(observations.map(o=>o.file)).size!==shots.length)throw Error("THESIS_CAPTURE_LIGHT_INCOMPLETE");
  for(const shot of shots){
    const item=observations.find(o=>o.file===shot.file);
    if(!item || !Array.isArray(item.deliveredStyles) || !item.deliveredStyles.some(s=>s.sharedShell) || !item.deliveredStyles.some(s=>s.workspace))throw Error("THESIS_CAPTURE_LIGHT_INCOMPLETE");
    assertObservation(item.facts,shot);
  }
}
const SOURCE_FILES=["terminal/components/workspaces/ThesisWorkspace.tsx", "terminal/components/workspaces/ThesisWorkspace.module.css", "terminal/lib/rmsViews.ts", "terminal/lib/savedViews.ts", "terminal/lib/plainLabels.ts", "terminal/lib/i18n.tsx", "terminal/lib/thesisAmendmentProposals.ts", "terminal/components/chrome/shared-shell/SharedShellPresentation.tsx", "terminal/components/chrome/shared-shell/shared-shell.css", "terminal/components/chrome/AppShell.tsx", "terminal/app/layout.tsx", "terminal/e2e/tools/capture_f11_4_research_views.cjs", "terminal/e2e/tools/capture_b_f11_5_thesis_proposals.cjs", "terminal/e2e/tools/thesis_capture_runtime.cjs", "terminal/e2e/tools/thesis_capture_light_bodies.cjs"];
module.exports={observeSmallTextRendering,SOURCE_FILES,LIGHT_MODE,DARK_MODE,captureMode,plan,settleOwner,observe,assertObservation,retainStyles,assertComplete};
