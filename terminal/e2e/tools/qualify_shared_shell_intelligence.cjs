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
  const historyFixture = path.join(ROOT,'lib/__tests__/fixtures/sectorCycleHistory.ts');
  const liquidityFixture = path.join(ROOT,'lib/__tests__/fixtures/macroLiquidity.ts');
  const candidateFixture = path.join(ROOT,'lib/__tests__/fixtures/prophetCandidatePool.ts');
  const todayFixture = path.join(ROOT,'lib/__tests__/fixtures/todayDailyDesk.ts');
  if (!resolved.startsWith(path.join(ROOT,'e2e/fixtures')+path.sep) && resolved !== generationFixture && resolved !== historyFixture && resolved !== liquidityFixture && resolved !== candidateFixture && resolved !== todayFixture) throw Error('fixture loader scope');
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  module._compile(code,filename);
};
const {sectorFixture} = require('../fixtures/sector-company-v3.ts');
const sectorGeneration = require('../../lib/__tests__/fixtures/sector_generation.captured.preview.v1.json');
const {syntheticCycleHistory:cycleHistory,syntheticCycleHistorySha:cycleHistorySha} = require('../../lib/__tests__/fixtures/sectorCycleHistory.ts');
const {liquidityFixture} = require('../../lib/__tests__/fixtures/macroLiquidity.ts');
const {candidatePoolFixture} = require('../../lib/__tests__/fixtures/prophetCandidatePool.ts');
const {todayMarketFixture,todayPersonalBriefFixture,todayChangesFixture,todayDigestFixture,
 todayCatalogFixture,todayWatchlistFixture,TODAY_SAVED_SELECTION} = require('../../lib/__tests__/fixtures/todayDailyDesk.ts');
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
 'components/intelligence/MacroLiquidityDetail.tsx',
 'components/intelligence/MacroLiquidity.module.css',
 'lib/shared-shell/macroWorkspacePayload.ts',
 'lib/__tests__/fixtures/macroLiquidity.ts',
 'components/intelligence/IntelligenceToolWorkspace.tsx',
 'components/prophet/ProphetLanesView.tsx',
 'components/prophet/useProphetUrlState.ts',
 'components/prophet/today/today.module.css',
 'components/prophet/candidates/ProphetCandidateView.tsx',
 'components/prophet/candidates/candidates.module.css',
 'components/prophet/candidates/candidateDecision.ts',
 'lib/prophetCandidatePool.ts', 'lib/prophetUrlState.ts',
 'lib/shared-shell/useReadingScope.ts', 'lib/shared-shell/readingProxy.ts',
 'lib/__tests__/fixtures/prophetCandidatePool.ts',
 'components/workspaces/TodayWorkspace.tsx', 'components/workspaces/TodayWorkspace.module.css',
 'components/workspaces/TodayDeskDestinations.tsx', 'components/workspaces/TodaySinceLastVisit.tsx',
 'components/workspaces/TodayRiskEvents.tsx', 'components/workspaces/TodayResearchAttention.tsx',
 'components/workspaces/TodayBreadthReading.tsx', 'lib/__tests__/fixtures/todayDailyDesk.ts',
 'components/workspaces/DiscoverLanding.tsx', 'components/workspaces/DiscoverLanding.module.css',
 'components/workspaces/DiscoverWorkspace.tsx', 'components/chrome/WorkspaceTabs.tsx',
 'components/sector-intelligence/SectorIntelligenceWorkspace.tsx',
 'components/sector-intelligence/SectorCycleHistory.tsx',
 'components/sector-intelligence/SectorCycleLens.tsx',
 'components/sector-intelligence/cycles/CycleSheets.tsx',
 'lib/__tests__/fixtures/sectorCycleHistory.ts',
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
   if(u.pathname==='/api/shared-shell/today')return route.fulfill({json:u.searchParams.get('workspace')==='liquidity_regime'?liquidityFixture():macro});
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

async function noOverflow(page) {
 const bounds = await overflow(page);
 expect(bounds.document).toBeLessThanOrEqual(bounds.viewport + 1);
 for (const main of bounds.main) expect(main.scroll).toBeLessThanOrEqual(main.client + 1);
}
// These member-only assertions use the existing authenticated qualifier. The
// anonymous Shared Shell lane must continue to show its real account gate.
async function qualifySectorCoherence(page, cell) {
  await page.route("**/api/sector-intelligence?**", route => {
    const source = new URL(route.request().url()).searchParams.get("source");
    if (source !== "generation") return sectorFixture(route);
    return route.fulfill({ json: { data: sectorGeneration, receipt: {
      source, status: "ready", path: "/api/sector-generation?audience=preview",
      asOf: sectorGeneration.source_session, observedAt: sectorGeneration.published_at,
      contentHash: "3e275fc69d22e990f81261c8a803576a832be9332484c7a99b2dddd165a5d425", stale: false,
    } } });
  });
  await page.goto(BASE + "/discover");
  await page.getByRole("button", { name: "Open Sectors", exact: true }).click();
  await expect(page).toHaveURL(/\/sectors\?workspaceMarket=us$/);
  const workspace = page.getByTestId("sector-intelligence");
  await expect(workspace.getByRole("heading", { level: 1, name: "Sector Intelligence", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("h1:visible")).toHaveCount(1);
  await expect(page.locator("main:visible")).toHaveCount(1);
  await expect(workspace).toHaveAttribute("id", "shared-shell-content");
  await expect(workspace.getByRole("button", { name: /Use (light|dark) view/ })).toHaveCount(0);
  const primary = workspace.getByTestId("sector-native-brief-explore");
  await expect(primary).toBeVisible();
  expect(await primary.evaluate(button => {
    const css = getComputedStyle(button);
    return css.backgroundColor !== "rgba(0, 0, 0, 0)" && css.backgroundColor !== css.color;
  })).toBe(true);
  await noOverflow(page);
  await page.screenshot({ animations: "disabled", path: path.join(OUT, cell + "-" + "sectors-brief-dark-en.png") });
  await primary.click();
  const table = workspace.getByRole("table", { name: "Explore sectors", exact: true });
  await expect(table.getByRole("columnheader")).toHaveCount(3);
  await expect(table.getByRole("rowheader")).toHaveCount(11);
  await table.getByRole("button", { name: "Select sector: Financials", exact: true }).click();
  await expect(workspace.getByTestId("sector-native-inspector")).toContainText("Financials");
  await noOverflow(page);
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await expect(workspace).toHaveAttribute("data-sector-theme", "light");
  await page.screenshot({ animations: "disabled", path: path.join(OUT, cell + "-" + "sectors-explore-light-en.png") });
  await workspace.getByTestId("sector-native-inspector-open").click();
  await expect(page.locator("h1:visible")).toHaveCount(1);
  await expect(workspace.getByTestId("sector-native-dossier")).toHaveAttribute("data-sector-theme", "light");
  await workspace.getByTestId("sector-native-dossier-back").click();
  await expect(table.getByRole("button", { name: "Select sector: Financials", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Old investigation addresses retain their mode without the Discover tool tabs.
  await page.goto(BASE + "/discover?tab=sectors&sectorJob=brief&sectorTheme=dark");
  await expect(workspace.getByTestId("sector-native-brief")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("h1:visible")).toHaveCount(1);
  await expect(page.locator("#wtab-sectors")).toHaveCount(0);
  // Reloaded account metadata remains authoritative. Exercise the shell's
  // explicit light-view intent even when this legacy URL requests dark.
  const light = page.getByRole("button", { name: "Light theme", exact: true });
  if (await light.getAttribute("aria-pressed") !== "true") await light.click();
  await expect(workspace).toHaveAttribute("data-sector-theme", "light");
  await noOverflow(page);
}

async function qualifyCycleHistory(page, cell) {
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  const sources = [];
  await page.route("**/api/sector-intelligence?**", route => {
    const source = new URL(route.request().url()).searchParams.get("source");
    sources.push(source);
    if (source !== "history") return sectorFixture(route);
    // Synthetic contract observations and their exact fixture-byte receipt.
    // This proves UI behavior, not real-source or authenticated production parity.
    return route.fulfill({ json: { data: cycleHistory, receipt: {
      source, status: "ready", path: "/sectordata/sector_cycles.json", asOf: "2026-11-12",
      observedAt: "2026-11-13T00:00:00Z", contentHash: cycleHistorySha, stale: false,
    } } });
  });
  await page.goto(BASE + "/sectors?workspaceMarket=us&sectorWorkspace=cycles&sector=xlk");
  const workspace = page.getByTestId("sector-intelligence");
  const hero = workspace.getByTestId("cycle-hero");
  const panel = workspace.getByTestId("cycle-chart-panel");
  await expect(hero).toContainText("Technology", { timeout: 30_000 });
  await expect(page.locator("h1:visible")).toHaveCount(1);
  await expect(page.locator("main:visible")).toHaveCount(1);
  await expect(workspace.locator("iframe")).toHaveCount(0);
  expect([...new Set(sources)].sort()).toEqual(["events", "history"]);
  await expect(workspace.getByTestId("cycle-history-measurement")).toContainText("Total return");
  await noOverflow(page);
  await page.screenshot({ animations: "disabled", path: path.join(OUT, cell + "-" + "cycle-history-dark-en.png") });
  await panel.getByRole("button", { name: "Data table", exact: true }).click();
  await panel.getByRole("combobox", { name: "Chart range", exact: true }).selectOption("21");
  await expect(panel.locator("tbody tr")).toHaveCount(21);
  await expect(panel.locator("caption")).toContainText("SPY");
  const sourceButton = workspace.getByRole("button", { name: "Sources and method", exact: true });
  await sourceButton.click();
  const sourceDialog = page.getByRole("dialog");
  await expect(sourceDialog).toBeVisible();
  await expect(sourceDialog).toContainText("2026-11-12");
  await sourceDialog.getByText("Technical receipt", { exact: true }).first().click();
  await expect(sourceDialog).toContainText("/sectordata/sector_cycles.json");
  await page.keyboard.press("Escape");
  await expect(sourceButton).toBeFocused();
  // The compact picker is the same owner on phone and tablet. Draft and
  // Cancel leave the URL unchanged; Apply commits through the host codec.
  const picker = panel.getByRole("button", { name: /^Series \(\d+\)$/ });
  await picker.click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Financials XLF/ }).click();
  await dialog.getByText("Cancel", { exact: true }).click();
  await expect(page).toHaveURL(/sector=xlk/);
  await expect(picker).toBeFocused();
  await picker.click();
  dialog = page.getByRole("dialog");
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await apply.focus(); await page.keyboard.press("Tab");
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await dialog.getByRole("button", { name: /Financials XLF/ }).click();
  await apply.click();
  await expect(page).toHaveURL(/sector=xlf/);
  await expect(hero).toContainText("Financials");
  await page.goBack();
  await expect(page).toHaveURL(/sector=xlk/);
  await expect(hero).toContainText("Technology");
  const selectedFocus = page.viewportSize().width <= 980
    ? workspace.locator("[data-cycle-change-series]") : workspace.locator('[data-sector-choice="xlk"]');
  await expect(selectedFocus).toBeFocused();
  await hero.getByRole("button", { name: "Open sector dossier", exact: true }).click();
  await expect(workspace.getByTestId("sector-native-dossier")).toBeVisible();
  await workspace.getByTestId("sector-native-dossier-back").click();
  await expect(page).toHaveURL(/sectorWorkspace=cycles/);
  await expect(hero).toContainText("Technology");
  await expect(hero.getByRole("button", { name: "Open sector dossier", exact: true })).toBeFocused();
  await hero.getByRole("button", { name: "Open sector dossier", exact: true }).click();
  await expect(workspace.getByTestId("sector-native-dossier")).toBeVisible();
  await page.goBack();
  await expect(hero).toContainText("Technology");
  await expect(hero.getByRole("button", { name: "Open sector dossier", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await page.getByRole("button", { name: "Chinese language", exact: true }).click();
  await expect(workspace).toHaveAttribute("data-sector-theme", "light");
  await expect(workspace.getByRole("heading", { name: "周期历史", exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ animations: "disabled", path: path.join(OUT, cell + "-" + "cycle-history-light-zh.png") });
}

async function qualifyLiquidity(page,cell) {
  let fixtureRead=liquidityFixture(),selectedReads=0;
  await page.route('**/api/shared-shell/today?workspace=liquidity_regime',route=>{selectedReads++;return route.fulfill({json:fixtureRead});});
  await page.goto(BASE+'/intelligence?workspaceMarket=us');
  const entry=page.getByRole('link',{name:'Liquidity regime →',exact:true});
  await expect(entry).toBeVisible({timeout:30000});await entry.click();
  await expect(page).toHaveURL(BASE+'/intelligence?workspaceMarket=us&macroWorkspace=liquidity_regime');
  const detail=page.locator('[data-macro-liquidity]');
  await expect(detail).toHaveAttribute('data-read-state','ready',{timeout:30000});
  await expect(detail.getByRole('heading',{level:1,name:'Liquidity Regime',exact:true})).toBeFocused();
  await expect(page.locator('h1:visible')).toHaveCount(1);await expect(page.locator('main:visible')).toHaveCount(1);await expect(detail.locator('iframe')).toHaveCount(0);
  await expect(detail).toContainText('Tight funding / Weak support');await expect(detail).toContainText('48.00');
  await expect(detail.getByRole('table')).toContainText('Unchanged');await expect(detail.getByRole('table')).toContainText('0.00');
  await expect(detail).toContainText('2026-11-10 → 2026-11-12');await expect(detail).toContainText('Points on a 0–100 scale');await expect(detail).toContainText('2026-11-06');
  await noOverflow(page);await page.screenshot({animations:'disabled',path:path.join(OUT,cell+'-liquidity-dark-en.png')});
  await detail.getByRole('button',{name:'Sources & method',exact:true}).click();
  await expect(detail.locator('summary')).toBeFocused();await expect(detail.locator('details')).toHaveAttribute('open','');
  await expect(detail.locator('details')).toContainText('8'.repeat(64));await expect(detail.locator('details')).toContainText('not a hash of the raw file bytes');await noOverflow(page);
  await detail.getByRole('link',{name:'← Market overview',exact:true}).click();
  await expect(page).toHaveURL(BASE+'/intelligence?workspaceMarket=us');await expect(entry).toBeFocused();
  await page.keyboard.press('Enter');await expect(detail).toHaveAttribute('data-read-state','ready');
  await page.goBack();await expect(entry).toBeFocused();await page.goForward();await expect(detail).toHaveAttribute('data-read-state','ready');
  await expect(detail.getByRole('link',{name:'Open full liquidity workspace ↗',exact:true})).toHaveAttribute('href','/macro_liquidity_regime.html');
  // The market owner keeps the selected task while the coverage boundary
  // unmounts its US consumer. Returning to US must reopen the same detail.
  const beforeMarketSwitch=selectedReads;
  await page.getByRole('combobox',{name:'Workspace market',exact:true}).selectOption('cn');
  await expect(page).toHaveURL(BASE+'/intelligence?macroWorkspace=liquidity_regime&workspaceMarket=cn');
  await expect(page.getByRole('heading',{name:'This workspace is not available for this market yet',exact:true})).toBeVisible();
  await expect(detail).toHaveCount(0);expect(selectedReads).toBe(beforeMarketSwitch);
  await page.getByRole('link',{name:'View US workspace →',exact:true}).click();
  await expect(page).toHaveURL(BASE+'/intelligence?macroWorkspace=liquidity_regime&workspaceMarket=us');
  await expect(detail).toHaveAttribute('data-read-state','ready');
  await expect(detail.getByRole('heading',{level:1,name:'Liquidity Regime',exact:true})).toBeFocused();
  // One missing prior affects one row; it cannot erase the published state or
  // manufacture a zero change. Values below remain synthetic specimens.
  const missing=fixtureRead.selected_workspace.view.changes.deltas[1];
  Object.assign(missing,{prior:null,prior_raw:null,prior_present:false,delta:null,delta_raw:null,delta_present:false,comparable:false,is_movement:false,absence:{label:{en:'Previous value unavailable',zh:'上次值不可用'}}});
  await detail.getByRole('button',{name:'Refresh',exact:true}).click();await expect(detail).toHaveAttribute('data-read-state','ready');
  await expect(detail.getByRole('table')).toContainText('Previous value unavailable');await expect(detail.getByRole('table')).toContainText('Unchanged');await noOverflow(page);
  await page.getByRole('button',{name:'Light theme',exact:true}).click();await page.getByRole('button',{name:'Chinese language',exact:true}).click();
  await expect(detail.getByRole('heading',{level:1,name:'流动性状态',exact:true})).toBeVisible();await noOverflow(page);
  await page.locator('main').evaluate(el=>el.scrollTo(0,0));await page.screenshot({animations:'disabled',path:path.join(OUT,cell+'-liquidity-partial-light-zh.png')});
  fixtureRead=liquidityFixture();const view=fixtureRead.selected_workspace.view;
  view.changes={comparable:false,comparability:'NO_PRIOR',comparability_label:{en:'No prior publication',zh:'无上次发布'},prior_is_earlier:false,prior_effective_date:null,deltas:[],absence:{label:{en:'No prior publication',zh:'无上次发布'}}};view.headline.prior={state_id:null,effective_date:null};view.headline.hysteresis={held_prior:false,note:null};
  await detail.getByRole('button',{name:'刷新',exact:true}).click();await expect(detail).toHaveAttribute('data-read-state','ready');
  await expect(detail.getByRole('table')).toHaveCount(0);await expect(detail).toContainText('无上次发布');await expect(detail).toContainText('48.00');await noOverflow(page);
  await page.locator('main').evaluate(el=>el.scrollTo(0,0));await page.screenshot({animations:'disabled',path:path.join(OUT,cell+'-liquidity-no-prior-light-zh.png')});
  const beforeInvalid=selectedReads;await page.goto(BASE+'/intelligence?workspaceMarket=us&macroWorkspace=unknown');
  await expect(page.locator('[data-macro-liquidity]')).toHaveAttribute('data-read-state','invalid');await expect(page.locator('button[aria-controls="liquidity-sources"]')).toHaveCount(0);expect(selectedReads).toBe(beforeInvalid);
  report.cells.push({w:page.viewportSize().width,journey:'native-liquidity',sourceProof:'ORIGINAL_SYNTHETIC_PRESENTATION_NOT_MARKET_DATA',fixtureSha256:crypto.createHash('sha256').update(JSON.stringify(liquidityFixture())).digest('hex'),selectedReads,passed:true});
}

async function qualifyCandidates(page,cell) {
  let candidateRead=candidatePoolFixture(),status=200,candidateReads=0;
  const sectorQueries=[];
  await page.route('**/api/shared-shell/prophet-candidates',route=>{candidateReads++;return route.fulfill({status,json:candidateRead});});
  await page.route('**/api/prophet/sector-members*',route=>{sectorQueries.push(new URL(route.request().url()).searchParams.get('q'));return route.continue();});
  await page.goto(BASE+'/prophet?tab=candidates&workspaceMarket=us');
  const view=page.getByTestId('prophet-candidates');
  const presentation=async(lang,theme)=>{
    const language=page.getByRole('button',{name:/^(Chinese language|中文界面)$/});
    if(await language.getAttribute('aria-pressed')!==(lang==='zh'?'true':'false'))await language.click();
    const light=page.getByRole('button',{name:/^(Light theme|浅色主题)$/});
    if(await light.getAttribute('aria-pressed')!==(theme==='light'?'true':'false'))await light.click();
    await expect(page.locator('html')).toHaveAttribute('data-lang',lang);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  };
  const inspect=symbol=>view.getByRole('link',{name:'Inspect '+symbol,exact:true});
  const search=async text=>{await view.getByLabel('Find ticker, company or sector',{exact:true}).fill(text);await view.getByRole('button',{name:'Search',exact:true}).click();};
  const refresh=async()=>{await view.getByRole('button',{name:'Refresh',exact:true}).click();};
  const capture=async name=>{await noOverflow(page);expect(await view.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({animations:'disabled',path:path.join(OUT,cell+'-'+name+'.png')});};
  const back=()=>view.getByRole('link',{name:/^← All candidates/}).first();
  const readableCandidateActions=async()=>{
    if(page.viewportSize().width>700)return;
    const geometry=await view.locator('[data-candidate]').evaluateAll(links=>links.map(link=>{
      const row=link.closest('li'),box=link.getBoundingClientRect(),rowBox=row.getBoundingClientRect();
      const decision=row.querySelector('p').parentElement.getBoundingClientRect();
      const lines=[];
      for(const node of link.childNodes){
        if(node.nodeType!==Node.TEXT_NODE||!node.textContent.trim())continue;
        const range=document.createRange();range.selectNodeContents(node);
        for(const rect of range.getClientRects())if(rect.width>0)lines.push(Math.round(rect.top));
      }
      return {height:box.height,labelLines:new Set(lines).size,contained:box.left>=rowBox.left-1&&box.right<=rowBox.right+1&&box.bottom<=rowBox.bottom+1,belowDecision:box.top>=decision.bottom-1};
    }));
    expect(geometry.length).toBeGreaterThan(0);
    for(const item of geometry){expect(item.height).toBeGreaterThanOrEqual(44);expect(item.labelLines).toBe(1);expect(item.contained).toBe(true);expect(item.belowDecision).toBe(true);}
  };
  await expect(view).toHaveAttribute('data-read-state','ready',{timeout:30000});
  await presentation('en',page.viewportSize().width===820?'dark':'light');
  await expect(page.locator('h1:visible')).toHaveCount(1);await expect(page.getByRole('heading',{level:1,name:'Prophet',exact:true})).toBeVisible();
  await expect(page.locator('main:visible')).toHaveCount(1);await expect(view.locator('iframe')).toHaveCount(0);
  await expect(view.locator('[data-candidate]')).toHaveCount(4);
  await expect(view.locator('li:has(a[data-candidate="DEMOB"])')).toContainText('0.0');
  await expect(view.locator('li:has(a[data-candidate="DEMOC"])')).toContainText('Not scored');
  const candidatesTab=page.getByTestId('prophet-tab-candidates');
  await expect(candidatesTab).toHaveAttribute('aria-selected','true');await expect(candidatesTab).toHaveAttribute('tabindex','0');
  await expect(candidatesTab).toHaveAttribute('aria-controls','prophet-panel-candidates');
  await readableCandidateActions();await capture('list-en');

  if(page.viewportSize().width===320){
    for(const id of ['today','candidates','screener','plans']){
      const box=await page.getByTestId('prophet-tab-'+id).boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await candidatesTab.focus();await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('prophet-tab-screener')).toBeFocused();
    await page.keyboard.press('ArrowLeft');await expect(candidatesTab).toBeFocused();
    await expect(view).toHaveAttribute('data-read-state','ready');
    const more=page.getByTestId('prophet-lane-more');
    await more.click();await page.getByTestId('prophet-tab-options').focus();await page.keyboard.press('Escape');
    await expect(more).toBeFocused();await expect(more).toHaveAttribute('aria-expanded','false');
    await more.click();await page.getByTestId('prophet-tab-options').click();
    await expect(more).toBeFocused();await expect(more).toHaveText('More');await noOverflow(page);
    await candidatesTab.click();await expect(view).toHaveAttribute('data-read-state','ready');
  }

  const beforeSearch=candidateReads;
  await view.getByLabel('Find ticker, company or sector',{exact:true}).fill('Technology');
  expect(new URL(page.url()).searchParams.has('prophetQ')).toBe(false);await expect(view.locator('[data-candidate]')).toHaveCount(4);
  await view.getByRole('button',{name:'Search',exact:true}).click();
  await expect(view.locator('[data-candidate]')).toHaveCount(2);expect(new URL(page.url()).searchParams.get('prophetQ')).toBe('Technology');
  await inspect('DEMOC').scrollIntoViewIfNeeded();await inspect('DEMOC').focus();
  const listScroll=await view.evaluate(el=>el.scrollTop);
  await page.keyboard.press('Enter');await expect(view.getByRole('heading',{level:2,name:'Cedar Networks',exact:true})).toBeFocused();
  await expect(view).toContainText('Screen position');await expect(view).toContainText('Not scored');
  await expect(view.getByRole('link',{name:'Open company intelligence',exact:true})).toHaveAttribute('href','/analysis?symbol=DEMOC&page=overview');
  await expect(view.getByRole('link',{name:'Browse model plans',exact:true})).toHaveAttribute('href',/tab=plans/);
  await expect(view.getByRole('link',{name:'Full Prophet workspace',exact:true})).toHaveAttribute('href','/us_stocks.html');
  await capture('detail-en');
  await back().click();await expect(inspect('DEMOC')).toBeFocused();
  expect(Math.abs((await view.evaluate(el=>el.scrollTop))-listScroll)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Enter');await expect(page).toHaveURL(/symbol=DEMOC/);
  await page.goBack();await expect(inspect('DEMOC')).toBeFocused();await page.goForward();
  await expect(view.getByRole('heading',{level:2,name:'Cedar Networks',exact:true})).toBeVisible();
  expect(candidateReads).toBe(beforeSearch);
  const detailHref=page.url();await page.reload();await expect(page).toHaveURL(detailHref);
  await expect(view.getByRole('heading',{level:2,name:'Cedar Networks',exact:true})).toBeVisible();
  await view.getByRole('button',{name:'Sources & method',exact:true}).click();
  await expect(view.locator('summary')).toBeFocused();await expect(view.locator('details')).toHaveAttribute('open','');await noOverflow(page);
  await expect(view.locator('details')).toContainText(candidateRead.source.sha256);

  const beforeMarket=candidateReads;
  await page.getByRole('combobox',{name:'Workspace market',exact:true}).selectOption('cn');
  await expect(page.getByRole('heading',{name:'This workspace is not available for this market yet',exact:true})).toBeVisible();
  await expect(view).toHaveCount(0);expect(candidateReads).toBe(beforeMarket);
  expect(new URL(page.url()).searchParams.get('tab')).toBe('candidates');expect(new URL(page.url()).searchParams.has('symbol')).toBe(false);
  await noOverflow(page);await page.screenshot({animations:'disabled',path:path.join(OUT,cell+'-market-coverage.png')});
  await page.getByRole('link',{name:'View US workspace →',exact:true}).click();
  await expect(view).toHaveAttribute('data-read-state','ready');await expect(candidatesTab).toHaveAttribute('aria-selected','true');
  await search('Zephyr');await expect(view).toContainText('No candidates match this search');await expect(view).toContainText('0 / 4');await capture('no-matches-en');
  await view.getByRole('button',{name:'Clear search',exact:true}).first().click();await expect(view.locator('[data-candidate]')).toHaveCount(4);

  await presentation('zh','dark');
  await expect(view.getByRole('heading',{level:2,name:'全部候选股票',exact:true})).toBeVisible();
  await view.getByLabel('查找代码、公司或板块',{exact:true}).fill('晨光');await view.getByRole('button',{name:'搜索',exact:true}).click();
  await expect(view.locator('[data-candidate]')).toHaveCount(1);await expect(view).toContainText('Dawn Materials 晨光材料');
  const chineseHref=page.url();await page.reload();await expect(page).toHaveURL(chineseHref);await expect(view.locator('[data-candidate]')).toHaveCount(1);
  // The fixture account reloads its existing EN metadata. The Unicode URL
  // survives independently; request the Chinese presentation again explicitly.
  await presentation('zh','dark');
  await readableCandidateActions();await capture('list-dark-zh');
  if(page.viewportSize().width===320){
    const originalViewport=page.viewportSize();await page.setViewportSize({...originalViewport,width:390});
    await readableCandidateActions();await capture('list-390-dark-zh');await page.setViewportSize(originalViewport);
  }
  await page.getByTestId('prophet-tab-screener').click();expect(new URL(page.url()).searchParams.has('prophetQ')).toBe(false);
  await page.goBack();await expect(view.locator('[data-candidate]')).toHaveCount(1);expect(new URL(page.url()).searchParams.get('prophetQ')).toBe('晨光');
  expect(sectorQueries.some(value=>value&&value.includes('晨光'))).toBe(false);
  await presentation('en','light');
  await view.getByRole('button',{name:'Clear search',exact:true}).first().click();await expect(view.locator('[data-candidate]')).toHaveCount(4);

  // State variants are deliberately mutated synthetic contracts, not a claim
  // that these values or hashes represent another real published generation.
  candidateRead=candidatePoolFixture();candidateRead.projection.status='empty';candidateRead.projection.rows=[];
  for(const key of Object.keys(candidateRead.projection.counts))candidateRead.projection.counts[key]=0;
  await refresh();await expect(view).toHaveAttribute('data-source-status','empty');await expect(view).toContainText('No eligible candidates in this publication');await capture('verified-empty-en');
  candidateRead=candidatePoolFixture();candidateRead.projection.status='unavailable';candidateRead.projection.reason='candidate_pool_absent';candidateRead.projection.rows=[];candidateRead.projection.as_of=null;candidateRead.projection.source_digest=null;
  for(const key of Object.keys(candidateRead.projection.counts))candidateRead.projection.counts[key]=null;
  status=503;await refresh();await expect(view).toHaveAttribute('data-read-state','unavailable');await expect(view).toContainText('Date unavailable');await expect(view).toContainText('Candidate count unavailable');await expect(view.locator('[data-candidate]')).toHaveCount(0);await capture('unavailable-en');
  candidateRead=candidatePoolFixture();candidateRead.projection.as_of=null;status=200;
  await refresh();await expect(view).toHaveAttribute('data-read-state','unavailable');await expect(view.locator('details')).toHaveCount(0);
  candidateRead=candidatePoolFixture();await refresh();await expect(view.locator('[data-candidate]')).toHaveCount(4);
  status=403;await refresh();await expect(view).toHaveAttribute('data-read-state','access');await expect(view).not.toContainText('Aster Instruments');await expect(view.locator('details')).toHaveCount(0);await expect(view.getByRole('button',{name:'Back to Prophet Today',exact:true})).toBeVisible();await capture('access-en');
  status=200;await refresh();await expect(view.locator('[data-candidate]')).toHaveCount(4);
  await search('Technology');await inspect('DEMOC').click();await expect(view.getByRole('heading',{name:'Cedar Networks',exact:true})).toBeVisible();
  candidateRead.projection.rows=candidateRead.projection.rows.filter(row=>row.ticker!=='DEMOC');candidateRead.projection.counts={eligible:3,in_buy_lane:2,off_buy_lane:1,scored:2,unscored:1};
  await refresh();await expect(view).toContainText('DEMOC is not in this publication');await expect(view).not.toContainText('Cedar Networks');
  await back().click();await expect(view.getByRole('heading',{level:2,name:'All eligible candidates',exact:true})).toBeFocused();await expect(view.locator('[data-candidate]')).toHaveCount(1);
  report.cells.push({w:page.viewportSize().width,journey:'native-prophet-candidates',sourceProof:'ORIGINAL_SYNTHETIC_PRESENTATION_NOT_MARKET_DATA',fixtureSha256:crypto.createHash('sha256').update(JSON.stringify(candidatePoolFixture())).digest('hex'),candidateReads,sectorQueries,passed:true});
}

async function qualifyDiscover(page,cell) {
  let candidateReads=0,catalystReads=0;
  await page.route('**/api/shared-shell/prophet-candidates',route=>{candidateReads++;return route.fulfill({json:candidatePoolFixture()});});
  await page.route('**/api/catalyst-opportunities**',route=>{catalystReads++;return route.fulfill({status:503,json:{error:'synthetic source unavailable'}});});
  await page.goto(BASE+'/discover?origin=chooser-proof&workspaceMarket=us#evidence');
  const chooser=page.locator('[data-discover-chooser]');
  const presentation=async(lang,theme)=>{
    const language=page.getByRole('button',{name:/^(Chinese language|中文界面)$/});
    if(await language.getAttribute('aria-pressed')!==(lang==='zh'?'true':'false'))await language.click();
    const light=page.getByRole('button',{name:/^(Light theme|浅色主题)$/});
    if(await light.getAttribute('aria-pressed')!==(theme==='light'?'true':'false'))await light.click();
    await expect(page.locator('html')).toHaveAttribute('data-lang',lang);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  };
  await expect(chooser).toBeVisible({timeout:30000});
  await expect(page.locator('h1:visible')).toHaveCount(1);await expect(page.locator('main:visible')).toHaveCount(1);
  await expect(chooser.locator('iframe')).toHaveCount(0);await expect(chooser.getByRole('button')).toHaveCount(8);
  await expect(chooser.locator('a[href="/prophet?tab=candidates&workspaceMarket=us"]')).toHaveCount(1);
  await expect(chooser.locator('a[href="/biocatalyst.html"]')).toHaveCount(1);
  await expect(chooser.locator('a[href="/us_stocks.html"]')).toHaveCount(1);
  await expect(chooser.locator('a[href="/confluence_screener.html"]')).toHaveCount(1);
  for(const [lang,mode] of [['en','dark'],['zh','light']]){
    await presentation(lang,mode);
    await expect(chooser.getByRole('heading',{level:1,name:lang==='zh'?'发现':'Discover',exact:true})).toBeVisible();
    for(const action of await chooser.locator('button,a').all()){
      await action.scrollIntoViewIfNeeded();
      const box=await action.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44);
      expect(await action.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      await action.focus();await expect(action).toBeFocused();
    }
    await noOverflow(page);await page.screenshot({animations:'disabled',path:path.join(OUT,cell+'-research-'+lang+'.png')});
    await chooser.evaluate(el=>el.scrollTop=0);await page.screenshot({animations:'disabled',path:path.join(OUT,cell+'-questions-'+lang+'.png')});
  }
  expect(candidateReads).toBe(0);expect(catalystReads).toBe(0);
  await presentation('en','dark');
  const catalyst=chooser.getByRole('button',{name:'Open Catalyst Intelligence',exact:true});
  await catalyst.focus();await page.keyboard.press('Enter');
  const catalystTab=page.locator('#wtab-catalysts');
  await expect(catalystTab).toHaveAttribute('aria-selected','true');await expect(catalystTab).toBeFocused();
  expect(new URL(page.url()).searchParams.get('origin')).toBe('chooser-proof');expect(new URL(page.url()).hash).toBe('#evidence');
  await expect(page.getByTestId('catalyst-opportunities')).toBeVisible();
  await expect.poll(()=>catalystReads).toBeGreaterThan(0);
  await page.locator('.discover-chooser-back').click();
  await expect(chooser.getByRole('heading',{level:1,name:'Discover',exact:true})).toBeFocused();
  expect(new URL(page.url()).searchParams.has('tab')).toBe(false);
  expect(new URL(page.url()).searchParams.get('origin')).toBe('chooser-proof');expect(new URL(page.url()).hash).toBe('#evidence');
  await chooser.getByRole('link',{name:'Open candidates',exact:true}).click();
  await expect(page).toHaveURL(BASE+'/prophet?tab=candidates&workspaceMarket=us');
  await expect(page.getByTestId('prophet-candidates')).toHaveAttribute('data-read-state','ready');
  await page.goBack();await expect(chooser).toBeVisible();
  expect(new URL(page.url()).searchParams.get('origin')).toBe('chooser-proof');expect(new URL(page.url()).hash).toBe('#evidence');
  await noOverflow(page);
  report.cells.push({w:page.viewportSize().width,journey:'discover-chooser-handoffs',sourceProof:'CHOOSER_ONLY_WITH_SYNTHETIC_DESTINATION_STATES',candidateReads,catalystReads,passed:true});
}

async function qualifyToday(page,cell) {
  let marketRead=todayMarketFixture(),marketStatus=200,changesStatus=200;
  const counts={market:0,brief:0,comparison:0,catalog:0,watchlists:0,breadth:0,reportBodies:0},comparisonInputs=[];
  await page.addInitScript(({owner,selection})=>{
    // Seed one synthetic existing revision using readingContracts' exact key format.
    // Never substitute a current revision when the user resumes this saved selection.
    const pointer=`mm.research.last.v1:${owner}`;
    if(!localStorage.getItem(pointer)){
      const key=['reading-progress',owner,selection.docId,selection.sourcePdfSha256,selection.extractedTextSha256,selection.extractorVersion,selection.segmenterVersion].join('|');
      localStorage.setItem(key,JSON.stringify({segmentStart:7}));localStorage.setItem(pointer,JSON.stringify({selection}));
    }
    window.__todayDigestWrites=0;
    const write=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='mmx.today.since.v1')window.__todayDigestWrites++;return write.call(this,key,value);};
  },{owner:OWNER,selection:TODAY_SAVED_SELECTION});
  await page.route('**/api/shared-shell/today',route=>{counts.market++;return route.fulfill({status:marketStatus,json:marketStatus===200?marketRead:{error:'synthetic source unavailable'}});});
  await page.route('**/api/portfolio-brief',route=>{counts.brief++;return route.fulfill({json:todayPersonalBriefFixture()});});
  await page.route('**/api/portfolio-changes',route=>{
    counts.comparison++;expect(route.request().method()).toBe('POST');
    const previous=route.request().postDataJSON().previous;comparisonInputs.push(previous);
    return route.fulfill({status:changesStatus,json:changesStatus===200?{...todayChangesFixture(),first_visit:previous===null}:{error:'synthetic comparison unavailable'}});
  });
  await page.route('**/api/shared-shell/research/catalog',route=>{counts.catalog++;return route.fulfill({json:todayCatalogFixture()});});
  await page.route('**/api/shared-shell/research/read/**',route=>{counts.reportBodies++;return route.fulfill({status:503,json:{error:'No automatic body read'}});});
  await page.route('**/api/watchlist',route=>{counts.watchlists++;return route.fulfill({json:todayWatchlistFixture()});});
  await page.route('**/api/market-breadth',route=>{counts.breadth++;return route.fulfill({status:503,json:{error:'synthetic independent source unavailable'}});});
  await page.route('**/api/shared-shell/prophet-candidates',route=>route.fulfill({json:candidatePoolFixture()}));
  const presentation=async(lang,mode)=>{
    const language=page.getByRole('button',{name:/^(Chinese language|中文界面)$/});
    if(await language.getAttribute('aria-pressed')!==(lang==='zh'?'true':'false'))await language.click();
    const light=page.getByRole('button',{name:/^(Light theme|浅色主题)$/});
    if(await light.getAttribute('aria-pressed')!==(mode==='light'?'true':'false'))await light.click();
    await expect(page.locator('html')).toHaveAttribute('data-lang',lang);await expect(page.locator('html')).toHaveAttribute('data-theme',mode);
  };
  const savedHref='/research?'+new URLSearchParams({doc_id:TODAY_SAVED_SELECTION.docId,source_pdf_sha256:TODAY_SAVED_SELECTION.sourcePdfSha256,
    extracted_text_sha256:TODAY_SAVED_SELECTION.extractedTextSha256,extractor_version:TODAY_SAVED_SELECTION.extractorVersion,
    segmenter_version:TODAY_SAVED_SELECTION.segmenterVersion,segment_start:'7'}).toString();
  const since=page.locator('[data-today-since-state]'),summary=page.locator('[data-today-market-summary]'),market=page.locator('[data-today-market-snapshot]');
  const capture=async name=>{await noOverflow(page);await page.screenshot({animations:'disabled',path:path.join(OUT,cell+'-'+name+'.png')});};
  const width=page.viewportSize().width,height=page.viewportSize().height;
  await page.goto(BASE+'/today?workspaceMarket=us');
  await expect(since).toHaveAttribute('data-today-since-state','ready',{timeout:30000});
  await presentation('en',width===1440?'dark':'light');
  await expect(summary).toHaveText('Liquidity is mixed. Growth is picking up.');
  await expect(page.getByRole('heading',{level:1,name:'Today',exact:true})).toBeVisible();
  await expect(page.locator('h1:visible')).toHaveCount(1);await expect(page.locator('main:visible')).toHaveCount(1);
  await expect(market.locator('iframe')).toHaveCount(0);
  await expect(page.locator('[data-breadth-cell]')).toContainText('Breadth reading unavailable');
  await expect(since).toContainText('No earlier comparison is available');
  await expect(page.locator('[data-today-brief-context]')).toContainText("The desk's daily read: Mixed.");
  await expect(page.locator('section[aria-labelledby$="-continue"]').getByRole('heading',{name:'Memory & storage: what still needs proof',exact:true})).toBeVisible();
  await expect(page.locator('[data-today-attention-state]')).toHaveAttribute('data-today-attention-state','ready');
  await expect(page.getByRole('link',{name:'Resume reading',exact:true})).toHaveAttribute('href',savedHref);
  await expect(page.locator('[data-today-source-details]')).not.toHaveAttribute('open','');
  expect(counts.comparison).toBe(1);expect(counts.reportBodies).toBe(0);
  expect(await page.evaluate(()=>window.__todayDigestWrites)).toBe(1);
  const stored=await page.evaluate(()=>localStorage.getItem('mmx.today.since.v1'));
  expect(JSON.parse(stored)[`account:${OWNER}`]).toEqual(todayDigestFixture());
  await capture('reading-visible-en');
  const before={...counts};
  await since.evaluate(el=>{window.__todaySinceNode=el;});
  const disclosure=page.locator('[data-today-source-details] summary');
  await disclosure.focus();await page.keyboard.press('Enter');await expect(disclosure).toBeFocused();
  await expect(page.locator('[data-today-source-details]')).toHaveAttribute('open','');
  await expect(page.locator('[data-today-reading="inflation"]')).toBeVisible();
  await since.locator('summary').click();await expect(since).toContainText('This account · this browser');
  await presentation('zh',width===820?'light':'dark');
  await expect(summary).toHaveText('流动性不均衡。增长正在回升。');
  await page.setViewportSize({width:width===320?820:320,height});await noOverflow(page);
  await page.setViewportSize({width,height});await noOverflow(page);
  expect(await since.evaluate(el=>window.__todaySinceNode===el)).toBe(true);
  expect(counts).toEqual(before);expect(await page.evaluate(()=>window.__todayDigestWrites)).toBe(1);
  expect(await page.evaluate(()=>localStorage.getItem('mmx.today.since.v1'))).toBe(stored);
  await expect(page.getByRole('link',{name:'继续阅读',exact:true})).toHaveAttribute('href',savedHref);
  await capture('sources-and-basis-zh');

  // A new explicit visit may read again; a failed comparison must preserve its accepted baseline.
  marketRead=todayMarketFixture();marketRead.read.clauses=[];changesStatus=503;
  await page.reload();await presentation('en','light');
  await expect(summary).toHaveText('A market summary was not published.');
  await expect(page.locator('[data-today-reading="money"]')).toContainText('Tight and thin');
  await expect(since).toHaveAttribute('data-today-since-state','unavailable');
  await expect(page.locator('[data-today-brief-context]')).toContainText("The desk's daily read: Mixed.");
  expect(await page.evaluate(()=>localStorage.getItem('mmx.today.since.v1'))).toBe(stored);
  expect(await page.evaluate(()=>window.__todayDigestWrites)).toBe(0);
  await capture('summary-and-comparison-unavailable');
  changesStatus=200;await since.getByRole('button',{name:'Check again',exact:true}).click();
  await expect(since).toHaveAttribute('data-today-since-state','ready');await expect(since).toContainText('No tracked changes in this reading.');
  expect(comparisonInputs.at(-1)).toEqual(todayDigestFixture());
  marketStatus=503;await page.reload();await presentation('en','light');
  await expect(page.getByRole('heading',{name:'Market reading unavailable',exact:true})).toBeVisible();
  await expect(since).toHaveAttribute('data-today-since-state','ready');await expect(summary).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Resume reading',exact:true})).toHaveAttribute('href',savedHref);
  await capture('market-unavailable-desk-retained');
  marketStatus=200;marketRead=todayMarketFixture();await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(summary).toBeVisible();
  await market.getByRole('link',{name:'Open market overview',exact:true}).click();
  await expect(page).toHaveURL(BASE+'/intelligence?workspaceMarket=us');await expect(page.locator('[data-intelligence-overview]')).toBeVisible();
  await page.goBack();await expect(page).toHaveURL(BASE+'/today?workspaceMarket=us');await expect(summary).toBeVisible();
  await page.locator('main a[href="/prophet?tab=candidates&workspaceMarket=us"]').click();
  await expect(page).toHaveURL(BASE+'/prophet?tab=candidates&workspaceMarket=us');
  await expect(page.getByTestId('prophet-candidates')).toHaveAttribute('data-read-state','ready');
  await page.goBack();await expect(summary).toBeVisible();
  await page.locator('main a[href="/sectors?sectorJob=explore&workspaceMarket=us"]').click();
  await expect(page).toHaveURL(BASE+'/sectors?sectorJob=explore&workspaceMarket=us');
  await expect(page.getByTestId('sector-native-job-explore')).toHaveAttribute('aria-selected','true');
  await page.goBack();await expect(summary).toBeVisible();
  expect(counts.reportBodies).toBe(0);
  report.cells.push({w:width,journey:'native-today-daily-desk',sourceProof:'ORIGINAL_SYNTHETIC_PRESENTATION_NOT_MARKET_OR_ACCOUNT_DATA',
    fixtureSha256:crypto.createHash('sha256').update(JSON.stringify(todayMarketFixture())).digest('hex'),counts,
    presentationKeptReaderIdentity:true,presentationDigestWrites:1,savedRevisionHref:savedHref,passed:true});
}

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
  // Warm only the qualified real routes, with the same synthetic authority.
  for(const dest of ['/intelligence','/prophet','/sectors','/today','/discover']){
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
  await page.locator('[data-intelligence-source="prophet"] a[href="/prophet"]').click();await expect(page).toHaveURL(BASE+'/prophet');await expect(page.getByRole('heading',{level:1,name:'Prophet',exact:true})).toBeVisible();
  // /prophet opens on the Today lane; the plans grid lives in the Plans lane, which the reader selects (URL gains tab=plans).
  await page.getByTestId('prophet-tab-plans').click();await expect(page).toHaveURL(BASE+'/prophet?tab=plans');await expect(page.locator('.obs-prophet-grid')).toBeVisible({timeout:45000});await expect(page.getByText('UBER',{exact:true}).first()).toBeVisible();
  await expect(page.getByRole('link',{name:'Full workspace ↗',exact:true})).toHaveAttribute('href','/us_stocks.html');
  await page.screenshot({path:path.join(OUT,'prophet-native-desktop.png')});await page.goBack();await expect(page).toHaveURL(BASE+'/prophet');await page.goBack();await expect(page).toHaveURL(BASE+'/intelligence');
  await page.locator('[data-intelligence-nav="context"]').getByRole('link',{name:'Sector Intelligence',exact:true}).click();await expect(page.locator('[data-testid="sector-intelligence"]')).toBeVisible({timeout:45000});
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
  await page.locator('.appnav').getByRole('link',{name:'Overview',exact:true}).click();
  // Prove that the requested destination committed before exercising Back.
  // An immediate goBack can race the asynchronous route commit and tests no journey.
  await expect(page).toHaveURL(BASE+'/intelligence?workspaceMarket=us');
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
  await page.locator('.appnav').getByRole('link',{name:'Overview',exact:true}).click();
  await expect(page).toHaveURL(BASE+'/intelligence?workspaceMarket=us');
  await page.setViewportSize({width:320,height:844});const stress=await overflow(page);if(stress.document>321)throw Error('320px document overflow');report.stress320=stress;
  await page.route('**/api/flow?f=prophet_idx&view=intelligence',r=>r.fulfill({status:403,json:{error:'pro_required'}}));
  await page.locator('[data-intelligence-source="prophet"] button').click();await expect(page.locator('[data-intelligence-source="prophet"]')).toHaveAttribute('data-read-state','access');await expect(page.locator('[data-intelligence-source="macro"]')).toHaveAttribute('data-read-state','ready');
  await ctx.close();
  const guest=await context(false),gp=await guest.newPage();await gp.goto(BASE+'/intelligence');await expect(gp.locator('[data-intelligence-overview]')).toHaveCount(0);report.guestGate=true;await guest.close();
  for (const [width,height] of [[1440,900],[820,1180],[320,844]]) {
   theme='dark';locale='en';
   const memberContext=await context(), memberPage=await memberContext.newPage();
   await memberPage.setViewportSize({width,height});
   memberPage.on('pageerror',error=>report.errors.push({cell:`sector-native-${width}`,error:error.message}));
   const cell=`sector-native-${width}`;
   await qualifySectorCoherence(memberPage,cell);
   await qualifyCycleHistory(memberPage,cell);
   report.cells.push({w:width,h:height,journey:'native-sector-and-cycle-history',source:cycleHistorySha,
    sourceProof:'SYNTHETIC_CONTRACT_FIXTURE_NOT_MARKET_DATA',passed:true});
   await memberContext.close();
   const liquidityContext=await context(),liquidityPage=await liquidityContext.newPage();
   await liquidityPage.setViewportSize({width,height});liquidityPage.on('pageerror',error=>report.errors.push({cell:`liquidity-${width}`,error:error.message}));
   await qualifyLiquidity(liquidityPage,`liquidity-${width}`);await liquidityContext.close();
   const candidateContext=await context(),candidatePage=await candidateContext.newPage();
   await candidatePage.setViewportSize({width,height});candidatePage.on('pageerror',error=>report.errors.push({cell:`candidates-${width}`,error:error.message}));
   await qualifyCandidates(candidatePage,`candidates-${width}`);await candidateContext.close();
   const todayContext=await context(),todayPage=await todayContext.newPage();
   await todayPage.setViewportSize({width,height});todayPage.on('pageerror',error=>report.errors.push({cell:`today-${width}`,error:error.message}));
   await qualifyToday(todayPage,`today-${width}`);await todayContext.close();
   const discoverContext=await context(),discoverPage=await discoverContext.newPage();
   await discoverPage.setViewportSize({width,height});discoverPage.on('pageerror',error=>report.errors.push({cell:`discover-${width}`,error:error.message}));
   await qualifyDiscover(discoverPage,`discover-${width}`);await discoverContext.close();
  }
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
