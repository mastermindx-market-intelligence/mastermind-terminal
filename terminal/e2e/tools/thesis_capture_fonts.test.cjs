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
 const session={async send(method){if(method==="Runtime.evaluate")return {result:{objectId:"controlled"}};if(method==="DOM.requestNode")return {nodeId:1};if(method==="CSS.getPlatformFontsForNode")return {fonts:[{familyName:glyphFamily,isCustomFont:glyphFamily==="Inter",glyphCount:4}]};return {};},async detach(){detached++;}};
 const page={async evaluate(){return [{family:"Inter",status:"loaded"},{family:"JetBrains Mono",status:"loaded"}];},context(){return {async newCDPSession(){return session;}};}};
 const state={pending:[],failures:[],unavailable:[],verified:new Map([["inter",{family:"Inter",subset:"latin"}],["mono",{family:"JetBrains Mono",subset:"latin"}]])};
 return {page,state,detached:()=>detached};
}
test("font availability alone cannot qualify fallback-rendered glyphs",async()=>{
 const t=controlled("Arial");await assert.rejects(()=>qualifyPageFonts(t.page,t.state),/FONT_BINDING/);assert.equal(t.detached(),1);
});
test("only verified Latin bytes plus actualcustomInter glyphs qualify",async()=>{
 const t=controlled();const result=await qualifyPageFonts(t.page,t.state);assert.equal(result.renderedGlyphs.length,3);assert.equal(t.detached(),1);
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
