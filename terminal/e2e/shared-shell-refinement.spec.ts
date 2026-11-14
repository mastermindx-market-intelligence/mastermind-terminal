import {expect,test,type Page} from "@playwright/test";
import {SHARED_SHELL_PROTOCOL,SHARED_SHELL_BRIDGE_VERSION,SHARED_SHELL_DOCUMENT_VERSION} from "../lib/sharedShellContracts";
import {overviewFundFixture,detailFundFixture,insiderActivityFixture,archiveCallsFixture,marketBarsFixture} from "./fixtures/analysisResearch";
import {contextFixture,themeContextFixture,institutionalContextFixture} from "./fixtures/companyIntelligenceContext";
import {techLabFixture} from "../lib/__tests__/fixtures/techLab";
import {retainedCompanyResearchFixture} from "./fixtures/retainedCompanyResearch";
import {expectSelectLabelFits} from "./selectLabel";
import {settled} from "./settle";
import {canonicalTranscriptBodySha256} from "../lib/transcriptSearch";
import {gzipSync} from "node:zlib";

// Use the existing responsive harness and real routes. The normal customer
// configuration keeps this opt-in surface off; CI qualifies it explicitly.
test.skip(process.env.MMX_SHARED_SHELL !== "1", "Shared Shell is an explicit beta opt-in");
test.use({colorScheme:"dark"});

// These are the incumbent standalone fixtures in the actual opt-in Beta shell.
// They qualify composition and interaction, never production data or acceptance.
async function installAnalysisFixtures(page:Page,baseURL:string,lang:"en"|"zh") {
 await page.context().addCookies([
  {name:"mm_e2e_rs30",value:"1",url:baseURL},{name:"mm_e2e_guest",value:"1",url:baseURL},
 ]);
 await page.addInitScript(language=>localStorage.setItem("mm.lang",language),lang);
 await page.route("https://www.mastermind-x.com/mm_brain.js",route=>route.fulfill({contentType:"application/javascript",body:""}));
 await page.route("**/data/manifest.json",route=>route.fulfill({json:{as_of:null,symbols:{
  NVDA:{name:"NVIDIA Corporation",mkt:"NASDAQ",col:"#aaa",sec:"Equities",verdict:null},
  AAPL:{name:"Apple Inc.",mkt:"NASDAQ",col:"#aaa",sec:"Equities",verdict:null},
 }}}));
 await page.route("**/NVDA.fund.json**",route=>route.fulfill({json:overviewFundFixture}));
 await page.route("**/data/NVDA.json**",route=>route.fulfill({json:marketBarsFixture()}));
 await page.route("**/data/NVDA.intel.json**",route=>route.fulfill({json:techLabFixture("NVDA")}));
 await page.route("**/api/company-intelligence/NVDA**",route=>route.fulfill({json:{ok:true,state:"ready",context:contextFixture()}}));
 await page.route("**/api/company-theme-context/NVDA**",route=>route.fulfill({json:{ok:true,state:"partial",context:themeContextFixture()}}));
 await page.route("**/api/company-institutional-context/NVDA**",route=>route.fulfill({json:{ok:true,state:"ready",context:institutionalContextFixture()}}));
 await page.route("**/api/event-workspace/**",route=>route.fulfill({status:404,json:{ok:false,state:"error",available:false,
  error:{code:"not_found",message:"Event workspace is not covered in this fixture",retryable:false}}}));
 await page.route("**/api/investigations/baseline?**",route=>route.fulfill({status:503,json:{ok:false,reason:"current_owner_unavailable"}}));
}

async function chooseAnalysisFamily(page:Page,family:string,routePage:string) {
 const compact=page.locator(".fin-family-mobile-trigger");
 if(await compact.isVisible()) {
  await compact.click();
  const menu=page.locator(".fin-family-sheet-layer[open]");
  await expect(menu).toBeVisible();
  await menu.locator(`[data-fin-family-sheet="${family}"]`).click();
  await expect(menu).toHaveCount(0);
  await expect(compact).toBeFocused();
 } else {
  await page.locator(`[data-fin-family="${family}"]`).click();
 }
 await expect(page).toHaveURL(new RegExp(`[?&]page=${routePage}(?:&|$)`));
}

async function chooseAnalysisView(page:Page,view:string) {
 await page.locator(`[data-fin-local="${view}"]`).click();
 await expect(page).toHaveURL(new RegExp(`[?&]page=${view}(?:&|$)`));
}

async function installAnalysisArchive(page:Page) {
 const generated_at="2026-09-23T12:00:00Z";
 const revisions:Record<string,string>={};
 const dates:Record<string,string>={};
 for(const body of archiveCallsFixture) {
  const hash=await canonicalTranscriptBodySha256(body);
  if(!hash) throw new Error("Transcript fixture hashing is unavailable");
  revisions[`NVDA/${body.id}`]=hash;
  dates[`NVDA/${body.id}`]=body.date!;
  await page.route(url=>url.pathname===`/data/tx/NVDA/${body.id}.json.gz`,route=>route.fulfill({
   body:gzipSync(JSON.stringify(body)),contentType:"application/gzip",
  }));
 }
 await page.route(url=>url.pathname==="/data/tx/index.json",route=>route.fulfill({json:{
  schema:"mastermind.tx-index/v1",generated_at,body_count:archiveCallsFixture.length,
  symbols:{NVDA:archiveCallsFixture.map(call=>call.id)},revisions,dates,
 }}));
 await page.route(url=>url.pathname==="/data/tx/NVDA/index.json",route=>route.fulfill({json:{
  schema:"mastermind.tx-symbol-index/v1",ticker:"NVDA",generated_at,
  calls:archiveCallsFixture.map(call=>{
   const qa=call.segments.findIndex(segment=>segment.text.startsWith("Our first question"));
   return {id:call.id,period:call.period,date:call.date,title:call.title,url:`/data/tx/NVDA/${call.id}.json.gz`,
    segment_count:call.segments.length,speaker_count:new Set(call.segments.map(segment=>segment.speaker)).size,
    speakers:[...new Set(call.segments.map(segment=>segment.speaker))],qa_start:qa>=0?qa:null,has_qa:qa>=0,source:"DefeatBeta"};
  }),
 }}));
}

async function compactAnalysisChrome(page:Page) {
 const workspace=page.locator(".analysis-shell");
 await expect(workspace.locator(".fin-research-nav")).toHaveCount(1);
 await expect(workspace.locator(".fin-company-control")).toHaveCount(1);
 await expect(workspace.locator(".analysis-context-bar,.analysis-context-back")).toHaveCount(0);
 await expect(workspace.locator(".analysis-context-actions")).not.toHaveAttribute("open","");
 const nav=await workspace.locator(".fin-research-nav").boundingBox();
 expect(nav!.height).toBeLessThanOrEqual(64);
 const body=await workspace.locator(".fin-pane > .fin-body").boundingBox();
 // The global shell, company bar and local lenses must leave most of the
 // viewport available for research, even at the real 390px mobile width.
 expect(body!.y).toBeLessThanOrEqual(190);
 expect(body!.height).toBeGreaterThan(page.viewportSize()!.height*0.65);
 expect(body!.y+body!.height).toBeLessThanOrEqual(page.viewportSize()!.height+1);
 expect(body!.x).toBeGreaterThanOrEqual(0);
 expect(body!.x+body!.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
 expect(await workspace.locator(".fin-pane").evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
 await noOverflow(page);
}

async function analysisChartReturn(page:Page,lang:"en"|"zh",symbol:string) {
 const researchUrl=page.url();
 const visibleChrome=page.locator(".shared-shell > .topbar:visible, .shared-shell > .mobilebar:visible");
 await expect(visibleChrome).toHaveCount(1);
 const desktopChart=page.locator(".shared-shell > .topbar .shared-shell-terminal-link");
 let href:string|null;
 if(await page.locator(".shared-shell > .topbar").isVisible()) {
  await expect(desktopChart).toBeVisible();
  await expect(desktopChart).toHaveCount(1);
  href=await desktopChart.getAttribute("href");
 } else {
  const menu=page.locator(".mobilebar").getByRole("button",{name:lang==="zh"?"打开导航":"Open navigation",exact:true});
  await menu.click();
  const chart=page.locator('.m-drawer.open a[href^="/terminal?"]');
  await expect(chart).toHaveCount(1);
  href=await chart.getAttribute("href");
  await page.keyboard.press("Escape");
  await expect(page.locator(".m-drawer.open")).toHaveCount(0);
  await expect(menu).toBeFocused();
 }
 const target=new URL(href!,researchUrl);
 expect(target.searchParams.get("symbol")).toBe(symbol);
 expect(target.searchParams.get("ret")).toBe(researchUrl);
 return target.href;
}

for(const lang of ["en","zh"] as const) {
 test(`populated Analysis keeps useful data and metric exploration inside Beta (${lang})`,async({page,baseURL},info)=>{
  test.setTimeout(150_000);
  await installAnalysisFixtures(page,baseURL!,lang);
  const zh=lang==="zh";
  await page.goto("/analysis?symbol=NVDA&page=overview");
  const overview=page.locator("[data-overview-vnext]");
  await expect(overview).toBeVisible();
  await expect(overview.locator("[data-overview-vnext-snapshot]")).toContainText("4.00T");
  await compactAnalysisChrome(page);
  await expect(overview.locator("[data-overview-vnext-snapshot] .fin-kpi .v").first()).toBeInViewport({ratio:1});
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-overview-${lang}.png`)});

  await chooseAnalysisFamily(page,"financials","statements");
  const financials=page.locator("[data-financials-vnext]");
  await expect(financials.getByRole("heading",{name:zh?"财务报表":"Financial statements",exact:true})).toBeVisible();
  await expect(financials.locator("[data-financials-vnext-summary]")).toContainText("130.00B");
  await compactAnalysisChrome(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-statements-${lang}.png`)});
  const metric=financials.getByRole("button",{name:zh?"毛利":"Gross profit",exact:true});
  await metric.click();
  await expect(metric).toHaveAttribute("aria-pressed","true");
  const history=financials.locator(".fin-financials-trajectory");
  await expect(history.getByRole("heading",{name:zh?"毛利":"Gross profit",exact:true})).toBeVisible();
  await expect(history.locator(".fin-financials-selected-value")).toContainText("98.00B");
  await history.scrollIntoViewIfNeeded();
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-selected-metric-${lang}.png`)});
  await financials.getByRole("button",{name:zh?"资产负债":"Balance",exact:true}).click();
  await expect(financials.locator("[data-financials-vnext-summary]")).toContainText("125.00B");
  await financials.getByRole("button",{name:zh?"现金流":"Cash flow",exact:true}).click();
  await expect(financials.locator("[data-financials-vnext-summary]")).toContainText("69.00B");

  await chooseAnalysisFamily(page,"earnings","earnings");
  const earnings=page.locator("[data-earnings-vnext]");
  await expect(earnings.locator("[data-earnings-vnext-pulse]")).toContainText("130.00B");
  await expect(earnings.locator("[data-earnings-vnext-pulse]")).toContainText("2.95");
  await expect(earnings.locator("[data-earnings-vnext-pulse]")).toContainText("FY2025");
  await expect(earnings.locator("[data-earnings-vnext-pulse]")).toContainText(zh?"财务报表支持":"Statement-backed");
  await compactAnalysisChrome(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-earnings-${lang}.png`)});
 });

 test(`financial detail views preserve readable history and comparison inside Beta (${lang})`,async({page,baseURL},info)=>{
  test.setTimeout(150_000);
  await installAnalysisFixtures(page,baseURL!,lang);
  const zh=lang==="zh";
  await page.route("**/NVDA.fund.json**",route=>route.fulfill({json:detailFundFixture}));
  const peer=structuredClone(detailFundFixture);
  peer.ticker="AMD";
  // Scale the whole synthetic statement, so the source drawer retains
  // internally consistent income, balance-sheet and cash-flow relationships.
  const peerScale=[0.5,40/90,50/130];
  for(const statement of [peer.statements.annual.income,peer.statements.annual.balance,peer.statements.annual.cashflow]) {
   for(const values of Object.values(statement)) values.forEach((value,index)=>{values[index]=value*peerScale[index];});
  }
  await page.route("**/AMD.fund.json**",route=>route.fulfill({json:peer}));
  await page.goto("/analysis?symbol=NVDA&page=revenue");
  const revenue=page.locator(".fin-sec").filter({has:page.locator(".fin-eyebrow",{hasText:zh?"营收历史":"REVENUE HISTORY"})});
  await expect(revenue.locator(".fin-bar")).toHaveCount(3);
  await expect(revenue.locator("table")).toContainText("130.00B");
  await compactAnalysisChrome(page);
  await expect(revenue.getByRole("group",{name:zh?"营收历史口径":"Revenue history basis"})).toBeInViewport({ratio:1});
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-revenue-${lang}.png`)});

  await chooseAnalysisView(page,"dividends");
  const dividends=page.locator(".fin-div-cards");
  await expect(dividends.locator(".fin-kpi")).toHaveCount(4);
  await expect(dividends).toBeInViewport({ratio:1});
  const dividendTable=page.getByRole("table",{name:zh?"股息历史":"Dividend history",exact:true});
  await expect(dividendTable.locator("tbody tr")).toHaveCount(3);
  await expect(dividendTable.locator("tbody tr").first()).toContainText("0.0100");
  await compactAnalysisChrome(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-dividends-${lang}.png`)});

  await chooseAnalysisView(page,"compare");
  await expect(page.locator('[data-fc-state="ready"]')).toBeVisible();
  await page.locator("#fc-add-peer").fill("AMD");
  await page.locator("#fc-add-peer").press("Enter");
  const sourceCell=page.locator('[data-fc-cell="revenue:AMD:F0"]');
  await expect(sourceCell.locator("[data-fc-value]")).toHaveText("50.00B");
  await compactAnalysisChrome(page);
  const options=page.locator("[data-fc-options]");
  await expect(options).not.toHaveAttribute("open","");
  await expect(page.locator("[data-fc-frame]")).toBeInViewport({ratio:1});
  // A real figure must fit in the initial reading area, before any click or
  // scroll can repair a layout that put every value below the fold.
  await expect(page.locator('[data-fc-cell="revenue:NVDA:F2"] [data-fc-value]')).toBeInViewport({ratio:1});
  await expect(page.locator(".fin-pane > .fin-body")).toHaveJSProperty("scrollTop",0);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-compare-${lang}.png`)});
  const summary=options.locator("summary");
  await summary.focus();
  await summary.press("Enter");
  await expect(options).toHaveAttribute("open","");
  const marginOption=options.locator('[data-fc-metric-option="net_margin"]');
  await marginOption.click();
  await expect(page.locator('[data-fc-table="net_margin"]')).toHaveCount(1);
  await expect(options.locator("[data-fc-options-readout]")).toContainText(zh?"3 项指标":"3 metrics");
  await marginOption.click();
  await summary.focus();
  await summary.press("Enter");
  await expect(options).not.toHaveAttribute("open","");
  await expect(summary).toBeFocused();
  await sourceCell.click();
  const source=page.locator("[data-fc-source]");
  await expect(source).toHaveAttribute("data-fc-source","AMD:annual:income:2");
  await expect(source).toHaveAttribute("data-fc-source-end","2026-01-25");
  await expect(source.locator("#fc-source-title")).toBeFocused();
  await expect(source.locator("#fc-source-title")).toContainText("AMD");
  await expect(source.locator("[data-fc-source-selection]")).toHaveText(zh?"营业收入 · FY2025":"Revenue · FY2025");
  const focusedCell=source.locator('td[data-focus-cell="true"]');
  await expect(focusedCell).toHaveCount(1);
  await expect(focusedCell.locator(".fin-cell-v")).toHaveText("50.00B");
  await expect(focusedCell.locator("xpath=..").locator('th[scope="row"]')).toHaveText(zh?"营业收入":"Revenue");
  await expect(focusedCell.locator("xpath=ancestor::table[1]").locator('thead th[data-focus="true"]')).toHaveText("FY2025");
  // Observe the application's reveal. Do not scroll or modify styles here:
  // text in the DOM is insufficient if smooth scrolling has not completed,
  // or the table's sticky metric column covers the selected figure.
  await settled({
   read:()=>focusedCell.evaluate(cell=>{
    const table=cell.closest("table")!;
    const scroller=cell.closest<HTMLElement>(".fin-table-scroll")!;
    const body=cell.closest<HTMLElement>(".fin-pane > .fin-body")!;
    const pane=body.closest<HTMLElement>(".fin-pane")!;
    const source=cell.closest("[data-fc-source]")!;
    const texts=[cell.querySelector(".fin-cell-v")!,table.querySelector('thead th[data-focus="true"]')!,cell.parentElement!.querySelector('th[scope="row"]')!,source.querySelector("#fc-source-title")!,source.querySelector("[data-fc-source-selection]")!,source.querySelector("[data-fc-close-source]")!];
    const port=body.getBoundingClientRect(),clip=scroller.getBoundingClientRect();
    const boxes=texts.map(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getBoundingClientRect();});
    const readable=boxes.every((box,index)=>{
     const top=Math.max(0,port.top,index<3?clip.top:port.top),bottom=Math.min(innerHeight,port.bottom,index<3?clip.bottom:port.bottom);
     const left=Math.max(0,port.left,index<3?clip.left:port.left),right=Math.min(innerWidth,port.right,index<3?clip.right:port.right);
     if(box.width<=0||box.height<=0||box.top<top-1||box.bottom>bottom+1||box.left<left-1||box.right>right+1)return false;
     return [box.left+1,(box.left+box.right)/2,box.right-1].every(x=>texts[index].contains(document.elementFromPoint(x,(box.top+box.bottom)/2)));
    });
    return {readable:readable&&pane.scrollLeft===0&&body.scrollLeft===0,bounds:boxes.map(box=>[box.x,box.y,box.width,box.height]),scroll:[body.scrollTop,scroller.scrollLeft]};
   }),
   ok:value=>value.readable,
   same:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
   message:"The selected source row must be readable and settled without test scrolling",
  });
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-compare-source-cell-${lang}.png`)});
  // Source context and the full-history row are separate reading positions
  // on a phone; capture both explicitly after proving automatic row reveal.
  const sourceFor=source.locator("[data-fc-source-for]");
  await sourceFor.scrollIntoViewIfNeeded();
  await expect(sourceFor).toContainText("AMD");
  await expect(sourceFor).toContainText("FY2025");
  await expect(sourceFor).toContainText(zh?"营业收入":"Revenue");
  await expect(sourceFor).toBeInViewport({ratio:1});
  await settled({
   read:()=>source.evaluate(panel=>{
    const body=panel.closest<HTMLElement>(".fin-pane > .fin-body")!;
    const port=body.getBoundingClientRect();
    const texts=[panel.querySelector("#fc-source-title")!,panel.querySelector("[data-fc-source-for]")!];
    const bounds:number[][]=[];
    const readable=texts.every(el=>{
     const range=document.createRange();range.selectNodeContents(el);
     // Probe each line separately; a wrapped context sentence's union box
     // includes blank space that is not part of its rendered text.
     const lines=Array.from(range.getClientRects()).filter(box=>box.width>0&&box.height>0);
     return lines.length>0&&lines.every(box=>{
      bounds.push([box.x,box.y,box.width,box.height]);
      if(box.top<Math.max(0,port.top)-1||box.bottom>Math.min(innerHeight,port.bottom)+1||box.left<Math.max(0,port.left)-1||box.right>Math.min(innerWidth,port.right)+1)return false;
      return [box.left+1,(box.left+box.right)/2,box.right-1].every(x=>el.contains(document.elementFromPoint(x,(box.top+box.bottom)/2)));
     });
    });
    return {readable,bounds,scroll:body.scrollTop};
   }),
   ok:value=>value.readable,
   same:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
   message:"The source heading and context must remain readable and settled before capture",
  });
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-compare-source-${lang}.png`)});
  await source.locator("[data-fc-close-source]").click();
  await expect(sourceCell).toBeFocused();

  await chooseAnalysisFamily(page,"market","technicals");
  await chooseAnalysisView(page,"seasonals");
  const seasonal=page.locator(".fin-seas");
  await expect(seasonal.locator(".fin-seas-chartbox > svg")).toBeVisible();
  await compactAnalysisChrome(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-seasonality-${lang}.png`)});
  // Seven supplied years use inline controls; the long-history popover has
  // its own coverage in seasonal-controls.spec.ts.
  const year=seasonal.locator(".fin-seas-legend-years button").first();
  await expect(year).toBeVisible();
  const selected=await year.getAttribute("aria-pressed");
  await year.focus();
  await year.press("Space");
  await expect(year).toHaveAttribute("aria-pressed",selected==="true"?"false":"true");
  await expect(year).toBeFocused();
  await noOverflow(page);
 });

 test(`Analyst, transcript archive and Insider remain useful inside Beta (${lang})`,async({page,baseURL},info)=>{
  test.setTimeout(150_000);
  await page.clock.setFixedTime(new Date("2026-09-23T12:00:00Z"));
  await installAnalysisFixtures(page,baseURL!,lang);
  await installAnalysisArchive(page);
  const zh=lang==="zh";
  await page.route("**/NVDA.fund.json**",route=>route.fulfill({json:detailFundFixture}));
  await page.route("**/NVDA.insider.json**",route=>route.fulfill({json:insiderActivityFixture}));
  await page.goto("/analysis?symbol=NVDA&page=forecast");
  const analyst=page.locator(".fin-fc");
  await expect(analyst.locator(".fin-fc-price")).toContainText("250.00");
  await expect(analyst.locator(".fin-fc-dist-row .cnt")).toHaveText(["4","8","2","1","0"]);
  await compactAnalysisChrome(page);
  await expect(analyst.locator(".fin-fc-price")).toBeInViewport({ratio:1});
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-analyst-${lang}.png`)});
  const eps=analyst.locator(".fin-sec").filter({has:page.locator(".fin-fc-sec-head > .fin-sec-h",{hasText:zh?"每股收益":"EPS"})});
  await eps.getByRole("button",{name:zh?"季度":"Quarterly",exact:true}).click();
  await expect(eps.locator("table")).toContainText("0.95");
  await analyst.locator(".fin-fc-tabs").getByRole("button",{name:zh?"实际与预期":"Actuals and estimates",exact:true}).click();
  await analyst.getByRole("button",{name:zh?"每股收益":"Earnings per share",exact:true}).click();
  await expect(analyst.locator("table")).toContainText("4.50");
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-analyst-estimates-${lang}.png`)});

  await chooseAnalysisView(page,"transcripts");
  const archive=page.locator(".fin-transcripts");
  const calls=archive.locator(".fin-tx-library-row");
  await expect(calls).toHaveCount(2);
  await compactAnalysisChrome(page);
  await expect(calls.first()).toBeInViewport({ratio:1});
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-transcripts-${lang}.png`)});
  await archive.getByRole("button",{name:zh?"问答":"Q&A",exact:true}).click();
  await expect(calls).toHaveCount(1);
  await expect(calls).toContainText("Q1 FY2026");
  const search=archive.getByRole("textbox",{name:zh?"搜索电话会":"Search calls",exact:true});
  await search.fill("Alex Rivera");
  await expect(calls).toHaveCount(0);
  await expect(archive.locator(".fin-tx-result-count")).toHaveText("0 / 2");
  await archive.getByRole("button",{name:zh?"全部":"All",exact:true}).click();
  await expect(calls).toHaveCount(1);
  await expect(calls).toContainText("Q4 FY2025");
  await calls.click();
  const drawer=page.locator(".fin-tx-drawer");
  await expect(drawer).toContainText("This prepared update establishes the prior-period capacity baseline.");
  await expect(drawer).toContainText("Q4 FY2025");
  await drawer.getByRole("button",{name:zh?"关闭电话会":"Close transcript",exact:true}).click();
  await expect(calls).toBeFocused();

  await chooseAnalysisFamily(page,"ownership","ownership");
  await chooseAnalysisView(page,"insider");
  await expect(page.locator(".fin-insider-evcell .v").first()).toHaveText("1");
  await expect(page.locator(".fin-insider-volchart svg")).toBeVisible();
  await expect(page.locator(".fin-insider-tbl tbody tr")).toHaveCount(2);
  await compactAnalysisChrome(page);
  await expect(page.locator(".fin-insider-ev")).toBeInViewport({ratio:1});
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-insider-${lang}.png`)});
  const filing=page.locator(".fin-insider-tbl tbody tr").first();
  await filing.scrollIntoViewIfNeeded();
  await expect(filing).toContainText("Chief Financial Officer");
  await expect(filing).toContainText("300.00K");
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-insider-filings-${lang}.png`)});
 });

 test(`unavailable analyst estimates and no insider activity stay explicit in Beta (${lang})`,async({page,baseURL},info)=>{
  test.setTimeout(120_000);
  await installAnalysisFixtures(page,baseURL!,lang);
  const zh=lang==="zh";
  await page.route("**/NVDA.insider.json**",route=>route.fulfill({json:{...insiderActivityFixture,
   buyers:0,sellers:0,buy_usd:0,sell_usd:0,net_usd:0,buy_shares:0,sell_shares:0,
   routine_only:true,last_trade_age_d:undefined,series:[],trades:[],
  }}));
  await page.goto("/analysis?symbol=NVDA&page=forecast");
  await page.locator(".fin-fc-tabs").getByRole("button",{name:zh?"实际与预期":"Actuals and estimates",exact:true}).click();
  await expect(page.locator(".fin-fc-analyst-empty")).toContainText(zh?"暂无分析师覆盖":"No analyst coverage");
  await compactAnalysisChrome(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-analyst-unavailable-${lang}.png`)});
  await chooseAnalysisFamily(page,"ownership","ownership");
  await chooseAnalysisView(page,"insider");
  await expect(page.locator(".fin-insider-sentence")).toHaveText(zh?"本窗口内没有已披露的公开市场买入或卖出。":"No open-market buys or sells were reported in this window.");
  await expect(page.locator(".fin-insider-evcell .v").first()).toHaveText("0");
  await expect(page.locator(".fin-insider-tbl")).toHaveCount(0);
  await compactAnalysisChrome(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-insider-no-activity-${lang}.png`)});
 });

 for(const history of [false,true]) {
 test(`Statistics uses the Beta canvas for ${history?"published history":"current ratios"} (${lang})`,async({page,baseURL},info)=>{
  test.setTimeout(120_000);
  await installAnalysisFixtures(page,baseURL!,lang);
  const zh=lang==="zh";
  // Each source state gets the default fresh browser context. The application
  // intentionally persists fresh company data across reloads in IndexedDB.
   const fund=structuredClone(overviewFundFixture);
   if(!history) fund.ratios={...fund.ratios,periods:[],pe:[],ps:[],pb:[],pcf:[],ev:[],ev_ebitda:[]};
   let reads=0;
   await page.route("**/NVDA.fund.json**",route=>{reads++;return route.fulfill({json:fund});});
   await page.goto("/analysis?symbol=NVDA&page=statistics");
   const statistics=page.locator(".fin-body:has(> .fin-stats-hdr)");
   await expect(statistics.locator("[data-has-history]")).toHaveAttribute("data-has-history",String(history));
   const valuation=statistics.locator('[data-statistics-group="valuation"] table');
   const pe=valuation.getByRole("row").filter({has:page.getByRole("rowheader",{name:zh?"市盈率":"Price to earnings ratio",exact:true})});
   await expect(pe.locator("td").last()).toHaveText("42.00");
   await expect(valuation.getByRole("columnheader")).toHaveCount(history?7:2);
   await expect(statistics.locator(".fin-stats-hdr button")).toHaveCount(0);
   await expect(statistics.locator(".fin-bar")).toHaveCount(history?10:0);
   await compactAnalysisChrome(page);
   if(!history) {
    await expect(pe.getByRole("rowheader")).toBeInViewport({ratio:1});
    if(page.viewportSize()!.width>=1280) {
     await expect(statistics.getByText(zh?"盈利比率":"Profitability ratios",{exact:true})).toBeInViewport({ratio:1});
     await expect(statistics.getByText(zh?"关键指标":"Key stats",{exact:true})).toBeInViewport({ratio:1});
    }
   } else {
    await expect(valuation).toContainText("FY2025");
   }
   await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-statistics-${history?"history":"current"}-${lang}.png`)});
   const readCount=reads;
   expect(readCount).toBeGreaterThan(0);
   const source=statistics.locator("[data-statistics-statement-source]");
   await source.locator("summary").click();
   await expect(source).toHaveAttribute("open","");
   await expect(source).toContainText("USD");
   expect(reads).toBe(readCount);
 });
 }

 test(`company Intelligence leads with the brief and keeps source limits accessible in Beta (${lang})`,async({page,baseURL},info)=>{
  test.setTimeout(120_000);
  await installAnalysisFixtures(page,baseURL!,lang);
  const zh=lang==="zh";
  const base=contextFixture();
  const context={...base,topics:{...base.topics,dropped:["accelerated computing"],timeline:[...base.topics.timeline,
   {tag:"accelerated computing",first_event_id:base.history[1].event_id,last_event_id:base.history[1].event_id,event_count:1,status:"dropped"},
  ]}};
  await page.route("**/api/company-intelligence/NVDA**",route=>route.fulfill({json:{ok:true,state:"ready",context}}));
  await page.goto("/analysis?symbol=NVDA&page=intelligence");
  const brief=page.locator("[data-ci-paper-brief]");
  await expect(brief).toBeVisible();
  if(info.project.name==="mobile") {
   await expectSelectLabelFits(page.locator(".ci-event-select select"));
  }
  await compactAnalysisChrome(page);
  await expect(brief.locator(".ci-paper-brief-hero h3")).toContainText("Data-center demand remained broad");
  await expect(brief.locator(".ci-paper-brief-hero h3")).toBeInViewport({ratio:0.5});
  await expect(brief.locator(".ci-paper-metrics > button")).toHaveCount(4);
  await expect(brief.locator(".ci-paper-metrics > button").first()).toBeInViewport({ratio:0.5});
  expect(await page.locator(".fin-pane > .fin-body").evaluate(node=>node.scrollTop)).toBe(0);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-intelligence-brief-${lang}.png`)});
  const lenses=page.locator(".ci-lenses");
  await lenses.getByRole("tab",{name:zh?"业绩":"Results",exact:true}).click();
  const results=page.locator("[data-ci-paper-results]");
  await expect(results).toContainText("18.4%");
  const limits=results.locator(".ci-paper-results-boundary");
  await limits.locator("summary").click();
  await expect(limits).toHaveAttribute("open","");
  await expect(limits.getByText(zh?"不可用 · 缺少已授权的事件前预期数据":"Unavailable · no licensed pre-event estimates",{exact:true})).toBeVisible();
  await limits.locator("summary").click();
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-intelligence-results-${lang}.png`)});
  await lenses.locator("#ci-tab-sources").click();
  await expect(lenses.locator("#ci-tab-sources")).toHaveAttribute("aria-selected","true");
  const sources=page.locator("[data-ci-paper-sources]");
  await expect(sources).toHaveAttribute("data-ci-sources-event-id","cie_d8488221fd8c710c53d6537d");
  await expect(sources).toHaveAttribute("data-ci-sources-generation-id","aaaaaaaaaaaaaaaaaaaaaaaa");
  await expect(sources).toContainText(zh?"仅供背景参考":"Context only");
  const consensus=sources.locator(".ci-paper-sources-coverage-grid article").filter({has:page.getByText(zh?"共识":"Consensus",{exact:true})});
  await expect(consensus).toContainText(zh?"不可用":"Unavailable");
  await expect(consensus).toContainText(zh?"没有已授权且报告口径匹配的事件前预期数据可供比较。":"No licensed pre-event estimates with a matching reporting basis are available for comparison.");
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-intelligence-sources-${lang}.png`)});
  await lenses.locator("#ci-tab-history").click();
  const history=page.locator(".ci-history-table");
  await expect(history.getByRole("columnheader",{name:zh?"营收增长":"Revenue growth",exact:true})).toBeVisible();
  await expect(history.getByRole("columnheader",{name:zh?"每股盈利增长":"EPS growth",exact:true})).toBeVisible();
  await expect(history.locator("tbody tr")).toHaveCount(2);
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-intelligence-history-${lang}.png`)});
  const prior=history.getByRole("button",{name:"Q4 FY2025",exact:true});
  await prior.focus();
  await prior.press("Enter");
  await expect(page.locator(".ci-event-select select")).toHaveValue(base.history[1].event_id);
  await lenses.locator("#ci-tab-sources").click();
  await expect(sources).toHaveAttribute("data-ci-sources-event-id",base.history[1].event_id);
  await lenses.locator("#ci-tab-brief").click();
  await expect(brief).toContainText("2026-02-19");
  await expect(brief).toContainText("Q4 FY2025");

  await lenses.locator("#ci-tab-topics").click();
  const topics=page.locator(".ci-topics-browser");
  await expect(topics.locator("tbody tr")).toHaveCount(3);
  await expect(topics.locator("tbody tr").first()).toContainText(zh?"数据中心":"Data center");
  const topicSearch=topics.getByRole("searchbox",{name:zh?"搜索主题":"Search topics",exact:true});
  await topicSearch.fill("DEMAND");
  await expect(topics.locator("tbody tr")).toHaveCount(1);
  await topics.getByRole("combobox",{name:zh?"主题状态":"Topic status",exact:true}).selectOption("persistent");
  await expect(topics.locator(".ci-inline-empty")).toHaveText(zh?"没有符合筛选条件的主题。":"No topics match these filters.");
  await topicSearch.fill("");
  await topics.getByRole("combobox",{name:zh?"主题状态":"Topic status",exact:true}).selectOption("all");
  const sort=topics.getByRole("combobox",{name:zh?"主题排序":"Sort topics",exact:true});
  await sort.selectOption("name");
  await expect(topics.locator("tbody th")).toHaveText(zh?["Accelerated computing","数据中心","需求"]:["Accelerated computing","Data center","Demand"]);
  await sort.selectOption("frequency");
  await expect(topics.locator("tbody tr").first()).toContainText(zh?"数据中心":"Data center");
  await expect(topics.getByRole("status")).toHaveText(zh?"3 / 3 个主题":"3 of 3 topics");
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-intelligence-topics-${lang}.png`)});
 });

 test(`market, ownership and Lab preserve usable research inside Beta (${lang})`,async({page,baseURL},info)=>{
  test.setTimeout(120_000);
  await installAnalysisFixtures(page,baseURL!,lang);
  const zh=lang==="zh";
  await page.goto("/analysis?symbol=NVDA&page=technicals");
  const market=page.locator("[data-market-vnext]");
  await expect(market).toBeVisible();
  await expect(market).toContainText("RSI");
  const observations=marketBarsFixture().bars.length;
  await expect(market.locator("[data-market-vnext-state] header p")).toContainText(zh?`${observations} 个观测`:`${observations} observations`);
  await expect(market.locator('[data-metric="rsi"] strong')).toHaveText(/\d/);
  await compactAnalysisChrome(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-market-${lang}.png`)});
  await chooseAnalysisFamily(page,"ownership","ownership");
  const positions=page.locator(".analysis-shell").getByRole("table").filter({hasText:"Alpha Capital"});
  await expect(positions).toBeVisible();
  const positionValue=new Intl.NumberFormat(zh?"zh-CN":"en-US",{style:"currency",currency:"USD",notation:"compact",minimumFractionDigits:0,maximumFractionDigits:1}).format(12_000_000);
  await expect(positions.getByRole("row").filter({hasText:"Alpha Capital"})).toContainText(positionValue);
  await compactAnalysisChrome(page);
  // The table may scroll horizontally; the manager identity must already be
  // readable vertically before an action scrolls the research canvas.
  await expect(positions.getByRole("row").filter({hasText:"Alpha Capital"}).locator("th,td").first()).toBeInViewport({ratio:0.9});
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-ownership-${lang}.png`)});
  await chooseAnalysisFamily(page,"lab","lab");
  const lab=page.getByTestId("lab-workspace");
  await expect(lab.getByRole("heading",{name:zh?"活跃形态":"Active setups",exact:true})).toBeVisible();
  const rows=lab.locator("li[data-setup-id]");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toHaveAttribute("data-setup-id","strongest");
  await compactAnalysisChrome(page);
  await expect(rows.first()).toBeInViewport({ratio:0.5});
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-lab-${lang}.png`)});
  await lab.getByRole("button",{name:zh?/^低于基准/:/^Below baseline/}).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-setup-id","weak");
 });

 test(`retained company event keeps its exact source identity in the Beta reading layout (${lang})`,async({page,baseURL},info)=>{
  test.setTimeout(120_000);
  await installAnalysisFixtures(page,baseURL!,lang);
  const fixture=retainedCompanyResearchFixture();
  const requests:string[]=[];
  await page.route("**/api/investigations/baseline?**",route=>{
   requests.push(new URL(route.request().url()).search);
   return route.fulfill({json:fixture});
  });
  await page.goto("/analysis?symbol=AAPL&page=intelligence");
  const event=page.locator('[data-ci-plane="event_workspace.v1"]');
  await expect(event).toHaveAttribute("data-ci-event-id",fixture.receipt.event_id);
  await expect(page).toHaveURL(new RegExp(`ci_generation=${fixture.receipt.generation_id}`));
  const url=new URL(page.url());
  expect(url.searchParams.get("ci_event")).toBe(fixture.receipt.event_id);
  expect(url.searchParams.get("ci_company")).toBe(fixture.receipt.company_id);
  expect(url.searchParams.get("ci_fingerprint")).toBe(fixture.receipt.fingerprint);
  // The existing dev server replays mount effects in StrictMode. Its canceled
  // attempt may reach the route; the accepted receipt must not create another read.
  expect(requests.length).toBeGreaterThanOrEqual(1);
  expect(requests.length).toBeLessThanOrEqual(2);
  expect(requests.every(query=>query==="?symbol=AAPL")).toBe(true);
  const acceptedReads=requests.length;
  const brief=event.locator("[data-ci-paper-brief]");
  if(info.project.name==="mobile") {
   await expectSelectLabelFits(event.locator(".ci-event-select select"));
  }
  await expect(brief).toContainText("$109.4B");
  await expect(brief.locator(".ci-paper-brief-hero h3")).toBeInViewport({ratio:0.5});
  await expect(brief.locator(".ci-paper-metrics > button").first()).toBeInViewport({ratio:0.5});
  await compactAnalysisChrome(page);
  expect(await page.locator(".fin-pane > .fin-body").evaluate(node=>node.scrollTop)).toBe(0);
  await analysisChartReturn(page,lang,"AAPL");
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-retained-brief-${lang}.png`)});
  await event.locator("#ci-tab-sources").click();
  await expect(event.locator("[data-ci-paper-sources]")).toHaveAttribute("data-ci-sources-event-id",fixture.receipt.event_id);
  await expect(event.locator("[data-ci-paper-sources]")).toHaveAttribute("data-ci-sources-generation-id",fixture.receipt.generation_id);
  expect(requests).toHaveLength(acceptedReads);
  await event.locator("#ci-tab-brief").click();
  await brief.locator(".ci-paper-watch-list > button").filter({hasText:"Q4 revenue growth"}).click();
  const evidence=page.locator(".ci-evidence");
  await expect(evidence).toHaveAttribute("aria-hidden","false");
  await expect(evidence).toContainText("9%-11%");
  expect(requests).toHaveLength(acceptedReads);
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath(`analysis-beta-retained-guidance-${lang}.png`)});
  if(info.project.name==="desktop" && lang==="en") {
   await page.locator(".ci-evidence-close").click();
   const chartUrl=await analysisChartReturn(page,lang,"AAPL");
   const researchUrl=page.url();
   await page.locator(".shared-shell-terminal-link").click();
   await expect(page).toHaveURL(chartUrl);
   await expect(page.locator(".pair b")).toHaveText("AAPL");
   await page.locator(".brand-back").click();
   await expect(page).toHaveURL(researchUrl);
   await expect(page.locator('[data-ci-plane="event_workspace.v1"]')).toHaveAttribute("data-ci-event-id",fixture.receipt.event_id);
  }
 });
}

async function noOverflow(page:import("@playwright/test").Page) {
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const shell=page.locator('[data-shared-shell="beta"]');
 const box=await shell.boundingBox();
 expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
}

test("Paper header geometry preserves one mobile owner and a readable company search",async({page},info)=>{
 await page.goto("/discover");
 const shell=page.locator('[data-shared-shell="beta"]');
 await expect(page.getByRole("heading",{name:"Discover",exact:true})).toBeVisible();
 await expect(shell.locator("#shared-primary-navigation")).toHaveCount(1);
 if(info.project.name==="desktop"){
  const rail=await shell.locator(".appnav").boundingBox();
  const search=shell.locator(".shared-shell-company-search");
  const searchBox=await search.boundingBox();
  expect(Math.abs(searchBox!.x-(rail!.x+rail!.width+32))).toBeLessThan(2);
  expect(searchBox!.width).toBeGreaterThan(300);
  expect(searchBox!.height).toBeGreaterThanOrEqual(40);
  await expect(search).toHaveCSS("display","flex");
  const ids=await page.locator(".topbar-brand-group linearGradient").evaluateAll(nodes=>nodes.map(n=>n.id));
  expect(ids).toHaveLength(1);
  expect(await page.locator('[id="'+ids[0]+'"]').count()).toBe(1);
  await shell.locator(".appnav").getByRole("link",{name:"Discover",exact:true}).focus();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const toggle=shell.locator("[data-investor-compact-toggle]");
  await toggle.click();await expect(toggle).toHaveAttribute("aria-pressed","true");
  expect(Math.round((await shell.locator(".appnav").boundingBox())!.width)).toBe(72);
  expect(Math.round((await search.boundingBox())!.x)).toBe(104);
  await noOverflow(page);
  await toggle.click();
 }else{
  await expect(shell.locator(".topbar")).toBeHidden();
  await expect(shell.locator(".appnav")).toBeHidden();
  await expect(shell.locator(".mobilebar")).toBeVisible();
  await page.getByRole("button",{name:"Open navigation",exact:true}).click();
  await expect(page.locator(".m-drawer.open")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".m-drawer.open")).toBeHidden();
 }
 await noOverflow(page);
 await page.screenshot({animations:"disabled",path:info.outputPath("discover-dark-en.png")});
});

test("light and Chinese presentation stay coherent through the tools directory",async({page},info)=>{
 await page.goto("/discover");
 const theme=page.getByRole("button",{name:"Light theme",exact:true});
 await expect(theme).toBeVisible();
 if(await theme.getAttribute("aria-pressed")!=="true")await theme.click();
 await expect(page.locator("html")).toHaveAttribute("data-theme","light");
 await page.screenshot({animations:"disabled",path:info.outputPath("discover-light-en.png")});
 await page.getByRole("button",{name:"Chinese language",exact:true}).click();
 await expect(page.getByRole("heading",{name:"发现",exact:true})).toBeVisible();
 await noOverflow(page);
 await page.screenshot({animations:"disabled",path:info.outputPath("discover-light-zh.png")});
 await page.keyboard.press("ControlOrMeta+k");
 const directory=page.locator("#shared-shell-tools");
 await expect(directory).toBeVisible();
 const bounds=await directory.boundingBox();
 expect(bounds!.x).toBeGreaterThanOrEqual(0);
 expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
 await page.screenshot({animations:"disabled",path:info.outputPath("directory-light-zh.png")});
 await page.keyboard.press("Escape");
 await expect(directory).toHaveCount(0);
});

test("mobile chrome keeps every target usable at 320px and contract widths",async({page},info)=>{
 test.skip(info.project.name!=="desktop","One explicit smallest-width stress case");
 await page.goto("/discover");
 await expect(page.getByRole("heading",{name:"Discover",exact:true})).toBeVisible();
 for(const width of [320,390,641,820,860]){
  await page.setViewportSize({width,height:844});
  for(const chinese of [false,true]){
   const bar=page.locator(".mobilebar");
   const presentation=bar.locator(".shared-shell-presentation-toggle");
   if((await presentation.nth(0).getAttribute("aria-pressed")==="true")!==chinese)await presentation.nth(0).click();
   if((await presentation.nth(1).getAttribute("aria-pressed")==="true")!==chinese)await presentation.nth(1).click();
   await expect(page.locator("html")).toHaveAttribute("data-lang",chinese?"zh":"en");
   await expect(page.locator("html")).toHaveAttribute("data-theme",chinese?"light":"dark");
   const controls=bar.locator("button:visible");
   // Menu, company search, appearance, locale and the incumbent account owner.
   await expect(controls).toHaveCount(5);
   const boxes=await controls.evaluateAll(buttons=>buttons.map(button=>{
    const box=button.getBoundingClientRect();
    const after=getComputedStyle(button,"::after");
    // The account owner's existing centred ::after expands its painted 30px avatar
    // to a 44px hit area. Verify the browser hit test, not just the declared width.
    const width=Math.max(box.width,after.content!=="none"?parseFloat(after.width)||0:0);
    const height=Math.max(box.height,after.content!=="none"?parseFloat(after.height)||0:0);
    const x=box.x+(box.width-width)/2,y=box.y+(box.height-height)/2;
    // Probe each edge midpoint; the canonical rounded buttons intentionally do
    // not paint their bounding rectangle's extreme corners.
    const reachable=[[x+1,y+height/2],[x+width-1,y+height/2],[x+width/2,y+1],[x+width/2,y+height-1]].every(([px,py])=>{
     const hit=document.elementFromPoint(px,py);return hit===button||button.contains(hit);
    });
    return {x,y,width,height,reachable,label:button.getAttribute("aria-label")};
   }));
   for(const box of boxes){
    expect(box.width,box.label??"").toBeGreaterThanOrEqual(44);
    expect(box.height,box.label??"").toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
    expect(box.reachable,box.label??"").toBe(true);
   }
   for(let i=1;i<boxes.length;i++)expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i-1].x+boxes[i-1].width);
   await page.keyboard.press("Tab");
   for(const control of await controls.all()){
    await control.focus();await expect(control).toBeFocused();
    await expect(control).toHaveCSS("outline-style","solid");
    await expect(control).toHaveCSS("outline-width","2px");
   }
   const menu=bar.getByRole("button",{name:chinese?"打开导航":"Open navigation",exact:true});
   await menu.click();await expect(page.locator(".m-drawer.open")).toBeVisible();
   await page.keyboard.press("Escape");await expect(page.locator(".m-drawer.open")).toBeHidden();
   await expect(menu).toBeFocused();
   const search=bar.getByRole("button",{name:chinese?"搜索公司":"Search companies",exact:true});
   await search.focus();await page.keyboard.press("Enter");
   await expect(page.getByRole("dialog")).toHaveCount(1);
   await expect(page.getByRole("dialog")).toBeVisible();
   await expect(page.getByRole("dialog").getByRole("combobox")).toBeFocused();
   expect(await page.getByRole("dialog").evaluate(node=>node.closest(".topbar")===null)).toBe(true);
   const scopes=page.getByRole("dialog").getByRole("group",{name:chinese?"搜索范围":"Search scope",exact:true});
   const companies=scopes.getByRole("button",{name:chinese?/^公司(?:\s|$)/:/^Companies(?:\s|$)/});
   const tools=scopes.getByRole("button",{name:chinese?/^工具(?:\s|$)/:/^Tools(?:\s|$)/});
   await expect(companies).toBeVisible();await expect(companies).toHaveAttribute("aria-pressed","true");
   await expect(tools).toBeVisible();await expect(tools).toHaveAttribute("aria-pressed","false");
   await expect(page.getByRole("dialog").getByRole("region",{name:chinese?"公司结果":"Company results",exact:true})).toBeVisible();
   const skin=await page.getByRole("dialog").evaluate(node=>{
    const surface=node.matches(".msheet")?node:node.querySelector(".smodal");
    const probe=document.createElement("div");probe.style.backgroundColor="var(--panel)";document.body.append(probe);
    const expected=getComputedStyle(probe).backgroundColor;probe.remove();
    return {expected,actual:surface?getComputedStyle(surface).backgroundColor:null,
     inherited:surface?getComputedStyle(surface).getPropertyValue("--panel"):null,
     token:getComputedStyle(document.documentElement).getPropertyValue("--panel")};
   });
   expect(skin.inherited).toBe(skin.token);
   // Light uses the canonical white research surface; dark retains the native
   // sheet's glass treatment while inheriting the same document token owner.
   if(chinese)expect(skin.actual).toBe(skin.expected);
   await page.screenshot({animations:"disabled",path:info.outputPath(`search-${width}-${chinese?"light-zh":"dark-en"}.png`)});
   await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);
   await expect(search).toBeFocused();
   await noOverflow(page);
   await page.screenshot({animations:"disabled",path:info.outputPath(`chrome-${width}-${chinese?"light-zh":"dark-en"}.png`)});
  }
 }
});

test("company search selects one canonical company from desktop, tablet and phone chrome",async({page},info)=>{
 await page.route("**/data/manifest.json",route=>route.fulfill({json:{as_of:null,symbols:{
  AAPL:{name:"Apple Inc.",zh:"苹果公司",col:"#aaa",verdict:null,mkt:"NASDAQ",sec:"Equities"},
 }}}));
 await page.goto("/discover");
 await expect(page.getByRole("heading",{name:"Discover",exact:true})).toBeVisible();
 const opener=info.project.name==="desktop"
  ? page.locator(".topbar .shared-shell-company-search")
  : page.locator(".mobilebar").getByRole("button",{name:"Search companies",exact:true});
 await opener.click();
 const dialog=page.getByRole("dialog");await expect(dialog).toHaveCount(1);await expect(dialog).toBeVisible();
 await expect(dialog).toHaveAccessibleName("Search companies and tools");
 const panel=dialog.locator(".smodal").count().then(count=>count?dialog.locator(".smodal"):dialog);
 const box=await (await panel).boundingBox();
 expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
 await dialog.getByRole("combobox").fill("Apple");
 await expect(dialog.locator('[data-company-symbol="AAPL"]')).toContainText("AAPL");
 await page.screenshot({animations:"disabled",path:info.outputPath("company-search-selection.png")});
 await dialog.getByRole("combobox").press("Enter");
 await expect(dialog.getByRole("button",{name:"Open Analysis",exact:true})).toBeVisible();
 await dialog.getByRole("button",{name:"Open Analysis",exact:true}).click();
 await expect(page).toHaveURL(/\/analysis\?symbol=AAPL&company_query=Apple&workspaceMarket=us$/);
 await expect(page.getByRole("dialog")).toHaveCount(0);
 await noOverflow(page);
});

test("phone company search keeps its scope in both languages and dismisses by touch",async({page},info)=>{
 test.skip(info.project.name!=="mobile","Actual phone sheet and touch context");
 await page.goto("/discover");
 await expect(page.getByRole("heading",{name:"Discover",exact:true})).toBeVisible();
 const bar=page.locator(".mobilebar");
 for(const chinese of [false,true]){
  if(chinese){await bar.getByRole("button",{name:"Light theme",exact:true}).click();await bar.getByRole("button",{name:"Chinese language",exact:true}).click();}
  const opener=bar.getByRole("button",{name:chinese?"搜索公司":"Search companies",exact:true});
  await opener.tap();
  const dialog=page.getByRole("dialog");await expect(dialog).toHaveCount(1);
  await expect(dialog).toHaveAccessibleName(chinese?"搜索公司和工具":"Search companies and tools");
  await expect(dialog).toBeVisible();
  await page.screenshot({animations:"disabled",path:info.outputPath(`phone-scope-${chinese?"light-zh":"dark-en"}.png`)});
  await page.setViewportSize({width:320,height:844});
  await expect(dialog).toBeVisible();
  await page.screenshot({animations:"disabled",path:info.outputPath(`phone-scope-320-${chinese?"light-zh":"dark-en"}.png`)});
  await page.locator(".msheet-scrim").tap({position:{x:10,y:10}});
  await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
  await page.setViewportSize({width:390,height:844});
 }
});


for (const lang of ["en", "zh"] as const) {
  test(`SS12 unknown-page recovery opens company search and returns keyboard focus at 320px (${lang})`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "Original 320px phone recovery");
    await page.setViewportSize({ width: 320, height: 844 });
    await page.addInitScript(language => localStorage.setItem("mm.lang", language), lang);
    const response = await page.goto("/__beta_missing_route_ui_probe");
    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
    const zh = lang === "zh";
    if (zh) {
      const theme = page.getByRole("button", { name: "浅色主题", exact: true });
      if (await theme.getAttribute("aria-pressed") !== "true") await theme.click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", zh ? "light" : "dark");
    const recovery = page.getByRole("main");
    const opener = recovery.getByRole("button", { name: zh ? "搜索公司" : "Search companies", exact: true });
    await expect(recovery.getByRole("heading", { name: zh ? "还记得公司名称吗？" : "Remember the company name?" })).toBeVisible();
    await opener.scrollIntoViewIfNeeded();
    expect((await opener.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ animations: "disabled", path: info.outputPath(`ss12-company-recovery-${lang}.png`) });
    const href = page.url();
    await opener.press("Enter");
    const dialog = page.getByRole("dialog", { name: zh ? "搜索公司和工具" : "Search companies and tools" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("region", { name: zh ? "公司结果" : "Company results", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(page.url()).toBe(href);
    await noOverflow(page);
  });
}

test("Tools opens an admitted public page and Back restores query, scope and selection",async({page},info)=>{
 // /learn is an existing canonical public native member, not a fabricated fixture route.
 // Its real static page needs neither an entitlement appointment nor a data response.
 await page.goto("/discover");
 await expect(page.getByRole("heading",{name:"Discover",exact:true})).toBeVisible();
 const origin=page.url();
 const opener=info.project.name==="desktop"
  ? page.locator(".topbar .shared-shell-company-search")
  : page.locator(".mobilebar").getByRole("button",{name:"Search companies",exact:true});
 await opener.click();
 const dialog=page.getByRole("dialog");
 await expect(dialog).toHaveAccessibleName("Search companies and tools");
 const scopes=dialog.getByRole("group",{name:"Search scope",exact:true});
 await scopes.getByRole("button",{name:/^Tools(?:\s|$)/}).click();
 await dialog.getByRole("combobox").fill("/learn");
 const selected=dialog.getByRole("option",{name:"Learn Workspaces",exact:true}).filter({has:page.locator("strong",{hasText:/^Learn$/})});
 await expect(selected).toHaveCount(1);
 await selected.click();
 await expect(selected).toHaveAttribute("aria-selected","true");
 await expect(dialog.getByRole("complementary",{name:"Selected tool",exact:true}).getByRole("heading",{name:"Learn",exact:true})).toBeVisible();
 await expect(dialog.getByRole("complementary",{name:"Selected tool",exact:true}).getByText("/learn",{exact:true})).toBeVisible();
 await page.screenshot({animations:"disabled",path:info.outputPath("tools-selected-public-learn.png")});
 await dialog.getByRole("button",{name:"Open tool",exact:false}).click();
 await expect(page).toHaveURL(/\/learn$/);
 await expect(page.getByRole("heading",{level:1,name:"The gamma weather map, in six reads",exact:true})).toBeVisible();
 const lessons=page.locator("main ol > li details");
 await expect(lessons).toHaveCount(6);
 await expect(lessons.first()).toHaveAttribute("open","");
 await expect(lessons.first().locator("p")).toBeVisible();
 await expect(page.getByRole("dialog")).toHaveCount(0);
 await page.screenshot({animations:"disabled",path:info.outputPath("tools-public-learn-destination.png")});
 await page.goBack();
 await expect(page).toHaveURL(origin);
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole("combobox")).toHaveValue("/learn");
 await expect(scopes.getByRole("button",{name:/^Tools(?:\s|$)/})).toHaveAttribute("aria-pressed","true");
 await expect(scopes.getByRole("button",{name:/^Companies(?:\s|$)/})).toHaveAttribute("aria-pressed","false");
 await expect(selected).toHaveAttribute("aria-selected","true");
 await expect(dialog.getByRole("complementary",{name:"Selected tool",exact:true}).getByRole("heading",{name:"Learn",exact:true})).toBeVisible();
 await noOverflow(page);
 await page.screenshot({animations:"disabled",path:info.outputPath("tools-public-learn-back-restored.png")});
});


// Recovery uses the real Next layout, admission endpoint and LegacyPageHost.
// Only the cross-origin child is controlled so late/error messages are repeatable.
function recoveryChild(parentOrigin: string, holdReady: boolean) {
 return `<!doctype html><html><head><meta charset="utf-8"><title>Recovery test workspace</title></head>
 <body><button id="workspace-action">Workspace action</button><script>
 const parentOrigin=${JSON.stringify(parentOrigin)};
 const generation=new URL(location.href).searchParams.get("mmx_generation");
 let init=null;
 const send=(body)=>parent.postMessage({protocol:${JSON.stringify(SHARED_SHELL_PROTOCOL)},frameGeneration:generation,...body},parentOrigin);
 const ready=()=>{if(init)send({type:"READY",href:new URL(init.canonicalPath,location.origin).href,title:"Sector Cycles",
  contextRevision:init.contextRevision,bridgeVersion:${JSON.stringify(SHARED_SHELL_BRIDGE_VERSION)},documentVersion:${JSON.stringify(SHARED_SHELL_DOCUMENT_VERSION)},responseKind:"content"});};
 window.shellRecoveryFixture={ready,fail:()=>send({type:"ERROR",code:"initialization_failed"}),navigate:(href)=>{
  history.pushState({},"",href);
  send({type:"NAVIGATE",href:new URL(href,location.origin).href,mode:"push",sameDocument:true,requestId:crypto.randomUUID()});
 }};
 addEventListener("message",event=>{
  if(event.source!==parent||event.origin!==parentOrigin||event.data?.type!=="INIT"||event.data.frameGeneration!==generation)return;
  init=event.data;document.documentElement.dataset.initialized="true";
  if(!${JSON.stringify(holdReady)})ready();
 });
 <\/script></body></html>`;
}

test.describe("legacy workspace recovery",()=>{
 const canonical="/sector_cycles.html?filter=a%20b&filter=a+b#risk";
 const legacy="https://www.mastermind-x.com";
 type FixtureWindow=Window & {shellRecoveryFixture:{ready:()=>void;fail:()=>void}};
 async function setup(page:import("@playwright/test").Page,baseURL:string) {
  let hold=false;
  await page.context().addCookies([
   {name:"mm_e2e_rs30",value:"1",url:baseURL},
   {name:"mm_e2e_guest",value:"1",url:baseURL},
  ]);
  await page.route(legacy+"/sector_cycles.html?**",route=>route.fulfill({
   contentType:"text/html; charset=utf-8",body:recoveryChild(new URL(baseURL).origin,hold),
  }));
  // Warm this real admission route before measuring a child response deadline.
  const gate=await page.request.get(baseURL+"/api/shared-shell/status");
  expect((await gate.json()).enabled).toBe(true);
  await page.goto(canonical);
  const frame=page.locator("[data-shared-shell-frame]");
  await expect(frame).toBeVisible();
  const child=()=>page.frames().find(candidate=>candidate.url().startsWith(legacy+"/sector_cycles.html?"))!;
  await expect.poll(()=>child()?.url()).toContain("mmx_generation=");
  return {frame,child,holdNext:()=>{hold=true;}};
 }

 test("temporary status failure on tab return retries the same workspace without reloading the shell",async({page,baseURL},info)=>{
  const {frame,child}=await setup(page,baseURL!);
  const originalUrl=page.url();
  const generation=new URL(child().url()).searchParams.get("mmx_generation");
  await page.evaluate(()=>{document.documentElement.dataset.recheckLifetime="preserved";});
  let failOnce=true;
  await page.route("**/api/shared-shell/status",async route=>{
   if(failOnce){failOnce=false;await route.fulfill({status:503,json:{status:"unavailable"}});}
   else await route.continue();
  });
  await child().locator("#workspace-action").focus();
  await page.evaluate(()=>{document.dispatchEvent(new Event("visibilitychange"));});
  await expect(page.locator('[data-shared-shell-failure="gate-http"]')).toBeVisible();
  const retry=page.locator(".shared-shell-boundary").getByRole("button",{name:"Try again",exact:true});
  await expect(retry).toBeVisible();await expect(frame).toBeHidden();
  await child().evaluate(()=>{(window as unknown as FixtureWindow).shellRecoveryFixture.ready();});
  await expect(retry).toBeVisible();await expect(frame).toBeHidden();
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath("status-unavailable-retry.png")});
  await retry.click();
  await expect(frame).toBeVisible();
  await expect.poll(()=>new URL(child().url()).searchParams.get("mmx_generation")).not.toBe(generation);
  await expect(page).toHaveURL(originalUrl);
  await expect(page.locator("html")).toHaveAttribute("data-recheck-lifetime","preserved");
  await expect(frame).toBeFocused();
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath("status-workspace-recovered.png")});
 });

 test("failure stays stable, then explicit retry transfers keyboard focus into the new workspace",async({page,baseURL},info)=>{
  const {frame,child,holdNext}=await setup(page,baseURL!);
  await child().locator("#workspace-action").focus();
  await expect(frame).toBeFocused();
  const generation=new URL(child().url()).searchParams.get("mmx_generation");
  await child().evaluate(()=>{(window as unknown as FixtureWindow).shellRecoveryFixture.fail();});
  const boundary=page.locator(".shared-shell-boundary");
  const heading=boundary.getByRole("heading");
  await expect(heading).toBeFocused();
  await expect(frame).toBeHidden();
  await expect(frame).toHaveAttribute("inert","");
  await expect(boundary.getByRole("button",{name:"Try again",exact:true})).toBeVisible();
  const recoveryTitle=await heading.textContent();
  await child().evaluate(()=>{(window as unknown as FixtureWindow).shellRecoveryFixture.ready();});
  await expect(heading).toHaveText(recoveryTitle!);
  await expect(frame).toBeHidden();
  for(const action of await boundary.locator("button,a").all()){
   const box=await action.boundingBox();
   expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath("workspace-recovery-dark-en.png")});
  holdNext();
  await boundary.getByRole("button").click();
  await expect(heading).toBeFocused();
  await expect.poll(()=>new URL(child().url()).searchParams.get("mmx_generation")).not.toBe(generation);
  await expect(child().locator("html")).toHaveAttribute("data-initialized","true");
  await child().evaluate(()=>{(window as unknown as FixtureWindow).shellRecoveryFixture.ready();});
  await expect(frame).toBeVisible();
  await expect(frame).toBeFocused();
  await expect(boundary).toHaveCount(0);
  expect(new URL(page.url()).pathname+new URL(page.url()).search+new URL(page.url()).hash).toBe(canonical);
 });

 test("light Chinese recovery remains usable on short screens and preserves a newer focus choice",async({page,baseURL},info)=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  const {frame,child,holdNext}=await setup(page,baseURL!);
  await page.getByRole("button",{name:"Light theme",exact:true}).click();
  await page.getByRole("button",{name:"Chinese language",exact:true}).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme","light");
  await expect(page.locator("html")).toHaveAttribute("data-lang","zh");
  await child().evaluate(()=>{(window as unknown as FixtureWindow).shellRecoveryFixture.fail();});
  const boundary=page.locator(".shared-shell-boundary");
  await expect(boundary.getByRole("button",{name:"重试",exact:true})).toBeVisible();
  const original=boundary.getByRole("link");
  await expect(original).toHaveAttribute("href",legacy+canonical);
  await expect(original).toHaveAttribute("target","_blank");
  await expect(original).toHaveAttribute("rel","noopener noreferrer");
  await expect(original).toHaveCSS("transition-duration","0s");
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath("workspace-recovery-light-zh.png")});
  if(info.project.name==="desktop"){
   for(const viewport of [{width:568,height:320},{width:320,height:480}]){
    await page.setViewportSize(viewport);
    await boundary.getByRole("heading").scrollIntoViewIfNeeded();
    const headingBox=await boundary.getByRole("heading").boundingBox();
    const boundaryBox=await boundary.boundingBox();
    expect(headingBox!.y).toBeGreaterThanOrEqual(boundaryBox!.y);
    for(const action of await boundary.locator("button,a").all()){
     await action.scrollIntoViewIfNeeded();
     const box=await action.boundingBox();
     expect(box!.height).toBeGreaterThanOrEqual(44);
     expect(box!.x).toBeGreaterThanOrEqual(0);
     expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width);
     expect(await action.evaluate(element=>{
      const box=element.getBoundingClientRect();
      const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
      return hit===element||element.contains(hit);
     })).toBe(true);
    }
    await noOverflow(page);
    await page.screenshot({animations:"disabled",path:info.outputPath(`workspace-recovery-${viewport.width}x${viewport.height}.png`)});
   }
  }
  const generation=new URL(child().url()).searchParams.get("mmx_generation");
  holdNext();
  await boundary.getByRole("button").click();
  await expect.poll(()=>{
   const url=child()?.url();
   const next=url?new URL(url).searchParams.get("mmx_generation"):null;
   return Boolean(next&&next!==generation);
  }).toBe(true);
  const replacement=child();
  await expect(replacement.locator("html")).toHaveAttribute("data-initialized","true");
  const outside=page.locator(".topbar button:visible,.mobilebar button:visible").first();
  await outside.focus();
  await replacement.evaluate(()=>{(window as unknown as FixtureWindow).shellRecoveryFixture.ready();});
  await expect(frame).toBeVisible();
  await expect(outside).toBeFocused();
 });
});


test("the current legacy company opens its chart and returns to the exact research location",async({page,baseURL},info)=>{
 test.skip(info.project.name!=="desktop","The current-chart toolbar is desktop chrome");
 const origin=new URL(baseURL!).origin;
 const legacy="https://www.mastermind-x.com";
 await page.context().addCookies([
  {name:"mm_e2e_rs30",value:"1",url:baseURL!},{name:"mm_e2e_guest",value:"1",url:baseURL!},
 ]);
 await page.addInitScript(({origin})=>{
  if(location.origin===origin && !sessionStorage.getItem("shell-company-cursor-seeded")){
   localStorage.setItem("mm.activeSymbol","NVDA");sessionStorage.setItem("shell-company-cursor-seeded","1");
  }
 },{origin});
 await page.route(legacy+"/stock.html**",route=>route.fulfill({
  contentType:"text/html; charset=utf-8",body:recoveryChild(origin,false),
 }));
 const initial="/stock.html?filter=a%20b&filter=a+b#AAPL";
 await page.goto(initial);
 const frame=page.locator("[data-shared-shell-frame]");
 await expect(frame).toBeVisible();
 const chart=page.getByRole("link",{name:"Terminal",exact:true});
 let chartHref=new URL((await chart.getAttribute("href"))!,origin);
 expect(chartHref.searchParams.get("symbol")).toBe("AAPL");
 expect(chartHref.searchParams.get("ret")).toBe(origin+initial);
 const child=page.frames().find(candidate=>candidate.url().startsWith(legacy+"/stock.html"))!;
 const next="/stock.html?filter=a%20b&filter=a+b#MSFT";
 await child.evaluate(href=>{
  (window as unknown as Window & {shellRecoveryFixture:{navigate:(href:string)=>void}}).shellRecoveryFixture.navigate(href);
 },next);
 await expect(page).toHaveURL(origin+next);
 await expect.poll(async()=>new URL((await chart.getAttribute("href"))!,origin).searchParams.get("symbol")).toBe("MSFT");
 expect(page.frames()).toContain(child);
 await expect(frame).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem("mm.activeSymbol"))).toBe("NVDA");
 chartHref=new URL((await chart.getAttribute("href"))!,origin);
 expect(chartHref.searchParams.get("ret")).toBe(origin+next);
 await chart.click();
 await expect(page).toHaveURL(chartHref.href);
 await expect(page.locator(".pair b")).toHaveText("MSFT");
 await page.locator(".brand-back").click();
 await expect(page).toHaveURL(origin+next);
 await expect(page.locator("[data-shared-shell-frame]")).toBeVisible();
});

// URL-owned market context uses this already-qualified beta responsive lane.
test("market selection preserves the workspace and history without displaying another market", async ({ page }, info) => {
  await page.goto("/discover");
  const selector = page.getByRole("combobox", { name: "Workspace market" }).filter({ visible: true });
  await expect(selector).toHaveValue("us");
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  await selector.focus(); await expect(selector).toBeFocused();
  await selector.selectOption("cn");
  await expect(page).toHaveURL(/\/discover\?workspaceMarket=cn$/);
  await expect(page.getByRole("heading", { name: "This workspace is not available for this market yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toHaveCount(0);
  await expect(page.locator(".shared-shell-market-coverage a").first()).toHaveAttribute("href", "/china.html");
  await selector.selectOption("hk");
  await expect(selector).toHaveValue("hk");
  await expect(page.locator(".shared-shell-market-eyebrow")).toHaveText("Hong Kong");
  await page.goBack(); await expect(selector).toHaveValue("cn");
  await page.reload(); await expect(selector).toHaveValue("cn");
  await page.goBack(); await expect(selector).toHaveValue("us");
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  await page.goForward(); await expect(selector).toHaveValue("cn");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (info.project.name === "desktop") {
    const nav = page.locator("#shared-primary-navigation");
    await expect(nav.getByRole("link", { name: "Macro Dashboard", exact: true })).toHaveAttribute("href", "/china.html");
    await expect(nav.getByRole("link", { name: "Prophet", exact: true })).toHaveAttribute("href", "/china_stocks.html");
    await expect(nav.getByRole("link", { name: "Sector Intelligence", exact: true })).toHaveAttribute("href", "/sectors?workspaceMarket=cn");
    await expect(nav.getByRole("link", { name: "China", exact: true })).toHaveCount(0);
  }
  await page.screenshot({ animations: "disabled", path: info.outputPath("market-coverage-dark-en.png") });
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await page.getByRole("button", { name: "Chinese language", exact: true }).click();
  await expect(page.getByRole("heading", { name: "此市场暂未提供这个工作区" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "工作区市场" }).filter({ visible: true })).toHaveValue("cn");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ animations: "disabled", path: info.outputPath("market-coverage-light-zh.png") });
});

test("market control remains reachable at 320px alongside existing header actions", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "One smallest-width stress test");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/discover");
  const selector = page.locator(".mobilebar select");
  await expect(selector).toBeVisible();
  const box = await selector.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  const reachable = await selector.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element;
  });
  expect(reachable).toBe(true);
  await selector.selectOption("intl");
  await expect(selector).toHaveValue("intl");
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await expect(page.locator(".m-drawer").getByRole("link", { name: "Macro Dashboard", exact: true })).toHaveAttribute("href", "/intl.html");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ animations: "disabled", path: info.outputPath("market-320.png") });
});

