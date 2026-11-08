"use strict";
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { assertNoCaptureDotenv, captureServerEnv } = require("./capture_b_f11_10_analysis_theses_entry.cjs");
const { trackOwnedServer, prepareNamespace } = require("./f11_owned_server.cjs");
const { classifyRequest, typedUnavailablePayload } = require("./f11_provider_closed_policy.cjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Incumbent capture runtime is CommonJS.
const { prepareFontEnvironment, installFontWitness, captureCanonicalScreenshot, validateFontWitnesses, waitForCanonicalFonts, fontFailureFacts } = require("./thesis_capture_fonts.cjs");
let journal, diagnosticFailure;
// Diagnostics are never allowed to replace the original effect/cleanup result.
const note = value => { try { if(journal)journal(value); } catch(error) { diagnosticFailure ||= error; } };
const assertDiagnostics = () => { if(diagnosticFailure)throw diagnosticFailure; };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const UUID = "[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}";
function fixtureApi(url, method, base) {
  if (typeof url !== "string" || typeof method !== "string") return false;
  let u; try { u = new URL(url); } catch { return false; }
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
  guardApiRequest(context.request, base, counts);
}
function guardApiRequest(request, base, counts) {
  // Every public network entrypoint converges on the captured original fetch.
  // Named convenience methods must not dynamically re-enter an unguarded fetch.
  const fetch = request.fetch.bind(request);
  for (const name of ["get","post","put","patch","delete","head","fetch"]) {
    request[name] = async (url, options={}) => {
      if (!options || typeof options !== "object") throw Error("THESIS_CAPTURE_API_SCOPE");
      const raw = name === "fetch" ? (options.method === undefined ? "GET" : options.method) : name;
      const method = typeof raw === "string" && /^[A-Za-z]+$/.test(raw) ? raw.toUpperCase() : "";
      if (!fixtureApi(url,method,base)) throw Error("THESIS_CAPTURE_API_SCOPE");
      counts.directFixtureRequests++;
      return fetch(url,{...options,method,maxRedirects:0});
    };
  }
}
async function cleanupPreserving(primary, cleanup) {
  try { return await cleanup(); }
  catch(error) {
    note({phase:"CLEANUP_FAILED",cleanupCode:error.code || (/^[A-Z_]{1,80}$/.test(error.message) ? error.message : "OTHER")});
    if(primary){primary.cleanupError=error;throw primary;}
    throw error;
  }
}
async function initializeOwnedBrowser(server, initialize, absent = pid => {
  try { process.kill(pid,0); } catch(error) { if(error.code === "ESRCH")return; throw error; }
  throw Error("THESIS_CAPTURE_BROWSER_STILL_PRESENT");
}) {
  try { return await initialize(); }
  catch(error) {
    const cleanup={serverCloseObserved:false,processAbsent:false,unknown:true};
    try {
      await server.close();cleanup.serverCloseObserved=true;
      const pid=server.process()?.pid;
      if(!Number.isSafeInteger(pid) || pid<=1)throw Error("THESIS_CAPTURE_BROWSER_IDENTITY");
      await absent(pid);cleanup.processAbsent=true;cleanup.unknown=false;
    } catch(cleanupError) { cleanup.errorCode=cleanupError.code || "THESIS_CAPTURE_CLEANUP_UNKNOWN"; }
    // Keep the original initialization failure; uncertain cleanup never becomes
    // permission for another browser/host/process launch.
    note({phase:"BROWSER_INITIALIZATION_FAILED",...cleanup});
    error.ownedBrowserCleanup=cleanup;
    throw error;
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
      note({phase:"BROWSER_LAUNCH_REQUESTED"});assertDiagnostics();
      const server = await original.launchServer({...options,timeout:30000,env:captureServerEnv()});
      return initializeOwnedBrowser(server,async()=>{
      const child = server.process();
      note({phase:"BROWSER_PROCESS_RETURNED",browserPid:child?.pid});assertDiagnostics();
      if (!child || !Number.isSafeInteger(child.pid)) throw Error("THESIS_CAPTURE_BROWSER_IDENTITY");
      const browser = await original.connect(server.wsEndpoint(),{timeout:30000});
      counts.browserPid=child.pid;
      counts.browserExecutable=child.spawnfile;
      counts.browserExecutableSha256=hash(fs.readFileSync(child.spawnfile));
      const profiles=child.spawnargs.filter(arg=>arg.startsWith("--user-data-dir="));
      if(profiles.length!==1 || !process.env.TMPDIR)throw Error("THESIS_CAPTURE_PROFILE_SCOPE");
      const tmp=fs.realpathSync(process.env.TMPDIR), profile=fs.realpathSync(profiles[0].slice("--user-data-dir=".length));
      const st=fs.lstatSync(profile), parent=fs.lstatSync(tmp);
      if(!profile.startsWith(tmp+path.sep) || !st.isDirectory() || st.uid!==process.getuid()
          || !parent.isDirectory() || parent.uid!==process.getuid() || (parent.mode&0o777)!==0o700)throw Error("THESIS_CAPTURE_PROFILE_SCOPE");
      counts.browserProfile={path:profile,dev:st.dev,ino:st.ino,uid:st.uid,tmpRoot:tmp};
      note({phase:"BROWSER_CONNECTED",browserPid:child.pid,browserExecutable:child.spawnfile,browserExecutableSha256:counts.browserExecutableSha256,browserProfile:counts.browserProfile});assertDiagnostics();
      const newContext = browser.newContext.bind(browser), close = browser.close.bind(browser);
      browser.newContext = async opts => {
        assertDiagnostics();
        const context = await newContext({...opts,serviceWorkers:"block"});counts.contexts++;
        await boundary(context,process.env.THESIS_CAPTURE_BASE,counts);
        installFontWitness(context,counts);
        const closeContext = context.close.bind(context);let closed=false;
        context.close=async()=>{await closeContext();if(!closed){closed=true;counts.contextsClosed++;}};
        return context;
      };
      browser.close=async()=>{
        try { await close(); } finally { await server.close(); }
        try { process.kill(child.pid,0); throw Error("THESIS_CAPTURE_BROWSER_STILL_PRESENT"); }
        catch(error) { if(error.code!=="ESRCH")throw error; }
        if(fs.existsSync(counts.browserProfile.path))throw Error("THESIS_CAPTURE_PROFILE_STILL_PRESENT");
        counts.browserProfileAbsent=true;
        counts.browsersClosed++;counts.browserProcessAbsent=true;
        note({phase:"BROWSER_CLOSED",browserPid:child.pid,browserProcessAbsent:true});
      };
      return browser;
      });
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
async function start(root,port,stage) {
  const file=path.join(stage,"CONTROL.json"),record={phase:"PREPARING",events:[]};
  diagnosticFailure=undefined;
  journal=value=>{record.phase=value.phase;record.events.push({...value,at:new Date().toISOString()});
    fs.writeFileSync(file,JSON.stringify(record,null,2)+"\n",{mode:0o600});};
  note({phase:"PREPARING",port});assertDiagnostics();
  process.stdout.write("THESIS_CAPTURE_CONTROL "+file+"\n");
  assertNoCaptureDotenv(root);await assertPortFree(port);
  const fontFixture=prepareFontEnvironment(root);
  record.canonicalFontInputs=fontFixture.provenance;
  const namespace=prepareNamespace(root);
  const env={...captureServerEnv(),...fontFixture.env,THESIS_CAPTURE_SERVER:"1",THESIS_CAPTURE_PORT:String(port),
    NODE_OPTIONS:`--require ${JSON.stringify(path.join(__dirname,"thesis_capture_egress.cjs"))}`,
    npm_config_update_notifier:"false",npm_config_audit:"false"};
  let child,owner,settlement,stopPromise,resourceFailure,output="",lastStatus=null;
  const stopOwned=()=>stopPromise ||= owner.stop().then(()=>{
    settlement=owner.settlement();note({phase:"SERVER_CLOSED",...settlement});
  });
  const settle=async()=>{
    let failure;
    try { if(owner)await stopOwned();else if(child)throw Error("THESIS_CAPTURE_SERVER_CUSTODY_UNKNOWN"); }
    catch(error){failure=error;}
    try { namespace.restoreGeneratedTypeFile();note({phase:"TYPES_RESTORED"}); }
    catch(error){if(failure)failure.typesCleanupError=error;else failure=error;}
    if(failure)throw failure;
  };
  try {
    child=spawn("npm",["run","dev","--","--webpack","--hostname","127.0.0.1","--port",String(port)],{cwd:root,env,stdio:["ignore","pipe","pipe"],detached:true});
    owner=trackOwnedServer(child);
    // Keep the actual spawn receipt in the error path even if persistence fails.
    note({phase:"SERVER_PROCESS_RETURNED",serverPid:child.pid,port});assertDiagnostics();
    const log=path.join(stage,"server.log");let retained=0;
    const logUnavailable=error=>{
      diagnosticFailure ||= error;note({phase:"LOG_UNAVAILABLE",code:error.code || "OTHER"});
      void stopOwned().catch(error=>{resourceFailure ||= error;});
    };
    for(const pipe of [child.stdout,child.stderr]){pipe.on("error",logUnavailable);pipe.on("data",b=>{
      try {
        output=(output+b.toString()).slice(-16000);
        if(retained<262144){const bytes=b.subarray(0,262144-retained);fs.appendFileSync(log,bytes,{mode:0o600});retained+=bytes.length;}
      } catch(error) {
        // Event callbacks cannot throw past the owner.
        logUnavailable(error);
      }
    });}
    const base=`http://127.0.0.1:${port}`;process.env.THESIS_CAPTURE_BASE=base;
    return {async ready(timeoutMs=180000){
      const until=Date.now()+timeoutMs;
      while(Date.now()<until){assertDiagnostics();owner.assertRunning();
        try {assertOwnedListener(port,child.pid);const r=await fetch(base+"/analysis?view=theses&symbol=NVDA",{redirect:"manual",headers:{Cookie:"mm_e2e_rs30=1"},signal:AbortSignal.timeout(10000)});owner.assertRunning();assertOwnedListener(port,child.pid);lastStatus=r.status;if(r.status===200){note({phase:"SERVER_READY",serverPid:child.pid,port,status:200});assertDiagnostics();return;}}
        catch(error){assertDiagnostics();owner.assertRunning();if(error.message==="THESIS_CAPTURE_FOREIGN_LISTENER")throw error;}
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      note({phase:"SERVER_NOT_READY",serverPid:child.pid,port,lastStatus});assertDiagnostics();
      throw Error("THESIS_CAPTURE_SERVER_NOT_READY");
    },failure(error){note({phase:"PRIMARY_FAILURE",fontObservation:fontFailureFacts(error),name:error.name,code:error.code || null,
      message:/^[A-Z_]{1,80}$/.test(error.message)?error.message:"OTHER",
      category:/EPERM|EACCES|permission denied|operation not permitted/i.test(error.message)?"PERMISSION":/timeout|timed out/i.test(error.message)?"TIMEOUT":"OTHER"});},
    stop:settle,summary(){
      assertDiagnostics();if(resourceFailure)throw resourceFailure;
      if(!settlement)throw Error("THESIS_CAPTURE_NOT_SETTLED");
      return {server:settlement,generatedTypes:namespace.summary(),canonicalFontInputs:fontFixture.provenance,port,providerBoundary:"Node socket/DNS/fetch denied before external egress; fixture path allowlist",serverLogSha256:hash(Buffer.from(output))};
    }};
  } catch(error) {
    try { await settle();error.ownedServerCleanup={pid:child?.pid,...settlement,unknown:!!child&&!settlement}; }
    catch(cleanup){error.cleanupError=cleanup;error.ownedServerCleanup={pid:child?.pid,unknown:true};}
    note({phase:"INITIALIZATION_FAILED",...error.ownedServerCleanup});
    throw error;
  }
}
function staging(root,family){const parent=path.join(root,".next","thesis-capture");fs.mkdirSync(parent,{recursive:true});return fs.mkdtempSync(path.join(parent,family+"-"));}
function publish(stage,target,files,control){
  assertDiagnostics();
  if(control.counts.contexts!==control.counts.contextsClosed || control.counts.browsersClosed!==1 || control.counts.redirectsDenied)throw Error("THESIS_CAPTURE_UNSETTLED");
  validateFontWitnesses(stage,files,control.counts);
  for(const file of [...files,"EVIDENCE.yml"]){const st=fs.lstatSync(path.join(stage,file));if(!st.isFile() || st.size<8)throw Error("THESIS_CAPTURE_INCOMPLETE");}
  const backup=path.join(stage,"previous");fs.mkdirSync(backup);fs.mkdirSync(target,{recursive:true});
  for(const file of [...files,"EVIDENCE.yml"]){const dst=path.join(target,file);if(fs.existsSync(dst))fs.copyFileSync(dst,path.join(backup,file));
    fs.copyFileSync(path.join(stage,file),dst+".capture-new");fs.renameSync(dst+".capture-new",dst);}
  fs.writeFileSync(path.join(stage,"CONTROL.json"),JSON.stringify(control,null,2)+"\n");
  process.stdout.write(JSON.stringify({thesisCaptureControl:path.join(stage,"CONTROL.json"),...control})+"\n");
}
module.exports={captureCanonicalScreenshot,waitForCanonicalFonts,cleanupPreserving,initializeOwnedBrowser,fixtureApi,decision,boundary,guardApiRequest,getChromium,assertPortFree,assertOwnedListener,start,staging,publish};
