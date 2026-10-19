import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";
import { paperSectorFixture, type PaperFixtureMode } from "./fixtures/sector-paper-r2";

test.setTimeout(90000);
// Use the existing non-chart shell fixture identity. The watchlist route retains
// its own isolated per-test fixture store; no production auth seam is changed.
test.beforeEach(async ({page,baseURL})=>{
  await page.context().addCookies([{name:"mm_e2e_rs30",value:"1",url:baseURL!}]);
});
const url="/discover?tab=sectors&sectorTheme=light";
async function prepare(page:Page,lang="en",mode:()=>PaperFixtureMode=()=>"ready"){
  await page.addInitScript(language=>{localStorage.setItem("mm.lang",language);document.documentElement?.setAttribute("data-lang",language);},lang);
  await page.route("**/api/sector-intelligence?**",route=>paperSectorFixture(route,mode()));
}
async function noOverflow(page:Page){
  const root=page.getByTestId("sector-intelligence");
  expect(await root.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
}
async function capture(page:Page,testInfo:TestInfo,name:string){
  const directory=path.resolve("..","design_refs","sector-paper-r2","validation");
  await mkdir(directory,{recursive:true});
  await page.screenshot({path:path.join(directory,name+"-"+testInfo.project.name+".png"),animations:"disabled"});
}
function navigation(page:Page){return page.getByTestId("sector-paper-workspace").getByRole("navigation",{name:"Sector Intelligence",exact:true});}

test("Paper Brief presents native percent history, partial coverage and one main landmark",async({page},testInfo)=>{
  await prepare(page);await page.goto(url);
  const paper=page.getByTestId("sector-paper-workspace");
  await expect(paper.getByRole("heading",{name:"Energy leads the measured sector ranking."})).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(paper.getByTestId("paper-sector-coverage")).toContainText("9 / 11");
  await expect(paper.getByRole("img",{name:/Relative leadership history: Energy versus SPY/})).toBeVisible();
  const table=paper.getByText("View accessible value table",{exact:true});
  await table.click();
  await expect(paper.getByRole("cell",{name:"+2.40%",exact:true})).toBeVisible();
  await expect(paper.getByRole("cell",{name:"+4.10%",exact:true})).toBeVisible();
  await table.click();
  await capture(page,testInfo,"brief-history-light-en");
  await page.getByTestId("sector-intelligence").evaluate(el=>el.scrollTo(0,0));
  await page.evaluate(()=>window.scrollTo(0,0));
  await noOverflow(page);await capture(page,testInfo,"brief-light-en");
});

test("native dossier, Research and outer Discover browser Back preserve identity",async({page},testInfo)=>{
  await prepare(page);await page.goto(url);
  await page.getByRole("button",{name:"Inspect Energy →",exact:true}).click();
  await expect(page).toHaveURL(/sector=xle/);
  await expect(page.getByTestId("sector-intelligence").getByRole("heading",{name:"Energy",exact:true})).toBeVisible();
  await capture(page,testInfo,"dossier-light-en");
  const dossierUrl=page.url();
  await navigation(page).getByRole("button",{name:"Research",exact:true}).click();
  await expect(page.getByRole("link",{name:"Open saved research ↗",exact:true})).toHaveAttribute("href","/analysis?view=investigations&symbol=XLE");
  await expect(page.getByTestId("sector-paper-workspace")).toContainText("This sector snapshot is not saved with it yet.");
  await noOverflow(page);await capture(page,testInfo,"research-light-en");
  const researchUrl=page.url();
  await page.getByRole("button",{name:"Open the selected dossier →",exact:true}).click();
  await expect(page.getByTestId("sector-detail-return")).toHaveText("← Return to Research");
  await page.goBack();await expect(page).toHaveURL(researchUrl);
  await page.goBack();await expect(page).toHaveURL(dossierUrl);
  await expect(page.getByTestId("sector-detail-return")).toHaveText("← Return to Brief");
  await expect(page.getByTestId("sector-intelligence").getByLabel("Sector",{exact:true})).toHaveValue("xle");
  await page.getByTestId("sector-detail-return").click();
  await expect(page.getByTestId("sector-paper-workspace")).toHaveAttribute("data-paper-route","brief");
  await expect(page.getByRole("button",{name:"Inspect Energy →",exact:true})).toBeFocused();
  const beforeTab=page.url();
  await page.locator("#wtab-heatmap").click();
  await expect(page.locator("#wtab-heatmap")).toHaveAttribute("aria-selected","true");
  await page.goBack();await expect(page).toHaveURL(beforeTab);
  await expect(page.locator("#wtab-sectors")).toHaveAttribute("aria-selected","true");
  await expect(page.getByTestId("sector-paper-workspace")).toHaveAttribute("data-paper-route","brief");
});

test("Rotation uses the native instrument and What changed reaches its event section",async({page},testInfo)=>{
  await prepare(page);await page.goto(url);
  await navigation(page).getByRole("button",{name:"Explore",exact:true}).click();
  const rotation=page.getByTestId("sector-rotation");
  await expect(rotation).toBeVisible();
  await expect(rotation.getByTestId("rotation-measured-coverage")).toContainText("9");
  await expect(rotation.getByTestId("rotation-plot")).toBeVisible();
  await noOverflow(page);await capture(page,testInfo,"rotation-light-en");
  await navigation(page).getByRole("button",{name:"Brief",exact:true}).click();
  await page.getByRole("button",{name:"What changed? →",exact:true}).click();
  await expect(page.getByTestId("rotation-native-episodes")).toBeFocused();
  await expect(page).toHaveURL(/sectorPaperLens=rotation/);
  const source=page.getByTestId("sector-paper-workspace").getByRole("button",{name:"Review sources →",exact:true}).last();
  await source.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await capture(page,testInfo,"sources-light-en");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(source).toBeFocused();
});

test("Confluence, themes and shared-watch continuation are real reachable destinations",async({page},testInfo)=>{
  await prepare(page);await page.goto(url);
  await navigation(page).getByRole("button",{name:"Explore",exact:true}).click();
  const lenses=page.getByRole("navigation",{name:"Explore views",exact:true});
  await lenses.getByRole("button",{name:"Confluence",exact:true}).click();
  const paper=page.getByTestId("sector-paper-workspace");
  await expect(paper).toContainText("Semiconductors");
  await expect(paper).toContainText("2026-09-23");
  await noOverflow(page);await capture(page,testInfo,"confluence-light-en");
  await lenses.getByRole("button",{name:"Themes & overlap",exact:true}).click();
  await expect(paper).toContainText("Memory, HBM & Storage");
  await expect(paper).toContainText("Shared membership is not independent evidence.");
  await noOverflow(page);await capture(page,testInfo,"themes-light-en");
  await navigation(page).getByRole("button",{name:"My watches",exact:true}).click();
  await expect(paper.getByRole("link",{name:"Manage watchlists ↗",exact:true})).toHaveAttribute("href","/terminal");
  await expect(paper.getByTestId("paper-sector-watches")).toContainText("Default");
  await expect(paper).toContainText("Sector condition alerts and saved views are not connected yet.");
});

test("Chinese dark Brief keeps the Paper hierarchy and fits the viewport",async({page},testInfo)=>{
  await prepare(page,"zh");await page.goto(url.replace("sectorTheme=light","sectorTheme=dark"));
  const paper=page.getByTestId("sector-paper-workspace");
  await expect(paper).toHaveAttribute("data-theme","dark");
  await expect(paper.getByRole("heading",{name:"能源领跑已测量 板块排名。"})).toBeVisible();
  await expect(paper.getByRole("img",{name:/能源相对SPY的领先表现历史/})).toBeVisible();
  await noOverflow(page);await capture(page,testInfo,"brief-dark-zh");
});

test("missing history remains a measured table and refresh removes prior-account evidence",async({page},testInfo)=>{
  let mode:PaperFixtureMode="no-history";
  await prepare(page,"en",()=>mode);await page.goto(url);
  const paper=page.getByTestId("sector-paper-workspace");
  await expect(paper.getByRole("heading",{name:"Energy leads the measured sector ranking."})).toBeVisible();
  await expect(paper.getByRole("img",{name:/Relative leadership history/})).toHaveCount(0);
  await expect(paper.getByRole("table")).toContainText("+2.40%");
  await capture(page,testInfo,"brief-missing-history-light-en");
  mode="access";
  await paper.getByRole("button",{name:"Refresh",exact:true}).click();
  await expect(paper.getByRole("heading",{name:"Sector evidence needs access",exact:true})).toBeVisible();
  await expect(paper.getByRole("heading",{name:"Energy leads the measured sector ranking."})).toHaveCount(0);
  await expect(paper.getByTestId("paper-sector-coverage")).toHaveCount(0);
  await expect(paper.getByRole("table")).toHaveCount(0);
  await noOverflow(page);await capture(page,testInfo,"brief-access-light-en");
});

test("My watches uses the existing owner API and retains an added sector across reload",async({page,baseURL},testInfo)=>{
  await isolateWatchlistStore(page,testInfo,baseURL);
  await prepare(page);
  const created=await page.request.post("/api/watchlist",{data:{action:"createList",name:"Paper sector ideas"}});
  expect(created.ok()).toBe(true);const list=(await created.json()).list;
  const seeded=await page.request.post("/api/watchlist",{data:{action:"add",listId:list.id,symbols:["AAPL"],section:""}});
  expect(seeded.ok()).toBe(true);
  await page.goto(url+"&sector=xle&sectorPaperRoute=watches");
  const owned=page.locator('[data-watchlist-id="'+list.id+'"]');
  await expect(owned).toContainText("AAPL");
  const add=owned.getByRole("button",{name:"Watch XLE in Paper sector ideas",exact:true});
  await add.click();
  await expect(add).toBeDisabled();await expect(add).toContainText("XLE is saved");
  const saved=await page.request.get("/api/watchlist");
  const inventory=await saved.json();
  expect(inventory.lists.find((row:{id:string})=>row.id===list.id).symbols.map((row:{symbol:string})=>row.symbol)).toEqual(["AAPL","XLE"]);
  await page.reload();
  await expect(owned.getByRole("button",{name:"Watch XLE in Paper sector ideas",exact:true})).toBeDisabled();
  await noOverflow(page);await capture(page,testInfo,"watches-light-en");
  await owned.scrollIntoViewIfNeeded();await capture(page,testInfo,"watches-saved-light-en");
  await owned.getByRole("button",{name:"Inspect sector →",exact:true}).click();
  await expect(page.getByTestId("sector-detail-return")).toHaveText("← Return to My watches");
  await page.getByTestId("sector-detail-return").click();
  await expect(page.getByTestId("sector-paper-workspace")).toHaveAttribute("data-paper-route","watches");
  await expect(owned).toContainText("XLE");
});

test("direct Paper lens links select the matching native instrument",async({page},testInfo)=>{
  await prepare(page);
  for(const [lens,workspace,label] of [["breadth","breadth","Breadth"],["rotation","rotation","Rotation"],["market-map","discover","Market map"]]){
    await page.goto(url+"&sectorPaperRoute=explore&sectorPaperLens="+lens);
    await expect(page.getByTestId("sector-intelligence")).toHaveAttribute("data-sector-workspace",workspace);
    await expect(page.getByRole("navigation",{name:"Explore views",exact:true}).getByRole("button",{name:label,exact:true})).toHaveAttribute("aria-current","page");
    if(lens==="breadth")await expect(page.getByTestId("sector-discovery").getByRole("heading",{name:"Market breadth",exact:true})).toBeVisible();
    if(lens==="rotation")await expect(page.getByTestId("rotation-plot")).toBeVisible();
    await noOverflow(page);
    if(lens!=="rotation")await capture(page,testInfo,lens+"-light-en");
  }
});
