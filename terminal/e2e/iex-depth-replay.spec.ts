import { expect, test, type Page } from "@playwright/test";
import fixture from "../lib/__tests__/fixtures/iexDepthReplay.synthetic.json";
async function prepare(page: Page) {
  const url = test.info().project.use.baseURL || `http://127.0.0.1:${process.env.TERMINAL_E2E_PORT || 3108}`;
  await page.context().addCookies([{ name:"mm_e2e_rs30", value:"1", url }]);
}
async function source(page: Page, mode = "valid") {
  await page.route("**/api/large-trades?*", async route => {
    const symbol = new URL(route.request().url()).searchParams.get("sym");
    if (mode === "absent" || symbol !== "SPY") return route.fulfill({ json:{state:"unavailable",reason:"feed_not_admitted"} });
    const envelope = structuredClone(fixture);
    if (mode === "invalid") envelope.depthReplay.priceScale = 4;
    return route.fulfill({json:{state:"ready",envelope,artifactSha256:"a".repeat(64),servedAtNs:envelope.provenance.generatedAtNs}});
  });
}
async function fits(page: Page) {
  const x = await page.evaluate(() => ({width:document.documentElement.clientWidth, content:document.documentElement.scrollWidth}));
  expect(x.content).toBeLessThanOrEqual(x.width+1);
}

test("IEX observed depth and native correction-aware volume share one replay cursor", async ({page}) => {
  await prepare(page); await source(page);
  const errors: string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/options/equity-replay?symbol=SPY");
  await expect(page.getByTestId("iex-depth-replay")).toContainText("IEX venue only");
  await expect(page.getByTestId("iex-depth-level").first()).toBeVisible();
  await expect(page.getByTestId("iex-executed-total")).toHaveText("60");
  await expect(page.getByTestId("iex-bid-total")).toHaveText("60");
  const slider = page.getByRole("slider",{name:"Observed snapshot"});
  await slider.focus();await slider.press("Home");
  await expect(page.getByTestId("iex-executed-total")).toHaveText("50");
  await page.getByRole("tab",{name:"Executed volume",exact:true}).click();
  await expect(page.getByTestId("iex-footprint-row")).toHaveCount(1);
  await expect(page.getByTestId("iex-footprint-row")).toContainText("100.0000");
  await slider.press("End");
  await expect(page.getByTestId("iex-executed-total")).toHaveText("60");
  await expect(page.getByTestId("iex-footprint-row")).toHaveCount(3);
  await expect(page.getByTestId("iex-depth-replay")).toContainText("Data provided for free by IEX.");
  await fits(page);expect(errors).toEqual([]);
});

test("a gap withholds the selected book, and unavailable instruments cannot reuse old data", async ({page}) => {
  await prepare(page);await source(page);
  await page.goto("/options/equity-replay?symbol=SPY");
  const slider=page.getByRole("slider",{name:"Observed snapshot"});
  await slider.focus();await slider.press("Home");await slider.press("ArrowRight");await slider.press("ArrowRight");
  await expect(page.getByTestId("iex-book-gap")).toBeVisible();
  await expect(page.getByTestId("iex-bid-total")).toHaveText("—");
  await expect(page.getByTestId("iex-depth-gap")).toHaveCount(1);
  await page.getByLabel("Symbol",{exact:true}).selectOption("QQQ");
  await expect(page.getByTestId("iex-depth-unavailable")).toBeVisible();
  await expect(page.getByTestId("iex-executed-total")).toHaveCount(0);
  await expect(page.getByTestId("iex-depth-chart")).toHaveCount(0);
  await fits(page);
});

test("shared language, exact share units and source-contract refusal remain responsive",async({page})=>{
  await prepare(page);await source(page);
  await page.goto("/options/equity-replay?symbol=SPY");
  await expect(page.getByTestId("iex-executed-total")).toBeVisible();
  await page.getByRole("button",{name:"Language",exact:true}).click();
  await expect(page.getByTestId("iex-depth-replay")).toHaveAttribute("lang","zh");
  await expect(page.getByTestId("iex-depth-replay")).toContainText("单位为股");
  await fits(page);
  await page.unroute("**/api/large-trades?*");await source(page,"invalid");
  await page.getByRole("button",{name:"刷新来源",exact:true}).click();
  await expect(page.getByTestId("iex-depth-unavailable")).toBeVisible();
  await expect(page.getByTestId("iex-executed-total")).toHaveCount(0);
});
