/* eslint-disable @typescript-eslint/no-require-imports -- This standalone Node qualifier is intentionally CommonJS. */
/* Local fixture-only qualification of the actual native routes. No real account,
 * credential, service, or external writer is used. Both HTTP servers are loopback
 * children owned and stopped by this process. Never production acceptance. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const {spawn,execFileSync} = require('node:child_process');
const {chromium,expect} = require('@playwright/test');
const ROOT = process.cwd();
// Reuse the incumbent historical sector fixture, never a second sample dataset.
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const resolved = path.resolve(filename);
  // sector-company-v3 reuses this one shared synthetic fixture dependency.
  const generationFixture = path.join(ROOT,'lib/__tests__/fixtures/sectorNativeGeneration.ts');
  if (!resolved.startsWith(path.join(ROOT,'e2e/fixtures')+path.sep) && resolved !== generationFixture) throw Error('fixture loader scope');
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  module._compile(code,filename);
};
const {sectorFixture} = require('../fixtures/sector-company-v3.ts');
const EVIDENCE_ROOT = path.join(ROOT,'docs/pr-crops/shared-shell-intelligence-20261103');
const VARIANT = process.env.INTELLIGENCE_TEST_VARIANT || '';
if (VARIANT && !/^[a-z][a-z0-9-]{0,63}$/.test(VARIANT)) throw Error('invalid evidence variant');
const CANONICAL_OUT = VARIANT ? path.join(EVIDENCE_ROOT,VARIANT) : EVIDENCE_ROOT;
fs.mkdirSync(CANONICAL_OUT,{recursive:true});
// Next watches the project tree. Keep live logs and screenshots outside it and
// retain the complete result only after this qualifier's server has closed.
const OUT = fs.mkdtempSync(path.join(os.tmpdir(),'terminal-intelligence-'));
const outputRelative=path.relative(fs.realpathSync(ROOT),fs.realpathSync(OUT));
if(outputRelative!== '..'&&!outputRelative.startsWith('..'+path.sep)&&!path.isAbsolute(outputRelative)){
 fs.rmdirSync(OUT);throw Error('live qualification output must be outside the project');
}
const OWNER = '11111111-1111-4111-8111-111111111111';
const PORT = Number(process.env.INTELLIGENCE_TEST_PORT || 3347);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw Error('invalid test port');
const BASE = `http://127.0.0.1:${PORT}`;
const proof = JSON.parse(fs.readFileSync(path.join(EVIDENCE_ROOT,'source-projection-receipt.json')));
const macro = {schema:'mastermind.macro_command_read.v1',state:'partial',source:{served_root_qualified:true,manifest_generated_at:'2026-11-02T00:00:00Z',manifest_sha256:'d'.repeat(64),composed_at:'2026-11-02T00:00:00Z'},read:{as_of:'2026-10-30',as_of_display:null,as_of_meaning:null,omitted:true,clauses:[{topic:{en:'Liquidity',zh:'流动性'},predicate:{en:'is mixed',zh:'不均衡'},punct:{en:'.',zh:'。'},section:'liquidity'}]},strip:[{id:'liquidity',section:'liquidity',label:{en:'Liquidity',zh:'流动性'},value:{en:'Mixed',zh:'不均衡'},tone:'neutral',null:false,cause:null,note:null,meaning:null,as_of:'2026-10-30',as_of_display:null}],coverage:{available:2,total:5},sections:[{id:'liquidity',label:{en:'Liquidity',zh:'流动性'},href:'/macro_monetary.html#liquidity'}],workspaces:[]};
const report = {proof:'LOCAL_FIXTURE_BROWSER_NOT_PRODUCTION',cspProof:'NOT_COVERED: isolated loopback authority fixture uses context-only bypassCSP; production headers unchanged',source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),cells:[],errors:[],externalRequests:[],fixtureWrites:[],passed:false};
report.variant=VARIANT || 'candidate';
report.sourceFiles=Object.fromEntries([
 'components/AppNav.tsx', 'components/MobileNav.tsx',
 'components/intelligence/IntelligenceNav.tsx',
 'components/intelligence/SharedShellPrimaryNav.tsx',
 'lib/shared-shell/intelligenceNavigation.ts',
 'components/intelligence/IntelligenceWorkspace.tsx',
 'components/intelligence/IntelligenceToolWorkspace.tsx',
 'components/sector-intelligence/SectorIntelligenceWorkspace.tsx',
 'lib/sectorDepthReturn.ts', 'lib/sharedShellRoutes.generated.json',
 'app/(shell)/intelligence/loading.tsx',
 'app/(shell)/prophet/loading.tsx', 'app/(shell)/sectors/loading.tsx',
 'e2e/tools/qualify_shared_shell_intelligence.cjs'
].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
report.trackedWorkingChanges=execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
let theme='dark',locale='en', browser, child, childClosed, fixture;
report.authReads=0;
report.authStatuses={200:0,401:0};
report.outputOutsideProject=true;
report.overviewNavigations=[];
report.reloadDiagnostics={counts:{},events:{},dropped:{}};
function diagnostic(kind,value){
 const key=kind+':'+String(value.event||value.type||value.reason||'observed').slice(0,80);
 const data=report.reloadDiagnostics;
 if(!Object.hasOwn(data.counts,key)&&Object.keys(data.counts).length>=48)return;
 data.counts[key]=(data.counts[key]||0)+1;
 const events=data.events[key]??=[];
 const limit=/reload/i.test(key)?20:kind==='console'?24:12;
 if(events.length<limit)events.push({at:Date.now(),theme,locale,...value});
 else data.dropped[key]=(data.dropped[key]||0)+1;
}
const diagnosticText=(value,limit=512)=>typeof value==='string'?value.slice(0,limit):undefined;
const diagnosticPath=value=>{try{return new URL(value).pathname;}catch{return diagnosticText(value);}};
const diagnosticUpdate=value=>value&&typeof value==='object'?{
 type:diagnosticText(value.type),path:diagnosticText(value.path),
 resourcePath:diagnosticText(value.resource?.path),
 resourceHeaderNames:value.resource?.headers&&typeof value.resource.headers==='object'?Object.keys(value.resource.headers).slice(0,12):undefined,
 instructionType:diagnosticText(value.instruction?.type),reason:diagnosticText(value.reason,2048)
}:undefined;
async function observeReloads(ctx,page){
 page.on('console',message=>{
  const text=message.text();
  if(['warning','error'].includes(message.type())||/HMR|Fast Refresh|Turbopack|full reload/i.test(text))
   diagnostic('console',{type:message.type(),text:text.slice(0,2048)});
 });
 page.on('websocket',socket=>{
  const pathname=new URL(socket.url()).pathname;
  if(!['/_next/hmr','/_next/webpack-hmr'].includes(pathname))return;
  diagnostic('socket',{type:'opened',path:pathname});
  socket.on('close',()=>diagnostic('socket',{type:'closed',path:pathname}));
  socket.on('socketerror',error=>diagnostic('socket',{type:'error',path:pathname,error:diagnosticText(String(error),2048)}));
  for(const direction of ['framesent','framereceived'])socket.on(direction,frame=>{
   const payload=frame.payload,bytes=Buffer.byteLength(payload);
   if(typeof payload!=='string'||bytes>1024*1024){diagnostic(direction,{path:pathname,bytes,binary:typeof payload!=='string'});return;}
   try{
    const value=JSON.parse(payload);
    diagnostic(direction,{path:pathname,bytes,type:diagnosticText(value.type),event:diagnosticText(value.event),action:diagnosticText(value.action),
     hmrVersion:value.hmrVersion,dataHmrVersion:value.data?.hmrVersion,sessionId:value.data?.sessionId,
     resource:diagnosticText(value.resource)||diagnosticText(value.resource?.path),resourcePath:diagnosticText(value.path),
     resourceHeaderNames:value.headers&&typeof value.headers==='object'?Object.keys(value.headers).slice(0,12):undefined,
     dataType:diagnosticText(value.data?.type),hadRuntimeError:value.hadRuntimeError,
     updates:Array.isArray(value.data)?value.data.slice(0,8).map(diagnosticUpdate):diagnosticUpdate(value.data),
     reason:typeof value.reason==='string'?value.reason.slice(0,2048):undefined,
     stackTrace:typeof value.stackTrace==='string'?value.stackTrace.slice(0,4096):undefined,
     dependencyChain:Array.isArray(value.dependencyChain)?value.dependencyChain.slice(0,8).map(item=>diagnosticText(item)):undefined});
   }catch{diagnostic(direction,{path:pathname,bytes,nonJson:true});}
  });
 });
 const protocol=await ctx.newCDPSession(page);
 await protocol.send('Page.enable');await protocol.send('Network.enable');
 protocol.on('Page.frameRequestedNavigation',event=>diagnostic('navigation',{reason:event.reason,path:diagnosticPath(event.url),frameId:event.frameId}));
 protocol.on('Network.requestWillBeSent',event=>{
  if(event.type!=='Document')return;
  diagnostic('document',{path:diagnosticPath(event.request.url),redirectStatus:event.redirectResponse?.status,
   initiator:event.initiator?.type,stack:event.initiator?.stack?.callFrames?.slice(0,8).map(frame=>({functionName:diagnosticText(frame.functionName),path:diagnosticPath(frame.url),lineNumber:frame.lineNumber,columnNumber:frame.columnNumber}))});
 });
}
const now = Math.floor(Date.now()/1000);
const enc = v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const head=enc({alg:'HS256',typ:'JWT'}),body=enc({sub:OWNER,email:'research-fixture@example.test',aud:'authenticated',role:'authenticated',iat:now,exp:now+3600});
// Random throwaway fixture signing key exists only in this process.
const token=`${head}.${body}.${crypto.createHmac('sha256',crypto.randomBytes(32)).update(`${head}.${body}`).digest('base64url')}`;
const user=()=>({id:OWNER,aud:'authenticated',role:'authenticated',email:'research-fixture@example.test',email_confirmed_at:'2026-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{theme,lang:locale,onboarded_at:'2026-01-01T00:00:00Z'}});
const session=()=>({access_token:token,refresh_token:'fixture-only-refresh-never-used',expires_in:3600,expires_at:now+3600,token_type:'bearer',user:user()});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function within(promise,ms,label){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}
 finally{clearTimeout(timer);}
}
async function startFixture(){
 fixture=http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin',BASE);res.setHeader('Access-Control-Allow-Headers',req.headers['access-control-request-headers']||'authorization,apikey,content-type,x-client-info,x-supabase-api-version');res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  if(req.method!=='GET'){report.fixtureWrites.push({method:req.method,path:req.url});res.writeHead(405).end('{}');return;}
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/auth/v1/user'){report.authReads++;if(req.headers.authorization!==`Bearer ${token}`){report.authStatuses[401]++;res.writeHead(401).end('{"message":"invalid fixture session"}');return;}report.authStatuses[200]++;res.end(JSON.stringify(user()));return;}
  if(u.pathname==='/api/me'){res.end(JSON.stringify({tier:'pro',features:['terminal_live_options'],status:'active'}));return;}
  if(u.pathname.startsWith('/rest/')){res.end('[]');return;}
  res.writeHead(404).end('{"error":"fixture route absent"}');
 });
 await new Promise((resolve,reject)=>{fixture.once('error',reject);fixture.listen(0,'127.0.0.1',resolve);});
 return `http://127.0.0.1:${fixture.address().port}`;
}
async function context(auth=true){
 const ctx=await browser.newContext({viewport:{width:1440,height:900},colorScheme:theme,bypassCSP:true});
 if(auth)await ctx.addCookies([{name:'sb-127-auth-token',value:'base64-'+Buffer.from(JSON.stringify(session())).toString('base64url'),url:BASE,httpOnly:false,sameSite:'Lax'}]);
 await ctx.addInitScript(({theme,locale})=>{localStorage.setItem('mm.lang',locale);localStorage.setItem('mmx.shell.theme',theme);const apply=()=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.lang=locale;};if(document.documentElement)apply();else document.addEventListener('DOMContentLoaded',apply,{once:true});},{theme,locale});
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(!['127.0.0.1','localhost'].includes(u.hostname)){report.externalRequests.push(u.origin+u.pathname);return route.abort();}
  if(u.origin===BASE){
   if(u.pathname==='/api/shared-shell/today')return route.fulfill({json:macro});
   if(u.pathname==='/api/sector-intelligence')return u.searchParams.get('view')==='intelligence'?route.fulfill({json:proof.cycles.summary}):sectorFixture(route);
   if(u.pathname==='/api/flow'&&u.searchParams.get('view')==='intelligence')return route.fulfill({json:proof.prophet.summary});
   if(u.pathname==='/api/prefs')return route.fulfill({json:{}});
   if(u.pathname==='/api/teams')return route.fulfill({json:{teams:[],truncated:false}});
  }
  return route.continue();
 });
 return ctx;
}
async function overflow(page){return page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth,main:[...document.querySelectorAll('main')].map(el=>({client:el.clientWidth,scroll:el.scrollWidth}))}));}
(async()=>{
 try{
  const authBase=await startFixture();
  const log=fs.openSync(path.join(OUT,'local-next.log'),'w');
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(PORT)],{cwd:ROOT,stdio:['ignore',log,log],env:{...process.env,MMX_SHARED_SHELL:'1',NEXT_PUBLIC_SUPABASE_URL:authBase,NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-anon-key',BILLING_GATEWAY_BASE:authBase,FLOW_FIXTURE:'1',TERMINAL_REQUIRE_AUTH:'0',TERMINAL_E2E_FIXTURE:'1',TERMINAL_E2E_EMAIL:'research-fixture@example.test',TERMINAL_E2E_ENTITLEMENT:'unlimited',ANALYSIS_LOCAL_PREVIEW:'1',RATE_LIMIT_MAX:'100000',ISSUE_DESK_API_BASE:authBase}});
  childClosed=new Promise((resolve,reject)=>{child.once('close',(code,signal)=>resolve({code,signal}));child.once('error',reject);});
  // Attach a rejection observer immediately; cleanup still receives the original error.
  void childClosed.catch(()=>{});
  fs.closeSync(log);
  let ready=false;
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(`Next exited ${child.exitCode}`);try{const r=await fetch(BASE+'/api/shared-shell/status',{signal:AbortSignal.timeout(2000)});if(r.ok){ready=true;break;}}catch{}await sleep(1000);}
  if(!ready)throw Error('local Next readiness not established');
  browser=await chromium.launch({headless:true});
  // Warm only these exact three real routes, with the same synthetic authority.
  for(const dest of ['/intelligence','/prophet','/sectors']){
   const r=await fetch(BASE+dest,{headers:{cookie:`sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session())).toString('base64url')}`},signal:AbortSignal.timeout(120000)});
   if(!r.ok)throw Error(`${dest} warm HTTP ${r.status}`);await r.text();
  }
  for(const [w,h] of [[1440,900],[820,1180],[390,844]])for(const mode of [['dark','en'],['light','zh']]){
   [theme,locale]=mode;const ctx=await context();const page=await ctx.newPage();await page.setViewportSize({width:w,height:h});
   await observeReloads(ctx,page);
   page.on('pageerror',e=>report.errors.push({cell:`${w}-${theme}-${locale}`,error:e.message}));
   const documentNavigations=[];
   report.overviewNavigations.push({cell:`${w}-${theme}-${locale}`,documents:documentNavigations});
   page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())documentNavigations.push(request.url());});
   await page.goto(BASE+'/intelligence',{waitUntil:'domcontentloaded'});
   await expect(page.locator('[data-intelligence-overview]')).toBeVisible({timeout:45000});
   await expect(page.locator('[data-intelligence-source="macro"]')).toHaveAttribute('data-read-state','ready',{timeout:30000});
   await expect(page.locator('[data-intelligence-source="cycles"]')).toHaveAttribute('data-read-state','ready');
   await expect(page.locator('[data-intelligence-source="prophet"]')).toHaveAttribute('data-read-state','ready');
   const bounds=await overflow(page);if(bounds.document>bounds.viewport+1||bounds.main.some(x=>x.scroll>x.client+1))throw Error(`overflow ${JSON.stringify(bounds)}`);
   const file=`overview-${w}-${theme}-${locale}.png`;await page.screenshot({path:path.join(OUT,file),fullPage:false});
   if(w>860){await expect(page.locator('.appnav [aria-current="page"]')).toHaveCount(1);}else{
    await page.getByRole('button',{name:locale==='zh'?'打开导航':'Open navigation',exact:true}).click();
    await expect(page.getByRole('dialog').locator('[data-intelligence-nav="drawer"]')).toBeVisible();
    await page.keyboard.press('Escape');
   }
   if(documentNavigations.length!==1||documentNavigations[0]!==BASE+'/intelligence')throw Error(`unexpected overview navigation: ${JSON.stringify(documentNavigations)}`);
   report.cells.push({w,h,theme,locale,screenshot:file,bounds,documentNavigations});await ctx.close();
  }
  theme='dark';locale='en';const ctx=await context();const page=await ctx.newPage();
  await page.goto(BASE+'/intelligence');await expect(page.locator('[data-intelligence-source="prophet"]')).toHaveAttribute('data-read-state','ready');
  await expect(page.locator('[data-intelligence-nav="context"] a[href="/us_stocks.html"]')).toHaveText('Prophet');
  await expect(page.locator('[data-intelligence-source="prophet"] a[href="/us_stocks.html"]')).toContainText('Open opportunity workspace');
  report.prophetWorkspaceHref='/us_stocks.html'; // href proof only; joined Macro document needs its separate real-source journey.
  await page.locator('[data-intelligence-source="prophet"] a[href="/prophet"]').click();await expect(page).toHaveURL(BASE+'/prophet');await expect(page.getByRole('heading',{name:'Model plans & options',exact:true})).toBeVisible();await expect(page.locator('.obs-prophet-grid')).toBeVisible({timeout:45000});await expect(page.getByText('UBER',{exact:true}).first()).toBeVisible();
  await expect(page.getByRole('link',{name:'Open Prophet workspace →',exact:true})).toHaveAttribute('href','/us_stocks.html');
  await page.screenshot({path:path.join(OUT,'prophet-native-desktop.png')});await page.goBack();await expect(page).toHaveURL(BASE+'/intelligence');
  await page.locator('[data-intelligence-nav="context"] a[href="/sectors"]').click();await expect(page.locator('[data-testid="sector-intelligence"]')).toBeVisible({timeout:45000});
  await page.goto(BASE+'/sectors?sector=xlk&group=semiconductors&sectorTheme=light');
  const sector=page.getByTestId('sector-intelligence');
  await expect(sector.locator('[data-company-choice="MU"]')).toBeVisible();
  await sector.locator('[data-company-choice="MU"]').click();
  await expect(sector.getByTestId('sector-company-inspector').getByRole('heading',{name:'MU',exact:true})).toBeVisible();
  await expect(page).toHaveURL(/sectorCompany=MU/);
  const selectedHref=page.url();
  const companyHref=await sector.getByTestId('sector-company-inspector').getByRole('link',{name:/Open company research/}).getAttribute('href');
  if(companyHref!=='/analysis?symbol=MU&page=overview')throw Error('company handoff changed');
  report.sectorCompanyHandoff=companyHref;
  report.sectorReturnJourney={selectedHref};
  await page.screenshot({path:path.join(OUT,'sectors-native-desktop.png')});
  await page.locator('[data-intelligence-nav="context"] a[href="/intelligence"]').click();
  // Prove that the requested destination committed before exercising Back.
  // An immediate goBack can race the asynchronous route commit and tests no journey.
  await expect(page).toHaveURL(BASE+'/intelligence');
  await expect(page.locator('[data-intelligence-source="macro"]')).toHaveAttribute('data-read-state','ready');
  report.sectorReturnJourney.overviewArrived=page.url();
  await page.goBack();
  await expect(page).toHaveURL(selectedHref);
  await expect(page.getByTestId('sector-company-inspector').getByRole('heading',{name:'MU',exact:true})).toBeVisible();
  report.sectorReturnJourney.returnedHref=page.url();
  await page.screenshot({path:path.join(OUT,'sectors-selected-company-after-back.png')});
  await page.reload();
  await expect(page).toHaveURL(selectedHref);
  await expect(page.getByTestId('sector-company-inspector').getByRole('heading',{name:'MU',exact:true})).toBeVisible();
  report.sectorReturnJourney.reloadPreserved=true;
  await page.locator('[data-intelligence-nav="context"] a[href="/intelligence"]').click();
  await expect(page).toHaveURL(BASE+'/intelligence');
  await page.setViewportSize({width:320,height:844});const stress=await overflow(page);if(stress.document>321)throw Error('320px document overflow');report.stress320=stress;
  await page.route('**/api/flow?f=prophet_idx&view=intelligence',r=>r.fulfill({status:403,json:{error:'pro_required'}}));
  await page.locator('[data-intelligence-source="prophet"] button').click();await expect(page.locator('[data-intelligence-source="prophet"]')).toHaveAttribute('data-read-state','access');await expect(page.locator('[data-intelligence-source="macro"]')).toHaveAttribute('data-read-state','ready');
  await ctx.close();
  const guest=await context(false),gp=await guest.newPage();await gp.goto(BASE+'/intelligence');await expect(gp.locator('[data-intelligence-overview]')).toHaveCount(0);report.guestGate=true;await guest.close();
  report.passed=report.errors.length===0; if(!report.passed)throw Error('browser page errors; inspect receipt');
 }catch(error){report.failure=String(error);process.exitCode=1;if(browser){const pages=browser.contexts().flatMap(c=>c.pages());const page=pages.at(-1);if(page){report.failureBody=(await page.locator('body').innerText().catch(()=>'' )).slice(0,5000);await page.screenshot({path:path.join(OUT,'failure-diagnostic.png')}).catch(()=>{});}}}
 finally{
  const cleanupErrors=[];
  if(browser)try{await within(browser.close(),10000,'browser close unsettled');}catch(error){cleanupErrors.push(String(error));}
  report.ownedChildClosed=!child;
  if(child){
   if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
   try{report.childClose=await within(childClosed,5000,'Next close unsettled');report.ownedChildClosed=true;}
   catch(error){
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
    try{report.childClose=await within(childClosed,5000,'Next kill unsettled');report.ownedChildClosed=true;}
    catch(settleError){cleanupErrors.push(String(error),String(settleError));}
   }
  }
  if(fixture)try{await within(new Promise((resolve,reject)=>fixture.close(error=>error?reject(error):resolve())),5000,'fixture close unsettled');report.fixtureClosed=true;}catch(error){cleanupErrors.push(String(error));}
  report.finishedAt=new Date().toISOString();
  report.externalRequests=[...new Set(report.externalRequests)];
  if(cleanupErrors.length){report.passed=false;report.cleanupErrors=cleanupErrors;process.exitCode=1;}
  fs.writeFileSync(path.join(OUT,'browser-qualification.json'),JSON.stringify(report,null,2)+'\n');
  let receipt=path.join(OUT,'browser-qualification.json');
  if(report.ownedChildClosed){
   fs.cpSync(OUT,CANONICAL_OUT,{recursive:true});
   receipt=path.join(CANONICAL_OUT,'browser-qualification.json');
   fs.rmSync(OUT,{recursive:true});
  }
  console.log(JSON.stringify({passed:report.passed,cells:report.cells.length,failure:report.failure,errors:report.errors,cleanupErrors:report.cleanupErrors,receipt}));
 }
})();
