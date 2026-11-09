import { expect, test } from "@playwright/test";

for (const lang of ["en", "zh"] as const) {
  test(`Surface reads a chosen strike, pins it, and returns to the observation (${lang})`, async ({ page }, info) => {
    test.setTimeout(100_000);
    await page.addInitScript(value => localStorage.setItem("mm.lang", value), lang);
    const posts: unknown[] = [];
    await page.route("**/api/alerts", route => {
      if (route.request().method() !== "POST") return route.continue();
      posts.push(route.request().postDataJSON());
      return route.fulfill({ json: { alert: { id: "fixture-strike-alert" } } });
    });
    const date = "2026-09-17";
    const stamps = ["0930", "0935", "0940"];
    await page.route("**/api/intraday?**", route => route.fulfill({ json: { bars: [] } }));
    await page.route("**/api/flow?**", route => {
      const key = new URL(route.request().url()).searchParams.get("f");
      if (key === "surface_idx:SPY") return route.fulfill({ json: { root: "SPY", date, stamps, latest: "0940", cadenceSec: 300 } });
      if (key?.startsWith("surface:SPY:")) {
        const end = stamps.indexOf(key.slice(-4)) + 1;
        return route.fulfill({ json: {
          root: "SPY", session_date: date, spot: 100.3, price_levels: [95,100,105],
          time_steps: ["09:30","09:35","09:40"].slice(0,end), cadence: "5-min",
          grids: { netprem: [[1300,1500,null], [2000,2200,0], [0,3200,3400]].map(row => row.slice(0,end)) },
          asof: `${date}T13:${key.slice(-2)}:00Z`,
        } });
      }
      return route.continue();
    });
    await page.goto("/options?tab=surface");
    const entry = page.getByRole("button", { name: lang === "en" ? "Inspect strike" : "查看行权价", exact: true });
    await expect(entry).toBeEnabled({ timeout: 45_000 });
    await entry.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    const strike = dialog.getByRole("combobox", { name: lang === "en" ? "Strike price" : "行权价" });
    await expect(strike).toHaveValue("1");
    await expect(dialog).toContainText("+$0");
    await strike.selectOption("0");
    await expect(dialog).toContainText(lang === "zh" ? "美东时间 09:40" : "09:40 ET");
    await expect(dialog.locator("strong").first()).toHaveText("—");
    await strike.selectOption("2");
    await expect(dialog.locator("strong").first()).toHaveText("+$3.4K");
    const pin = dialog.getByRole("button", { name: lang === "en" ? "Pin to chart" : "钉在图上" });
    await pin.click();
    await expect(dialog.getByRole("button", { pressed: true })).toBeVisible();
    await expect(page.locator(".obs-surf-frame-rail")).toHaveAttribute("aria-valuenow","3");
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await dialog.screenshot({ path: info.outputPath("strike-inspector.png") });
    await dialog.locator("summary").filter({ hasText: lang === "en" ? "Price alert" : "价格提醒" }).click();
    const condition = dialog.getByRole("combobox", { name: lang === "en" ? "Price condition" : "价格条件" });
    await expect(condition).toHaveValue("above");
    await condition.selectOption("below");
    expect(posts).toEqual([]);
    await dialog.getByRole("button", { name: lang === "en" ? "Create alert" : "创建提醒", exact: true }).click();
    await expect(dialog.getByRole("button", { name: lang === "en" ? "Alert created" : "提醒已创建" })).toBeDisabled();
    expect(posts).toEqual([{ symbol: "SPY", condition: { type: "price", op: "below", value: 105 } }]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
    await expect(page.locator(".obs-surf-pins")).toContainText("105");
    await page.locator(".obs-surf-yfit button").last().click();
    const plot = page.locator(".obs-surf-chart-area").first();
    const chosen: number[] = [];
    for (const y of [.23, .73]) {
      await plot.scrollIntoViewIfNeeded();
      const area = await plot.locator("canvas").first().boundingBox();
      expect(area).not.toBeNull();
      const x = area!.x + area!.width * .45, pos = area!.y + area!.height * y;
      await expect.poll(() => plot.evaluate((el, point) =>
        el.contains(document.elementFromPoint(point.x, point.y)), { x, y: pos })).toBe(true);
      if (info.project.use.hasTouch) await page.touchscreen.tap(x, pos);
      else await page.mouse.click(x, pos);
      await expect(dialog).toBeVisible();
      chosen.push(Number(await strike.inputValue()));
      await dialog.locator(".obs-modal-close").click();
      await expect(entry).toBeFocused();
    }
    expect(chosen[0]).toBeGreaterThan(chosen[1]);

    // A short tap drills. Chart gestures must remain available on the same canvas.
    await plot.scrollIntoViewIfNeeded();
    const canvas = (await plot.locator("canvas").first().boundingBox())!;
    const cx = canvas.x + canvas.width / 2, cy = canvas.y + canvas.height * .48;
    if (info.project.use.hasTouch) {
      const client = await page.context().newCDPSession(page);
      try {
        const fingers = (gap: number) => [{ x: cx - gap, y: cy, id: 1 }, { x: cx + gap, y: cy, id: 2 }];
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers(14) });
        await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingers(33) });
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } finally {
        await client.detach();
      }
    } else {
      await page.mouse.move(cx, cy); await page.mouse.down();
      await page.mouse.move(cx + 45, cy + 8, { steps: 5 }); await page.mouse.up();
    }
    await expect(dialog).toHaveCount(0);
    await plot.locator("canvas").first().waitFor();
  });
}
