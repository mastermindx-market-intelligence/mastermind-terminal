/* eslint-disable @typescript-eslint/no-require-imports -- The Next font mock and incumbent capture tools use CommonJS. */
"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {prepareFontEnvironment,responseMap,qualifyPageFonts,installFontWitness,captureCanonicalScreenshot,validateFontWitnesses}=require("./thesis_capture_fonts.cjs");
const root=path.resolve(__dirname,"../.."), assets=path.resolve(__dirname,"../fixtures/retained-fonts-34fb");
test("fixed13-buffer provenance and exactNext/layout options produce only the named mock env",()=>{
 const f=prepareFontEnvironment(root);assert.deepEqual(Object.keys(f.env),["NEXT_FONT_GOOGLE_MOCKED_RESPONSES"]);
 assert.equal(f.provenance.inputs.filter(x=>x.file.endsWith(".woff2")).length,13);
 assert.equal(f.provenance.optionsByteEqual,true);assert.equal(f.provenance.nextVersion,"16.2.9");
 const map=responseMap(root);assert.equal(Object.keys(map).length,2);
 for(const css of Object.values(map)){assert(!css.includes("FIXTURE_ASSET_ROOT"));assert(!css.includes("url(https:"));}
});
for(const kind of ["receipt","css","buffer","symlink"]){test("prelaunch refuses altered "+kind,()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"font-control-"));
 try {fs.cpSync(assets,temp,{recursive:true});const receipt=JSON.parse(fs.readFileSync(path.join(temp,"receipt.json")));
  const file=kind==="receipt"?"receipt.json":kind==="css"?receipt.families[0].localized_css:receipt.families[0].files[0].file;
  if(kind==="symlink"){fs.unlinkSync(path.join(temp,file));fs.symlinkSync(path.join(assets,file),path.join(temp,file));}
  else fs.appendFileSync(path.join(temp,file),"changed");
  assert.throws(()=>prepareFontEnvironment(root,temp),/FONT_BINDING/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});}
test("layout/font-semantic drift refuses independently of other root metadata",()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"font-root-"));
 try {fs.mkdirSync(path.join(temp,"app"));fs.symlinkSync(path.join(root,"node_modules"),path.join(temp,"node_modules"),"dir");
  const layout=fs.readFileSync(path.join(root,"app/layout.tsx"),"utf8");
  fs.writeFileSync(path.join(temp,"app/layout.tsx"),layout.replace('subsets: ["latin"]','subsets: ["greek"]'));
  assert.throws(()=>prepareFontEnvironment(temp),/FONT_BINDING/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
function controlled(glyphFamily="Inter"){
 let detached=0;
 const session={async send(method){if(method==="Runtime.evaluate")return {result:{objectId:"controlled"}};if(method==="Runtime.callFunctionOn")return {result:{value:{tag:"SPAN",fontFamily:"Inter",weight:"400",hasLatin:true,hasNumeric:true,hasOtherScript:false}}};if(method==="DOM.requestNode")return {nodeId:1};if(method==="CSS.getPlatformFontsForNode")return {fonts:[{familyName:glyphFamily,isCustomFont:glyphFamily==="Inter",glyphCount:4}]};return {};},async detach(){detached++;}};
 const page={async evaluate(){return [{family:"Inter",status:"loaded"},{family:"JetBrains Mono",status:"loaded"}];},context(){return {async newCDPSession(){return session;}};}};
 const state={pending:[],failures:[],unavailable:[],verified:new Map([["inter",{family:"Inter",subset:"latin"}],["mono",{family:"JetBrains Mono",subset:"latin"}]])};
 return {page,state,detached:()=>detached};
}
test("font availability alone cannot qualify fallback-rendered glyphs",async()=>{
 const t=controlled("Arial");await assert.rejects(()=>qualifyPageFonts(t.page,t.state),/FONT_BINDING/);assert.equal(t.detached(),1);
});
test("only verified Latin bytes plus actualcustomInter glyphs qualify",async()=>{
 const t=controlled();const result=await qualifyPageFonts(t.page,t.state);assert.equal(result.renderedGlyphs.length,4);assert.equal(t.detached(),1);
 assert.equal(result.jetBrainsAvailabilityOnly,true);
});
test("unique missing response or wrong bytes refuse; verified duplicate remains uncredited",async()=>{
 const t=controlled();t.state.unavailable.push("missing");await assert.rejects(()=>qualifyPageFonts(t.page,t.state),/FONT_BINDING/);
 t.state.verified.set("missing",{family:"Inter",subset:"latin"});assert.equal((await qualifyPageFonts(t.page,t.state)).unavailableDuplicateBodies,1);
 t.state.failures.push("FONT_BYTES");await assert.rejects(()=>qualifyPageFonts(t.page,t.state),/FONT_BINDING/);
});
test("actual page and locator entrypoints require font proof and exact complete named image hashes",async()=>{
 const {EventEmitter}=require("node:events"),{createHash}=require("node:crypto"),receipt=JSON.parse(fs.readFileSync(path.join(assets,"receipt.json")));
 const counts={},temp=fs.mkdtempSync(path.join(os.tmpdir(),"font-image-"));let shots=0;
 async function pageForContext(wrong=false){
  const controlledPage=controlled(),page=Object.assign(new EventEmitter(),controlledPage.page,{async screenshot(options){shots++;const b=Buffer.from("controlled-png-bytes");if(options.path)fs.writeFileSync(options.path,b);return b;}});
  const context={async newPage(){return page;}};installFontWitness(context,counts);await context.newPage();
  for(const family of receipt.families){const f=family.files.find(x=>x.subset==="latin");page.emit("response",{url:()=>"http://127.0.0.1:41911/_next/static/media/"+f.sha256+".woff2",status:()=>200,body:async()=>wrong?Buffer.from("wrong"):fs.readFileSync(path.join(assets,f.file))});}
  return page;
 }
 try {
  const first=await pageForContext();await captureCanonicalScreenshot(first,first,{path:path.join(temp,"one.png")});
  const second=await pageForContext();let ready=false;const evaluate=second.evaluate;second.evaluate=async(...args)=>{ready=true;return evaluate(...args);};
  const target={async scrollIntoViewIfNeeded(){assert(ready,"fonts must settle before locator geometry");},async boundingBox(){assert(ready);return {x:1,y:1,width:100,height:50};},screenshot:second.screenshot.bind(second)};
  await captureCanonicalScreenshot(second,target,{path:path.join(temp,"two.png")});
  assert.equal(counts.canonicalFontWitnesses.length,2);assert.equal(shots,2);
  assert.equal(counts.canonicalFontWitnesses[1].captureKind,"locator");
  assert.equal(counts.canonicalFontWitnesses[0].imageSha256,createHash("sha256").update("controlled-png-bytes").digest("hex"));
  validateFontWitnesses(temp,["one.png","two.png"],counts);
  const complete=counts.canonicalFontWitnesses[0];counts.canonicalFontWitnesses[0]={file:complete.file,imageSha256:complete.imageSha256,imageBytes:complete.imageBytes};
  assert.throws(()=>validateFontWitnesses(temp,["one.png","two.png"],counts),/FONT_BINDING/);counts.canonicalFontWitnesses[0]=complete;
  await second.screenshot({path:path.join(temp,"bypassed.png")});
  assert.throws(()=>validateFontWitnesses(temp,["one.png","two.png","bypassed.png"],counts),/FONT_BINDING/);
  const wrong=await pageForContext(true),wrongTarget={...target,screenshot:wrong.screenshot.bind(wrong)};
  await assert.rejects(()=>captureCanonicalScreenshot(wrong,wrongTarget,{path:path.join(temp,"three.png")}),/FONT_BINDING/);
  assert.equal(shots,3);assert.equal(counts.canonicalFontWitnesses.length,2);
  fs.writeFileSync(path.join(temp,"one.png"),"changed");assert.throws(()=>validateFontWitnesses(temp,["one.png","two.png"],counts),/FONT_BINDING/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test("all three actual success sites use the shared font boundary; FAIL crops remain uncredited",()=>{
 const expected={"capture_b_f13_6_claim_form.cjs":"captureCanonicalScreenshot(page, target,",
  "capture_b_f11_5_thesis_proposals.cjs":'captureCanonicalScreenshot(page, page.getByTestId("thesis-amendment-panel"),',
  "capture_f11_4_research_views.cjs":"captureCanonicalScreenshot(page, page,"};
 const research=fs.readFileSync(path.join(__dirname,"capture_f11_4_research_views.cjs"),"utf8");assert(research.indexOf("await runtime.waitForCanonicalFonts(page)")<research.indexOf("const box = await pane.boundingBox()"));
 for(const [file,call]of Object.entries(expected))assert(fs.readFileSync(path.join(__dirname,file),"utf8").includes(call));
});

function sourceRoleCase(mode="valid", cleanupFailure=false) {
 const vm=require("node:vm"),api=require("./thesis_capture_fonts.cjs"),css=fs.readFileSync(path.join(root,"app/globals.css"),"utf8");
 const stack=key=>css.match(new RegExp("--"+key+":([^;]+)"))[1].replace('var(--font-inter)','Inter');
 const native={tagName:"SPAN",text:"PRIVATE_UI_TEXT",fontFamily:stack("font-ui"),fonts:[{familyName:".AppleSystemUIFont",postScriptName:".SFNS-Regular",isCustomFont:false,glyphCount:8}]};
 const numeric={tagName:"SPAN",text:"123",fontFamily:stack("font-num"),fonts:[{familyName:mode==="fallback"?"Arial":"Inter",postScriptName:mode==="fallback"?"ArialMT":"Inter-Regular",isCustomFont:mode!=="fallback",glyphCount:3}]};
 const nodes=mode==="missing"?[native]:[native,numeric];
 for(const e of nodes){e.childNodes=[{nodeType:3,textContent:e.text}];e.getBoundingClientRect=()=>({x:1,y:1,top:1,left:1,width:100,height:20,right:101,bottom:21});}
 const globals={document:{body:{querySelectorAll:()=>nodes}},innerWidth:1440,innerHeight:900,getComputedStyle:e=>({fontFamily:e.fontFamily,fontWeight:"400",visibility:"visible",display:"inline",opacity:"1"})};
 const session={async send(method,p={}){
  if(method==="Runtime.evaluate"){const e=vm.runInNewContext(p.expression,globals);return{result:e?{objectId:String(nodes.indexOf(e)+1)}:{subtype:"null"}};}
  if(method==="DOM.requestNode")return{nodeId:Number(p.objectId)};
  if(method==="CSS.getPlatformFontsForNode")return{fonts:nodes[p.nodeId-1].fonts};
  if(method==="Runtime.callFunctionOn"){const e=nodes[Number(p.objectId)-1];return{result:{value:vm.runInNewContext('('+p.functionDeclaration+').call(selected)',{...globals,selected:e})}};}
  return{};
 },async detach(){if(cleanupFailure)throw Error("PRIVATE_CDP_CLEANUP_DETAIL");}};
 const page={async evaluate(){return[{family:"Inter",weight:"100 900",style:"normal",status:"loaded"},{family:"JetBrains Mono",weight:"100 800",style:"normal",status:"loaded"}];},context(){return{async newCDPSession(){return session;}};}};
 const receipt=JSON.parse(fs.readFileSync(path.join(assets,"receipt.json"))),verified=new Map(receipt.families.map(f=>{const b=f.files.find(v=>v.subset==="latin");return[f.family,{family:f.family,...b}];}));
 const state={pending:[],failures:[],unavailable:[],verified};
 return {api,page,state,nodes,session,run:()=>api.qualifyPageFonts(page,state)};
}
test("actual selector respects source-defined SF-first UI and Inter-first numerals",async()=>{
 const t=sourceRoleCase(),w=await t.run();const ui=w.renderedGlyphs.find(g=>g.kind==="native-ui"),numeric=w.renderedGlyphs.find(g=>g.kind==="numeric");
 assert(ui.present && !ui.requiresCustomInter);assert.equal(ui.selectedElement.primaryFontFamily,"-apple-system");
 assert.equal(ui.fonts[0].familyName,".AppleSystemUIFont");assert(numeric.requiresCustomInter&&numeric.fonts[0].isCustomFont);
 assert.equal(w.renderedGlyphs.find(g=>g.kind==="latin").status,"not_present");assert.equal(w.interRendering,"observed");
});
test("actual Inter-first fallback still refuses; preassertion facts survive without UI text",async()=>{
 const t=sourceRoleCase("fallback");let error;try{await t.run();assert.fail("must refuse");}catch(e){error=e;}
 assert.equal(error.message,"THESIS_CAPTURE_FONT_BINDING");const facts=t.api.fontFailureFacts(error);
 assert.equal(facts.phase,"platform-fonts");assert.equal(facts.role,"numeric");assert.equal(facts.selectedElement.primaryFontFamily,"Inter");
 assert.equal(facts.platformFonts[0].familyName,"Arial");assert.equal(facts.requiresCustomInter,true);
 assert.equal(facts.loadedFaces.length,2);assert.equal(facts.verifiedBodies.length,2);assert(facts.verifiedBodies.every(b=>/^[0-9a-f]{64}$/.test(b.sha256)));
 assert(!JSON.stringify(facts).includes("PRIVATE_UI_TEXT"));facts.role="changed";assert.equal(t.api.fontFailureFacts(error).role,"numeric");
});
test("absent visible Inter role is not invented or injected",async()=>{
 const t=sourceRoleCase("missing"),w=await t.run();assert.equal(w.interRendering,"not_present");assert.equal(t.nodes.length,1);
 for(const kind of ["latin","numeric"])assert.deepEqual(w.renderedGlyphs.find(g=>g.kind===kind),{kind,present:false,status:"not_present",requiresCustomInter:false});
});
test("CDP cleanup cannot replace the original font rejection or leak its prose",async()=>{
 const t=sourceRoleCase("fallback",true);let error;try{await t.run();assert.fail("must refuse");}catch(e){error=e;}
 assert.equal(error.message,"THESIS_CAPTURE_FONT_BINDING");const facts=t.api.fontFailureFacts(error);assert(facts.cdpCleanupFailed);
 assert.equal(facts.platformFonts[0].familyName,"Arial");assert(!JSON.stringify(facts).includes("PRIVATE_CDP_CLEANUP_DETAIL"));
});
test("frozen first-read exception identity and diagnostic isolation are preserved",async()=>{
 const t=sourceRoleCase(),error=Object.freeze(Error("PRIVATE_READ_FAILURE"));t.page.evaluate=async()=>{throw error;};
 await assert.rejects(()=>t.run(),e=>e===error);const facts=t.api.fontFailureFacts(error);assert.equal(facts.phase,"loading-faces");
 assert(!JSON.stringify(facts).includes("PRIVATE_READ_FAILURE"));assert.equal(t.api.fontFailureFacts(Object.assign(Error("foreign"),{fontObservation:{secret:true}})),null);
});

test("first platform-read exception identity survives later CDP cleanup failure",async()=>{
 const t=sourceRoleCase("valid",true),error=Object.freeze(Error("private platform read details")),send=t.session.send;
 t.session.send=async(method,params)=>{if(method==="CSS.getPlatformFontsForNode")throw error;return send(method,params);};
 await assert.rejects(()=>t.run(),e=>e===error);const facts=t.api.fontFailureFacts(error);assert(facts.cdpCleanupFailed);
 assert.equal(facts.role,"numeric");assert.equal(facts.platformFonts.length,0);assert(!JSON.stringify(facts).includes("private platform read details"));
});
