import { expect, test, type Page } from "@playwright/test";
import published from "./fixtures/company-search-published.json";
test.skip(process.env.MMX_SHARED_SHELL !== "1", "Shared Shell is an explicit local beta qualification");

// Real Next routes with frozen public emitted bytes. The incumbent local Analysis
// preview seam supplies no real account. Every API call is refused locally so the
// test cannot acquire live quotes, private research, or change account state.
async function publishedData(page: Page) {
  await page.route("**/api/**", route => route.fulfill({ status: 503, json: { error: "unavailable_in_local_qualification" } }));
  await page.route("**/data/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/data/manifest.json") return route.fulfill({ json: published.manifest });
    for (const symbol of ["BABA", "9988.HK"] as const) {
      if (path === `/data/${symbol}.fund.json`) return route.fulfill({ json: published.funds[symbol] });
    }
    return route.fulfill({ status: 404, json: { unavailable: true } });
  });
}

for (const theme of ["dark", "light"] as const) for (const lang of ["en", "zh"] as const) {
  test(`${theme} ${lang}: explicit HK listing → Analysis → exact Back and query`, async ({ page }, info) => {
    const fundReads: string[] = []; const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    page.on("request", request => { if (new URL(request.url()).pathname.endsWith(".fund.json")) fundReads.push(request.url()); });
    await publishedData(page);
    await page.goto("/discover");
    const narrow = page.viewportSize()!.width <= 860;
    const toggles = page.locator(narrow ? ".mobilebar" : ".topbar").locator(".shared-shell-presentation-toggle");
    await expect(toggles).toHaveCount(2);
    const languageToggle = toggles.nth(1);
    const themeToggle = toggles.nth(0);
    await expect(languageToggle).toBeVisible();
    if ((await languageToggle.getAttribute("aria-pressed") === "true") !== (lang === "zh")) await languageToggle.click();
    if ((await themeToggle.getAttribute("aria-pressed") === "true") !== (theme === "light")) await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const origin = page.url();
    const opener = page.viewportSize()!.width > 860
      ? page.locator(".topbar .shared-shell-company-search")
      : page.locator(".mobilebar").getByRole("button", { name: lang === "zh" ? "搜索公司" : "Search companies", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog");
    const input = dialog.getByRole("combobox"); await input.fill("Alibaba");
    await expect(dialog.locator('[data-company-symbol="BABA"]')).toContainText("NYSE");
    const hk = dialog.locator('[data-company-symbol="9988.HK"]');
    await expect(hk).toContainText("HKEX");
    if (info.project.name === "desktop") {
      const index = (await dialog.getByRole("option").allTextContents()).findIndex(text=>text.includes("9988.HK"));
      expect(index).toBeGreaterThanOrEqual(0);
      if (index === 0) await input.press("Enter");
      else for (let i = 0; i < index; i++) await input.press("ArrowDown");
    } else await hk.tap();
    const preview = dialog.locator("[data-company-listing]");
    const issuer = (await hk.locator("strong").innerText()).trim();
    await expect(dialog.getByRole("heading", { name: issuer, exact: true })).toHaveCount(1);
    await expect(preview.getByText(issuer, { exact: true })).toHaveCount(0);
    await expect(preview).toContainText("9988.HK"); await expect(preview).toContainText("HKEX");
    await expect(preview).toContainText("HKD"); await expect(preview).not.toContainText("CNY");
    const selectedBox = await hk.boundingBox(); const previewBox = await preview.boundingBox();
    if (info.project.name === "desktop") {
      expect(previewBox!.x).toBeGreaterThan(selectedBox!.x + selectedBox!.width);
      const panel = (await dialog.locator(".smodal").boundingBox())!;
      const column = (await page.locator(".app2.shared-shell > .main2").boundingBox())!;
      expect(panel.width).toBeGreaterThan(1000);
      expect(panel.x).toBeGreaterThanOrEqual(column.x + 23);
      expect(page.viewportSize()!.width - panel.x - panel.width).toBeCloseTo(24, 0);
    }
    else { expect(previewBox!.y).toBeGreaterThanOrEqual(selectedBox!.y); }

    expect(fundReads.length).toBeGreaterThan(0);
    expect(fundReads.every(url => new URL(url).pathname === "/data/9988.HK.fund.json")).toBe(true);
    expect(page.url()).toBe(origin);
    await page.screenshot({ path: info.outputPath("selected-listing.png"), animations: "disabled" });
    const open = preview.getByRole("button", { name: lang === "zh" ? "打开分析" : "Open Analysis", exact: true });
    await expect(open).toBeVisible();
    if (info.project.name === "desktop") await input.press("Enter");
    else await open.tap();
    await expect(page).toHaveURL(/\/analysis\?symbol=9988\.HK&company_query=Alibaba/);
    const identity = page.locator("[data-company-listing]");
    await expect(identity).toContainText("9988.HK"); await expect(identity).toContainText("HKEX");
    await expect(identity).toContainText("HKD"); await expect(identity).toContainText("Alibaba");
    await expect(identity).not.toContainText("CNY");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath("analysis-identity.png"), animations: "disabled" });
    await page.goBack(); await expect(page).toHaveURL(origin);
    await expect(page.getByRole("dialog").getByRole("combobox")).toHaveValue("Alibaba");
    await expect(page.getByRole("dialog").locator("[data-company-listing]")).toContainText("9988.HK");
    await expect(page.getByRole("dialog").locator("[data-company-listing]")).toContainText("HKD");
    await expect(page.getByRole("dialog").locator('[data-company-symbol="9988.HK"]')).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath("returned-search.png"), animations: "disabled" });
    expect(errors).toEqual([]);
  });
}

for (const lang of ["en", "zh"] as const) {
 test(`tools remain usable with company service unavailable; exact tool return ${lang}`,async({page},info)=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await publishedData(page);
  await page.route("**/data/manifest.json",route=>route.fulfill({status:503,json:{unavailable:true}}));
  await page.goto("/discover?view=tools&q=a%20b&q=a+b#research");
  const narrow=page.viewportSize()!.width<=860;
  const toggles=page.locator(narrow?".mobilebar":".topbar").locator(".shared-shell-presentation-toggle");
  if((await toggles.nth(1).getAttribute("aria-pressed")==="true")!==(lang==="zh"))await toggles.nth(1).click();
  if((await toggles.nth(0).getAttribute("aria-pressed")==="true")!==(lang==="zh"))await toggles.nth(0).click();
  const origin=page.url();
  const opener=narrow?page.locator(".mobilebar").getByRole("button",{name:lang==="zh"?"搜索公司":"Search companies",exact:true}):page.locator(".topbar .shared-shell-company-search");
  await opener.click();const dialog=page.getByRole("dialog");
  await expect(dialog.getByRole("heading",{name:lang==="zh"?"公司搜索暂时无法读取。":"Company search could not be loaded.",exact:true})).toBeVisible();
  await dialog.getByRole("button",{name:lang==="zh"?/^工具/:/^Tools/}).click();await dialog.getByRole("combobox").fill("cagr");
  const result=dialog.getByRole("option").filter({hasText:/CAGR|复合|复利/i});await expect(result).toHaveCount(1);await result.click();
  const open=dialog.getByRole("button",{name:lang==="zh"?/打开工具/:/Open tool/});await expect(open).toBeVisible();
  await page.screenshot({path:info.outputPath("tools-company-unavailable.png"),animations:"disabled"});
  await open.click();await expect(page).toHaveURL(/\/tools\/calculators\/cagr\.html$/);await page.goBack();await expect(page).toHaveURL(origin);
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveValue("cagr");await expect(page.locator('[data-shared-search-scope="tools"]')).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("option").filter({hasText:/CAGR|复合|复利/i})).toHaveAttribute("aria-selected","true");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
  await page.getByRole("dialog").getByRole("combobox").press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);await expect(opener).toBeFocused();
  await page.keyboard.press("/");
  await expect(page.locator('[data-shared-search-scope="companies"]')).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveValue("cagr");
  expect(page.url()).toBe(origin);
 });
}
