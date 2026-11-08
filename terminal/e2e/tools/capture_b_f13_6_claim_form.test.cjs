/* eslint-disable @typescript-eslint/no-require-imports -- Incumbent capture tools and the Node test runner use CommonJS require/exports. */
"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const {captureMode,assertLightObservation,openLightWorkspace,retainLightStyles,SHOTS,LIGHT_MODE,LIGHT_FILE} = require("./capture_b_f13_6_claim_form.cjs");
const {capturePresentationEnvironment,start} = require("./thesis_capture_runtime.cjs");

test("fixed light mode cannot broaden selectors, theme, locale or family",async () => {
  assert.equal(captureMode([]),"dark");
  assert.equal(captureMode(["--light-claim"]),LIGHT_MODE);
  for(const args of [["--theme=light"],["--light-claim","--lang=zh"],["--light-claim","--light-claim"],["--light-claim=1"]])
    assert.throws(() => captureMode(args),/PRESENTATION_SCOPE/);
  assert.deepEqual(capturePresentationEnvironment(),{});
  assert.deepEqual(capturePresentationEnvironment(LIGHT_MODE),{MMX_SHARED_SHELL:"1"});
  for(const mode of [null,"light",{},"dark;OPEN=1"]){
    assert.throws(() => capturePresentationEnvironment(mode),/PRESENTATION_SCOPE/);
    await assert.rejects(start("/not-used",0,"/not-used",mode),/PRESENTATION_SCOPE/);
  }
  assert.equal(SHOTS.length,12);
  assert.equal(new Set(SHOTS.map(shot => shot.file)).size,12);
  assert.equal(SHOTS.some(shot => shot.file === LIGHT_FILE),false);
  assert.deepEqual(SHOTS.map(shot => shot.viewport),Array(4).fill("desktop").concat(Array(4).fill("mobile"),["desktop","desktop","mobile","mobile"]));
});

function facts() { return {sharedShell:"1",theme:"light",lang:"en",lightPressed:"true",viewport:{width:1440,height:900},
  panelToken:"#ffffff",panelBackground:"rgb(255, 255, 255)",panelText:"rgb(32, 38, 50)",dateBackground:"rgb(238, 241, 246)",
  dateScheme:"light",checkboxScheme:"light",dateValue:"2026-11-09",checkboxChecked:true}; }
test("light attributes alone cannot qualify dark tokens, controls or missing owner",() => {
  assert.deepEqual(assertLightObservation(facts()),facts());
  for(const delta of [{sharedShell:undefined},{theme:"dark"},{lang:"zh"},{lightPressed:"false"},{viewport:{width:390,height:844}},
    {panelToken:"#181b21"},{panelBackground:"rgb(24, 27, 33)"},{panelText:"rgb(215, 220, 227)"},
    {dateBackground:"rgb(30, 34, 42)"},{dateScheme:"dark"},{checkboxScheme:"dark"},{dateValue:""},{checkboxChecked:false}])
    assert.throws(() => assertLightObservation({...facts(),...delta}),/LIGHT_PRESENTATION/);
});

function fakePage(pressed) {
  const calls = [], light = {waitFor:async () => {}, getAttribute:async () => pressed,
    click:async () => {calls.push("light-owner-click");}};
  return {calls,context:() => ({addCookies:async cookies => calls.push(["cookies",cookies])}),
    goto:async (url) => calls.push(["goto",url]),locator:selector => ({waitFor:async () => calls.push(["shell",selector])}),
    getByRole:(role,options) => {assert.equal(role,"button");assert.deepEqual(options,{name:"Light theme",exact:true});return light;},
    waitForFunction:async fn => calls.push(["predicate",fn.toString()]),
    getByTestId:id => ({waitFor:async () => {},click:async () => {assert.equal(id,"claim-entry-button");calls.push("claim-open");}})};
}
test("light opens real shell and existing owner control before Claim, without theme injection or submit",async () => {
  for(const pressed of ["false","true"]) {
    const page = fakePage(pressed);await openLightWorkspace(page);
    const names = page.calls.filter(value => typeof value === "string");
    assert.deepEqual(names,pressed === "false" ? ["light-owner-click","claim-open"] : ["claim-open"]);
    const cookies = page.calls.find(value => value[0] === "cookies")[1];
    assert.deepEqual(cookies.map(cookie => [cookie.name,cookie.value]),[["mm_e2e_rs30","1"],["mm_e2e_guest","1"]]);
    assert(cookies.every(cookie => cookie.url === "http://127.0.0.1:3556"));
    assert.equal(page.calls.find(value => value[0] === "goto")[1],"http://127.0.0.1:3556/analysis?view=theses&symbol=NVDA&lang=en");
    const predicates = page.calls.filter(value => value[0] === "predicate").map(value => value[1]).join("\n");
    assert.match(predicates,/mmxSharedShell/);assert.match(predicates,/theme === "light"/);assert.match(predicates,/!!entry && !entry.disabled/);
  }
});

test("separate publication retains strict PNG pipeline, no partial flag or dark manifest overwrite",() => {
  const source = fs.readFileSync(path.join(__dirname,"capture_b_f13_6_claim_form.cjs"),"utf8");
  assert.match(source,/if \(process.env.CAPTURE_ONLY\) throw Error\("THESIS_CAPTURE_PARTIAL_REFUSED"\)/);
  assert.match(source,/light \? join\(TARGET,"light-native-controls"\) : TARGET/);
  assert.match(source,/await runtime.captureCanonicalScreenshot\(page, target,/);
  assert.match(source,/colorScheme: light \? "light" : "dark"/);
  const lightBody = source.slice(source.indexOf("async function openLightWorkspace"),source.indexOf("function assertLightObservation"));
  assert.doesNotMatch(lightBody,/evaluate|addInitScript|localStorage|setAttribute|submit/);
  assert.match(source,/if\(require.main === module\)main\(\)/);
});

function stylePage() {
  let listener;
  return {on:(event,fn) => {assert.equal(event,"response");listener=fn;},emit:response => listener(response)};
}
function styleResponse(url,body = "data-mmx-shared-shell ClaimAuthoringForm",status = 200) {
  return {url:() => url,request:() => ({resourceType:() => "stylesheet"}),status:() => status,body:async () => Buffer.from(body)};
}
test("delivered CSS identity is bounded, local, content-hashed and both source facets required",async () => {
  const page = stylePage(), read = retainLightStyles(page);
  page.emit(styleResponse("http://127.0.0.1:3556/_next/static/css/app.css?ephemeral=excluded"));
  const files = await read();assert.equal(files.length,1);assert.equal(files[0].path,"/_next/static/css/app.css");
  assert.match(files[0].sha256,/^[a-f0-9]{64}$/);assert.equal(files[0].sharedShell,true);assert.equal(files[0].claimForm,true);
  for(const response of [styleResponse("https://provider.invalid/x.css"),styleResponse("http://user@127.0.0.1:3556/_next/static/x.css"),
    styleResponse("malformed"),styleResponse("http://127.0.0.1:3556/_next/static/x.css","wrong facets"),
    styleResponse("http://127.0.0.1:3556/_next/static/x.css","data-mmx-shared-shell ClaimAuthoringForm",503),
    {...styleResponse("http://127.0.0.1:3556/_next/static/x.css"),body:async () => {throw Error("BODY_UNAVAILABLE");}}]) {
    const p = stylePage(), collect = retainLightStyles(p);
    assert.doesNotThrow(() => p.emit(response));await assert.rejects(collect());
  }
});
