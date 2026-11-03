import { expect, test } from "@playwright/test";

for (const lang of ["en", "zh"] as const) {
  test(`Levels keeps the selected symbol through its guide and browser history (${lang})`, async ({ page }) => {
    await page.addInitScript(l => localStorage.setItem("mm.lang", l), lang);
    const reads: string[] = [];
    page.on("request", req => {
      const url = new URL(req.url());
      const key = url.searchParams.get("f");
      if (url.pathname === "/api/flow" && key?.startsWith("levels:")) reads.push(key);
    });
    await page.goto("/options?tab=levels&symbol=%20qqq%20&keep=kept");
    const symbol = page.locator('input[list="levels-roots"]');
    await expect(symbol).toHaveValue("QQQ");
    await expect.poll(() => reads).toContain("levels:QQQ");
    expect(reads).not.toContain("levels:SPY");

    await symbol.fill("brk.b");
    await symbol.press("Enter");
    await expect(page).toHaveURL(/symbol=BRK.B/);
    expect(new URL(page.url()).searchParams.get("keep")).toBe("kept");
    await expect.poll(() => reads).toContain("levels:BRK.B");
    await page.goBack();
    await expect(symbol).toHaveValue("QQQ");
    await page.goForward();
    await expect(symbol).toHaveValue("BRK.B");

    const guide = page.locator('.levels-board a[href^="/learn"]');
    await expect(guide).toHaveAttribute("href", "/learn?symbol=BRK.B");
    await guide.click();
    await expect(page).toHaveURL(/\/learn\?symbol=BRK.B$/);
    const back = page.getByRole("link", { name: lang === "zh" ? "← 返回档位图 · BRK.B" : "← Back to the board · BRK.B", exact: true });
    const href = "/options?tab=levels&symbol=BRK.B";
    await expect(back).toHaveAttribute("href", href);
    await expect(back).toContainText("BRK.B");
    await expect(page.locator("header a").first()).toHaveAttribute("href", href);
    await expect(page.locator("main a").last()).toHaveAttribute("href", href);
    await back.click();
    await expect(symbol).toHaveValue("BRK.B");
    await page.reload();
    await expect(symbol).toHaveValue("BRK.B");
    await expect(page).toHaveURL(/tab=levels&symbol=BRK.B$/);
  });
}

test("Levels guide ignores malformed and ambiguous symbols and never accepts a return URL", async ({ page }) => {
  for (const search of ["symbol=..%2Fsecret", "symbol=IWM&symbol=QQQ"]) {
    await page.goto(`/learn?${search}&returnTo=https%3A%2F%2Fexample.invalid%2F`);
    const back = page.locator("header a").last();
    await expect(back).toHaveAttribute("href", "/options?tab=levels");
  }
  const requests: string[] = [];
  page.on("request", request => {
    const key = new URL(request.url()).searchParams.get("f");
    if (key?.startsWith("levels:")) requests.push(key);
  });
  await page.goto("/options?tab=levels&symbol=..%2Fsecret");
  await expect(page.locator('input[list="levels-roots"]')).toHaveValue("SPY");
  await expect.poll(() => requests).toContain("levels:SPY");
  expect(new Set(requests)).toEqual(new Set(["levels:SPY"]));
});
