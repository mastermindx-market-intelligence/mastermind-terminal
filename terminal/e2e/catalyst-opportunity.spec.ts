import { expect, test, type Page } from "@playwright/test";
import fixture from "../lib/__tests__/fixtures/catalystOpportunity.json";
import defenseOwner from "../lib/__tests__/fixtures/catalystDefenseOwner.json";
import datedSource from "../lib/__tests__/fixtures/catalystOpportunityDatedSource.json";

// Exercises the shipped Discover tab and components with an explicitly synthetic
// Python-produced contract. This is browser behavior proof, not live-data/auth proof.
test.setTimeout(90000);
// The original dated Macro artifact is a specimen, not a live entitlement receipt.
test.beforeEach(async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-17T18:00:00Z"));
  await page.route("**/api/catalyst-opportunities/defense",route=>route.fulfill({status:200,json:defenseOwner}));
});
async function prepare(page: Page, lang = "en", status = 200, payload: unknown = fixture) {
  await page.addInitScript(language => {localStorage.setItem("mm.lang",language);document.documentElement?.setAttribute("data-lang",language);},lang);
  await page.route("**/api/catalyst-opportunities",route=>route.fulfill({status,json:payload}));
}
async function noOverflow(page: Page) {
  const result = await page.getByTestId("catalyst-opportunities").evaluate(root=>({
    rootWidth:root.clientWidth,rootScroll:root.scrollWidth,
    pageWidth:document.documentElement.clientWidth,pageScroll:document.documentElement.scrollWidth,
  }));
  expect(result.rootScroll).toBeLessThanOrEqual(result.rootWidth+1);
  expect(result.pageScroll).toBeLessThanOrEqual(result.pageWidth+1);
}
for (const lang of ["en","zh"] as const) {
  test(`usable discovery, evidence and coverage - ${lang} native dark`,async({page},testInfo)=>{
    const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    await prepare(page,lang);await page.goto("/discover?tab=catalysts");
    const root=page.getByTestId("catalyst-opportunities");
    await expect(root.getByRole("heading",{level:1})).toHaveText(lang==="en"?"What matters now":"当下值得关注");
    await expect(root.locator("article")).toHaveCount(2);
    // Native Terminal is dark-only; changing an attribute is not light-mode proof.
    await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
    await expect(root).toContainText(lang==="en"?"+6.21 pp":"+6.21 个百分点");
    await noOverflow(page);
    await page.screenshot({path:testInfo.outputPath(`catalyst-${testInfo.project.name}-${lang}-native-dark.png`),fullPage:true});
    const choice=root.getByRole("button",{name:lang==="en"?"Inspect evidence: Defense & Aerospace":"查看证据: 国防与航空航天",exact:true});
    await choice.click();
    await expect(page).toHaveURL(/case=defense/);
    await expect(root.locator("#catalyst-detail-title")).toBeFocused();
    await expect(root.locator("#catalyst-detail-title")).toHaveText(lang==="en"?"Defense & Aerospace":"国防与航空航天");
    await root.locator("details").filter({has:page.locator("summary",{hasText:lang==="en"?"Catalyst, exposure and timing":"催化剂、敞口与时机"})}).locator("summary").click();
    await expect(root).toContainText(lang==="en"?"No verified event is attached":"尚未连接已核实事件");
    await page.goBack();await expect(page).not.toHaveURL(/case=defense/);
    await root.getByLabel(lang==="en"?"Find a theme":"搜索主题",{exact:true}).fill("not-in-this-source");
    await expect(root).toContainText(lang==="en"?"No watches match this view":"此视图没有匹配的关注项");
    await root.getByRole("button",{name:lang==="en"?"Clear filters":"清除筛选",exact:true}).click();
    await expect(root.locator("article")).toHaveCount(2);
    await noOverflow(page);expect(errors).toEqual([]);
  });
}

test("dated source and uncovered watch remain distinct; refresh clears access",async({page},testInfo)=>{
  const payload=structuredClone(fixture);
  payload.status="stale";payload.source.freshness="stale";
  payload.cases=payload.cases.filter(c=>c.theme_id!=="defense");payload.coverage.watch_count=1;
  payload.inventory.find(r=>r.theme_id==="defense")!.watch=false;
  for(const candidate of payload.cases) candidate.observation_status="stale";
  await prepare(page,"en",200,payload);await page.goto("/discover?tab=catalysts");
  const root=page.getByTestId("catalyst-opportunities");
  await expect(root).toContainText("This snapshot is dated");
  await root.getByRole("button",{name:"Defense",exact:true}).click();
  await expect(root).toContainText("Defense is covered in this snapshot");
  await root.getByText("Inspect coverage and theme states (3)",{exact:true}).click();
  await expect(root.getByRole("table")).toBeVisible();
  await noOverflow(page);
  await page.screenshot({path:testInfo.outputPath(`catalyst-${testInfo.project.name}-dated-coverage.png`),fullPage:true});
  await page.unroute("**/api/catalyst-opportunities");
  await page.route("**/api/catalyst-opportunities",route=>route.fulfill({status:403,json:{error:"ENTITLEMENT_REQUIRED"}}));
  await root.getByRole("button",{name:"Refresh sources",exact:true}).first().click();
  await expect(root).toContainText("This view requires the site-full research entitlement");
  await expect(root.locator("article")).toHaveCount(0);await expect(root.getByRole("table")).toHaveCount(0);
  await expect(root.getByTestId("defense-research")).not.toContainText("4,101");
  await expect(root.locator('a[href*="sec.gov"]')).toHaveCount(0);
});

test("failed sources do not pretend that the market is quiet; native tab is reachable",async({page})=>{
  await prepare(page,"en",503,{error:"CATALYST_UNAVAILABLE"});
  await page.goto("/discover?tab=catalysts");const root=page.getByTestId("catalyst-opportunities");
  await expect(root).toContainText("not a signal that markets are quiet");
  await expect(root.getByRole("link",{name:"Open Sector Intelligence",exact:true})).toHaveAttribute("href","/discover?tab=sectors");
  await expect(root.locator("article")).toHaveCount(0);
  await noOverflow(page);
});

for (const lang of ["en","zh"] as const) {
  test(`source-bound Defense economics and readable conditions - ${lang}`,async({page},testInfo)=>{
    const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    await prepare(page,lang);await page.goto("/discover?tab=catalysts");
    const panel=page.getByTestId("defense-research");
    await expect(panel).toContainText("4,101");await expect(panel).toContainText("14.5%");
    await expect(panel).toContainText("Missiles and Fire Control");
    await expect(panel.locator('[data-dated="true"]')).toHaveCount(3);
    await panel.getByRole("button",{name:"NOC",exact:true}).click();
    await expect(panel).toContainText("Northrop Grumman");await expect(panel).toContainText("2,093");
    await expect(panel).toContainText("7.5%");await expect(panel).toContainText("Defense Systems");
    const baseline=panel.locator("summary").filter({hasText:lang==="en"?"Conditional baseline":"有条件基准"});
    await baseline.click();
    await expect(panel).toContainText(lang==="en"?defenseOwner.profiles[2].interpretation.scenarios[0].assumption_en:defenseOwner.profiles[2].interpretation.scenarios[0].assumption_zh);
    await expect(panel.locator('a[href^="https://www.sec.gov/Archives/edgar/data/"]').first()).toBeVisible();
    await panel.evaluate(element=>element.scrollIntoView({block:"start"}));await noOverflow(page);
    await page.screenshot({path:testInfo.outputPath(`defense-${testInfo.project.name}-${lang}-source-bound.png`),fullPage:true});
    expect(errors).toEqual([]);
  });
}

test("Defense outage clears company figures without removing market observations",async({page})=>{
  await prepare(page);await page.goto("/discover?tab=catalysts");
  const panel=page.getByTestId("defense-research");await expect(panel).toContainText("4,101");
  await page.unroute("**/api/catalyst-opportunities/defense");
  await page.route("**/api/catalyst-opportunities/defense",route=>route.fulfill({status:503,json:{error:"UNAVAILABLE"}}));
  await panel.getByRole("button",{name:"Refresh evidence",exact:true}).click();
  await expect(panel).toContainText("Defense evidence is unavailable");
  await expect(panel).not.toContainText("4,101");await expect(panel.locator('a[href*="sec.gov"]')).toHaveCount(0);
  await expect(page.getByTestId("catalyst-opportunities").locator("article")).toHaveCount(2);await noOverflow(page);
});

// Actual committed source content; the receipt/assessment clock is a fixed test replay.
test("49-theme dated source keeps covered Defense separate from company research",async({page},testInfo)=>{
  await prepare(page,"en",200,datedSource);await page.goto("/discover?tab=catalysts");
  const root=page.getByTestId("catalyst-opportunities");
  await expect(root.locator("article")).toHaveCount(6);
  await root.getByRole("button",{name:"Defense",exact:true}).click();
  await expect(root.locator("article")).toHaveCount(0);
  await root.getByText("Inspect coverage and theme states (49)",{exact:true}).click();
  await expect(root.getByRole("table").locator("tbody tr")).toHaveCount(49);
  await expect(root.getByRole("row").filter({hasText:"Defense"}).getByRole("cell",{name:"No",exact:true})).toBeVisible();
  const panel=root.getByTestId("defense-research");await expect(panel).toContainText("4,101");
  await panel.evaluate(element=>element.scrollIntoView({block:"start"}));await noOverflow(page);
  await page.screenshot({path:testInfo.outputPath(`dated-source-${testInfo.project.name}.png`),fullPage:true});
});


for (const lang of ["en","zh"] as const) {
  test(`inspect exact economic evidence without confusing cash, guidance or ownership - ${lang}`,async({page},testInfo)=>{
    const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    let ownerRequests=0;page.on("request",request=>{if(request.url().endsWith("/api/catalyst-opportunities/defense"))ownerRequests+=1;});
    await prepare(page,lang);await page.goto("/discover?tab=catalysts");
    const panel=page.getByTestId("defense-research"), facts=panel.getByTestId("defense-source-fact");
    await expect(panel).toContainText("4,101");await expect(facts).toHaveCount(0);
    const initialRequests=ownerRequests;
    const allLabel=lang==="en"?"Inspect all company evidence":"核查全部公司证据";
    await panel.getByRole("button",{name:new RegExp(`^${allLabel}`)}).click();
    const allEvidence=panel.getByRole("region",{name:allLabel,exact:true});
    await expect(facts).toHaveCount(defenseOwner.profiles[0].axes.economics.facts.length);
    await expect(allEvidence.getByText("-150",{exact:true})).toBeVisible();
    await expect(allEvidence).toContainText(lang==="en"?"Company guidance, not a reported result":"公司指引，并非已披露业绩");
    await expect(allEvidence).toContainText(lang==="en"?"Earlier company guidance":"先前公司指引");
    await noOverflow(page);
    await panel.getByRole("button",{name:"NOC",exact:true}).click();await expect(facts).toHaveCount(0);
    const marginSummary=panel.locator("summary").filter({hasText:lang==="en"?"Segment operating margin":"分部营业利润率"}).first();
    await marginSummary.focus();await expect(marginSummary).toBeFocused();await page.keyboard.press("Enter");
    const margin=marginSummary.locator("..");
    await margin.getByRole("button",{name:new RegExp(lang==="en"?"^Inspect supporting evidence":"^核查支持证据")}).click();
    await expect(margin.getByTestId("defense-source-fact")).toHaveCount(4);
    await expect(margin).toContainText("12.7%");await expect(margin).toContainText(lang==="en"?"not a cash payment":"并非现金付款");
    await noOverflow(page);
    await margin.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`defense-evidence-${testInfo.project.name}-${lang}-margin.png`)});
    await panel.getByRole("button",{name:"LHX",exact:true}).click();await expect(facts).toHaveCount(0);
    await panel.getByRole("button",{name:new RegExp(`^${allLabel}`)}).click();
    const terms=facts.filter({hasText:lang==="en"?"Completed space-business sale disclosure":"已完成航天业务出售的披露"});
    await terms.locator("summary").filter({hasText:lang==="en"?"Original source wording":"原始来源措辞"}).click();
    await expect(terms.locator('blockquote[lang="en"]')).toContainText("$845 million");
    await expect(facts.filter({hasText:lang==="en"?"Earlier proposed space-business sale terms":"早先拟议的航天业务出售条款"})).toContainText(lang==="en"?"Conditional terms":"有条件条款");
    await expect(panel.getByRole("region",{name:allLabel,exact:true})).toContainText(lang==="en"?"Cash-flow effect of receivables":"应收款项对现金流的影响");
    await noOverflow(page);expect(ownerRequests).toBe(initialRequests);expect(errors).toEqual([]);
  });
}


test("Defense entitlement denial clears both lanes and a fresh authorized read can recover",async({page})=>{
  await prepare(page);
  await page.unroute("**/api/catalyst-opportunities/defense");
  await page.route("**/api/catalyst-opportunities/defense",route=>route.fulfill({status:403,json:{error:"ENTITLEMENT_REQUIRED"}}));
  await page.goto("/discover?tab=catalysts");const root=page.getByTestId("catalyst-opportunities");
  await expect(root).toContainText("requires the site-full research entitlement");
  await expect(root.locator("article")).toHaveCount(0);await expect(root).not.toContainText("4,101");
  await expect(root.getByTestId("defense-source-fact")).toHaveCount(0);
  await page.unroute("**/api/catalyst-opportunities/defense");
  await page.route("**/api/catalyst-opportunities/defense",route=>route.fulfill({status:200,json:defenseOwner}));
  await root.getByRole("button",{name:"Refresh sources",exact:true}).first().click();
  await expect(root.locator("article")).toHaveCount(2);await expect(root).toContainText("4,101");await noOverflow(page);
});
