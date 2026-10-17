import { expect, test, type Page } from "@playwright/test";
import fixture from "../lib/__tests__/fixtures/catalystOpportunity.json";

// Exercises the shipped Discover tab and components with an explicitly synthetic
// Python-produced contract. This is browser behavior proof, not live-data/auth proof.
test.setTimeout(90000);
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
});

test("failed sources do not pretend that the market is quiet; native tab is reachable",async({page})=>{
  await prepare(page,"en",503,{error:"CATALYST_UNAVAILABLE"});
  await page.goto("/discover?tab=catalysts");const root=page.getByTestId("catalyst-opportunities");
  await expect(root).toContainText("not a signal that markets are quiet");
  await expect(root.getByRole("link",{name:"Open Sector Intelligence",exact:true})).toHaveAttribute("href","/discover?tab=sectors");
  await expect(root.locator("article")).toHaveCount(0);
  await noOverflow(page);
});
