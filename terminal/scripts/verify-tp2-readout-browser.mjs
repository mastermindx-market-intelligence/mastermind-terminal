/** Offline synthetic TP-2 browser QA. No network, R2, auth, route or deployment.
 * Run: node terminal/scripts/verify-tp2-readout-browser.mjs */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import esbuild from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import {chromium} from "playwright";

const terminal=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const req=createRequire(import.meta.url);
const fixtures=[
  ["tp2PrivateView.synthetic.v0.json",3394,"8c1ee4f865566f013d7a5805fccdd11c031223d39c6d8ec6b66968cbdc35f60b"],
  ["tp2R0Sidecar.synthetic.v0.json",1541,"fe03401a908d26230aa6f8426f9dd9318249a0cdd2eac256ed93786a0a48b715"],
];
const data=fixtures.map(([file,size,sha])=>{
 const b=fs.readFileSync(path.join(terminal,"lib/__tests__/fixtures",file));
 assert.equal(b.length,size);
 assert.equal(createHash("sha256").update(b).digest("hex"),sha);
 return b;
});
function luminance(cssRgb) {
 const match=/^rgb\((\d+), (\d+), (\d+)\)$/.exec(cssRgb);
 assert.ok(match,"expected resolved RGB theme token: "+cssRgb);
 const lin=[Number(match[1]),Number(match[2]),Number(match[3])].map(v=>{
  const channel=v/255;
  return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4;
 });
 return lin[0]*0.2126+lin[1]*0.7152+lin[2]*0.0722;
}
function contrastRatio(foreground,background) {
 const a=luminance(foreground),b=luminance(background);
 return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}
const screenshotDir=process.env.TP2_BROWSER_SCREENSHOT_DIR;
if(screenshotDir && (!path.isAbsolute(screenshotDir) ||
   !screenshotDir.startsWith(path.join(terminal,".tp2-"))))
 throw new Error("Screenshots must stay in a local .tp2- review path");
const temporary=fs.mkdtempSync(path.join(terminal,".tp2-browser-review-"));
let browser;
try {
 const outdir=path.join(temporary,"modules");
 await esbuild.build({entryPoints:{
   reader:path.join(terminal,"lib/tp2PrivateEvidence.ts"),
   view:path.join(terminal,"components/offexchange/Tp2ResearchReadout.tsx")
 },outdir,platform:"node",format:"cjs",bundle:true,target:["node20"],
   external:["react"],logLevel:"silent"});
 const {decodeTp2PrivateArtifact,decodeTp2R0Sidecar}=req(path.join(outdir,"reader.js"));
 const {Tp2ResearchReadout}=req(path.join(outdir,"view.js"));
 const evidence=decodeTp2PrivateArtifact({bytes:data[0],
   expectedSha256:fixtures[0][2],expectedLength:data[0].length,
   requestedAsOfNs:"1791478890000000001"});
 const r0=decodeTp2R0Sidecar({bytes:data[1],
   expectedSha256:fixtures[1][2],expectedLength:data[1].length,
   requestedAsOfNs:"1791478890000000001"});
 const cssInput='@import "tailwindcss" source(none);\n@source "../components/offexchange/Tp2ResearchReadout.tsx";\n';
 const css=(await postcss([tailwind()]).process(cssInput,{from:path.join(temporary,"review.css")})).css;
 assert.ok(css.includes("grid-cols-1")&&css.includes("grid-cols-3"),"Tailwind grid CSS missing");
 const style=[
  "html,body{margin:0;box-sizing:border-box;width:100%;background:var(--bg);color:var(--text);font-family:Arial,sans-serif}",
  "*,*::before,*::after{box-sizing:inherit}",
  ":root{--bg:#0a0b0e;--panel:#0d0f13;--panel-2:#15171d;--line:#23262f;--text:#d6dae3;--text-2:#9ba3b4;--muted:#717a8e;--warn:#e8a33d;--font-num:Arial,sans-serif}",
  'html[data-preview="light"]{--bg:#f4f6f9;--panel:#fff;--panel-2:#f0f3f7;--line:#d2d9e2;--text:#17202f;--text-2:#3a4b62;--muted:#586579;--warn:#825500}',
  "body{padding:16px;min-height:100vh}",
 ].join("\n");
 browser=await chromium.launch({headless:true});
 const scenarios=[
  [390,844,"en","dark"],[390,844,"zh","dark"],
  [390,844,"en","light"],[390,844,"zh","light"],
  [768,1024,"en","dark"],[768,1024,"zh","light"],
  [1440,900,"en","dark"],[1440,900,"zh","dark"],
  [1440,900,"en","light"],[1440,900,"zh","light"],
 ];
 const results=[];
 for(const [width,height,lang,theme] of scenarios) {
  const page=await browser.newPage({viewport:{width,height}});
  const markup=renderToStaticMarkup(React.createElement(Tp2ResearchReadout,{
   evidence,r0,lang,privateViewAuthorized:true,
  }));
  const html='<!doctype html><html data-preview="'+theme+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><style>'+style+'</style></head><body>'+markup+'</body></html>';
  await page.setContent(html,{waitUntil:"load"});
  const actual=await page.evaluate(()=>{
   const shell=document.querySelector('[data-testid="tp2-private-research"]');
   const grid=shell?.querySelector(".grid");
   const gridStyle=grid?getComputedStyle(grid):null;
   const s=shell?getComputedStyle(shell):null;
   return {width:Math.max(document.body.scrollWidth,document.documentElement.scrollWidth),
    columns:gridStyle?.gridTemplateColumns.trim().split(/\s+/).length??0,
    sections:["tp2-provisional","tp2-history","tp2-delayed"].filter(
     n=>document.querySelector('[data-testid="'+n+'"]')).length,
    text:shell?.textContent??"",background:s?.backgroundColor??"",
    foreground:s?.color??"",actions:document.querySelectorAll("a[href],button,script").length};
  });
  assert.equal(actual.sections,3);
  assert.ok(actual.width<=width+1,"horizontal overflow "+width+" => "+actual.width);
  assert.equal(actual.columns,width>=1024?3:1,"responsive columns");
  assert.equal(actual.actions,0,"unexpected action");
  assert.ok(actual.text.includes("$250,000")&&actual.text.includes("$500,000"));
  assert.ok(!actual.text.includes("$750,000"));
  assert.ok(lang==="en"?actual.text.includes("Historical observations"):actual.text.includes("历史参照"));
  const contrast=contrastRatio(actual.foreground,actual.background);
  assert.ok(contrast>=4.5,"text/background WCAG contrast below 4.5: "+contrast);
  results.push({width,lang,theme,columns:actual.columns,scrollWidth:actual.width,
    contrast:Number(contrast.toFixed(2)),background:actual.background,
    foreground:actual.foreground});
  if(screenshotDir && lang==="en" && theme==="dark" && (width===390||width===1440)){
   fs.mkdirSync(screenshotDir,{recursive:true});
   await page.screenshot({path:path.join(screenshotDir,
     "tp2-private-synthetic-"+width+".png"),fullPage:true});
  }
  await page.close();
 }
 const g=await browser.newPage({viewport:{width:390,height:844}});
 const markup=renderToStaticMarkup(React.createElement(Tp2ResearchReadout,{
  evidence,r0,lang:"en",privateViewAuthorized:false,
 }));
 await g.setContent("<!doctype html><html><body>"+markup+"</body></html>");
 const txt=await g.locator("body").innerText();
 assert.ok(txt.includes("Private access required"));
 for(const sensitive of ["SPY","$250,000","$500,000","0.333333"])
  assert.ok(!txt.includes(sensitive),"unauthorized fixture leak");
 await g.close();
 // State branches are fixture-only presentation cases, not source-authorized
 // adapter outputs or claims that a market has really entered those states.
 const states=[
  ["source_absent",null,null,"en",["Source not yet available","Not evidence of zero trading"],["$0"]],
  ["corrected_stale",{...evidence,state:"CALIBRATION_STALE_SOURCE_GENERATION",
    ranks:null,minuteBaseline:null},r0,"en",
    ["History stale after source correction"],["Observed sample rank"]],
  ["partial_rth",{...evidence,observed:{...evidence.observed,
    fullRthCoveredClaimUnverified:false}},r0,"en",
    ["Partial RTH session"],["Observed sample rank"]],
  ["cross_symbol_r0",evidence,{...r0,ticker:"QQQ"},"en",
    ["R0 context withheld"],["0.333333"]],
  ["corrected_zh",{...evidence,state:"CALIBRATION_STALE_SOURCE_GENERATION",
    ranks:null,minuteBaseline:null},r0,"zh",
    ["来源修订后历史参照已过期"],["机构买入确认"]],
 ];
 const stateResults=[];
 for(const [name,source,sidecar,lang,required,forbidden] of states){
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const markup=renderToStaticMarkup(React.createElement(Tp2ResearchReadout,{
   evidence:source,r0:sidecar,lang,privateViewAuthorized:true,
  }));
  await page.setContent("<!doctype html><html><body>"+markup+"</body></html>");
  const actual=await page.locator("body").innerText();
  for(const term of required) assert.ok(actual.includes(term),name+": missing "+term);
  for(const term of forbidden) assert.ok(!actual.includes(term),name+": leaked "+term);
  stateResults.push(name);
  await page.close();
 }
 console.log(JSON.stringify({status:"OFFLINE_TP2_RESPONSIVE_BROWSER_FIXTURE_PASS",
  chrome:browser.version(),scenarios:results,stateCases:stateResults,
  sourceFixtures:fixtures.map(([file,size,sha])=>({file,bytes:size,sha})),
  unauthorizedDom:"WITHHELD",productionAccepted:false,
  lightMode:"SIMULATED_TOKEN_COMPATIBILITY_ONLY"},null,2));
} finally {
 if(browser)await browser.close();
 fs.rmSync(temporary,{recursive:true,force:true});
}
