"use strict";
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { assertNoCaptureDotenv, captureServerEnv } = require("./capture_b_f11_10_analysis_theses_entry.cjs");
const { trackOwnedServer, prepareNamespace } = require("./f11_owned_server.cjs");
const { classifyRequest, typedUnavailablePayload } = require("./f11_provider_closed_policy.cjs");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const UUID = "[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}";
function fixtureApi(url, method, base) {
  const u = new URL(url);
  if (u.origin !== base || u.username || u.password || /%|\\/.test(u.pathname)) return false;
  if (u.pathname === "/api/theses") return ["GET","POST","PATCH","DELETE"].includes(method);
  if (u.pathname === "/api/thesis-saved-views") return ["GET","PUT","DELETE"].includes(method);
  if (u.pathname === "/api/thesis-fire-status") return method === "GET";
  if (new RegExp(`^/api/thesis/${UUID}/proposals$`).test(u.pathname)) return ["GET","POST"].includes(method);
  return new RegExp(`^/api/thesis/${UUID}/proposals/${UUID}$`).test(u.pathname) && method === "PATCH";
}
function decision(request, base) {
  let u; try { u = new URL(request.url); } catch { return "abort"; }
  if (fixtureApi(request.url, request.method, base)) return "fixture";
  if (u.origin === base && !u.username && !u.password && request.method === "GET"
      && request.resourceType === "document" && u.pathname === "/analysis") return "document";
  return classifyRequest(request, base).decision;
}
async function boundary(context, base, counts) {
  await context.routeWebSocket("**/*", socket => { counts.socketsDenied++; socket.close(); });
  await context.route("**/*", async route => {
    const r = route.request(), d = decision({url:r.url(),method:r.method(),resourceType:r.resourceType()},base);
    if (d === "fixture" || d === "document" || d === "continue") {
      const response = await route.fetch({maxRedirects:0});
      if (response.status() >= 300 && response.status() < 400) { counts.redirectsDenied++; return route.abort(); }
      counts[d === "fixture" ? "fixtureRequests" : "localAssets"]++;
      return route.fulfill({response});
    }
    if (d === "fulfill") { counts.businessUnavailable++; return route.fulfill({status:503,json:typedUnavailablePayload()}); }
    counts.externalDenied++; return route.abort("blockedbyclient");
  });
  // APIRequestContext bypasses context.route. Bind its real fixture mutations
  // separately to the exact same local paths, never an absolute provider URL.
  for (const method of ["get","post","put","patch","delete"]) {
    const original = context.request[method].bind(context.request);
    context.request[method] = async (url, options={}) => {
      if (!fixtureApi(url,method.toUpperCase(),base)) throw Error("THESIS_CAPTURE_API_SCOPE");
      counts.directFixtureRequests++;
      return original(url,{...options,maxRedirects:0});
    };
  }
}
function getChromium() {
  const custom = process.env.THESIS_CAPTURE_PLAYWRIGHT_MODULE;
  const modulePath = custom || "@playwright/test";
  if (custom && !path.isAbsolute(custom)) throw Error("THESIS_CAPTURE_TOOLCHAIN_PATH");
  const packagePath = require.resolve(modulePath + "/package.json");
  const pkg = JSON.parse(fs.readFileSync(packagePath));
  if (custom && pkg.version !== "1.63.0") throw Error("THESIS_CAPTURE_TOOLCHAIN_VERSION");
  const original = require(modulePath).chromium;
  const counts = {contexts:0,contextsClosed:0,browsersClosed:0,fixtureRequests:0,directFixtureRequests:0,
    localAssets:0,businessUnavailable:0,externalDenied:0,socketsDenied:0,redirectsDenied:0};
  return {counts,toolchain:{package:pkg.name,version:pkg.version,packageSha256:hash(fs.readFileSync(packagePath)),defaultExecutableLookup:original.executablePath()},
    async launch(options) {
      const server = await original.launchServer({...options,timeout:30000});
      const child = server.process();
      if (!child || !Number.isSafeInteger(child.pid)) { await server.close(); throw Error("THESIS_CAPTURE_BROWSER_IDENTITY"); }
      let browser;
      try { browser = await original.connect(server.wsEndpoint(),{timeout:30000}); }
      catch(error) { await server.close(); throw error; }
      counts.browserPid=child.pid;
      counts.browserExecutable=child.spawnfile;
      counts.browserExecutableSha256=hash(fs.readFileSync(child.spawnfile));
      const newContext = browser.newContext.bind(browser), close = browser.close.bind(browser);
      browser.newContext = async opts => {
        const context = await newContext({...opts,serviceWorkers:"block"});counts.contexts++;
        await boundary(context,process.env.THESIS_CAPTURE_BASE,counts);
        const closeContext = context.close.bind(context);let closed=false;
        context.close=async()=>{await closeContext();if(!closed){closed=true;counts.contextsClosed++;}};
        return context;
      };
      browser.close=async()=>{
        try { await close(); } finally { await server.close(); }
        try { process.kill(child.pid,0); throw Error("THESIS_CAPTURE_BROWSER_STILL_PRESENT"); }
        catch(error) { if(error.code!=="ESRCH")throw error; }
        counts.browsersClosed++;counts.browserProcessAbsent=true;
      };
      return browser;
    }};
}
async function assertPortFree(port) {
  if (!Number.isInteger(port) || port<1024 || port>65535 || port===3100) throw Error("THESIS_CAPTURE_PORT");
  await new Promise((resolve,reject)=>{const s=net.createServer();s.once("error",reject);s.listen(port,"127.0.0.1",()=>s.close(resolve));});
}
function assertOwnedListener(port,group) {
  const result=execFileSync("lsof",["-nP",`-iTCP:${port}`,"-sTCP:LISTEN","-t"],{encoding:"utf8"}).trim();
  const pids=[...new Set(result.split(/\s+/))];
  if (!pids.length || pids.some(pid=>!/^\d+$/.test(pid)
      || Number(execFileSync("ps",["-o","pgid=","-p",pid],{encoding:"utf8"}).trim())!==group)) throw Error("THESIS_CAPTURE_FOREIGN_LISTENER");
}
async function start(root,port) {
  assertNoCaptureDotenv(root);await assertPortFree(port);
  const namespace=prepareNamespace(root);
  const env={...captureServerEnv(),THESIS_CAPTURE_SERVER:"1",THESIS_CAPTURE_PORT:String(port),
    NODE_OPTIONS:`--require ${JSON.stringify(path.join(__dirname,"thesis_capture_egress.cjs"))}`,
    npm_config_update_notifier:"false",npm_config_audit:"false"};
  const child=spawn("npm",["run","dev","--","--webpack","--hostname","127.0.0.1","--port",String(port)],{cwd:root,env,stdio:["ignore","pipe","pipe"],detached:true});
  const owner=trackOwnedServer(child);let output="";
  for(const pipe of [child.stdout,child.stderr])pipe.on("data",b=>{output=(output+b.toString()).slice(-16000);});
  const base=`http://127.0.0.1:${port}`;process.env.THESIS_CAPTURE_BASE=base;
  let settlement;
  return {async ready(timeoutMs=180000){
    const until=Date.now()+timeoutMs;
    while(Date.now()<until){owner.assertRunning();
      try {assertOwnedListener(port,child.pid);const r=await fetch(base+"/analysis?view=theses&symbol=NVDA",{redirect:"manual",headers:{Cookie:"mm_e2e_rs30=1"}});owner.assertRunning();assertOwnedListener(port,child.pid);if(r.status===200)return;}
      catch(e){owner.assertRunning();if(e.message==="THESIS_CAPTURE_FOREIGN_LISTENER")throw e;}
      await new Promise(r=>setTimeout(r,500));
    }
    throw Error("THESIS_CAPTURE_SERVER_NOT_READY");
  },async stop(){try{await owner.stop();settlement=owner.settlement();}finally{namespace.restoreGeneratedTypeFile();}},summary(){
    if(!settlement)throw Error("THESIS_CAPTURE_NOT_SETTLED");
    return {server:settlement,generatedTypes:namespace.summary(),port,providerBoundary:"Node socket/DNS/fetch denied before external egress; fixture path allowlist",serverLogSha256:hash(Buffer.from(output))};
  }};
}
function staging(root,family){const parent=path.join(root,".next","thesis-capture");fs.mkdirSync(parent,{recursive:true});return fs.mkdtempSync(path.join(parent,family+"-"));}
function publish(stage,target,files,control){
  if(control.counts.contexts!==control.counts.contextsClosed || control.counts.browsersClosed!==1 || control.counts.redirectsDenied)throw Error("THESIS_CAPTURE_UNSETTLED");
  for(const file of [...files,"EVIDENCE.yml"]){const st=fs.lstatSync(path.join(stage,file));if(!st.isFile() || st.size<8)throw Error("THESIS_CAPTURE_INCOMPLETE");}
  const backup=path.join(stage,"previous");fs.mkdirSync(backup);fs.mkdirSync(target,{recursive:true});
  for(const file of [...files,"EVIDENCE.yml"]){const dst=path.join(target,file);if(fs.existsSync(dst))fs.copyFileSync(dst,path.join(backup,file));
    fs.copyFileSync(path.join(stage,file),dst+".capture-new");fs.renameSync(dst+".capture-new",dst);}
  fs.writeFileSync(path.join(stage,"CONTROL.json"),JSON.stringify(control,null,2)+"\n");
  process.stdout.write(JSON.stringify({thesisCaptureControl:path.join(stage,"CONTROL.json"),...control})+"\n");
}
module.exports={fixtureApi,decision,boundary,getChromium,assertPortFree,assertOwnedListener,start,staging,publish};
